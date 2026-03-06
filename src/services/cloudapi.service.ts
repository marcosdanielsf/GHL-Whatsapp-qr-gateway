/**
 * WhatsApp Cloud API Service
 *
 * Responsavel por:
 * - Enviar mensagens via Graph API (texto, template, imagem)
 * - Lookup de routing por phone_number_id
 * - Validacao HMAC-SHA256 de webhooks Meta
 */

import crypto from "crypto";
import { getSupabaseClient } from "../infra/supabaseClient";
import { logger } from "../utils/logger";
import type {
  WhatsAppRouting,
  CloudAPISendTextRequest,
  CloudAPISendTemplateRequest,
  CloudAPISendImageRequest,
  CloudAPISendResponse,
  CloudAPITemplateComponent,
} from "../types/cloudapi";

const GRAPH_API_VERSION = "v21.0";
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

// Cache de routing pra evitar lookup a cada mensagem
const routingCache = new Map<
  string,
  { data: WhatsAppRouting; expiresAt: number }
>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

/**
 * Busca routing por phone_number_id (webhook Meta envia esse campo)
 */
export async function getRoutingByPhoneNumberId(
  phoneNumberId: string,
): Promise<WhatsAppRouting | null> {
  const cached = routingCache.get(`pnid:${phoneNumberId}`);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("whatsapp_routing")
    .select("*")
    .eq("phone_number_id", phoneNumberId)
    .eq("is_active", true)
    .eq("is_cloud_api", true)
    .maybeSingle();

  if (error) {
    logger.error("Erro ao buscar routing por phone_number_id", {
      event: "cloudapi.routing.error",
      phoneNumberId,
      error: error.message,
    });
    return null;
  }

  if (data) {
    routingCache.set(`pnid:${phoneNumberId}`, {
      data,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
  }

  return data;
}

/**
 * Busca routing por location_id
 */
export async function getRoutingByLocationId(
  locationId: string,
): Promise<WhatsAppRouting | null> {
  const cached = routingCache.get(`loc:${locationId}`);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("whatsapp_routing")
    .select("*")
    .eq("location_id", locationId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    logger.error("Erro ao buscar routing por location_id", {
      event: "cloudapi.routing.error",
      locationId,
      error: error.message,
    });
    return null;
  }

  if (data) {
    routingCache.set(`loc:${locationId}`, {
      data,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
  }

  return data;
}

/**
 * Valida assinatura HMAC-SHA256 do webhook Meta
 */
export function validateWebhookSignature(
  rawBody: Buffer,
  signature: string,
  appSecret: string,
): boolean {
  if (!signature || !signature.startsWith("sha256=")) return false;

  const expectedSignature = crypto
    .createHmac("sha256", appSecret)
    .update(rawBody)
    .digest("hex");

  const providedSignature = signature.replace("sha256=", "");

  return crypto.timingSafeEqual(
    Buffer.from(expectedSignature, "hex"),
    Buffer.from(providedSignature, "hex"),
  );
}

/**
 * Envia mensagem de texto via Cloud API
 */
export async function sendTextMessage(
  routing: WhatsAppRouting,
  to: string,
  text: string,
): Promise<CloudAPISendResponse | null> {
  const payload: CloudAPISendTextRequest = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { preview_url: false, body: text },
  };

  return sendMessage(routing, payload);
}

/**
 * Envia template HSM via Cloud API
 */
export async function sendTemplateMessage(
  routing: WhatsAppRouting,
  to: string,
  templateName: string,
  language: string = "pt_BR",
  components?: CloudAPITemplateComponent[],
): Promise<CloudAPISendResponse | null> {
  const payload: CloudAPISendTemplateRequest = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: language },
      components,
    },
  };

  return sendMessage(routing, payload);
}

/**
 * Envia imagem via Cloud API
 */
export async function sendImageMessage(
  routing: WhatsAppRouting,
  to: string,
  imageUrl: string,
  caption?: string,
): Promise<CloudAPISendResponse | null> {
  const payload: CloudAPISendImageRequest = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "image",
    image: { link: imageUrl, caption },
  };

  return sendMessage(routing, payload);
}

/**
 * Envia mensagem genérica via Graph API
 */
async function sendMessage(
  routing: WhatsAppRouting,
  payload:
    | CloudAPISendTextRequest
    | CloudAPISendTemplateRequest
    | CloudAPISendImageRequest,
): Promise<CloudAPISendResponse | null> {
  if (!routing.phone_number_id || !routing.access_token) {
    logger.error("Routing sem phone_number_id ou access_token", {
      event: "cloudapi.send.missing_config",
      locationId: routing.location_id,
    });
    return null;
  }

  const url = `${GRAPH_API_BASE}/${routing.phone_number_id}/messages`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${routing.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error("Erro ao enviar mensagem via Cloud API", {
        event: "cloudapi.send.error",
        status: response.status,
        body: errorBody,
        locationId: routing.location_id,
        phoneNumberId: routing.phone_number_id,
        hasAccessToken: !!routing.access_token,
      });
      return null;
    }

    const result = (await response.json()) as CloudAPISendResponse;

    // Atualizar last_message_at
    const supabase = getSupabaseClient();
    await supabase
      .from("whatsapp_routing")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", routing.id);

    // Log de mensagem enviada no tracking
    const messageType = "type" in payload ? payload.type : "text";
    await supabase.from("whatsapp_cloud_messages").insert({
      routing_id: routing.id,
      wamid: result.messages?.[0]?.id,
      direction: "outbound",
      message_type: messageType,
      template_name:
        messageType === "template"
          ? (payload as CloudAPISendTemplateRequest).template.name
          : null,
      contact_phone: "to" in payload ? payload.to : "",
      content:
        messageType === "text"
          ? (payload as CloudAPISendTextRequest).text.body
          : `[${messageType}]`,
      status: "sent",
    });

    logger.info("Mensagem enviada via Cloud API", {
      event: "cloudapi.send.success",
      wamid: result.messages?.[0]?.id,
      locationId: routing.location_id,
      to: "to" in payload ? payload.to : "",
      type: messageType,
    });

    return result;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Excecao ao enviar mensagem via Cloud API", {
      event: "cloudapi.send.exception",
      error: message,
      locationId: routing.location_id,
    });
    return null;
  }
}

/**
 * Limpa cache de routing (chamar quando atualizar configs)
 */
export function clearRoutingCache(): void {
  routingCache.clear();
}
