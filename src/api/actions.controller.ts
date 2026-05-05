import { Request, Response, Router } from "express";
import {
  deleteWhatsAppMessage,
  getConnectionStatus,
  reactToWhatsAppMessage,
  type WhatsAppMessageKeyPayload,
} from "../core/baileys";
import { getSupabaseClient } from "../infra/supabaseClient";
import { ghlService } from "../services/ghl.service";
import type { GHLContact, GHLIntegration, MessageHistoryRow } from "../types";
import { logger } from "../utils/logger";

export const actionsRouter = Router();

interface ActionContext {
  integration: GHLIntegration;
  instanceId: string;
  contact: GHLContact;
  destination: {
    to: string;
    kind: "group" | "phone";
  };
}

function setCorsHeaders(req: Request, res: Response): void {
  const origin = req.headers.origin;
  res.header("Access-Control-Allow-Origin", origin || "*");
  res.header("Vary", "Origin");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Cache-Control", "no-cache");
}

function isAllowedOrigin(origin?: string): boolean {
  if (!origin) return true;
  try {
    const hostname = new URL(origin).hostname;
    return (
      hostname === "app.socialfy.me" ||
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname.endsWith(".leadconnectorhq.com") ||
      hostname.endsWith(".gohighlevel.com")
    );
  } catch (_error) {
    return false;
  }
}

function getString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForOnlineStatus(
  instanceId: string,
  maxWaitMs = 15000,
): Promise<string> {
  const startedAt = Date.now();
  let status = getConnectionStatus(instanceId);

  while (status !== "ONLINE" && Date.now() - startedAt < maxWaitMs) {
    await sleep(1500);
    status = getConnectionStatus(instanceId);
  }

  return status;
}

function normalizePhoneForWhatsApp(phone: string): string {
  let cleaned = phone.replace(/[\s\-().]/g, "");
  if (cleaned.startsWith("+")) return cleaned;

  if (
    (cleaned.startsWith("51") || cleaned.startsWith("55")) &&
    cleaned.length >= 10
  ) {
    return `+${cleaned}`;
  }
  if (cleaned.length === 9) return `+51${cleaned}`;
  if (cleaned.length === 11 && cleaned.startsWith("11")) {
    return `+55${cleaned}`;
  }
  return `+55${cleaned}`;
}

function resolveContactDestination(contact: GHLContact): ActionContext["destination"] | null {
  if (contact.email?.endsWith("@g.us")) {
    return { to: contact.email, kind: "group" };
  }
  if (contact.phone) {
    return { to: normalizePhoneForWhatsApp(contact.phone), kind: "phone" };
  }
  return null;
}

async function resolveInstanceId(
  integration: GHLIntegration,
  requestedInstanceId?: string,
): Promise<string | null> {
  if (!integration.tenant_id) return null;

  if (requestedInstanceId) {
    return requestedInstanceId.startsWith(`${integration.tenant_id}-`)
      ? requestedInstanceId
      : `${integration.tenant_id}-${requestedInstanceId}`;
  }

  const supabase = getSupabaseClient();
  const { data: instance } = await supabase
    .from("ghl_wa_instances")
    .select("name")
    .eq("tenant_id", integration.tenant_id)
    .eq("status", "connected")
    .limit(1)
    .maybeSingle();

  return instance?.name ? `${integration.tenant_id}-${instance.name}` : null;
}

function normalizeDestinationForCompare(value?: string | null): string {
  if (!value) return "";
  const lower = value.toLowerCase();
  if (lower.endsWith("@g.us")) return lower;
  return value.replace(/\D/g, "");
}

function belongsToDestination(row: MessageHistoryRow, destinationTo: string): boolean {
  const target = normalizeDestinationForCompare(destinationTo);
  return (
    normalizeDestinationForCompare(row.from_number) === target ||
    normalizeDestinationForCompare(row.to_number) === target
  );
}

function getWaKeyFromRow(
  row: MessageHistoryRow,
): WhatsAppMessageKeyPayload | null {
  const metadata = row.metadata || {};
  const waKey = metadata.waKey as Partial<WhatsAppMessageKeyPayload> | undefined;
  if (!waKey?.remoteJid || !waKey.id || typeof waKey.fromMe !== "boolean") {
    return null;
  }
  return {
    remoteJid: waKey.remoteJid,
    id: waKey.id,
    fromMe: waKey.fromMe,
    participant: waKey.participant || null,
  };
}

function previewText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 90 ? `${normalized.slice(0, 87)}...` : normalized;
}

function matchTextsFor(row: MessageHistoryRow): string[] {
  const values = [row.content];
  const metadata = row.metadata || {};

  if (metadata.source === "nexus-audio-recorder") {
    values.push("[Audio enviado pelo Nexus]", "Audio enviado pelo Nexus");
  }

  return Array.from(
    new Set(
      values
        .map((value) => previewText(value || ""))
        .filter((value) => value.length >= 3),
    ),
  );
}

async function resolveActionContext(
  locationId: string,
  contactId: string,
  requestedInstanceId?: string,
): Promise<ActionContext> {
  const integration = await ghlService.getIntegrationByLocationId(locationId);
  if (!integration || integration.is_active === false) {
    throw new Error("Integracao GHL ativa nao encontrada para esta location");
  }

  const instanceId = await resolveInstanceId(integration, requestedInstanceId);
  if (!instanceId) {
    throw new Error("Nenhuma instancia WhatsApp conectada para esta integracao");
  }

  const status = await waitForOnlineStatus(instanceId);
  if (status !== "ONLINE") {
    throw new Error(
      `WhatsApp reconectando. Aguarde alguns segundos e tente novamente. Estado: ${status}`,
    );
  }

  const token = await ghlService.ensureValidToken(integration);
  const contact = await ghlService.getContactById(token, contactId);
  if (!contact || (contact.locationId && contact.locationId !== locationId)) {
    throw new Error("Contato GHL nao encontrado nesta location");
  }

  const destination = resolveContactDestination(contact);
  if (!destination) {
    throw new Error("Contato GHL sem telefone ou email de grupo WhatsApp");
  }

  return { integration, instanceId, contact, destination };
}

async function loadActionableMessage(
  historyId: string,
  context: ActionContext,
): Promise<{ row: MessageHistoryRow; waKey: WhatsAppMessageKeyPayload }> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("ghl_wa_message_history")
    .select("*")
    .eq("id", historyId)
    .eq("instance_id", context.instanceId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Mensagem Nexus nao encontrada");

  const row = data as MessageHistoryRow;
  if (!belongsToDestination(row, context.destination.to)) {
    throw new Error("Mensagem nao pertence a este contato GHL");
  }

  const waKey = getWaKeyFromRow(row);
  if (!waKey) {
    throw new Error("Mensagem sem chave WhatsApp acionavel");
  }

  return { row, waKey };
}

actionsRouter.use((req: Request, res: Response, next) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

actionsRouter.get("/actions/messages", async (req: Request, res: Response) => {
  const origin = req.headers.origin;
  if (!isAllowedOrigin(origin)) {
    return res.status(403).json({ success: false, error: "Origem invalida" });
  }

  const locationId = getString(req.query.locationId);
  const contactId = getString(req.query.contactId);
  const instanceId = getString(req.query.instanceId);
  const limit = Math.min(Number(req.query.limit) || 12, 30);

  if (!locationId || !contactId) {
    return res.status(400).json({
      success: false,
      error: "locationId e contactId sao obrigatorios",
    });
  }

  try {
    const context = await resolveActionContext(locationId, contactId, instanceId);
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("ghl_wa_message_history")
      .select("*")
      .eq("instance_id", context.instanceId)
      .in("status", ["sent", "received"])
      .order("timestamp", { ascending: false })
      .limit(100);

    if (error) throw error;

    const messages = ((data || []) as MessageHistoryRow[])
      .filter((row) => belongsToDestination(row, context.destination.to))
      .filter((row) => !!getWaKeyFromRow(row))
      .slice(0, limit)
      .map((row) => ({
        id: String(row.id),
        direction: row.type,
        preview: previewText(row.content),
        matchTexts: matchTextsFor(row),
        status: row.status,
        timestamp: row.timestamp,
        canReact: true,
        canDelete: true,
      }));

    return res.json({
      success: true,
      instanceId: context.instanceId,
      contactKind: context.destination.kind,
      messages,
    });
  } catch (error: any) {
    logger.warn("Erro listando acoes Nexus", {
      event: "nexus.actions.list_error",
      locationId,
      contactId,
      error: error.message,
    });
    return res.status(500).json({
      success: false,
      error: error.message || "Erro interno listando mensagens",
    });
  }
});

actionsRouter.post("/actions/react", async (req: Request, res: Response) => {
  const origin = req.headers.origin;
  if (!isAllowedOrigin(origin)) {
    return res.status(403).json({ success: false, error: "Origem invalida" });
  }

  const locationId = getString(req.body.locationId);
  const contactId = getString(req.body.contactId);
  const historyId = getString(req.body.historyId);
  const instanceId = getString(req.body.instanceId);
  const emoji = getString(req.body.emoji) || "\uD83D\uDC4D";

  if (!locationId || !contactId || !historyId) {
    return res.status(400).json({
      success: false,
      error: "locationId, contactId e historyId sao obrigatorios",
    });
  }

  try {
    const context = await resolveActionContext(locationId, contactId, instanceId);
    const { row, waKey } = await loadActionableMessage(historyId, context);
    await reactToWhatsAppMessage(context.instanceId, waKey, emoji);

    logger.info("Reacao Nexus enviada", {
      event: "nexus.actions.react",
      locationId,
      contactId,
      historyId: row.id,
    });

    return res.json({ success: true });
  } catch (error: any) {
    logger.warn("Erro reagindo via Nexus", {
      event: "nexus.actions.react_error",
      locationId,
      contactId,
      historyId,
      error: error.message,
    });
    return res.status(500).json({
      success: false,
      error: error.message || "Erro interno reagindo a mensagem",
    });
  }
});

actionsRouter.post("/actions/delete", async (req: Request, res: Response) => {
  const origin = req.headers.origin;
  if (!isAllowedOrigin(origin)) {
    return res.status(403).json({ success: false, error: "Origem invalida" });
  }

  const locationId = getString(req.body.locationId);
  const contactId = getString(req.body.contactId);
  const historyId = getString(req.body.historyId);
  const instanceId = getString(req.body.instanceId);

  if (!locationId || !contactId || !historyId) {
    return res.status(400).json({
      success: false,
      error: "locationId, contactId e historyId sao obrigatorios",
    });
  }

  try {
    const context = await resolveActionContext(locationId, contactId, instanceId);
    const { row, waKey } = await loadActionableMessage(historyId, context);
    await deleteWhatsAppMessage(context.instanceId, waKey);

    logger.info("Mensagem apagada via Nexus", {
      event: "nexus.actions.delete",
      locationId,
      contactId,
      historyId: row.id,
    });

    return res.json({ success: true });
  } catch (error: any) {
    logger.warn("Erro apagando via Nexus", {
      event: "nexus.actions.delete_error",
      locationId,
      contactId,
      historyId,
      error: error.message,
    });
    return res.status(500).json({
      success: false,
      error: error.message || "Erro interno apagando mensagem",
    });
  }
});
