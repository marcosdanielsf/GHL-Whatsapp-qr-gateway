/**
 * Meta WhatsApp Cloud API Webhook Controller
 *
 * Endpoints:
 * - GET  /api/meta/webhook  → Verificacao do webhook (Meta challenge)
 * - POST /api/meta/webhook  → Receber mensagens e status updates
 * - POST /api/meta/send     → Enviar mensagem (texto livre ou template)
 */

import { Router, Request, Response } from "express";
import { logger } from "../utils/logger";
import { getSupabaseClient } from "../infra/supabaseClient";
import {
  getRoutingByPhoneNumberId,
  getRoutingByLocationId,
  validateWebhookSignature,
  sendTextMessage,
  sendTemplateMessage,
  sendImageMessage,
} from "../services/cloudapi.service";
import type {
  MetaWebhookPayload,
  MetaWebhookMessage,
  MetaWebhookStatus,
  WhatsAppRouting,
} from "../types/cloudapi";

export const metaWebhookRouter = Router();

// ─────────────────────────────────────────────
// GET /api/meta/webhook — Verificacao Meta
// ─────────────────────────────────────────────

metaWebhookRouter.get("/webhook", (req: Request, res: Response) => {
  const mode = req.query["hub.mode"] as string;
  const token = req.query["hub.verify_token"] as string;
  const challenge = req.query["hub.challenge"] as string;

  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN;

  if (mode === "subscribe" && token === verifyToken) {
    logger.info("Meta webhook verificado com sucesso", {
      event: "meta.webhook.verified",
    });
    return res.status(200).send(challenge);
  }

  logger.warn("Meta webhook verificacao falhou", {
    event: "meta.webhook.verify_failed",
    mode,
    tokenMatch: token === verifyToken,
  });
  return res.status(403).send("Forbidden");
});

// ─────────────────────────────────────────────
// POST /api/meta/webhook — Receber mensagens
// ─────────────────────────────────────────────

metaWebhookRouter.post("/webhook", async (req: Request, res: Response) => {
  // Validar HMAC-SHA256 ANTES de processar (P0 security)
  const signature = req.headers["x-hub-signature-256"] as string;
  const appSecret = process.env.META_APP_SECRET;

  if (appSecret) {
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(JSON.stringify(req.body));
    if (
      !signature ||
      !validateWebhookSignature(rawBody, signature, appSecret)
    ) {
      logger.warn("Meta webhook HMAC validation failed", {
        event: "meta.webhook.hmac_failed",
        hasSignature: !!signature,
      });
      return res.status(403).send("Forbidden");
    }
  }

  // Parse body se veio como raw Buffer
  let payload: MetaWebhookPayload;
  if (Buffer.isBuffer(req.body)) {
    try {
      payload = JSON.parse(req.body.toString()) as MetaWebhookPayload;
    } catch {
      logger.error("Meta webhook body parse failed", {
        event: "meta.webhook.parse_error",
      });
      return res.status(400).send("Bad Request");
    }
  } else {
    payload = req.body as MetaWebhookPayload;
  }

  // SEMPRE responder 200 rapido (Meta retry apos 20s timeout)
  res.status(200).send("EVENT_RECEIVED");

  try {
    if (payload.object !== "whatsapp_business_account") {
      logger.debug(
        "Webhook Meta ignorado (object != whatsapp_business_account)",
        {
          event: "meta.webhook.ignored",
          object: payload.object,
        },
      );
      return;
    }

    for (const entry of payload.entry) {
      for (const change of entry.changes) {
        const value = change.value;
        const phoneNumberId = value.metadata.phone_number_id;

        // Buscar routing pra esse numero
        const routing = await getRoutingByPhoneNumberId(phoneNumberId);
        if (!routing) {
          logger.warn("Routing nao encontrado para phone_number_id", {
            event: "meta.webhook.no_routing",
            phoneNumberId,
          });
          continue;
        }

        // Processar mensagens recebidas
        if (value.messages && value.messages.length > 0) {
          for (const message of value.messages) {
            await handleInboundMessage(
              routing,
              message,
              value.contacts?.[0]?.profile?.name,
            );
          }
        }

        // Processar status updates (delivered, read, failed)
        if (value.statuses && value.statuses.length > 0) {
          for (const status of value.statuses) {
            await handleStatusUpdate(routing, status);
          }
        }
      }
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Erro ao processar webhook Meta", {
      event: "meta.webhook.error",
      error: message,
    });
  }
});

/**
 * Processa mensagem inbound (lead enviou msg)
 */
async function handleInboundMessage(
  routing: WhatsAppRouting,
  message: MetaWebhookMessage,
  contactName?: string,
): Promise<void> {
  // Extrair conteudo baseado no tipo
  let content = "";
  switch (message.type) {
    case "text":
      content = message.text?.body || "";
      break;
    case "image":
      content = message.image?.caption || "[Imagem]";
      break;
    case "document":
      content =
        message.document?.caption ||
        `[Documento: ${message.document?.filename || ""}]`;
      break;
    case "audio":
      content = "[Audio]";
      break;
    case "video":
      content = message.video?.caption || "[Video]";
      break;
    case "location":
      content = `[Localizacao: ${message.location?.name || ""} ${message.location?.address || ""}]`;
      break;
    case "button":
      content = message.button?.text || "[Botao]";
      break;
    case "interactive":
      content =
        message.interactive?.button_reply?.title ||
        message.interactive?.list_reply?.title ||
        "[Interativo]";
      break;
    default:
      content = `[${message.type}]`;
  }

  logger.info("Mensagem inbound recebida via Cloud API", {
    event: "meta.inbound.received",
    from: message.from,
    type: message.type,
    locationId: routing.location_id,
    wamid: message.id,
    contactName,
  });

  // Salvar no Supabase
  const supabase = getSupabaseClient();
  await supabase.from("whatsapp_cloud_messages").insert({
    routing_id: routing.id,
    wamid: message.id,
    direction: "inbound",
    message_type: message.type,
    contact_phone: message.from,
    content,
    status: "delivered",
    metadata: {
      contact_name: contactName,
      timestamp: message.timestamp,
      context: message.context,
    },
  });

  // Atualizar last_message_at
  await supabase
    .from("whatsapp_routing")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", routing.id);

  // Encaminhar pra n8n via webhook (se configurado)
  if (routing.n8n_webhook_url) {
    try {
      const n8nPayload = {
        source: "cloud_api",
        location_id: routing.location_id,
        phone_number_id: routing.phone_number_id,
        from: message.from,
        contact_name: contactName,
        message_id: message.id,
        timestamp: message.timestamp,
        type: message.type,
        text: content,
        raw_message: message,
      };

      const n8nResponse = await fetch(routing.n8n_webhook_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(n8nPayload),
      });

      if (!n8nResponse.ok) {
        logger.warn("n8n webhook retornou erro", {
          event: "meta.inbound.n8n_error",
          status: n8nResponse.status,
          locationId: routing.location_id,
        });
      }
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error("Erro ao encaminhar pra n8n", {
        event: "meta.inbound.n8n_exception",
        error: errMsg,
        locationId: routing.location_id,
      });
    }
  }
}

/**
 * Processa status update (sent, delivered, read, failed)
 */
async function handleStatusUpdate(
  routing: WhatsAppRouting,
  status: MetaWebhookStatus,
): Promise<void> {
  const supabase = getSupabaseClient();

  // Atualizar status da mensagem
  const updateData: Record<string, unknown> = {
    status: status.status,
  };

  // Se tem info de conversa, salvar (pra tracking de custo)
  if (status.conversation) {
    updateData.conversation_id = status.conversation.id;
    updateData.conversation_category = status.conversation.origin?.type;
  }

  // Se falhou, salvar erro
  if (status.status === "failed" && status.errors?.length) {
    updateData.error_code = String(status.errors[0].code);
    updateData.error_message = status.errors[0].message;
  }

  const { error } = await supabase
    .from("whatsapp_cloud_messages")
    .update(updateData)
    .eq("wamid", status.id);

  if (error) {
    logger.warn("Erro ao atualizar status de mensagem", {
      event: "meta.status.update_error",
      wamid: status.id,
      status: status.status,
      error: error.message,
    });
  } else {
    logger.debug("Status de mensagem atualizado", {
      event: "meta.status.updated",
      wamid: status.id,
      status: status.status,
      category: status.conversation?.origin?.type,
    });
  }
}

// ─────────────────────────────────────────────
// POST /api/meta/send — Enviar mensagem
// ─────────────────────────────────────────────

metaWebhookRouter.post("/send", async (req: Request, res: Response) => {
  try {
    const {
      location_id,
      to,
      type,
      text,
      template_name,
      language,
      components,
      image_url,
      caption,
    } = req.body;

    if (!location_id || !to) {
      return res.status(400).json({
        success: false,
        error: "Campos obrigatorios: location_id, to",
      });
    }

    // Validar formato E.164
    const e164Regex = /^\+\d{10,15}$/;
    if (!e164Regex.test(to)) {
      return res.status(400).json({
        success: false,
        error: "Campo 'to' deve estar em formato E.164 (ex: +5511999999999)",
      });
    }

    // Buscar routing
    const routing = await getRoutingByLocationId(location_id);
    if (!routing) {
      return res.status(404).json({
        success: false,
        error: `Routing nao encontrado para location_id: ${location_id}`,
      });
    }

    if (!routing.is_cloud_api) {
      return res.status(400).json({
        success: false,
        error:
          "Este cliente ainda esta no Baileys. Use /api/send ou /api/ghl/outbound.",
      });
    }

    let result = null;
    const messageType = type || "text";

    switch (messageType) {
      case "text":
        if (!text?.body && !text) {
          return res.status(400).json({
            success: false,
            error: "Campo text.body obrigatorio para tipo text",
          });
        }
        result = await sendTextMessage(
          routing,
          to,
          typeof text === "string" ? text : text.body,
        );
        break;

      case "template":
        if (!template_name) {
          return res.status(400).json({
            success: false,
            error: "Campo template_name obrigatorio para tipo template",
          });
        }
        result = await sendTemplateMessage(
          routing,
          to,
          template_name,
          language || "pt_BR",
          components,
        );
        break;

      case "image":
        if (!image_url) {
          return res.status(400).json({
            success: false,
            error: "Campo image_url obrigatorio para tipo image",
          });
        }
        result = await sendImageMessage(routing, to, image_url, caption);
        break;

      default:
        return res.status(400).json({
          success: false,
          error: `Tipo nao suportado: ${messageType}`,
        });
    }

    if (!result) {
      return res.status(500).json({
        success: false,
        error: "Erro ao enviar mensagem via Cloud API",
      });
    }

    return res.json({
      success: true,
      wamid: result.messages?.[0]?.id,
      to,
      type: messageType,
      location_id,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Erro no endpoint /api/meta/send", {
      event: "meta.send.error",
      error: message,
    });
    return res.status(500).json({ success: false, error: message });
  }
});

// ─────────────────────────────────────────────
// POST /api/meta/send-template — Enviar template HSM
// ─────────────────────────────────────────────

metaWebhookRouter.post(
  "/send-template",
  async (req: Request, res: Response) => {
    try {
      const { location_id, to, template_name, language, components } = req.body;

      if (!location_id || !to || !template_name) {
        return res.status(400).json({
          success: false,
          error: "Campos obrigatorios: location_id, to, template_name",
        });
      }

      const routing = await getRoutingByLocationId(location_id);
      if (!routing || !routing.is_cloud_api) {
        return res.status(404).json({
          success: false,
          error: "Routing Cloud API nao encontrado",
        });
      }

      const result = await sendTemplateMessage(
        routing,
        to,
        template_name,
        language || "pt_BR",
        components,
      );

      if (!result) {
        return res
          .status(500)
          .json({ success: false, error: "Erro ao enviar template" });
      }

      return res.json({
        success: true,
        wamid: result.messages?.[0]?.id,
        to,
        template_name,
        location_id,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("Erro no endpoint /api/meta/send-template", {
        event: "meta.send_template.error",
        error: message,
      });
      return res.status(500).json({ success: false, error: message });
    }
  },
);
