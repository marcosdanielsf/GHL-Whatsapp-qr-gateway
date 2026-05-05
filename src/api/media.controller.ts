import { NextFunction, Request, Response, Router } from "express";
import multer from "multer";
import {
  getConnectionStatus,
  sendAudioBufferMessage,
  sendDocumentBufferMessage,
  sendImageBufferMessage,
  sendTextMessage,
  sendVideoBufferMessage,
  serializeWhatsAppMessageKey,
} from "../core/baileys";
import { messageHistory } from "../core/messageHistory";
import { getSupabaseClient } from "../infra/supabaseClient";
import { ghlService } from "../services/ghl.service";
import type { GHLContact, GHLIntegration } from "../types";
import { logger } from "../utils/logger";

export const mediaRouter = Router();

type NexusMediaKind = "text" | "image" | "video" | "audio" | "document";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 64 * 1024 * 1024 },
});

function setCorsHeaders(req: Request, res: Response): void {
  const origin = req.headers.origin;
  res.header("Access-Control-Allow-Origin", origin || "*");
  res.header("Vary", "Origin");
  res.header("Access-Control-Allow-Methods", "POST, OPTIONS");
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

function resolveContactDestination(contact: GHLContact): {
  to: string;
  kind: "group" | "phone";
} | null {
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

function getMediaKind(file?: Express.Multer.File): NexusMediaKind {
  if (!file) return "text";
  if (file.mimetype.startsWith("image/")) return "image";
  if (file.mimetype.startsWith("video/")) return "video";
  if (file.mimetype.startsWith("audio/")) return "audio";
  return "document";
}

function markerFor(kind: NexusMediaKind, message: string, fileName?: string) {
  if (kind === "text") return message;
  if (kind === "image") return "[Imagem enviada pelo Nexus]";
  if (kind === "video") return "[Video enviado pelo Nexus]";
  if (kind === "audio") return "[Audio enviado pelo Nexus]";
  return `[Documento enviado pelo Nexus${fileName ? `: ${fileName}` : ""}]`;
}

function historyTextFor(kind: NexusMediaKind, message: string, fileName?: string) {
  if (kind === "text") return message;
  const marker = markerFor(kind, "", fileName);
  return message ? `${marker}\n${message}` : marker;
}

function multerSingleFile(req: Request, res: Response, next: NextFunction) {
  upload.single("file")(req, res, (error) => {
    if (!error) return next();
    logger.warn("Upload de midia Nexus recusado", {
      event: "nexus.media.upload_error",
      error: error.message,
    });
    return res.status(400).json({
      success: false,
      error: error.message || "Midia invalida",
    });
  });
}

mediaRouter.use((req: Request, res: Response, next: NextFunction) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

mediaRouter.post(
  "/media/send",
  multerSingleFile,
  async (req: Request, res: Response) => {
    const origin = req.headers.origin;
    if (!isAllowedOrigin(origin)) {
      return res.status(403).json({ success: false, error: "Origem invalida" });
    }

    const locationId = getString(req.body.locationId);
    const contactId = getString(req.body.contactId);
    const requestedInstanceId = getString(req.body.instanceId);
    const message = getString(req.body.message);
    const caption = getString(req.body.caption || req.body.message);
    const file = req.file;
    const mediaKind = getMediaKind(file);

    if (!locationId || !contactId) {
      return res.status(400).json({
        success: false,
        error: "locationId e contactId sao obrigatorios",
      });
    }
    if (!message && !file?.buffer?.length) {
      return res.status(400).json({
        success: false,
        error: "Mensagem ou arquivo sao obrigatorios",
      });
    }

    try {
      const integration = await ghlService.getIntegrationByLocationId(
        locationId,
      );
      if (!integration || integration.is_active === false) {
        return res.status(404).json({
          success: false,
          error: "Integracao GHL ativa nao encontrada para esta location",
        });
      }

      const finalInstanceId = await resolveInstanceId(
        integration,
        requestedInstanceId,
      );
      if (!finalInstanceId) {
        return res.status(503).json({
          success: false,
          error: "Nenhuma instancia WhatsApp conectada para esta integracao",
        });
      }

      const status = await waitForOnlineStatus(finalInstanceId);
      if (status !== "ONLINE") {
        return res.status(503).json({
          success: false,
          error: `WhatsApp reconectando. Aguarde alguns segundos e tente novamente. Estado: ${status}`,
        });
      }

      const token = await ghlService.ensureValidToken(integration);
      const contact = await ghlService.getContactById(token, contactId);
      if (!contact || (contact.locationId && contact.locationId !== locationId)) {
        return res.status(404).json({
          success: false,
          error: "Contato GHL nao encontrado nesta location",
        });
      }

      const destination = resolveContactDestination(contact);
      if (!destination) {
        return res.status(400).json({
          success: false,
          error: "Contato GHL sem telefone ou email de grupo WhatsApp",
        });
      }

      let waKey: Parameters<typeof serializeWhatsAppMessageKey>[0];
      if (mediaKind === "text") {
        waKey = await sendTextMessage(finalInstanceId, destination.to, message);
      } else if (mediaKind === "image" && file) {
        waKey = await sendImageBufferMessage(
          finalInstanceId,
          destination.to,
          file.buffer,
          file.mimetype,
          caption,
        );
      } else if (mediaKind === "video" && file) {
        waKey = await sendVideoBufferMessage(
          finalInstanceId,
          destination.to,
          file.buffer,
          file.mimetype,
          caption,
        );
      } else if (mediaKind === "audio" && file) {
        waKey = await sendAudioBufferMessage(
          finalInstanceId,
          destination.to,
          file.buffer,
          file.mimetype || "audio/mpeg",
          false,
        );
      } else if (file) {
        waKey = await sendDocumentBufferMessage(
          finalInstanceId,
          destination.to,
          file.buffer,
          file.mimetype || "application/octet-stream",
          file.originalname || "arquivo",
          caption,
        );
      }

      const ghlMarker = markerFor(mediaKind, message, file?.originalname);
      const marker = await ghlService.sendInboundMessage(
        integration,
        contactId,
        ghlMarker,
        new Date(),
        "outbound",
      );

      if (!marker.success) {
        logger.warn("Midia enviada, mas marcador GHL falhou", {
          event: "nexus.media.ghl_marker_failed",
          locationId,
          contactId,
          mediaKind,
          error: marker.error,
        });
      }

      await messageHistory.add({
        instanceId: finalInstanceId,
        type: "outbound",
        to: destination.to,
        text: historyTextFor(mediaKind, message, file?.originalname),
        status: "sent",
        metadata: {
          source: "nexus-media-uploader",
          locationId,
          contactId,
          contactKind: destination.kind,
          mediaKind,
          mimetype: file?.mimetype,
          fileName: file?.originalname,
          fileSize: file?.size,
          ghlMarker: marker.success,
          waKey: serializeWhatsAppMessageKey(waKey),
        },
      });

      logger.info("Mensagem/midia Nexus enviada", {
        event: "nexus.media.sent",
        locationId,
        contactId,
        instanceId: finalInstanceId,
        contactKind: destination.kind,
        mediaKind,
      });

      return res.json({
        success: true,
        instanceId: finalInstanceId,
        contactKind: destination.kind,
        mediaKind,
        ghlMarker: marker.success,
      });
    } catch (error: any) {
      logger.error("Erro enviando midia Nexus", {
        event: "nexus.media.error",
        locationId,
        contactId,
        mediaKind,
        error: error.message,
      });
      return res.status(500).json({
        success: false,
        error: error.message || "Erro interno enviando midia",
      });
    }
  },
);
