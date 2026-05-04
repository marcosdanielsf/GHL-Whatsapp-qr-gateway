import makeWASocket, {
  DisconnectReason,
  WASocket,
  proto,
  delay,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import path from "path";
import fs from "fs";
import pino from "pino";
import { logger, logMessage } from "../utils/logger";
import { messageHistory } from "./messageHistory";
import { notifyConnectionAlert } from "../utils/monitoring";
import {
  registerInstanceNumber as registerInstanceNumberCache,
  unregisterInstanceNumber as unregisterInstanceNumberCache,
  isInternalNumberGlobal,
  getAllInstanceNumbers,
} from "../infra/instanceNumbersCache";
import {
  addPendingImageMessage,
  addPendingTextMessage,
  consumePendingMessages,
} from "./pendingMessages";
import { getSupabaseClient } from "../infra/supabaseClient";
import { useSupabaseAuthState } from "./supabaseAuthState";
import { ghlService } from "../services/ghl.service";
import { handleJarvisMessage } from "../services/jarvis.service";
import { collectOwnerMessage } from "../services/messageCollector.service";
import { markSent, wasSentByApi } from "../services/sentMessageTracker.service";
import { triggerAutoTakeover } from "../services/conversationTakeover.service";

// InstanceMetadata para H4
interface InstanceMetadata {
  instanceId: string;
  phoneAlias?: string;
  phone: string | null;
  status: "ONLINE" | "OFFLINE" | "RECONNECTING";
  lastConnectedAt: string | null;
  lastError: string | null;
}

// Session mapping structure per instance
interface SessionMapping {
  jidByPhone: Record<string, string>; // phone -> jid (@s.whatsapp.net)
  lidByPhone: Record<string, string>; // phone -> lid (@lid)
  phoneByJid: Record<string, string>; // jid OR lid -> phone
}

// Map to store tenantId for each instanceId
const tenantByInstance: Map<string, string> = new Map();
const instancesUpsertInProgress = new Set<string>(); // debounce: evita loop de inserts
let isShuttingDown = false; // flag para ignorar eventos de disconnect durante graceful shutdown
const startingInstances = new Set<string>();
const intentionallyClosingSockets = new Set<string>();

// Store de sockets y QR codes
const activeSockets: Map<string, WASocket> = new Map();
const qrCodes: Map<string, string> = new Map();
const qrTimers: Map<string, ReturnType<typeof setTimeout>> = new Map(); // TTL cleanup
const connectionStatus: Map<string, "OFFLINE" | "RECONNECTING" | "ONLINE"> =
  new Map();
const reconnectAttempts: Map<string, number> = new Map();
const MAX_RECONNECT_ATTEMPTS = 5;
const instanceNumbers: Map<string, string> = new Map();
const instancesMetadata: Map<string, InstanceMetadata> = new Map();
// Anti-duplicados: registrar IDs de mensajes ya procesados por instancia
const processedMessageIds: Map<string, Map<string, number>> = new Map();
// Jarvis: track sent message IDs to prevent response loop
const jarvisSentIds: Set<string> = new Set();
// Session mappings per instance (replaces old jidToPhoneMap/phoneToJidMap)
const sessionMappings: Map<string, SessionMapping> = new Map();

/**
 * Limpia completamente el estado de una instancia en memoria
 * @param instanceId - ID de la instancia a limpiar
 */
/**
 * Obtiene o inicializa el session mapping para una instancia
 */
function getSessionMapping(instanceId: string): SessionMapping {
  if (!sessionMappings.has(instanceId)) {
    sessionMappings.set(instanceId, {
      jidByPhone: {},
      lidByPhone: {},
      phoneByJid: {},
    });
  }
  return sessionMappings.get(instanceId)!;
}

export function clearInstanceData(instanceId: string): void {
  if (isShuttingDown) return;
  activeSockets.delete(instanceId);
  qrCodes.delete(instanceId);
  const existingTimer = qrTimers.get(instanceId);
  if (existingTimer) {
    clearTimeout(existingTimer);
    qrTimers.delete(instanceId);
  }
  connectionStatus.delete(instanceId);
  instanceNumbers.delete(instanceId);
  instancesMetadata.delete(instanceId);
  processedMessageIds.delete(instanceId);
  sessionMappings.delete(instanceId);
  tenantByInstance.delete(instanceId); // Clear tenant mapping
  logger.debug(`🧹 [${instanceId}] Estado en memoria limpiado`);
}
const normalizeText = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim()
    .toLowerCase();

/**
 * Guarda el mapeo phone ↔ jid/lid desde onWhatsApp result
 */
function savePhoneMapping(
  instanceId: string,
  phone: string,
  jid: string,
  lid?: string,
): void {
  const session = getSessionMapping(instanceId);

  // Guardar jid principal
  session.jidByPhone[phone] = jid;
  session.phoneByJid[jid] = phone;

  // Si hay lid, también guardarlo
  if (lid) {
    session.lidByPhone[phone] = lid;
    session.phoneByJid[lid] = phone; // *** IMPORTANTE: mapear lid -> phone ***
  }

  logger.debug(
    `[${instanceId}] 💾 Mapeo guardado: phone=${phone}, jid=${jid}${lid ? `, lid=${lid}` : ""}`,
  );
}

/**
 * Resuelve el teléfono real desde cualquier JID (jid o lid)
 */
function resolvePhoneFromJid(
  instanceId: string,
  jid: string,
): string | undefined {
  const session = getSessionMapping(instanceId);

  // 1) Si ya conocemos este jid (o lid) en el mapeo, retornar phone
  const mapped = session.phoneByJid[jid];
  if (mapped) {
    logger.debug(
      `[${instanceId}] ✅ Resuelto desde mapeo: ${jid} → +${mapped}`,
    );
    return mapped;
  }

  // 2) Si es un JID clásico de @s.whatsapp.net, decodificar a phone
  if (jid.endsWith("@s.whatsapp.net")) {
    const num = jid.split("@")[0];
    // Usar la misma lógica de normalización que para outbound
    const normalized = jidToNormalizedNumber(jid);
    if (normalized) {
      logger.debug(
        `[${instanceId}] ✅ Decodificado JID clásico: ${jid} → +${normalized}`,
      );
      // Guardarlo para futuras referencias
      session.jidByPhone[normalized] = jid;
      session.phoneByJid[jid] = normalized;
      return normalized;
    }
  }

  // 3) Si es @lid y NO lo tenemos en el mapeo, NO fabricar un número falso
  if (jid.endsWith("@lid")) {
    logger.warn(
      `[${instanceId}] ⚠️ No se pudo resolver @lid: ${jid} (no está en mapeo)`,
    );
    return undefined;
  }

  logger.warn(`[${instanceId}] ⚠️ No se pudo resolver JID: ${jid}`);
  return undefined;
}

/**
 * Busca el JID conocido para un phone (usado en outbound)
 */
function findJidByPhone(instanceId: string, phone: string): string | undefined {
  const session = getSessionMapping(instanceId);

  // Priorizar lid si existe (más actualizado para dispositivos vinculados)
  const lid = session.lidByPhone[phone];
  if (lid) {
    logger.debug(`[${instanceId}] ✅ Encontrado LID para ${phone}: ${lid}`);
    return lid;
  }

  // Si no, usar jid clásico
  const jid = session.jidByPhone[phone];
  if (jid) {
    logger.debug(`[${instanceId}] ✅ Encontrado JID para ${phone}: ${jid}`);
    return jid;
  }

  logger.debug(`[${instanceId}] ❌ No se encontró JID/LID para ${phone}`);
  return undefined;
}

const normalizePhoneInput = (value: string): string => {
  const cleanNumber = value.replace(/[\s\-\(\)]/g, "");
  if (!cleanNumber.startsWith("+")) {
    throw new Error(
      `El número debe tener formato internacional con +. Recibido: ${value}`,
    );
  }

  const digitsOnly = cleanNumber.replace(/^\+/, "");
  if (!/^\d+$/.test(digitsOnly)) {
    throw new Error(`El número ${value} contiene caracteres no válidos`);
  }
  return digitsOnly;
};

const jidToNormalizedNumber = (jid?: string | null): string | null => {
  if (!jid) return null;

  // Aceptar JIDs de WhatsApp estándar (@s.whatsapp.net) y de dispositivos ligados (@lid)
  if (!jid.endsWith("@s.whatsapp.net") && !jid.endsWith("@lid")) return null;

  const raw = jid.split("@")[0];
  let digits = raw.replace(/[^\d]/g, "");

  // Si viene de @lid, podría tener formato especial, extraer solo dígitos
  // Para @lid el formato suele ser como "212356722368740@lid" donde los primeros dígitos son el número
  if (jid.endsWith("@lid")) {
    // Tomar los primeros 10-15 dígitos que típicamente representan el número
    const match = digits.match(/^(\d{10,15})/);
    if (match) {
      digits = match[1];
    }
  }

  // Validar y corregir números peruanos (código 51)
  // Los números peruanos tienen: código país (51) + 9 dígitos = 11 dígitos totales
  if (digits.startsWith("51") && digits.length > 11) {
    // Si tiene más de 11 dígitos, tomar solo los primeros 11 (51 + 9 dígitos)
    digits = digits.substring(0, 11);
  }

  return digits || null;
};

const isInternalContact = (jid?: string | null): boolean => {
  const normalized = jidToNormalizedNumber(jid);
  if (!normalized) return false;
  return Array.from(instanceNumbers.values()).includes(normalized);
};

const isInternalDestination = (identifier: string): boolean => {
  let normalized: string | null = null;
  if (identifier.includes("@")) {
    normalized = jidToNormalizedNumber(identifier);
  } else {
    try {
      normalized = normalizePhoneInput(identifier);
    } catch {
      normalized = null;
    }
  }
  if (!normalized) return false;
  return Array.from(instanceNumbers.values()).includes(normalized);
};

// Supabase-backed global registry to avoid loops across processes
async function registerInstanceNumber(
  instanceId: string,
  normalizedNumber: string,
): Promise<void> {
  await registerInstanceNumberCache(instanceId, normalizedNumber);
}

async function unregisterInstanceNumber(instanceId: string): Promise<void> {
  await unregisterInstanceNumberCache(instanceId);
}

/**
 * Actualiza los metadatos de una instancia
 */
function updateInstanceMetadata(
  instanceId: string,
  updates: Partial<InstanceMetadata>,
): void {
  const current = instancesMetadata.get(instanceId) || {
    instanceId,
    phone: null,
    status: "OFFLINE" as const,
    lastConnectedAt: null,
    lastError: null,
  };
  instancesMetadata.set(instanceId, { ...current, ...updates });
}

/**
 * Inicializa los metadatos de una instancia si no existen
 */
function initializeMetadata(instanceId: string, phoneAlias?: string): void {
  if (!instancesMetadata.has(instanceId)) {
    instancesMetadata.set(instanceId, {
      instanceId,
      phoneAlias,
      phone: null,
      status: "OFFLINE",
      lastConnectedAt: null,
      lastError: null,
    });
  } else if (phoneAlias) {
    // Actualizar phoneAlias si se proporciona
    const current = instancesMetadata.get(instanceId)!;
    instancesMetadata.set(instanceId, { ...current, phoneAlias });
  }
}

// isInternalNumberGlobal is now imported from instanceNumbersCache

async function isInternalContactAsync(jid?: string | null): Promise<boolean> {
  const normalized = jidToNormalizedNumber(jid);
  if (!normalized) return false;
  if (Array.from(instanceNumbers.values()).includes(normalized)) return true;
  return await isInternalNumberGlobal(normalized);
}

async function isInternalDestinationAsync(
  identifier: string,
): Promise<boolean> {
  let normalized: string | null = null;
  if (identifier.includes("@")) {
    normalized = jidToNormalizedNumber(identifier);
  } else {
    try {
      normalized = normalizePhoneInput(identifier);
    } catch {
      normalized = null;
    }
  }
  if (!normalized) return false;
  if (Array.from(instanceNumbers.values()).includes(normalized)) return true;
  return await isInternalNumberGlobal(normalized);
}

class WaitingForContactError extends Error {
  public code = "WAITING_CONTACT";
  public data: {
    pendingId: string;
    instanceId: string;
    to: string;
    normalizedNumber: string;
    type: "text" | "image";
  };

  constructor(
    message: string,
    data: {
      pendingId: string;
      instanceId: string;
      to: string;
      normalizedNumber: string;
      type: "text" | "image";
    },
  ) {
    super(message);
    this.name = "WaitingForContactError";
    this.data = data;
    Object.setPrototypeOf(this, WaitingForContactError.prototype);
  }
}

/**
 * Envía mensaje directamente a través del socket
 */
async function sendMessageViaSocket(
  sock: WASocket,
  instanceId: string,
  jid: string,
  message: string,
): Promise<void> {
  logger.debug(`[${instanceId}] 📤 Preparando envío directo:`, {
    jid,
    messageLength: message.length,
  });

  logger.info("Iniciando envío directo", {
    event: "message.send.starting",
    instanceId,
    jid,
  });

  try {
    logger.debug(
      `[${instanceId}] 📤 Llamando a sendMessage(${jid}, "${message.substring(0, 30)}...")`,
    );

    if (typeof sock.sendMessage !== "function") {
      throw new Error(
        `Socket de ${instanceId} no tiene la función sendMessage`,
      );
    }

    const startTime = Date.now();
    logger.debug(`[${instanceId}] ⏳ Iniciando envío (timeout: 15s)...`);

    const sendPromise = sock.sendMessage(jid, { text: message });
    let timeoutId: NodeJS.Timeout;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        logger.error(`\n[${instanceId}] ⏱️ TIMEOUT después de 15 segundos`);
        reject(
          new Error(`Timeout: No se pudo enviar el mensaje en 15 segundos.`),
        );
      }, 15000);
    });

    const result = (await Promise.race([sendPromise, timeoutPromise])) as proto.WebMessageInfo | undefined;
    clearTimeout(timeoutId!); // Limpiar timeout si se resolvió exitosamente
    const duration = Date.now() - startTime;

    markSent(result?.key?.id);

    logger.debug(
      `[${instanceId}] ✅ Mensaje enviado exitosamente en ${duration}ms`,
    );

    logger.info("Mensaje enviado exitosamente", {
      event: "message.send.success",
      instanceId,
      jid,
      duration,
      hasResult: !!result,
    });
    logMessage.send(instanceId, "text", jid, "sent", {
      messageLength: message.length,
    });
  } catch (error: any) {
    logger.error(`[${instanceId}] ❌ Error al enviar mensaje:`, error.message);
    logger.error("Error al enviar mensaje de texto", {
      event: "message.send.error",
      instanceId,
      jid,
      error: error.message,
    });
    throw error;
  }
}

async function downloadImageBuffer(mediaUrl: string): Promise<Buffer> {
  const response = await fetch(mediaUrl);
  if (!response.ok) {
    throw new Error(
      `Error al descargar imagen: ${response.status} - ${response.statusText}`,
    );
  }
  return Buffer.from(await response.arrayBuffer());
}

async function processPendingMessagesForContact(
  instanceId: string,
  sock: WASocket,
  from: string,
) {
  const normalizedNumber = jidToNormalizedNumber(from);
  if (!normalizedNumber) {
    return;
  }

  const pending = await consumePendingMessages(instanceId, normalizedNumber);
  if (!pending.length) {
    return;
  }

  logger.debug(
    `[${instanceId}] 🔁 Encontrados ${pending.length} mensajes pendientes para ${from}. Enviando...`,
  );

  for (const pendingMessage of pending) {
    try {
      logMessage.send(
        instanceId,
        pendingMessage.type,
        pendingMessage.to,
        "deferred",
        {
          pendingId: pendingMessage.id,
          trigger: "contact_reply",
        },
      );

      await delay(500);
      if (pendingMessage.type === "text") {
        const sent = await sock.sendMessage(from, { text: pendingMessage.message });
        markSent(sent?.key?.id);
      } else if (pendingMessage.type === "image") {
        const buffer = await downloadImageBuffer(pendingMessage.mediaUrl);
        const sent = await sock.sendMessage(from, { image: buffer });
        markSent(sent?.key?.id);
      }

      logMessage.send(
        instanceId,
        pendingMessage.type,
        pendingMessage.to,
        "sent",
        {
          pendingId: pendingMessage.id,
          trigger: "contact_reply",
        },
      );

      logger.debug(
        `[${instanceId}] ✅ Mensaje pendiente ${pendingMessage.id} enviado tras respuesta del contacto`,
      );
    } catch (error: any) {
      logger.error("Error al enviar mensaje pendiente", {
        event: "message.pending.error",
        instanceId,
        to: pendingMessage.to,
        pendingId: pendingMessage.id,
        error: error.message,
      });
      logMessage.send(
        instanceId,
        pendingMessage.type,
        pendingMessage.to,
        "failed",
        {
          pendingId: pendingMessage.id,
          trigger: "contact_reply",
          error: error.message,
        },
      );
    }
  }
}

/**
 * Envía un mensaje inbound recibido desde WhatsApp a GHL
 * Usa la API oficial de GHL Conversations si hay integración configurada
 * Fallback a webhook genérico si no hay integración
 */
async function sendInboundToGHL(
  instanceId: string,
  phoneNumber: string, // Ya viene formateado con "+" (ej: "+51968782155")
  text: string,
  timestamp?: number | Long,
): Promise<void> {
  const tenantId = tenantByInstance.get(instanceId);

  // Convertir timestamp a Date
  let timestampDate: Date;
  if (
    typeof timestamp === "object" &&
    timestamp !== null &&
    "toNumber" in timestamp
  ) {
    timestampDate = new Date((timestamp as any).toNumber() * 1000);
  } else if (typeof timestamp === "number") {
    timestampDate = new Date(timestamp * 1000);
  } else {
    timestampDate = new Date();
  }

  // Intentar usar la API oficial del GHL si hay integración configurada
  if (tenantId) {
    try {
      const integration = await ghlService.getIntegrationByTenantInstance(
        tenantId,
        instanceId,
      );

      if (integration) {
        logger.info("Usando GHL Conversations API para inbound", {
          event: "ghl.inbound.api",
          instanceId,
          locationId: integration.location_id,
          from: phoneNumber,
        });

        // Buscar ou criar contato pelo telefone
        const accessToken = await ghlService.ensureValidToken(integration);
        const contact = await ghlService.getOrCreateContact(
          accessToken,
          integration.location_id,
          phoneNumber,
        );

        if (!contact) {
          logger.warn("Não foi possível criar/encontrar contato no GHL", {
            event: "ghl.inbound.contact_error",
            instanceId,
            phone: phoneNumber,
          });
          // Fallback para webhook
        } else {
          // Enviar mensagem para a API do GHL
          const result = await ghlService.sendInboundMessage(
            integration,
            contact.id,
            text,
            timestampDate,
          );

          if (result.success) {
            logger.info("Mensaje inbound enviado a GHL via API", {
              event: "ghl.inbound.api_success",
              instanceId,
              contactId: contact.id,
              messageId: result.messageId,
            });

            logger.debug(
              `[${instanceId}] ✅ Mensaje inbound enviado a GHL (API):`,
              {
                from: phoneNumber,
                contactId: contact.id,
                text: text.substring(0, 50),
              },
            );

            return; // Éxito, no necesitamos fallback
          }

          logger.warn("Falló el envío via API, usando fallback webhook", {
            event: "ghl.inbound.api_fallback",
            instanceId,
            error: result.error,
          });
        }
      }
    } catch (err: any) {
      logger.warn("Error intentando usar GHL API, usando fallback webhook", {
        event: "ghl.inbound.api_error",
        instanceId,
        error: err.message,
      });
    }
  }

  // FALLBACK: Usar webhook genérico
  let ghlInboundUrl = process.env.GHL_INBOUND_URL;

  if (tenantId) {
    try {
      const supabaseSvc = getSupabaseClient();
      const { data, error } = await supabaseSvc
        .from("ghl_wa_tenants")
        .select("webhook_url, webhook_events")
        .eq("id", tenantId)
        .single();

      if (!error && data?.webhook_url) {
        // Filtrar por webhook_events do tenant (Task 7 F1)
        const allowedEvents: string[] = Array.isArray(data.webhook_events)
          ? data.webhook_events
          : ["message_received", "message_sent"];
        if (!allowedEvents.includes("message_received")) {
          logger.debug(
            `[${instanceId}] Webhook inbound ignorado — message_received não está em tenant.webhook_events`,
          );
          return;
        }

        ghlInboundUrl = data.webhook_url;
        logger.debug(
          `[${instanceId}] Usando webhook personalizado del tenant: ${ghlInboundUrl}`,
        );
      }
    } catch (err) {
      logger.warn(`[${instanceId}] Error buscando webhook del tenant:`, err);
    }
  }

  // Fallback final
  if (!ghlInboundUrl) {
    ghlInboundUrl = "http://localhost:8080/api/ghl/inbound-test";
    logger.warn(
      `[${instanceId}] Usando webhook fallback local: ${ghlInboundUrl}`,
    );
  }

  const timestampNumber = Math.floor(timestampDate.getTime() / 1000);

  const payload = {
    instanceId,
    from: phoneNumber,
    text,
    timestamp: timestampNumber,
  };

  try {
    logger.info("Enviando mensaje inbound a GHL (webhook fallback)", {
      event: "ghl.inbound.webhook",
      instanceId,
      from: phoneNumber,
      text: text.substring(0, 50),
      timestamp: timestampNumber,
    });

    const response = await fetch(ghlInboundUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(
        `GHL inbound endpoint returned ${response.status}: ${errorText}`,
      );
    }

    const result = await response.json().catch(() => null);

    logger.info("Mensaje inbound enviado a GHL exitosamente (webhook)", {
      event: "ghl.inbound.webhook_success",
      instanceId,
      from: phoneNumber,
      timestamp: timestampNumber,
      ghlResponse: result,
    });

    logger.debug(
      `[${instanceId}] ✅ Mensaje inbound enviado a GHL (webhook):`,
      {
        from: phoneNumber,
        text: text.substring(0, 50),
      },
    );
  } catch (error: any) {
    logger.error("Error al enviar mensaje inbound a GHL", {
      event: "ghl.inbound.send_error",
      instanceId,
      from: phoneNumber,
      error: error.message,
      stack: error.stack,
    });

    logger.error(
      `[${instanceId}] ❌ Error al enviar inbound a GHL:`,
      error.message,
    );

    // No lanzamos el error para no bloquear el flujo normal
    // El mensaje ya fue logueado y procesado localmente
  }
}

export interface MessagePayload {
  instanceId: string;
  to: string;
  type: "text" | "image";
  message?: string;
  mediaUrl?: string;
}

/**
 * Inicializa una instancia de WhatsApp
 */
export async function initInstance(
  instanceId: string,
  force: boolean = false,
  phoneAlias?: string,
  tenantId?: string,
): Promise<void> {
  // Guardar tenantId en el mapa si se proporciona
  if (tenantId) {
    tenantByInstance.set(instanceId, tenantId);
    logger.debug(`[${instanceId}] 🔗 Asociado al tenant: ${tenantId}`);
  }

  // Inicializar metadatos
  initializeMetadata(instanceId, phoneAlias);

  // Si la instancia ya existe y no estamos forzando, verificar si tiene QR
  if (activeSockets.has(instanceId) && !force) {
    const existingQR = qrCodes.get(instanceId);
    const existingStatus = connectionStatus.get(instanceId);

    // Si no tiene QR y está desconectado, forzar reinicio
    if (!existingQR && existingStatus === "OFFLINE") {
      logger.info(
        `[${instanceId}] Instancia existe pero sin QR, reiniciando...`,
      );
      force = true;
    } else {
      logger.info(`[${instanceId}] Instancia ya existe`);
      return;
    }
  }

  if (startingInstances.has(instanceId) && !force) {
    logger.info(`[${instanceId}] Inicialização já em andamento`);
    return;
  }

  startingInstances.add(instanceId);

  // Si estamos forzando, limpiar la instancia existente
  if (force && activeSockets.has(instanceId)) {
    const oldSock = activeSockets.get(instanceId);
    if (oldSock) {
      try {
        intentionallyClosingSockets.add(instanceId);
        oldSock.end(undefined);
      } catch (e) {
        // Ignorar errores al cerrar socket anterior
      }
    }
    if (activeSockets.get(instanceId) === oldSock) {
      activeSockets.delete(instanceId);
    }
    qrCodes.delete(instanceId);
    connectionStatus.delete(instanceId);
    instanceNumbers.delete(instanceId);
    logger.info(`[${instanceId}] Instancia anterior limpiada`);
  }

  logger.info(`[${instanceId}] Iniciando instancia (Supabase Auth)...`);
  connectionStatus.set(instanceId, "RECONNECTING");
  updateInstanceMetadata(instanceId, { status: "RECONNECTING" });

  // SIEMPRE limpiar sesión si estamos forzando para garantizar QR nuevo
  if (force) {
    logger.debug(`[${instanceId}] 🔄 FORZANDO LIMPIEZA DE SESIÓN (DB)...`);
    try {
      const supabase = getSupabaseClient();
      await supabase
        .from("ghl_wa_sessions")
        .delete()
        .eq("instance_id", instanceId);
      logger.debug(`[${instanceId}] ✅ Sesión eliminada de DB`);
    } catch (e) {
      logger.error(`[${instanceId}] Error limpiando sesión:`, e);
    }
  }

  let { state, saveCreds } = await useSupabaseAuthState(instanceId);
  const { version } = await fetchLatestBaileysVersion();

  // Verificar si hay credenciales guardadas
  const hasCredentials = !!state.creds.registered;
  const hasMe = !!state.creds.me?.id;

  logger.debug(`[${instanceId}] Estado de autenticación:`, {
    hasCredentials,
    me: state.creds.me?.id || "no me",
    registered: state.creds.registered,
    hasMe,
  });

  // Crear socket con configuración optimizada para QR
  // Logger de pino para Baileys (silent para evitar spam, pero funcional)
  const baileysLogger = pino({ level: "silent" });

  // markOnlineOnConnect: false — coexistência com WhatsApp Desktop/Web no mesmo
  // numero. Quando true, o Nexus reivindicava "presence: available" a cada
  // (re)conexao e o WhatsApp Desktop respondia com `Stream Errored (conflict,
  // replaced)` ~4-5s depois, derrubando o socket em loop. Ver session log
  // 2026-05-04 ~09:51 BRT — chip wa-01 caia a cada 9s. Trade-off: leads veem
  // "ultima vez online" do Desktop, nao do Nexus. Envio/receive intacto.
  const sock = makeWASocket({
    auth: state,
    logger: baileysLogger, // Logger de pino válido
    version,
    markOnlineOnConnect: false,
    connectTimeoutMs: 60_000,
    defaultQueryTimeoutMs: 60_000,
    keepAliveIntervalMs: 10_000,
    // Configuración mínima para forzar QR
    browser: ["WhatsApp GHL Gateway", "Chrome", "1.0.0"],
  });

  // IMPORTANTE: Registrar eventos INMEDIATAMENTE después de crear el socket
  // Guardar credenciales
  sock.ev.on("creds.update", saveCreds);

  // Manejar actualizaciones de conexión - DEBE estar registrado ANTES de cualquier conexión
  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr, isNewLogin, isOnline } = update;

    // Log detallado para debugging - mostrar TODO
    logger.debug(`\n[${instanceId}] ========== connection.update ==========`);
    logger.debug(`[${instanceId}] connection:`, connection || "undefined");
    logger.debug(`[${instanceId}] hasQR:`, !!qr);
    logger.debug(`[${instanceId}] qrLength:`, qr ? qr.length : 0);
    logger.debug(`[${instanceId}] isNewLogin:`, isNewLogin);
    logger.debug(`[${instanceId}] isOnline:`, isOnline);
    if (lastDisconnect) {
      const statusCode = (lastDisconnect.error as Boom)?.output?.statusCode;
      logger.debug(`[${instanceId}] ❌ Disconnect - StatusCode:`, statusCode);
      logger.debug(`[${instanceId}] ❌ Error:`, lastDisconnect.error);
    }
    logger.debug(`[${instanceId}] =========================================\n`);

    // Si hay QR, guardarlo inmediatamente y mostrar
    if (qr) {
      const qrString = String(qr);
      logger.info(
        `[${instanceId}] 🔷 QR generado: ${qrString.substring(0, 20)}... (longitud: ${qrString.length})`,
      );
      // Clear any existing TTL timer before setting new QR
      const oldQrTimer = qrTimers.get(instanceId);
      if (oldQrTimer) clearTimeout(oldQrTimer);

      qrCodes.set(instanceId, qrString);

      // TTL: auto-remove QR after 5min if not scanned (prevents memory leak)
      const qrTtl = setTimeout(
        () => {
          if (qrCodes.has(instanceId)) {
            qrCodes.delete(instanceId);
            qrTimers.delete(instanceId);
            logger.info(`[${instanceId}] QR expirado sem escanear (TTL 5min)`);
          }
        },
        5 * 60 * 1000,
      );
      qrTtl.unref(); // Don't keep Node process alive just for this timer
      qrTimers.set(instanceId, qrTtl);

      connectionStatus.set(instanceId, "RECONNECTING"); // Asegurar estado
      updateInstanceMetadata(instanceId, { status: "RECONNECTING" });
      logger.debug(`\n${"=".repeat(50)}`);
      logger.debug(`[${instanceId}] ✅✅✅ QR DISPONIBLE PARA ESCANEAR ✅✅✅`);
      logger.debug(`[${instanceId}] QR completo: ${qrString}`);
      logger.debug(`[${instanceId}] QR guardado: ${qrCodes.has(instanceId)}`);
      logger.debug(`${"=".repeat(50)}\n`);
    }

    if (connection === "open") {
      reconnectAttempts.delete(instanceId); // reset contador de reconexão
      logMessage.connection(instanceId, "connected");
      connectionStatus.set(instanceId, "ONLINE");
      qrCodes.delete(instanceId); // Limpiar QR después de conectar
      const connectedQrTimer = qrTimers.get(instanceId);
      if (connectedQrTimer) {
        clearTimeout(connectedQrTimer);
        qrTimers.delete(instanceId);
      }
      const normalizedSelf = jidToNormalizedNumber(sock.user?.id);
      const tenantIdForUpsert = tenantByInstance.get(instanceId);

      // Salvar/atualizar instância no DB ao conectar (com debounce para evitar loop)
      if (tenantIdForUpsert && !instancesUpsertInProgress.has(instanceId)) {
        instancesUpsertInProgress.add(instanceId);
        const rawInstanceName = instanceId.startsWith(tenantIdForUpsert + "-")
          ? instanceId.slice(tenantIdForUpsert.length + 1)
          : instanceId;
        const supabase = getSupabaseClient();
        const phone = normalizedSelf ? `+${normalizedSelf}` : null;
        try {
          const { data: existingInst } = await supabase
            .from("ghl_wa_instances")
            .select("id")
            .eq("tenant_id", tenantIdForUpsert)
            .eq("name", rawInstanceName)
            .maybeSingle();
          if (existingInst?.id) {
            await supabase
              .from("ghl_wa_instances")
              .update({
                status: "connected",
                is_active: true,
                phone_number: phone,
                last_connected_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })
              .eq("id", existingInst.id);
          } else {
            await supabase.from("ghl_wa_instances").insert({
              tenant_id: tenantIdForUpsert,
              name: rawInstanceName,
              status: "connected",
              is_active: true,
              phone_number: phone,
              last_connected_at: new Date().toISOString(),
            });
          }
          logger.debug(
            `[${instanceId}] ✅ Instância salva no DB (${existingInst ? "update" : "insert"})`,
          );
        } finally {
          // Liberar debounce após 5s para permitir futuras reconexões
          setTimeout(() => instancesUpsertInProgress.delete(instanceId), 5000);
        }
      }

      if (normalizedSelf) {
        instanceNumbers.set(instanceId, normalizedSelf);
        await registerInstanceNumber(instanceId, normalizedSelf);
        const phoneFormatted = `+${normalizedSelf}`;
        updateInstanceMetadata(instanceId, {
          status: "ONLINE",
          phone: phoneFormatted,
          lastConnectedAt: new Date().toISOString(),
          lastError: null,
        });
      } else {
        updateInstanceMetadata(instanceId, {
          status: "ONLINE",
          lastConnectedAt: new Date().toISOString(),
          lastError: null,
        });
      }
      logger.debug(
        `[${instanceId}] ✅ Socket abierto y listo para enviar mensajes`,
      );
      logger.debug(
        `[${instanceId}] Usuario autenticado:`,
        sock.user ? "Sí" : "No",
      );
      if (sock.user) {
        logger.debug(`[${instanceId}] ID de usuario:`, sock.user.id);
      }

      await notifyConnectionAlert({
        instanceId,
        status: "connected",
        details: {
          isNewLogin,
          isOnline,
        },
      });
    }

    if (connection === "close") {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const currentSocket = activeSockets.get(instanceId);

      if (intentionallyClosingSockets.has(instanceId)) {
        intentionallyClosingSockets.delete(instanceId);
        if (currentSocket === sock) activeSockets.delete(instanceId);
        logger.info(`[${instanceId}] Socket anterior fechado intencionalmente`);
        return;
      }

      if (currentSocket !== sock) {
        logger.debug(`[${instanceId}] Close de socket antigo ignorado`);
        return;
      }

      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      const errorMessage =
        lastDisconnect?.error?.message || "Connection closed";

      logger.warn(
        `[${instanceId}] Conexión cerrada. StatusCode: ${statusCode}`,
      );

      if (shouldReconnect) {
        const attempts = (reconnectAttempts.get(instanceId) || 0) + 1;
        reconnectAttempts.set(instanceId, attempts);
        if (attempts > MAX_RECONNECT_ATTEMPTS) {
          logger.warn(
            `[${instanceId}] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Giving up. Rescan QR to reconnect.`,
          );
          connectionStatus.set(instanceId, "OFFLINE");
          reconnectAttempts.delete(instanceId);
          if (activeSockets.get(instanceId) === sock) {
            activeSockets.delete(instanceId);
          }
          instanceNumbers.delete(instanceId);
          await unregisterInstanceNumber(instanceId);
          const tenantForStatus2 = tenantByInstance.get(instanceId);
          if (tenantForStatus2) {
            const rawName2 = instanceId.startsWith(tenantForStatus2 + "-")
              ? instanceId.slice(tenantForStatus2.length + 1)
              : instanceId;
            const sb2 = getSupabaseClient();
            await sb2
              .from("ghl_wa_instances")
              .update({
                status: "disconnected",
                updated_at: new Date().toISOString(),
              })
              .eq("tenant_id", tenantForStatus2)
              .eq("name", rawName2);
          }
          return;
        }
        logger.info(
          `[${instanceId}] Reconectando en 3s... (tentativa ${attempts}/${MAX_RECONNECT_ATTEMPTS})`,
        );
        connectionStatus.set(instanceId, "RECONNECTING");
        updateInstanceMetadata(instanceId, {
          status: "RECONNECTING",
          lastError: errorMessage,
        });

        // Update status in Supabase (usa name+tenant_id, não UUID)
        try {
          const tenantForStatus = tenantByInstance.get(instanceId);
          if (tenantForStatus) {
            const rawName = instanceId.startsWith(tenantForStatus + "-")
              ? instanceId.slice(tenantForStatus.length + 1)
              : instanceId;
            const supabase = getSupabaseClient();
            await supabase
              .from("ghl_wa_instances")
              .update({
                status: "reconnecting",
                updated_at: new Date().toISOString(),
              })
              .eq("tenant_id", tenantForStatus)
              .eq("name", rawName);
          }
        } catch (err) {
          logger.error(`[${instanceId}] Failed to update status in DB:`, err);
        }

        if (activeSockets.get(instanceId) === sock) {
          activeSockets.delete(instanceId);
        }
        instanceNumbers.delete(instanceId);
        await unregisterInstanceNumber(instanceId);
        setTimeout(() => initInstance(instanceId), 3000);
      } else {
        logMessage.connection(instanceId, "disconnected", {
          reason: "logged_out",
        });
        connectionStatus.set(instanceId, "OFFLINE");
        updateInstanceMetadata(instanceId, {
          status: "OFFLINE",
          lastError: "Logged out",
        });

        // Update status in Supabase (usa name+tenant_id, não UUID)
        try {
          const tenantForStatus = tenantByInstance.get(instanceId);
          if (tenantForStatus) {
            const rawName = instanceId.startsWith(tenantForStatus + "-")
              ? instanceId.slice(tenantForStatus.length + 1)
              : instanceId;
            const supabase = getSupabaseClient();
            await supabase
              .from("ghl_wa_instances")
              .update({
                status: "disconnected",
                updated_at: new Date().toISOString(),
              })
              .eq("tenant_id", tenantForStatus)
              .eq("name", rawName);
          }
        } catch (err) {
          logger.error(`[${instanceId}] Failed to update status in DB:`, err);
        }

        if (activeSockets.get(instanceId) === sock) {
          activeSockets.delete(instanceId);
        }
        instanceNumbers.delete(instanceId);
        await unregisterInstanceNumber(instanceId);
      }

      await notifyConnectionAlert({
        instanceId,
        status: shouldReconnect ? "connecting" : "disconnected",
        reason: shouldReconnect ? "lost_connection" : "logged_out",
        details: {
          statusCode,
        },
      });
    }

    // Si está conectando pero no hay QR y no está conectado, puede ser que necesite QR
    if (connection === "connecting" && !qr && !activeSockets.get(instanceId)) {
      logger.debug(`[${instanceId}] ⏳ Esperando QR...`);
      await notifyConnectionAlert({
        instanceId,
        status: "connecting",
      });
    }
  });

  // Manejar mensajes entrantes
  sock.ev.on("messages.upsert", async (m) => {
    const autoReplyEnabled = process.env.AUTO_REPLY_ENABLED !== "false";
    const autoReplyMessage = process.env.AUTO_REPLY_MESSAGE || "¡Hola! 👋";
    const autoReplyKeywords = (process.env.AUTO_REPLY_KEYWORDS || "hola")
      .split(",")
      .map((keyword) => keyword.trim())
      .filter(Boolean);
    const normalizedKeywords = autoReplyKeywords
      .map((keyword) => normalizeText(keyword))
      .filter(Boolean);

    // Inicializar registro anti-duplicados para esta instancia
    if (!processedMessageIds.has(instanceId)) {
      processedMessageIds.set(instanceId, new Map());
    }
    const seenIds = processedMessageIds.get(instanceId)!;

    // Limpieza simple: eliminar entradas con más de 10 minutos para evitar crecer sin límite
    const now = Date.now();
    for (const [mid, ts] of Array.from(seenIds.entries())) {
      if (now - ts > 10 * 60 * 1000) {
        seenIds.delete(mid);
      }
    }

    for (const msg of m.messages) {
      if (!msg.message) continue;

      // Jarvis: allow owner's self-chat messages through
      const jarvisPhone = process.env.JARVIS_OWNER_PHONE?.replace(/^\+/, "");
      const remotePhone = jidToNormalizedNumber(msg.key.remoteJid);
      const isJarvisChat =
        msg.key.fromMe && !!jarvisPhone && remotePhone === jarvisPhone;

      // Clone collector: save ALL fromMe messages (independent of Jarvis config)
      if (msg.key.fromMe) {
        const msgText =
          msg.message?.conversation || msg.message?.extendedTextMessage?.text;
        if (msgText) {
          const isGroup = msg.key.remoteJid?.endsWith("@g.us") || false;
          const groupBlacklist = (process.env.CLONE_GROUP_BLACKLIST || "")
            .split(",")
            .filter(Boolean);
          const isBlacklisted =
            isGroup &&
            groupBlacklist.some((jid) => msg.key.remoteJid?.includes(jid));

          if (!isBlacklisted) {
            collectOwnerMessage({
              phone:
                jidToNormalizedNumber(msg.key.remoteJid) ||
                msg.key.remoteJid ||
                "",
              text: msgText,
              isGroup,
              groupJid: isGroup ? msg.key.remoteJid || undefined : undefined,
              instanceId,
              timestamp:
                Number(msg.messageTimestamp) || Math.floor(Date.now() / 1000),
            }).catch((err) =>
              logger.error(
                `[${instanceId}] Clone collector error:`,
                err.message,
              ),
            );
          }
        }
      }

      // Auto-takeover: fromMe message that DID NOT originate from the Nexus API
      // means the human typed in the native WhatsApp app. Pause the AI for that
      // conversation so it stops auto-replying after the human took over.
      if (msg.key.fromMe && !isJarvisChat) {
        if (msg.key.id && !wasSentByApi(msg.key.id) && !jarvisSentIds.has(msg.key.id)) {
          const contactPhone = jidToNormalizedNumber(msg.key.remoteJid);
          if (contactPhone) {
            triggerAutoTakeover(instanceId, contactPhone).catch((err) =>
              logger.error(
                `[${instanceId}] auto-takeover error:`,
                err.message,
              ),
            );
          }
        }
        continue;
      }

      // Jarvis anti-loop: skip messages sent by Jarvis itself
      if (msg.key.id && jarvisSentIds.has(msg.key.id)) {
        jarvisSentIds.delete(msg.key.id);
        continue;
      }

      // Obtener el JID del remitente (puede ser @s.whatsapp.net o @lid)
      // Si es un mensaje de grupo, usar participant; si no, usar remoteJid
      const from = msg.key.participant || msg.key.remoteJid;

      if (!from) {
        logger.debug(`[${instanceId}] ⚠️ Mensaje sin remitente, saltando`);
        continue;
      }

      if (await isInternalContactAsync(from)) {
        // Allow through if it's the Jarvis owner talking to themselves
        if (!isJarvisChat) {
          logger.debug("Ignorando mensajes internos para evitar bucles", {
            event: "message.internal.skip",
            instanceId,
            from,
          });
          continue;
        }
      }

      const text =
        msg.message.conversation || msg.message.extendedTextMessage?.text;

      if (text && from) {
        const normalizedText = normalizeText(text);

        // Clave de deduplicación robusta: usa ID de WhatsApp si existe; si no, usa combinación estable
        const dedupeKey =
          msg.key.id ||
          `${from}|${normalizedText}|${String(msg.messageTimestamp || "")}`;

        // Evitar procesar duplicados (Baileys puede emitir el mismo mensaje 2 veces)
        if (dedupeKey) {
          if (seenIds.has(dedupeKey)) {
            continue;
          }
          seenIds.set(dedupeKey, Date.now());
          if (seenIds.size > 1000) {
            const oldestKey = Array.from(seenIds.entries()).sort(
              (a, b) => a[1] - b[1],
            )[0]?.[0];
            if (oldestKey) seenIds.delete(oldestKey);
          }
        }

        // Log del mensaje recibido
        logger.debug(`\n[${instanceId}] 📩 MENSAJE RECIBIDO:`);
        logger.debug(`[${instanceId}] De: ${from}`);
        logger.debug(`[${instanceId}] Texto: ${text}`);
        logger.debug(
          `[${instanceId}] Normalizado: ${normalizedText || "(vacío)"}`,
        );
        logger.debug(`[${instanceId}] =========================\n`);

        logMessage.receive(instanceId, from, text);

        // Resolver el teléfono real desde el JID (puede ser @s.whatsapp.net o @lid)
        const phone = resolvePhoneFromJid(instanceId, from);

        // Mensaje de grupo (@g.us): persistir en historial pero NO enviar a GHL
        // (GHL no soporta JIDs de grupo en inbound; el contexto de grupo se sirve via /api/wa/groups/*)
        const isGroupMsg = msg.key.remoteJid?.endsWith("@g.us") || false;

        if (!phone) {
          if (isGroupMsg && msg.key.remoteJid) {
            messageHistory.add({
              instanceId,
              type: "inbound",
              from: msg.key.remoteJid, // group JID como remetente do thread
              text,
              status: "received",
              timestamp: msg.messageTimestamp
                ? Number(msg.messageTimestamp) * 1000
                : undefined,
              metadata: {
                isGroup: true,
                participant: msg.key.participant ?? null,
              },
            });
            logger.debug(
              `[${instanceId}] 📥 Mensaje de grupo persistido: ${msg.key.remoteJid}`,
            );
            continue;
          }

          logger.warn(
            "No se pudo resolver teléfono para JID, mensaje no enviado a GHL",
            {
              event: "ghl.inbound.unresolved_jid",
              instanceId,
              jid: from,
            },
          );
          logger.debug(
            `[${instanceId}] ⚠️ JID no resuelto: ${from}. Saltando envío a GHL.`,
          );
          continue;
        }

        // Jarvis interceptor: respond to owner messages directly
        if (isJarvisChat && jarvisPhone && phone === jarvisPhone) {
          try {
            logger.debug(
              `[${instanceId}] 🤖 Jarvis: processando mensagem do owner`,
            );
            const jarvisResponse = await handleJarvisMessage(phone, text);
            const sentMsg = await sock.sendMessage(msg.key.remoteJid!, {
              text: jarvisResponse,
            });
            // Track sent message ID to prevent loop
            if (sentMsg?.key?.id) {
              jarvisSentIds.add(sentMsg.key.id);
              setTimeout(() => jarvisSentIds.delete(sentMsg.key.id!), 60000);
            }
            markSent(sentMsg?.key?.id);
            logger.debug(`[${instanceId}] 🤖 Jarvis: resposta enviada`);
          } catch (err: any) {
            logger.error(`[${instanceId}] 🤖 Jarvis error:`, err.message);
            if (err.message !== "Rate limited") {
              const errMsg = await sock.sendMessage(msg.key.remoteJid!, {
                text: "(erro ao processar)",
              });
              markSent(errMsg?.key?.id);
            }
          }
          continue;
        }

        // F8: IA Inbox — intercepta ANTES do webhook GHL
        // Se agente ativo responder, não dispara GHL
        try {
          const { handleInboundMessage } = await import('./agent-runtime');
          const agentResult = await handleInboundMessage({
            tenantId: instanceId.split('-')[0],
            instanceName: instanceId.split('-').slice(1).join('-'),
            fromPhone: `+${phone}`,
            text,
            timestamp: Number(msg.messageTimestamp) || Math.floor(Date.now() / 1000),
          });
          if (agentResult === 'agent-replied') {
            logger.info('AI agent handled message, skipping GHL webhook', {
              event: 'agent_runtime.intercepted',
              instanceId,
              fromPhone: `+${phone}`,
            });
            messageHistory.add({
              instanceId,
              type: "inbound",
              from: `+${phone}`,
              text,
              status: "received",
              timestamp: msg.messageTimestamp
                ? Number(msg.messageTimestamp) * 1000
                : undefined,
              metadata: { handled_by: 'ai_agent' },
            });
            continue;
          }
        } catch (agentErr: any) {
          logger.error('agent-runtime error, falling back to GHL webhook', {
            event: 'agent_runtime.error',
            instanceId,
            error: agentErr.message,
          });
        }

        // Registrar en el historial con el teléfono REAL
        messageHistory.add({
          instanceId,
          type: "inbound",
          from: `+${phone}`,
          text,
          status: "received",
          timestamp: msg.messageTimestamp
            ? Number(msg.messageTimestamp) * 1000
            : undefined,
        });

        // Enviar mensaje inbound a GHL con el teléfono REAL
        try {
          // Pasar el phone directamente (ya está normalizado)
          await sendInboundToGHL(
            instanceId,
            `+${phone}`,
            text,
            msg.messageTimestamp || undefined,
          );
        } catch (error: any) {
          logger.error("Error al enviar mensaje inbound a GHL", {
            event: "ghl.inbound.send_error",
            instanceId,
            from: `+${phone}`,
            error: error.message,
          });
          // No bloqueamos el flujo si falla el envío a GHL
        }

        if (autoReplyEnabled && normalizedText) {
          const shouldAutoReply = normalizedKeywords.some((keyword) => {
            if (!keyword) return false;
            const words = normalizedText.split(/\s+/);
            return words.includes(keyword);
          });

          if (shouldAutoReply) {
            logger.debug(
              `[${instanceId}] 🤖 Enviando auto-respuesta a ${from}...`,
            );
            await delay(1000);
            try {
              const autoSent = await sock.sendMessage(from, { text: autoReplyMessage });
              markSent(autoSent?.key?.id);
              logger.debug(
                `[${instanceId}] ✅ Auto-respuesta enviada exitosamente`,
              );
              logger.info("Respuesta automática enviada", {
                event: "message.auto_reply",
                instanceId,
                to: from,
                received: text,
                reply: autoReplyMessage,
              });
            } catch (error: any) {
              logger.error(
                `[${instanceId}] ❌ Error al enviar auto-respuesta:`,
                error.message,
              );
              logger.error("Error al enviar auto-respuesta", {
                event: "message.auto_reply.error",
                instanceId,
                to: from,
                error: error.message,
              });
            }
          }
        }

        await processPendingMessagesForContact(instanceId, sock, from);
      }
    }
  });

  activeSockets.set(instanceId, sock);
  startingInstances.delete(instanceId);
  logger.info(`[${instanceId}] Socket registrado y eventos configurados`);

  // Log adicional para verificar que el socket está listo
  logger.debug(
    `[${instanceId}] ✅ Socket creado y listo. Esperando eventos de conexión...`,
  );

  // Verificar después de un segundo si hay QR (para debugging)
  setTimeout(() => {
    const hasQR = qrCodes.has(instanceId);
    const status = connectionStatus.get(instanceId);
    logger.debug(`[${instanceId}] 📊 Estado después de 1s:`, {
      hasQR,
      status,
      socketExists: activeSockets.has(instanceId),
    });
  }, 1000);
}

/**
 * Obtiene el QR code de una instancia
 */
export function getQRCode(instanceId: string): string | undefined {
  return qrCodes.get(instanceId);
}

/**
 * Obtiene el estado de conexión
 */
export function getConnectionStatus(instanceId: string): string {
  return connectionStatus.get(instanceId) || "disconnected";
}

/**
 * Obtiene el socket activo
 */
export function getSocket(instanceId: string): WASocket | undefined {
  return activeSockets.get(instanceId);
}

/**
 * Obtiene el número de teléfono conectado de una instancia
 * @param instanceId ID de la instancia
 * @returns Número formateado con + (ej: "+51999999999") o null si no está conectado
 */
export function getConnectedNumber(instanceId: string): string | null {
  const normalizedNumber = instanceNumbers.get(instanceId);
  if (!normalizedNumber) {
    return null;
  }
  // Retornar con formato internacional (+)
  return `+${normalizedNumber}`;
}

/**
 * Restaura todas las sesiones guardadas en la base de datos al iniciar el servidor
 */
export async function restoreSessions(): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    const { data: instances, error } = await supabase
      .from("ghl_wa_instances")
      .select("id, name, tenant_id, alias");

    if (error) {
      logger.error("Error fetching sessions to restore", { error });
      logger.error(
        "❌ Error al recuperar sesiones para restaurar:",
        error.message,
      );
      return;
    }

    if (!instances || instances.length === 0) {
      logger.debug("ℹ️ No hay sesiones para restaurar.");
      return;
    }

    logger.debug(`🔄 Restaurando ${instances.length} sesiones...`);

    for (const instance of instances) {
      // BUGFIX: usar scopedId = tenantId-name (igual ao qr.controller), não o UUID
      // O UUID causava mismatch: creds salvos em tenantId-name mas carregados pelo UUID
      const scopedId = instance.tenant_id
        ? `${instance.tenant_id}-${instance.name}`
        : instance.id;
      logger.debug(
        `   ⚡ Iniciando: ${scopedId} (name: ${instance.name}, tenant: ${instance.tenant_id})`,
      );
      // No forzamos nueva sesión (false), pasamos alias y tenantId
      await initInstance(scopedId, false, instance.alias, instance.tenant_id);

      // Pequeña pausa para no saturar
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    logger.debug("✅ Restauración de sesiones completada");
  } catch (err: any) {
    logger.error("❌ Error fatal en restoreSessions:", err.message);
  }
}

/**
 * Envía un mensaje de texto
 */
export async function sendTextMessage(
  instanceId: string,
  to: string,
  message: string,
): Promise<void> {
  const sock = activeSockets.get(instanceId);
  if (!sock) {
    throw new Error(
      `Instancia ${instanceId} no está conectada - socket no encontrado`,
    );
  }

  // Debug: verificar si es destino interno
  const isInternal = await isInternalDestinationAsync(to);
  if (isInternal) {
    // Log para debugging
    logger.debug(`\n🚫 [ANTI-LOOP] Bloqueando envío a ${to}`);
    logger.debug(
      `   Instancias en memoria:`,
      Array.from(instanceNumbers.entries()),
    );

    // Verificar también en Supabase
    try {
      const allNumbers = await getAllInstanceNumbers();
      logger.debug(`   Instancias en Supabase:`, allNumbers);
    } catch (e) {
      logger.debug(`   Error leyendo Supabase:`, (e as Error).message);
    }

    throw new Error(
      `No se puede enviar mensajes entre instancias internas (${to}).`,
    );
  }

  // Verificar estado de conexión
  const status = connectionStatus.get(instanceId);
  if (status !== "ONLINE") {
    throw new Error(
      `Instancia ${instanceId} no está conectada. Estado: ${status}`,
    );
  }

  // Verificar que el socket esté realmente conectado y autenticado
  if (sock.user === undefined) {
    logger.error("Socket no autenticado", {
      event: "message.send.not_authenticated",
      instanceId,
      to,
    });
    throw new Error(
      `Socket de ${instanceId} no está autenticado (user es undefined)`,
    );
  }

  // Verificar que el socket tenga las propiedades necesarias
  logger.debug(`[${instanceId}] Verificando socket:`, {
    hasUser: !!sock.user,
    userId: sock.user?.id,
    userJid: sock.user?.jid,
  });

  logger.info("Preparando envío de mensaje", {
    event: "message.send.preparing",
    instanceId,
    to,
    messageLength: message.length,
    userExists: !!sock.user,
  });

  // Formatear JID correctamente usando onWhatsApp para normalizar
  let jid: string;
  if (to.includes("@")) {
    jid = to;
  } else {
    const digitsOnly = normalizePhoneInput(to);

    // 1. Intentar buscar JID/LID conocido por mapeo previo
    const knownJid = findJidByPhone(instanceId, digitsOnly);
    if (knownJid) {
      logger.debug(
        `[${instanceId}] ✅ Usando JID/LID conocido: ${digitsOnly} -> ${knownJid}`,
      );
      jid = knownJid;

      // Verificar que siga activo (opcional, comentar si causa problemas)
      const lookup = await sock.onWhatsApp(knownJid);
      if (lookup && lookup.length > 0 && lookup[0].exists !== false) {
        // JID válido, continuar con el envío
        return await sendMessageViaSocket(sock, instanceId, knownJid, message);
      } else {
        logger.debug(
          `[${instanceId}] ⚠️ JID conocido ya no está activo, intentando normalización estándar`,
        );
      }
    }

    // 2. Intentar normalización estándar y guardar jid + lid
    const normalizedNumber = `${digitsOnly}@s.whatsapp.net`;
    logger.debug(
      `[${instanceId}] 🔍 Normalizando número ${digitsOnly} -> ${normalizedNumber}`,
    );
    const lookup = await sock.onWhatsApp(normalizedNumber);
    logger.debug(`[${instanceId}] 🔍 Resultado onWhatsApp:`, lookup);

    if (
      !lookup ||
      lookup.length === 0 ||
      !lookup[0].jid ||
      lookup[0].exists === false
    ) {
      // Envio direto: GHL outbound não precisa de "primeiro contato" do WhatsApp
      logger.warn(
        `[${instanceId}] ⚠️ onWhatsApp não encontrou JID para ${to}, tentando envio direto via ${normalizedNumber}`,
      );
      return await sendMessageViaSocket(
        sock,
        instanceId,
        normalizedNumber,
        message,
      );
    }

    const info = lookup[0];
    jid = info.jid;

    // *** IMPORTANTE: Guardar jid Y lid en el mapeo ***
    savePhoneMapping(
      instanceId,
      digitsOnly,
      info.jid,
      info.lid as string | undefined,
    );
  }

  logger.debug(`[${instanceId}] 📤 Preparando envío:`, {
    to,
    jid,
    messageLength: message.length,
  });

  logger.info("Iniciando envío", {
    event: "message.send.starting",
    instanceId,
    jid,
    originalTo: to,
  });

  // Enviar mensaje con logging detallado y timeout
  try {
    logger.debug(
      `[${instanceId}] 📤 Llamando a sendMessage(${jid}, "${message.substring(0, 30)}...")`,
    );

    logger.info("Llamando a sendMessage...", {
      event: "message.send.calling",
      instanceId,
      jid,
      messageLength: message.length,
    });

    // Verificar que el socket tenga la función sendMessage
    if (typeof sock.sendMessage !== "function") {
      throw new Error(
        `Socket de ${instanceId} no tiene la función sendMessage`,
      );
    }

    logger.debug(
      `[${instanceId}] Socket verificado, tiene sendMessage:`,
      typeof sock.sendMessage === "function",
    );

    // Timeout de 30s — padronizado com sendImageMessage
    const startTime = Date.now();

    logger.debug(`[${instanceId}] ⏳ Iniciando envío (timeout: 30s)...`);

    const sendPromise = sock.sendMessage(jid, { text: message });
    const timeoutPromise = new Promise((_, reject) => {
      const t = setTimeout(() => {
        logger.error(
          `[${instanceId}] ⏱️ TIMEOUT após 30s enviando para ${to}`,
          {
            event: "message.send.timeout",
            instanceId,
            to,
            jid,
          },
        );
        reject(
          new Error(
            `Timeout: mensagem para ${to} não enviada em 30s. Verifique se o número tem WhatsApp ativo.`,
          ),
        );
      }, 30000);
      t.unref(); // Não manter o processo vivo só por este timer
    });

    // Intentar enviar el mensaje con timeout
    logger.debug(`[${instanceId}] Ejecutando sock.sendMessage()...`);
    const result = (await Promise.race([sendPromise, timeoutPromise])) as proto.WebMessageInfo | undefined;
    const duration = Date.now() - startTime;

    markSent(result?.key?.id);

    logger.debug(
      `[${instanceId}] ✅ Mensaje enviado exitosamente en ${duration}ms`,
    );
    logger.debug(`[${instanceId}] Resultado:`, result ? "OK" : "Sin resultado");

    logger.info("Mensaje enviado exitosamente", {
      event: "message.send.success",
      instanceId,
      to,
      jid,
      duration,
      hasResult: !!result,
    });
    logMessage.send(instanceId, "text", to, "sent", {
      messageLength: message.length,
    });
  } catch (error: any) {
    logger.error(`[${instanceId}] ❌ Error al enviar mensaje:`, error.message);
    logger.error(`[${instanceId}] Stack:`, error.stack);
    logger.error("Error al enviar mensaje de texto", {
      event: "message.send.error",
      instanceId,
      to,
      jid,
      error: error.message,
      errorStack: error.stack,
    });
    throw error;
  }
}

/**
 * Envía una imagen
 */
export async function sendImageMessage(
  instanceId: string,
  to: string,
  imageUrl: string,
): Promise<void> {
  const sock = activeSockets.get(instanceId);
  if (!sock) {
    throw new Error(`Instancia ${instanceId} no está conectada`);
  }

  if (await isInternalDestinationAsync(to)) {
    throw new Error(
      `No se puede enviar imágenes entre instancias internas (${to}).`,
    );
  }

  // Verificar que el socket esté realmente conectado
  if (sock.user === undefined) {
    throw new Error(`Socket de ${instanceId} no está autenticado`);
  }

  let jid: string;
  if (to.includes("@")) {
    jid = to;
  } else {
    const digitsOnly = normalizePhoneInput(to);

    const normalizedNumber = `${digitsOnly}@s.whatsapp.net`;
    logger.debug(
      `[${instanceId}] 🔍 Normalizando número ${digitsOnly} -> ${normalizedNumber}`,
    );
    const lookup = await sock.onWhatsApp(normalizedNumber);
    logger.debug(`[${instanceId}] 🔍 Resultado onWhatsApp:`, lookup);

    if (
      !lookup ||
      lookup.length === 0 ||
      !lookup[0].jid ||
      lookup[0].exists === false
    ) {
      const pending = await addPendingImageMessage(
        instanceId,
        to,
        digitsOnly,
        imageUrl,
        "contact_inactive",
      );
      logMessage.send(instanceId, "image", to, "waiting_contact", {
        pendingId: pending.id,
        reason: "contact_inactive",
      });
      logger.warn(
        `[${instanceId}] ⏳ No podemos enviar imagen a ${to} todavía. Se enviará automáticamente cuando la persona nos hable.`,
      );
      throw new WaitingForContactError(
        `El número ${to} no ha iniciado una conversación. La imagen se enviará automáticamente cuando nos escriba.`,
        {
          pendingId: pending.id,
          instanceId,
          to,
          normalizedNumber: digitsOnly,
          type: "image",
        },
      );
    }

    const contact = lookup[0];
    jid = contact.jid;
  }

  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Error al descargar imagen: ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  // Timeout de 30s com .unref() para não pinnar o processo
  const sendPromise = sock.sendMessage(jid, { image: buffer });
  const timeoutPromise = new Promise((_, reject) => {
    const t = setTimeout(
      () => reject(new Error("Timeout: envio de imagem excedeu 30 segundos")),
      30000,
    );
    t.unref();
  });

  try {
    const imgResult = (await Promise.race([sendPromise, timeoutPromise])) as proto.WebMessageInfo | undefined;
    markSent(imgResult?.key?.id);
    logMessage.send(instanceId, "image", to, "sent", {
      imageUrl,
      imageSize: buffer.length,
    });
  } catch (error: any) {
    logger.error("Error al enviar imagen", {
      event: "message.send.error",
      instanceId,
      to,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Logout de una instancia
 */
export async function logoutInstance(instanceId: string): Promise<void> {
  const sock = activeSockets.get(instanceId);
  if (sock) {
    await sock.logout();
    activeSockets.delete(instanceId);
    qrCodes.delete(instanceId);
    connectionStatus.set(instanceId, "OFFLINE");
    updateInstanceMetadata(instanceId, {
      status: "OFFLINE",
      lastError: "Logged out manually",
    });
    instanceNumbers.delete(instanceId);
    await unregisterInstanceNumber(instanceId);
    logger.info(`[${instanceId}] Logout ejecutado`);
  }
}

/**
 * Fecha todos os sockets Baileys de forma graciosa (sem logout).
 * Chamado no SIGTERM para evitar erro 440 "conflict" quando Railway
 * reinicia o container — fecha o WebSocket sem revogar a sessão WA.
 */
export function closeAllInstances(): void {
  isShuttingDown = true;
  let closed = 0,
    errors = 0;
  for (const [instanceId, sock] of activeSockets.entries()) {
    try {
      sock.end(undefined);
      closed++;
    } catch (e) {
      errors++;
      logger.warn(`[${instanceId}] Erro ao fechar socket no shutdown`);
    }
  }
  activeSockets.clear();
  logger.info("Graceful shutdown WA completo", { closed, errors });
}

/**
 * Lista todas las instancias con metadatos completos
 */
export function listInstances() {
  // Obtener todas las instancias únicas (tanto de activeSockets como de instancesMetadata)
  const allInstanceIds = new Set([
    ...activeSockets.keys(),
    ...instancesMetadata.keys(),
  ]);

  return Array.from(allInstanceIds).map((id) => {
    const metadata = instancesMetadata.get(id);
    const connectedNumber = getConnectedNumber(id);
    const status = connectionStatus.get(id) || "OFFLINE";

    return {
      instanceId: id,
      status,
      phone: connectedNumber || metadata?.phone || null,
      lastConnectedAt: metadata?.lastConnectedAt || null,
      lastError: metadata?.lastError || null,
      phoneAlias: metadata?.phoneAlias,
      hasQR: qrCodes.has(id),
    };
  });
}

/**
 * Genera un nuevo instanceId incremental (ej: wa-01, wa-02)
 */
export function generateInstanceId(): string {
  const instances = listInstances();
  const nextId = instances.length + 1;

  // Límite máximo de 3 instancias
  if (nextId > 3) {
    throw new Error(
      "Límite máximo de instancias alcanzado (3). Elimina una instancia existente antes de crear una nueva.",
    );
  }

  return `wa-${String(nextId).padStart(2, "0")}`;
}
