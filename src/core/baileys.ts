import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  WASocket,
  proto,
  delay,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import path from 'path';
import fs from 'fs';
import pino from 'pino';
import { logger, logMessage } from '../utils/logger';
import { messageHistory } from './messageHistory';
import { notifyConnectionAlert } from '../utils/monitoring';
import { getRedisClient } from '../infra/redisClient';
import { addPendingImageMessage, addPendingTextMessage, consumePendingMessages } from './pendingMessages';

// InstanceMetadata para H4
interface InstanceMetadata {
  instanceId: string;
  phoneAlias?: string;
  phone: string | null;
  status: 'ONLINE' | 'OFFLINE' | 'RECONNECTING';
  lastConnectedAt: string | null;
  lastError: string | null;
}

// Session mapping structure per instance
interface SessionMapping {
  jidByPhone: Record<string, string>;      // phone -> jid (@s.whatsapp.net)
  lidByPhone: Record<string, string>;      // phone -> lid (@lid)
  phoneByJid: Record<string, string>;      // jid OR lid -> phone
}

// Store de sockets y QR codes
const activeSockets: Map<string, WASocket> = new Map();
const qrCodes: Map<string, string> = new Map();
const connectionStatus: Map<string, 'OFFLINE' | 'RECONNECTING' | 'ONLINE'> = new Map();
const instanceNumbers: Map<string, string> = new Map();
const instancesMetadata: Map<string, InstanceMetadata> = new Map();
// Anti-duplicados: registrar IDs de mensajes ya procesados por instancia
const processedMessageIds: Map<string, Map<string, number>> = new Map();
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
  activeSockets.delete(instanceId);
  qrCodes.delete(instanceId);
  connectionStatus.delete(instanceId);
  instanceNumbers.delete(instanceId);
  instancesMetadata.delete(instanceId);
  processedMessageIds.delete(instanceId);
  sessionMappings.delete(instanceId);
  console.log(`🧹 [${instanceId}] Estado en memoria limpiado`);
}
const normalizeText = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .trim()
    .toLowerCase();

/**
 * Guarda el mapeo phone ↔ jid/lid desde onWhatsApp result
 */
function savePhoneMapping(
  instanceId: string,
  phone: string,
  jid: string,
  lid?: string
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
  
  console.log(`[${instanceId}] 💾 Mapeo guardado: phone=${phone}, jid=${jid}${lid ? `, lid=${lid}` : ''}`);
}

/**
 * Resuelve el teléfono real desde cualquier JID (jid o lid)
 */
function resolvePhoneFromJid(instanceId: string, jid: string): string | undefined {
  const session = getSessionMapping(instanceId);
  
  // 1) Si ya conocemos este jid (o lid) en el mapeo, retornar phone
  const mapped = session.phoneByJid[jid];
  if (mapped) {
    console.log(`[${instanceId}] ✅ Resuelto desde mapeo: ${jid} → +${mapped}`);
    return mapped;
  }
  
  // 2) Si es un JID clásico de @s.whatsapp.net, decodificar a phone
  if (jid.endsWith('@s.whatsapp.net')) {
    const num = jid.split('@')[0];
    // Usar la misma lógica de normalización que para outbound
    const normalized = jidToNormalizedNumber(jid);
    if (normalized) {
      console.log(`[${instanceId}] ✅ Decodificado JID clásico: ${jid} → +${normalized}`);
      // Guardarlo para futuras referencias
      session.jidByPhone[normalized] = jid;
      session.phoneByJid[jid] = normalized;
      return normalized;
    }
  }
  
  // 3) Si es @lid y NO lo tenemos en el mapeo, NO fabricar un número falso
  if (jid.endsWith('@lid')) {
    console.warn(`[${instanceId}] ⚠️ No se pudo resolver @lid: ${jid} (no está en mapeo)`);
    return undefined;
  }
  
  console.warn(`[${instanceId}] ⚠️ No se pudo resolver JID: ${jid}`);
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
    console.log(`[${instanceId}] ✅ Encontrado LID para ${phone}: ${lid}`);
    return lid;
  }
  
  // Si no, usar jid clásico
  const jid = session.jidByPhone[phone];
  if (jid) {
    console.log(`[${instanceId}] ✅ Encontrado JID para ${phone}: ${jid}`);
    return jid;
  }
  
  console.log(`[${instanceId}] ❌ No se encontró JID/LID para ${phone}`);
  return undefined;
}

const normalizePhoneInput = (value: string): string => {
  const cleanNumber = value.replace(/[\s\-\(\)]/g, '');
  if (!cleanNumber.startsWith('+')) {
    throw new Error(`El número debe tener formato internacional con +. Recibido: ${value}`);
  }

  const digitsOnly = cleanNumber.replace(/^\+/, '');
  if (!/^\d+$/.test(digitsOnly)) {
    throw new Error(`El número ${value} contiene caracteres no válidos`);
  }
  return digitsOnly;
};

const jidToNormalizedNumber = (jid?: string | null): string | null => {
  if (!jid) return null;
  
  // Aceptar JIDs de WhatsApp estándar (@s.whatsapp.net) y de dispositivos ligados (@lid)
  if (!jid.endsWith('@s.whatsapp.net') && !jid.endsWith('@lid')) return null;
  
  const raw = jid.split('@')[0];
  let digits = raw.replace(/[^\d]/g, '');
  
  // Si viene de @lid, podría tener formato especial, extraer solo dígitos
  // Para @lid el formato suele ser como "212356722368740@lid" donde los primeros dígitos son el número
  if (jid.endsWith('@lid')) {
    // Tomar los primeros 10-15 dígitos que típicamente representan el número
    const match = digits.match(/^(\d{10,15})/);
    if (match) {
      digits = match[1];
    }
  }
  
  // Validar y corregir números peruanos (código 51)
  // Los números peruanos tienen: código país (51) + 9 dígitos = 11 dígitos totales
  if (digits.startsWith('51') && digits.length > 11) {
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
  if (identifier.includes('@')) {
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

// Redis-backed global registry to avoid loops across processes
const REDIS_INSTANCE_NUMBERS_KEY = 'instances:numbers';

async function registerInstanceNumber(instanceId: string, normalizedNumber: string): Promise<void> {
  try {
    const redis = getRedisClient();
    await redis.hset(REDIS_INSTANCE_NUMBERS_KEY, instanceId, normalizedNumber);
  } catch (e) {
    console.warn('No se pudo registrar número de instancia en Redis:', (e as Error)?.message);
  }
}

async function unregisterInstanceNumber(instanceId: string): Promise<void> {
  try {
    const redis = getRedisClient();
    await redis.hdel(REDIS_INSTANCE_NUMBERS_KEY, instanceId);
  } catch (e) {
    console.warn('No se pudo desregistrar número de instancia en Redis:', (e as Error)?.message);
  }
}

/**
 * Actualiza los metadatos de una instancia
 */
function updateInstanceMetadata(instanceId: string, updates: Partial<InstanceMetadata>): void {
  const current = instancesMetadata.get(instanceId) || {
    instanceId,
    phone: null,
    status: 'OFFLINE' as const,
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
      status: 'OFFLINE',
      lastConnectedAt: null,
      lastError: null,
    });
  } else if (phoneAlias) {
    // Actualizar phoneAlias si se proporciona
    const current = instancesMetadata.get(instanceId)!;
    instancesMetadata.set(instanceId, { ...current, phoneAlias });
  }
}

async function isInternalNumberGlobal(normalized: string): Promise<boolean> {
  try {
    const redis = getRedisClient();
    const all = await redis.hvals(REDIS_INSTANCE_NUMBERS_KEY);
    return all.includes(normalized);
  } catch {
    return false;
  }
}

async function isInternalContactAsync(jid?: string | null): Promise<boolean> {
  const normalized = jidToNormalizedNumber(jid);
  if (!normalized) return false;
  if (Array.from(instanceNumbers.values()).includes(normalized)) return true;
  return await isInternalNumberGlobal(normalized);
}

async function isInternalDestinationAsync(identifier: string): Promise<boolean> {
  let normalized: string | null = null;
  if (identifier.includes('@')) {
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
  public code = 'WAITING_CONTACT';
  public data: {
    pendingId: string;
    instanceId: string;
    to: string;
    normalizedNumber: string;
    type: 'text' | 'image';
  };

  constructor(
    message: string,
    data: { pendingId: string; instanceId: string; to: string; normalizedNumber: string; type: 'text' | 'image' }
  ) {
    super(message);
    this.name = 'WaitingForContactError';
    this.data = data;
    Object.setPrototypeOf(this, WaitingForContactError.prototype);
  }
}

/**
 * Envía mensaje directamente a través del socket
 */
async function sendMessageViaSocket(sock: WASocket, instanceId: string, jid: string, message: string): Promise<void> {
  console.log(`[${instanceId}] 📤 Preparando envío directo:`, {
    jid,
    messageLength: message.length,
  });
  
  logger.info('Iniciando envío directo', {
    event: 'message.send.starting',
    instanceId,
    jid,
  });
  
  try {
    console.log(`[${instanceId}] 📤 Llamando a sendMessage(${jid}, "${message.substring(0, 30)}...")`);
    
    if (typeof sock.sendMessage !== 'function') {
      throw new Error(`Socket de ${instanceId} no tiene la función sendMessage`);
    }
    
    const startTime = Date.now();
    console.log(`[${instanceId}] ⏳ Iniciando envío (timeout: 15s)...`);
    
    const sendPromise = sock.sendMessage(jid, { text: message });
    let timeoutId: NodeJS.Timeout;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        console.error(`\n[${instanceId}] ⏱️ TIMEOUT después de 15 segundos`);
        reject(new Error(`Timeout: No se pudo enviar el mensaje en 15 segundos.`));
      }, 15000);
    });
    
    const result = await Promise.race([sendPromise, timeoutPromise]);
    clearTimeout(timeoutId!); // Limpiar timeout si se resolvió exitosamente
    const duration = Date.now() - startTime;
    
    console.log(`[${instanceId}] ✅ Mensaje enviado exitosamente en ${duration}ms`);
    
    logger.info('Mensaje enviado exitosamente', {
      event: 'message.send.success',
      instanceId,
      jid,
      duration,
      hasResult: !!result,
    });
    logMessage.send(instanceId, 'text', jid, 'sent', { messageLength: message.length });
  } catch (error: any) {
    console.error(`[${instanceId}] ❌ Error al enviar mensaje:`, error.message);
    logger.error('Error al enviar mensaje de texto', {
      event: 'message.send.error',
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
    throw new Error(`Error al descargar imagen: ${response.status} - ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function processPendingMessagesForContact(instanceId: string, sock: WASocket, from: string) {
  const normalizedNumber = jidToNormalizedNumber(from);
  if (!normalizedNumber) {
    return;
  }

  const pending = await consumePendingMessages(instanceId, normalizedNumber);
  if (!pending.length) {
    return;
  }

  console.log(`[${instanceId}] 🔁 Encontrados ${pending.length} mensajes pendientes para ${from}. Enviando...`);

  for (const pendingMessage of pending) {
    try {
      logMessage.send(instanceId, pendingMessage.type, pendingMessage.to, 'deferred', {
        pendingId: pendingMessage.id,
        trigger: 'contact_reply',
      });

      await delay(500);
      if (pendingMessage.type === 'text') {
        await sock.sendMessage(from, { text: pendingMessage.message });
      } else if (pendingMessage.type === 'image') {
        const buffer = await downloadImageBuffer(pendingMessage.mediaUrl);
        await sock.sendMessage(from, { image: buffer });
      }

      logMessage.send(instanceId, pendingMessage.type, pendingMessage.to, 'sent', {
        pendingId: pendingMessage.id,
        trigger: 'contact_reply',
      });

      console.log(`[${instanceId}] ✅ Mensaje pendiente ${pendingMessage.id} enviado tras respuesta del contacto`);
    } catch (error: any) {
      logger.error('Error al enviar mensaje pendiente', {
        event: 'message.pending.error',
        instanceId,
        to: pendingMessage.to,
        pendingId: pendingMessage.id,
        error: error.message,
      });
      logMessage.send(instanceId, pendingMessage.type, pendingMessage.to, 'failed', {
        pendingId: pendingMessage.id,
        trigger: 'contact_reply',
        error: error.message,
      });
    }
  }
}

/**
 * Envía un mensaje inbound recibido desde WhatsApp a GHL
 */
async function sendInboundToGHL(
  instanceId: string,
  phoneNumber: string,  // Ya viene formateado con "+" (ej: "+51968782155")
  text: string,
  timestamp?: number | Long
): Promise<void> {
  // Obtener el endpoint de GHL desde variables de entorno
  const ghlInboundUrl = process.env.GHL_INBOUND_URL || 'http://localhost:8080/api/ghl/inbound-test';
  
  // Convertir timestamp a número (puede ser Long de protobuf)
  let timestampNumber: number;
  if (typeof timestamp === 'object' && timestamp !== null && 'toNumber' in timestamp) {
    timestampNumber = (timestamp as any).toNumber();
  } else if (typeof timestamp === 'number') {
    timestampNumber = timestamp;
  } else {
    timestampNumber = Math.floor(Date.now() / 1000);
  }
  
  const payload = {
    instanceId,
    from: phoneNumber,
    text,
    timestamp: timestampNumber,
  };
  
  try {
    logger.info('Enviando mensaje inbound a GHL', {
      event: 'ghl.inbound.sending',
      instanceId,
      from: phoneNumber,
      text: text.substring(0, 50), // Log solo primeros 50 caracteres
      timestamp: timestampNumber,
    });
    
    const response = await fetch(ghlInboundUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`GHL inbound endpoint returned ${response.status}: ${errorText}`);
    }
    
    const result = await response.json().catch(() => null);
    
    logger.info('Mensaje inbound enviado a GHL exitosamente', {
      event: 'ghl.inbound.success',
      instanceId,
      from: phoneNumber,
      timestamp: timestampNumber,
      ghlResponse: result,
    });
    
    console.log(`[${instanceId}] ✅ Mensaje inbound enviado a GHL:`, {
      from: phoneNumber,
      text: text.substring(0, 50),
    });
  } catch (error: any) {
    logger.error('Error al enviar mensaje inbound a GHL', {
      event: 'ghl.inbound.send_error',
      instanceId,
      from: phoneNumber,
      error: error.message,
      stack: error.stack,
    });
    
    console.error(`[${instanceId}] ❌ Error al enviar inbound a GHL:`, error.message);
    
    // No lanzamos el error para no bloquear el flujo normal
    // El mensaje ya fue logueado y procesado localmente
  }
}

export interface MessagePayload {
  instanceId: string;
  to: string;
  type: 'text' | 'image';
  message?: string;
  mediaUrl?: string;
}

/**
 * Inicializa una instancia de WhatsApp
 */
export async function initInstance(instanceId: string, force: boolean = false, phoneAlias?: string): Promise<void> {
  // Inicializar metadatos
  initializeMetadata(instanceId, phoneAlias);
  
  // Si la instancia ya existe y no estamos forzando, verificar si tiene QR
  if (activeSockets.has(instanceId) && !force) {
    const existingQR = qrCodes.get(instanceId);
    const existingStatus = connectionStatus.get(instanceId);
    
    // Si no tiene QR y está desconectado, forzar reinicio
    if (!existingQR && existingStatus === 'OFFLINE') {
      logger.info(`[${instanceId}] Instancia existe pero sin QR, reiniciando...`);
      force = true;
    } else {
      logger.info(`[${instanceId}] Instancia ya existe`);
      return;
    }
  }
  
  // Si estamos forzando, limpiar la instancia existente
  if (force && activeSockets.has(instanceId)) {
    const oldSock = activeSockets.get(instanceId);
    if (oldSock) {
      try {
        await oldSock.logout();
      } catch (e) {
        // Ignorar errores al hacer logout
      }
    }
    activeSockets.delete(instanceId);
    qrCodes.delete(instanceId);
    connectionStatus.delete(instanceId);
    instanceNumbers.delete(instanceId);
    logger.info(`[${instanceId}] Instancia anterior limpiada`);
  }

  const sessionDir = path.join(process.env.SESSION_DIR || './data/sessions', instanceId);
  
  // Crear directorio si no existe
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }

  logger.info(`[${instanceId}] Iniciando instancia...`);
  connectionStatus.set(instanceId, 'RECONNECTING');
  updateInstanceMetadata(instanceId, { status: 'RECONNECTING' });

  let { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const { version } = await fetchLatestBaileysVersion();

  // Verificar si hay credenciales guardadas
  const hasCredentials = state.creds.registered;
  const hasMe = !!state.creds.me?.id;
  
  console.log(`[${instanceId}] Estado de autenticación:`, {
    hasCredentials,
    me: state.creds.me?.id || 'no me',
    registered: state.creds.registered,
    hasMe
  });

  // SIEMPRE limpiar sesión si estamos forzando para garantizar QR nuevo
  if (force) {
    console.log(`[${instanceId}] 🔄 FORZANDO LIMPIEZA COMPLETA DE SESIÓN...`);
    try {
      // Eliminar TODO el directorio de sesión
      if (fs.existsSync(sessionDir)) {
        console.log(`[${instanceId}] Eliminando directorio completo: ${sessionDir}`);
        fs.rmSync(sessionDir, { recursive: true, force: true });
        console.log(`[${instanceId}] ✅ Directorio eliminado completamente`);
      }
      // Crear directorio nuevo
      fs.mkdirSync(sessionDir, { recursive: true });
      // Recargar estado SIN credenciales (sesión nueva)
      const reloaded = await useMultiFileAuthState(sessionDir);
      state = reloaded.state;
      saveCreds = reloaded.saveCreds;
      console.log(`[${instanceId}] ✅ Sesión completamente nueva creada, forzando QR`);
    } catch (e) {
      console.error(`[${instanceId}] ❌ Error limpiando sesión:`, e);
      throw e; // Lanzar error para que se vea
    }
  }

  // Crear socket con configuración optimizada para QR
  // Logger de pino para Baileys (silent para evitar spam, pero funcional)
  const baileysLogger = pino({ level: 'silent' });
  
  const sock = makeWASocket({
    auth: state,
    logger: baileysLogger, // Logger de pino válido
    version,
    markOnlineOnConnect: true,
    connectTimeoutMs: 60_000,
    defaultQueryTimeoutMs: 60_000,
    keepAliveIntervalMs: 10_000,
    // Configuración mínima para forzar QR
    browser: ['WhatsApp GHL Gateway', 'Chrome', '1.0.0'],
  });

  // IMPORTANTE: Registrar eventos INMEDIATAMENTE después de crear el socket
  // Guardar credenciales
  sock.ev.on('creds.update', saveCreds);

  // Manejar actualizaciones de conexión - DEBE estar registrado ANTES de cualquier conexión
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr, isNewLogin, isOnline } = update;

    // Log detallado para debugging - mostrar TODO
    console.log(`\n[${instanceId}] ========== connection.update ==========`);
    console.log(`[${instanceId}] connection:`, connection || 'undefined');
    console.log(`[${instanceId}] hasQR:`, !!qr);
    console.log(`[${instanceId}] qrLength:`, qr ? qr.length : 0);
    console.log(`[${instanceId}] isNewLogin:`, isNewLogin);
    console.log(`[${instanceId}] isOnline:`, isOnline);
    if (lastDisconnect) {
      const statusCode = (lastDisconnect.error as Boom)?.output?.statusCode;
      console.log(`[${instanceId}] ❌ Disconnect - StatusCode:`, statusCode);
      console.log(`[${instanceId}] ❌ Error:`, lastDisconnect.error);
    }
    console.log(`[${instanceId}] =========================================\n`);

    // Si hay QR, guardarlo inmediatamente y mostrar
    if (qr) {
      const qrString = String(qr);
      logger.info(`[${instanceId}] 🔷 QR generado: ${qrString.substring(0, 20)}... (longitud: ${qrString.length})`);
      qrCodes.set(instanceId, qrString);
      connectionStatus.set(instanceId, 'RECONNECTING'); // Asegurar estado
      updateInstanceMetadata(instanceId, { status: 'RECONNECTING' });
      console.log(`\n${'='.repeat(50)}`);
      console.log(`[${instanceId}] ✅✅✅ QR DISPONIBLE PARA ESCANEAR ✅✅✅`);
      console.log(`[${instanceId}] QR completo: ${qrString}`);
      console.log(`[${instanceId}] QR guardado: ${qrCodes.has(instanceId)}`);
      console.log(`${'='.repeat(50)}\n`);
    }

    if (connection === 'open') {
      logMessage.connection(instanceId, 'connected');
      connectionStatus.set(instanceId, 'ONLINE');
      qrCodes.delete(instanceId); // Limpiar QR después de conectar
      const normalizedSelf = jidToNormalizedNumber(sock.user?.id);
      if (normalizedSelf) {
        instanceNumbers.set(instanceId, normalizedSelf);
        await registerInstanceNumber(instanceId, normalizedSelf);
        const phoneFormatted = `+${normalizedSelf}`;
        updateInstanceMetadata(instanceId, {
          status: 'ONLINE',
          phone: phoneFormatted,
          lastConnectedAt: new Date().toISOString(),
          lastError: null,
        });
      } else {
        updateInstanceMetadata(instanceId, {
          status: 'ONLINE',
          lastConnectedAt: new Date().toISOString(),
          lastError: null,
        });
      }
      console.log(`[${instanceId}] ✅ Socket abierto y listo para enviar mensajes`);
      console.log(`[${instanceId}] Usuario autenticado:`, sock.user ? 'Sí' : 'No');
      if (sock.user) {
        console.log(`[${instanceId}] ID de usuario:`, sock.user.id);
      }

      await notifyConnectionAlert({
        instanceId,
        status: 'connected',
        details: {
          isNewLogin,
          isOnline,
        },
      });
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      const errorMessage = lastDisconnect?.error?.message || 'Connection closed';

      logger.warn(`[${instanceId}] Conexión cerrada. StatusCode: ${statusCode}`);

      if (shouldReconnect) {
        logger.info(`[${instanceId}] Reconectando en 3s...`);
        connectionStatus.set(instanceId, 'RECONNECTING');
        updateInstanceMetadata(instanceId, {
          status: 'RECONNECTING',
          lastError: errorMessage,
        });
        activeSockets.delete(instanceId);
        instanceNumbers.delete(instanceId);
        await unregisterInstanceNumber(instanceId);
        setTimeout(() => initInstance(instanceId), 3000);
      } else {
        logMessage.connection(instanceId, 'disconnected', { reason: 'logged_out' });
        connectionStatus.set(instanceId, 'OFFLINE');
        updateInstanceMetadata(instanceId, {
          status: 'OFFLINE',
          lastError: 'Logged out',
        });
        activeSockets.delete(instanceId);
        instanceNumbers.delete(instanceId);
        await unregisterInstanceNumber(instanceId);
      }

      await notifyConnectionAlert({
        instanceId,
        status: shouldReconnect ? 'connecting' : 'disconnected',
        reason: shouldReconnect ? 'lost_connection' : 'logged_out',
        details: {
          statusCode,
        },
      });
    }

    // Si está conectando pero no hay QR y no está conectado, puede ser que necesite QR
    if (connection === 'connecting' && !qr && !activeSockets.get(instanceId)) {
      console.log(`[${instanceId}] ⏳ Esperando QR...`);
      await notifyConnectionAlert({
        instanceId,
        status: 'connecting',
      });
    }
  });

  // Manejar mensajes entrantes
  sock.ev.on('messages.upsert', async (m) => {
    const autoReplyEnabled = process.env.AUTO_REPLY_ENABLED !== 'false';
    const autoReplyMessage = process.env.AUTO_REPLY_MESSAGE || '¡Hola! 👋';
    const autoReplyKeywords = (process.env.AUTO_REPLY_KEYWORDS || 'hola')
      .split(',')
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
      if (!msg.message || msg.key.fromMe) continue;

      // Obtener el JID del remitente (puede ser @s.whatsapp.net o @lid)
      // Si es un mensaje de grupo, usar participant; si no, usar remoteJid
      const from = msg.key.participant || msg.key.remoteJid;
      
      if (!from) {
        console.log(`[${instanceId}] ⚠️ Mensaje sin remitente, saltando`);
        continue;
      }

      if (await isInternalContactAsync(from)) {
        logger.debug('Ignorando mensajes internos para evitar bucles', {
          event: 'message.internal.skip',
          instanceId,
          from,
        });
        continue;
      }

      const text = msg.message.conversation || msg.message.extendedTextMessage?.text;

      if (text && from) {
        const normalizedText = normalizeText(text);

        // Clave de deduplicación robusta: usa ID de WhatsApp si existe; si no, usa combinación estable
        const dedupeKey =
          msg.key.id ||
          `${from}|${normalizedText}|${String(msg.messageTimestamp || '')}`;

        // Evitar procesar duplicados (Baileys puede emitir el mismo mensaje 2 veces)
        if (dedupeKey) {
          if (seenIds.has(dedupeKey)) {
            continue;
          }
          seenIds.set(dedupeKey, Date.now());
          if (seenIds.size > 1000) {
            const oldestKey = Array.from(seenIds.entries()).sort((a, b) => a[1] - b[1])[0]?.[0];
            if (oldestKey) seenIds.delete(oldestKey);
          }
        }

        // Log del mensaje recibido
        console.log(`\n[${instanceId}] 📩 MENSAJE RECIBIDO:`);
        console.log(`[${instanceId}] De: ${from}`);
        console.log(`[${instanceId}] Texto: ${text}`);
        console.log(`[${instanceId}] Normalizado: ${normalizedText || '(vacío)'}`);
        console.log(`[${instanceId}] =========================\n`);
        
        logMessage.receive(instanceId, from, text);
        
        // Resolver el teléfono real desde el JID (puede ser @s.whatsapp.net o @lid)
        const phone = resolvePhoneFromJid(instanceId, from);
        
        if (!phone) {
          logger.warn('No se pudo resolver teléfono para JID, mensaje no enviado a GHL', {
            event: 'ghl.inbound.unresolved_jid',
            instanceId,
            jid: from,
          });
          console.log(`[${instanceId}] ⚠️ JID no resuelto: ${from}. Saltando envío a GHL.`);
          // Si quisieras registrar de todas formas con "unknown", hazlo aquí
          continue;
        }
        
        // Registrar en el historial con el teléfono REAL
        messageHistory.add({
          instanceId,
          type: 'inbound',
          from: `+${phone}`,
          text,
          status: 'received',
          timestamp: msg.messageTimestamp ? Number(msg.messageTimestamp) * 1000 : undefined,
        });
        
        // Enviar mensaje inbound a GHL con el teléfono REAL
        try {
          // Pasar el phone directamente (ya está normalizado)
          await sendInboundToGHL(instanceId, `+${phone}`, text, msg.messageTimestamp || undefined);
        } catch (error: any) {
          logger.error('Error al enviar mensaje inbound a GHL', {
            event: 'ghl.inbound.send_error',
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
            console.log(`[${instanceId}] 🤖 Enviando auto-respuesta a ${from}...`);
            await delay(1000);
            try {
              await sock.sendMessage(from, { text: autoReplyMessage });
              console.log(`[${instanceId}] ✅ Auto-respuesta enviada exitosamente`);
              logger.info('Respuesta automática enviada', {
                event: 'message.auto_reply',
                instanceId,
                to: from,
                received: text,
                reply: autoReplyMessage,
              });
            } catch (error: any) {
              console.error(`[${instanceId}] ❌ Error al enviar auto-respuesta:`, error.message);
              logger.error('Error al enviar auto-respuesta', {
                event: 'message.auto_reply.error',
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
  logger.info(`[${instanceId}] Socket registrado y eventos configurados`);
  
  // Log adicional para verificar que el socket está listo
  console.log(`[${instanceId}] ✅ Socket creado y listo. Esperando eventos de conexión...`);
  
  // Verificar después de un segundo si hay QR (para debugging)
  setTimeout(() => {
    const hasQR = qrCodes.has(instanceId);
    const status = connectionStatus.get(instanceId);
    console.log(`[${instanceId}] 📊 Estado después de 1s:`, {
      hasQR,
      status,
      socketExists: activeSockets.has(instanceId)
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
  return connectionStatus.get(instanceId) || 'disconnected';
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
 * Envía un mensaje de texto
 */
export async function sendTextMessage(instanceId: string, to: string, message: string): Promise<void> {
  const sock = activeSockets.get(instanceId);
  if (!sock) {
    throw new Error(`Instancia ${instanceId} no está conectada - socket no encontrado`);
  }

  // Debug: verificar si es destino interno
  const isInternal = await isInternalDestinationAsync(to);
  if (isInternal) {
    // Log para debugging
    console.log(`\n🚫 [ANTI-LOOP] Bloqueando envío a ${to}`);
    console.log(`   Instancias en memoria:`, Array.from(instanceNumbers.entries()));
    
    // Verificar también en Redis
    try {
      const redis = getRedisClient();
      const allNumbers = await redis.hgetall(REDIS_INSTANCE_NUMBERS_KEY);
      console.log(`   Instancias en Redis:`, allNumbers);
    } catch (e) {
      console.log(`   Error leyendo Redis:`, (e as Error).message);
    }
    
    throw new Error(`No se puede enviar mensajes entre instancias internas (${to}).`);
  }

  // Verificar estado de conexión
  const status = connectionStatus.get(instanceId);
  if (status !== 'ONLINE') {
    throw new Error(`Instancia ${instanceId} no está conectada. Estado: ${status}`);
  }

  // Verificar que el socket esté realmente conectado y autenticado
  if (sock.user === undefined) {
    logger.error('Socket no autenticado', {
      event: 'message.send.not_authenticated',
      instanceId,
      to,
    });
    throw new Error(`Socket de ${instanceId} no está autenticado (user es undefined)`);
  }

  // Verificar que el socket tenga las propiedades necesarias
  console.log(`[${instanceId}] Verificando socket:`, {
    hasUser: !!sock.user,
    userId: sock.user?.id,
    userJid: sock.user?.jid,
  });

  logger.info('Preparando envío de mensaje', {
    event: 'message.send.preparing',
    instanceId,
    to,
    messageLength: message.length,
    userExists: !!sock.user,
  });

  // Formatear JID correctamente usando onWhatsApp para normalizar
  let jid: string;
  if (to.includes('@')) {
    jid = to;
  } else {
    const digitsOnly = normalizePhoneInput(to);

    // 1. Intentar buscar JID/LID conocido por mapeo previo
    const knownJid = findJidByPhone(instanceId, digitsOnly);
    if (knownJid) {
      console.log(`[${instanceId}] ✅ Usando JID/LID conocido: ${digitsOnly} -> ${knownJid}`);
      jid = knownJid;
      
      // Verificar que siga activo (opcional, comentar si causa problemas)
      const lookup = await sock.onWhatsApp(knownJid);
      if (lookup && lookup.length > 0 && lookup[0].exists !== false) {
        // JID válido, continuar con el envío
        return await sendMessageViaSocket(sock, instanceId, knownJid, message);
      } else {
        console.log(`[${instanceId}] ⚠️ JID conocido ya no está activo, intentando normalización estándar`);
      }
    }

    // 2. Intentar normalización estándar y guardar jid + lid
    const normalizedNumber = `${digitsOnly}@s.whatsapp.net`;
    console.log(`[${instanceId}] 🔍 Normalizando número ${digitsOnly} -> ${normalizedNumber}`);
    const lookup = await sock.onWhatsApp(normalizedNumber);
    console.log(`[${instanceId}] 🔍 Resultado onWhatsApp:`, lookup);

    if (!lookup || lookup.length === 0 || !lookup[0].jid || lookup[0].exists === false) {
      const pending = await addPendingTextMessage(instanceId, to, digitsOnly, message, 'contact_inactive');
      logMessage.send(instanceId, 'text', to, 'waiting_contact', {
        pendingId: pending.id,
        reason: 'contact_inactive',
      });
      console.warn(
        `[${instanceId}] ⏳ No podemos escribir a ${to} todavía. El envío se realizará automáticamente cuando la persona nos hable.`
      );
      throw new WaitingForContactError(
        `El número ${to} no ha iniciado una conversación. Se enviará automáticamente cuando nos escriba.`,
        {
          pendingId: pending.id,
          instanceId,
          to,
          normalizedNumber: digitsOnly,
          type: 'text',
        }
      );
    }
    
    const info = lookup[0];
    jid = info.jid;
    
    // *** IMPORTANTE: Guardar jid Y lid en el mapeo ***
    savePhoneMapping(instanceId, digitsOnly, info.jid, info.lid as string | undefined);
  }
 
  console.log(`[${instanceId}] 📤 Preparando envío:`, {
    to,
    jid,
    messageLength: message.length,
  });
  
  logger.info('Iniciando envío', {
    event: 'message.send.starting',
    instanceId,
    jid,
    originalTo: to,
  });
  
  // Enviar mensaje con logging detallado y timeout
  try {
    console.log(`[${instanceId}] 📤 Llamando a sendMessage(${jid}, "${message.substring(0, 30)}...")`);
    
    logger.info('Llamando a sendMessage...', {
      event: 'message.send.calling',
      instanceId,
      jid,
      messageLength: message.length,
    });
    
    // Verificar que el socket tenga la función sendMessage
    if (typeof sock.sendMessage !== 'function') {
      throw new Error(`Socket de ${instanceId} no tiene la función sendMessage`);
    }
    
    console.log(`[${instanceId}] Socket verificado, tiene sendMessage:`, typeof sock.sendMessage === 'function');
    
    // Crear promise con timeout de 15 segundos (más corto para detectar problemas rápido)
    const startTime = Date.now();
    
    console.log(`[${instanceId}] ⏳ Iniciando envío (timeout: 15s)...`);
    
    const sendPromise = sock.sendMessage(jid, { text: message });
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        console.error(`\n[${instanceId}] ⏱️ TIMEOUT después de 15 segundos`);
        console.error(`[${instanceId}] ⚠️  El mensaje se está quedando colgado`);
        console.error(`[${instanceId}] Posibles causas:`);
        console.error(`[${instanceId}]   1. El número ${to} no tiene WhatsApp activo`);
        console.error(`[${instanceId}]   2. El número necesita estar en tus contactos de WhatsApp primero`);
        console.error(`[${instanceId}]   3. El número bloqueó tu cuenta`);
        console.error(`[${instanceId}]   4. Problema de conexión con los servidores de WhatsApp`);
        console.error(`[${instanceId}] 💡 SOLUCIÓN: Guarda el número ${to} en tus contactos de WhatsApp y vuelve a intentar\n`);
        reject(new Error(`Timeout: No se pudo enviar el mensaje a ${to} en 15 segundos. Guarda el número en tus contactos de WhatsApp y vuelve a intentar.`));
      }, 15000);
    });
    
    // Intentar enviar el mensaje con timeout
    console.log(`[${instanceId}] Ejecutando sock.sendMessage()...`);
    const result = await Promise.race([sendPromise, timeoutPromise]);
    const duration = Date.now() - startTime;
    
    console.log(`[${instanceId}] ✅ Mensaje enviado exitosamente en ${duration}ms`);
    console.log(`[${instanceId}] Resultado:`, result ? 'OK' : 'Sin resultado');
    
    logger.info('Mensaje enviado exitosamente', {
      event: 'message.send.success',
      instanceId,
      to,
      jid,
      duration,
      hasResult: !!result,
    });
    logMessage.send(instanceId, 'text', to, 'sent', { messageLength: message.length });
  } catch (error: any) {
    console.error(`[${instanceId}] ❌ Error al enviar mensaje:`, error.message);
    console.error(`[${instanceId}] Stack:`, error.stack);
    logger.error('Error al enviar mensaje de texto', {
      event: 'message.send.error',
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
export async function sendImageMessage(instanceId: string, to: string, imageUrl: string): Promise<void> {
  const sock = activeSockets.get(instanceId);
  if (!sock) {
    throw new Error(`Instancia ${instanceId} no está conectada`);
  }

  if (await isInternalDestinationAsync(to)) {
    throw new Error(`No se puede enviar imágenes entre instancias internas (${to}).`);
  }

  // Verificar que el socket esté realmente conectado
  if (sock.user === undefined) {
    throw new Error(`Socket de ${instanceId} no está autenticado`);
  }

  let jid: string;
  if (to.includes('@')) {
    jid = to;
  } else {
    const digitsOnly = normalizePhoneInput(to);

    const normalizedNumber = `${digitsOnly}@s.whatsapp.net`;
    console.log(`[${instanceId}] 🔍 Normalizando número ${digitsOnly} -> ${normalizedNumber}`);
    const lookup = await sock.onWhatsApp(normalizedNumber);
    console.log(`[${instanceId}] 🔍 Resultado onWhatsApp:`, lookup);

    if (!lookup || lookup.length === 0 || !lookup[0].jid || lookup[0].exists === false) {
      const pending = await addPendingImageMessage(instanceId, to, digitsOnly, imageUrl, 'contact_inactive');
      logMessage.send(instanceId, 'image', to, 'waiting_contact', {
        pendingId: pending.id,
        reason: 'contact_inactive',
      });
      console.warn(
        `[${instanceId}] ⏳ No podemos enviar imagen a ${to} todavía. Se enviará automáticamente cuando la persona nos hable.`
      );
      throw new WaitingForContactError(
        `El número ${to} no ha iniciado una conversación. La imagen se enviará automáticamente cuando nos escriba.`,
        {
          pendingId: pending.id,
          instanceId,
          to,
          normalizedNumber: digitsOnly,
          type: 'image',
        }
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
  
  // Enviar con timeout de 30 segundos (las imágenes pueden tardar más)
  const sendPromise = sock.sendMessage(jid, { image: buffer });
  const timeoutPromise = new Promise((_, reject) => 
    setTimeout(() => reject(new Error('Timeout: El envío de imagen tomó más de 30 segundos')), 30000)
  );

  try {
    await Promise.race([sendPromise, timeoutPromise]);
    logMessage.send(instanceId, 'image', to, 'sent', { 
      imageUrl, 
      imageSize: buffer.length 
    });
  } catch (error: any) {
    logger.error('Error al enviar imagen', {
      event: 'message.send.error',
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
    connectionStatus.set(instanceId, 'OFFLINE');
    updateInstanceMetadata(instanceId, { status: 'OFFLINE', lastError: 'Logged out manually' });
    instanceNumbers.delete(instanceId);
    await unregisterInstanceNumber(instanceId);
    logger.info(`[${instanceId}] Logout ejecutado`);
  }
}

/**
 * Lista todas las instancias con metadatos completos
 */
export function listInstances() {
  // Obtener todas las instancias únicas (tanto de activeSockets como de instancesMetadata)
  const allInstanceIds = new Set([
    ...activeSockets.keys(),
    ...instancesMetadata.keys()
  ]);
  
  return Array.from(allInstanceIds).map(id => {
    const metadata = instancesMetadata.get(id);
    const connectedNumber = getConnectedNumber(id);
    const status = connectionStatus.get(id) || 'OFFLINE';
    
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
    throw new Error('Límite máximo de instancias alcanzado (3). Elimina una instancia existente antes de crear una nueva.');
  }
  
  return `wa-${String(nextId).padStart(2, '0')}`;
}
