import { Router, Request, Response } from "express";
import { logger } from "../utils/logger";
import { getConnectionStatus } from "../core/baileys";
import { getSupabaseClient } from "../infra/supabaseClient";
import { queueMessage } from "../core/queue";
import { messageHistory } from "../core/messageHistory";
import { ghlService } from "../services/ghl.service";
import type { GHLIntegration } from "../types";

export const ghlRouter = Router();

/**
 * POST /outbound-test
 * Endpoint alternativo que recibe webhooks de GHL con formato:
 * {
 *   "instanceId": "wa-01",
 *   "to": "+51999999999",
 *   "type": "text",
 *   "message": "Hola {{ contact.name }}, bienvenid@ ❤️"
 * }
 *
 * Este endpoint simplemente redirige internamente a /api/ghl/outbound
 * para mantener compatibilidad con diferentes URLs de ngrok
 */
const outboundTestRouter = Router();

outboundTestRouter.post("/", async (req: Request, res: Response) => {
  try {
    const { instanceId, to, type, message } = req.body;

    logger.info("Request recibido en /outbound-test", {
      event: "ghl.outbound_test.received",
      instanceId,
      to,
      type,
    });

    // Validar datos requeridos
    if (!to || !message) {
      logger.warn("Request /outbound-test inválido", {
        event: "ghl.outbound_test.invalid",
        body: req.body,
      });
      return res.status(400).json({
        success: false,
        error: "Faltan campos requeridos: to y message",
      });
    }

    // Validar que el mensaje no esté vacío
    if (typeof message !== "string" || message.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'El campo "message" no puede estar vacío',
      });
    }

    const finalInstanceId = instanceId || "wa-01"; // PLACEHOLDER
    const finalType = type || "text";

    // Verificar que la instancia esté conectada
    const status = getConnectionStatus(finalInstanceId);
    if (status !== "ONLINE") {
      logger.warn("Intento de envío /outbound-test a instancia no conectada", {
        event: "ghl.outbound_test.not_connected",
        instanceId: finalInstanceId,
        status,
        to,
      });
      return res.status(400).json({
        success: false,
        error: `Instancia ${finalInstanceId} no está conectada. Estado: ${status}`,
      });
    }

    // Agregar mensaje a la cola
    const jobId = await queueMessage(finalInstanceId, finalType, to, message);

    logger.info("Mensaje /outbound-test encolado exitosamente", {
      event: "ghl.outbound_test.success",
      instanceId: finalInstanceId,
      to,
      type: finalType,
      jobId,
    });

    res.json({
      success: true,
      message: `Mensaje desde GHL encolado para envío a ${to}`,
      instanceId: finalInstanceId,
      to,
      type: finalType,
      jobId,
      status: "queued",
    });
  } catch (error: any) {
    logger.error(`[OUTBOUND-TEST] ❌ Error:`, error);
    logger.error("Error al procesar mensaje /outbound-test", {
      event: "ghl.outbound_test.error",
      error: error.message,
      stack: error.stack,
      body: req.body,
    });

    // Asegurar que siempre respondemos (evitar 502)
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: error.message || "Error interno del servidor",
      });
    }
  }
});

export { outboundTestRouter };

/**
 * POST /api/ghl/outbound
 * Recibe un mensaje desde GHL y lo envía por WhatsApp
 *
 * Soporta 3 formatos:
 *
 * 1. Custom Conversation Provider (GHL Marketplace App):
 * {
 *   "contactId": "xxx",
 *   "locationId": "xxx",
 *   "messageId": "xxx",
 *   "phone": "+51999999999",
 *   "message": "Texto",
 *   "attachments": []
 * }
 *
 * 2. Formato simple (webhook directo):
 * {
 *   "instanceId": "wa-01",
 *   "to": "+51999999999",
 *   "type": "text",
 *   "message": "Texto"
 * }
 *
 * 3. Formato antiguo (compatible):
 * {
 *   "locationId": "xxx",
 *   "contactId": "yyy",
 *   "phone": "+51999999999",
 *   "message": "Texto"
 * }
 */
ghlRouter.post("/outbound", async (req: Request, res: Response) => {
  // LOG INMEDIATO para verificar que el servidor recibe la petición
  logger.debug("\n🔵 [GHL OUTBOUND] ⚡ Petición recibida en /api/ghl/outbound");
  logger.debug(`   Timestamp: ${new Date().toISOString()}`);
  logger.debug(`   Method: ${req.method}`);
  logger.debug(`   Path: ${req.path}`);
  logger.debug(`   Headers:`, JSON.stringify(req.headers, null, 2));

  // Responder inmediatamente para evitar timeout de ngrok
  // Esto asegura que ngrok reciba una respuesta, incluso si hay un error después
  let responded = false;

  const sendResponse = (status: number, data: object) => {
    if (!responded) {
      responded = true;
      try {
        res.status(status).json(data);
      } catch (e: any) {
        logger.warn("sendResponse falhou (stream já fechado)", {
          event: "ghl.outbound.response_error",
          status,
          error: e?.message,
        });
      }
    }
  };

  // Timeout para evitar que ngrok reciba 502
  const timeout = setTimeout(() => {
    if (!responded) {
      logger.error(
        "\n🔴 [GHL OUTBOUND] ⚠️ Timeout - enviando respuesta de error",
      );
      sendResponse(500, {
        success: false,
        error: "Timeout procesando la petición",
      });
    }
  }, 25000); // 25 segundos (ngrok tiene timeout de 30s)

  try {
    // Log completo de la petición para debugging
    logger.info("Request recibido en /api/ghl/outbound", {
      event: "ghl.outbound.received",
      headers: {
        "content-type": req.headers["content-type"],
        "user-agent": req.headers["user-agent"]?.substring(0, 50),
      },
      body: req.body, // Log completo del body para debugging
    });

    logger.debug(`\n[GHL OUTBOUND] 📥 Request recibido:`, {
      method: req.method,
      path: req.path,
      body: req.body,
      headers: {
        "content-type": req.headers["content-type"],
      },
    });

    // Detectar formato Custom Provider (tiene messageId del GHL)
    const isCustomProviderFormat = !!(
      req.body.messageId &&
      req.body.locationId &&
      req.body.contactId
    );

    // Parsear mensaje usando el helper del servicio
    const parsedMessage = ghlService.parseGHLOutboundWebhook(req.body);

    if (!parsedMessage) {
      clearTimeout(timeout);
      logger.warn("Request GHL outbound con formato inválido", {
        event: "ghl.outbound.invalid_format",
        body: req.body,
      });
      return sendResponse(400, {
        success: false,
        error:
          "Formato de mensaje inválido. Se requiere (to/phone + message) o (messageId + locationId + contactId + phone + message)",
      });
    }

    // Extraer datos del mensaje parseado
    const {
      contactId,
      locationId,
      messageId: ghlMessageId,
      phone: rawPhone,
      message,
      attachments,
    } = parsedMessage;

    // Soportar instanceId explícito o buscar por locationId
    // Resolver scopedId correto via location → tenant → instance
    let finalInstanceId = req.body.instanceId || "";
    let integrationCache: GHLIntegration | null = null; // reutilizado no lookup do contato abaixo
    if (!finalInstanceId) {
      try {
        integrationCache = await ghlService.getIntegrationByLocationId(
          parsedMessage?.locationId || req.body.locationId || "",
        );
        if (integrationCache?.tenant_id) {
          const sbClient = getSupabaseClient();
          const { data: instData } = await sbClient
            .from("ghl_wa_instances")
            .select("name")
            .eq("tenant_id", integrationCache.tenant_id)
            .eq("status", "connected")
            .limit(1)
            .maybeSingle();
          if (instData?.name)
            finalInstanceId = `${integrationCache.tenant_id}-${instData.name}`;
        }
      } catch (_e) {}
    }
    if (!finalInstanceId) {
      clearTimeout(timeout);
      logger.warn("Nenhuma instância WA ativa encontrada para a integração", {
        event: "ghl.outbound.no_instance",
        locationId,
      });
      return sendResponse(503, {
        success: false,
        error:
          "Nenhuma instância WhatsApp ativa encontrada para esta integração. Verifique se há uma instância conectada.",
      });
    }

    // Validar instanceId
    if (
      !finalInstanceId ||
      finalInstanceId === "null" ||
      finalInstanceId === ""
    ) {
      clearTimeout(timeout);
      logger.warn("Request GHL outbound sin instanceId válido", {
        event: "ghl.outbound.invalid_instance",
        body: req.body,
      });
      return sendResponse(400, {
        success: false,
        error:
          'El campo "instanceId" es requerido (o "locationId" con integración configurada)',
      });
    }

    finalInstanceId = String(finalInstanceId);

    // Para Custom Provider, buscar o telefone real do contato via GHL API.
    // O campo "phone" do webhook é o canal/roteamento do GHL (pode ser número fictício).
    // O número real do lead está no objeto de contato.
    let resolvedPhone = rawPhone;
    if (isCustomProviderFormat && contactId && locationId) {
      try {
        const intForContact =
          integrationCache ||
          (await ghlService.getIntegrationByLocationId(locationId));
        if (intForContact) {
          const validToken = await ghlService.ensureValidToken(intForContact);
          const contact = await ghlService.getContactById(
            validToken,
            contactId,
          );
          if (contact?.email?.endsWith("@g.us")) {
            resolvedPhone = contact.email;
            logger.info("Grupo resolvido via email do contato GHL", {
              event: "ghl.outbound.group_resolved",
              rawPhone,
              groupJid: contact.email,
              contactId,
            });
          } else if (contact?.phone) {
            resolvedPhone = contact.phone;
            logger.info("Telefone resolvido via GHL API", {
              event: "ghl.outbound.phone_resolved",
              rawPhone,
              resolvedPhone: contact.phone,
              contactId,
            });
          }
        }
      } catch (_e: any) {
        logger.warn("getContactById fallback to rawPhone", {
          contactId,
          error: _e?.message,
        });
      }
    }

    // Normalizar número de teléfono: quitar espacios, guiones, etc. y agregar código de país si falta
    let finalTo: string;

    if (!resolvedPhone) {
      finalTo = "";
    } else if (String(resolvedPhone).endsWith("@g.us")) {
      finalTo = String(resolvedPhone);
      logger.debug(`[GHL OUTBOUND] 👥 Grupo resolvido: ${finalTo}`);
    } else {
      // Quitar espacios, guiones, paréntesis, etc.
      let cleaned = String(resolvedPhone).replace(/[\s\-\(\)\.]/g, "");

      // Si no empieza con +, asumir código de país de Perú (51) o Brasil (55)
      if (!cleaned.startsWith("+")) {
        // Si ya tiene código de país (empieza con 51 o 55), agregar +
        if (
          (cleaned.startsWith("51") || cleaned.startsWith("55")) &&
          cleaned.length >= 10
        ) {
          cleaned = "+" + cleaned;
        } else if (cleaned.length === 9) {
          // Si tiene 9 dígitos, es un número peruano sin código de país
          cleaned = "+51" + cleaned;
        } else if (cleaned.length === 11 && cleaned.startsWith("11")) {
          // Número brasileiro (11 dígitos, começa com DDD)
          cleaned = "+55" + cleaned;
        } else {
          // Intentar con +55 (Brasil) por defecto
          cleaned = "+55" + cleaned;
        }
      }

      finalTo = cleaned;
      logger.debug(
        `  📞 Número normalizado: "${resolvedPhone}" -> "${finalTo}"`,
      );
    }

    // GHL envia type="OutboundMessage" (evento), usar contentType para o tipo real
    const contentType = String(req.body.contentType || "");
    const hasAttachments = attachments && attachments.length > 0;
    const firstAttachment = hasAttachments ? attachments[0] : undefined;
    const attachmentType = String(firstAttachment?.type || "");
    const attachmentUrl = firstAttachment?.url || "";
    const finalType =
      contentType.startsWith("image") || attachmentType.startsWith("image")
        ? "image"
        : contentType.startsWith("audio") || attachmentType.startsWith("audio")
          ? "audio"
          : "text";
    const finalMessage =
      finalType === "text" ? message : attachmentUrl || message;

    // Validar datos requeridos
    if (!finalTo || !finalMessage) {
      clearTimeout(timeout);
      logger.warn("Request GHL outbound inválido", {
        event: "ghl.outbound.invalid",
        body: req.body,
      });
      return sendResponse(400, {
        success: false,
        error: "Faltan campos requeridos: to (o phone) y message/attachment",
      });
    }

    // Validar que el mensaje no esté vacío
    if (typeof finalMessage !== "string" || finalMessage.trim().length === 0) {
      clearTimeout(timeout);
      return sendResponse(400, {
        success: false,
        error: 'El campo "message" o attachment url no puede estar vacío',
      });
    }

    // Validar formato de teléfono (básico)
    if (typeof finalTo !== "string" || finalTo.trim().length === 0) {
      clearTimeout(timeout);
      return sendResponse(400, {
        success: false,
        error: 'El campo "to" (o "phone") no puede estar vacío',
      });
    }

    // Converter phone do GHL para JID do WhatsApp
    // Se o número tem >13 dígitos após remover +, é um JID de grupo (@g.us)
    // Caso contrário, é um número normal (@s.whatsapp.net)
    if (finalTo && finalTo.startsWith("+")) {
      const digits = finalTo.replace("+", "");
      if (digits.length > 13) {
        // Grupo: +1203633932485136 → 1203633932485136@g.us
        finalTo = digits + "@g.us";
        logger.debug(`[GHL OUTBOUND] 👥 Grupo detectado: ${finalTo}`);
      }
    }

    // Verificar estado da instância WA
    const status = getConnectionStatus(finalInstanceId);
    if (status === "OFFLINE") {
      // OFFLINE = desconectado permanentemente (logout). Rejeitar para GHL não perder o job.
      clearTimeout(timeout);
      logger.warn("Instância OFFLINE — rejeitando mensagem GHL", {
        event: "ghl.outbound.not_connected",
        instanceId: finalInstanceId,
        status,
        to: finalTo,
      });
      return sendResponse(503, {
        success: false,
        error: `Instância ${finalInstanceId} está desconectada (OFFLINE). Reconecte o WhatsApp.`,
      });
    }
    if (status !== "ONLINE") {
      // RECONNECTING: aceitar e enfileirar — o worker vai enviar quando reconectar
      logger.warn("Instância RECONNECTING — enfileirando mensagem GHL", {
        event: "ghl.outbound.reconnecting_queued",
        instanceId: finalInstanceId,
        status,
        to: finalTo,
      });
    }

    // Agregar mensaje a la cola (llamando internamente a queueMessage)
    const jobId = await queueMessage(
      finalInstanceId,
      finalType,
      finalTo,
      finalMessage,
    );

    // Registrar en el historial
    messageHistory.add({
      instanceId: finalInstanceId,
      type: "outbound",
      to: finalTo,
      text:
        finalType === "audio"
          ? `[Audio: ${finalMessage}]`
          : finalType === "image"
            ? `[Imagen: ${finalMessage}]`
            : finalMessage,
      status: "queued",
      metadata: {
        jobId,
        locationId,
        contactId,
        source: "ghl",
        contentType,
        attachmentType,
      },
    });

    logger.info("Mensaje GHL encolado exitosamente", {
      event: "ghl.outbound.success",
      locationId,
      contactId,
      to: finalTo,
      phone: finalTo, // Mantener compatibilidad
      instanceId: finalInstanceId,
      type: finalType,
      jobId,
      isCustomProvider: isCustomProviderFormat,
      ghlMessageId,
    });

    // Si es formato Custom Provider, intentar actualizar el status en GHL (en background)
    if (isCustomProviderFormat && ghlMessageId && locationId) {
      // No esperamos la respuesta para no bloquear
      (async () => {
        try {
          const integration =
            await ghlService.getIntegrationByLocationId(locationId);
          if (integration) {
            // Primero, marcar como "delivered" (enviado al WhatsApp)
            await ghlService.updateMessageStatus(
              integration,
              ghlMessageId,
              "delivered",
            );
            logger.info("Status de mensaje actualizado en GHL", {
              event: "ghl.outbound.status_updated",
              ghlMessageId,
              status: "delivered",
            });
          }
        } catch (statusError: any) {
          logger.warn("Error al actualizar status en GHL (no bloqueante)", {
            event: "ghl.outbound.status_error",
            ghlMessageId,
            error: statusError.message,
          });
        }
      })();
    }

    // Limpiar timeout si respondemos exitosamente
    clearTimeout(timeout);

    sendResponse(200, {
      success: true,
      message: `Mensaje desde GHL encolado para envío a ${finalTo}`,
      locationId,
      contactId,
      to: finalTo,
      phone: finalTo, // Mantener compatibilidad
      instanceId: finalInstanceId,
      type: finalType,
      jobId,
      status: "queued",
      ghlMessageId: isCustomProviderFormat ? ghlMessageId : undefined,
    });
  } catch (error: any) {
    // Limpiar timeout en caso de error
    clearTimeout(timeout);

    logger.error(`\n🔴 [GHL OUTBOUND] ❌ Error:`, error);
    logger.error(`   Stack:`, error.stack);
    logger.error("Error al procesar mensaje GHL outbound", {
      event: "ghl.outbound.error",
      error: error.message,
      stack: error.stack,
      body: req.body,
    });

    // Asegurar que siempre respondemos (evitar 502)
    if (!responded) {
      sendResponse(500, {
        success: false,
        error: error.message || "Error interno del servidor",
      });
    }
  }
});

/**
 * POST /api/ghl/inbound-test
 * Endpoint de prueba para recibir mensajes inbound desde el gateway
 * (Este es un endpoint mock/test para desarrollo)
 *
 * Body:
 * {
 *   "instanceId": "wa-01",
 *   "from": "+51999999999",
 *   "text": "hola",
 *   "timestamp": 1731300000
 * }
 */
ghlRouter.post("/inbound-test", async (req: Request, res: Response) => {
  try {
    const { instanceId, from, text, timestamp } = req.body;

    logger.info("Mensaje inbound recibido desde gateway (test)", {
      event: "ghl.inbound.received",
      instanceId,
      from,
      text,
      timestamp,
    });

    logger.debug("\n📥 GHL INBOUND RECIBIDO:");
    logger.debug(`InstanceId: ${instanceId}`);
    logger.debug(`From: ${from}`);
    logger.debug(`Text: ${text}`);
    logger.debug(`Timestamp: ${timestamp}`);
    logger.debug("=========================\n");

    // Aquí normalmente se haría el procesamiento real de GHL:
    // - Mapear from → contacto (por número)
    // - Mostrar el mensaje en GHL
    // - Disparar workflows si es necesario

    res.json({
      success: true,
      message: "Mensaje inbound recibido correctamente",
      data: {
        instanceId,
        from,
        text,
        timestamp,
      },
    });
  } catch (error: any) {
    logger.error("Error al procesar mensaje GHL inbound", {
      event: "ghl.inbound.error",
      error: error.message,
      stack: error.stack,
      body: req.body,
    });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});
