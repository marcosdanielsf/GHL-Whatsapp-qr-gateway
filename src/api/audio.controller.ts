import { spawn } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { NextFunction, Request, Response, Router } from "express";
import multer from "multer";
import {
  getConnectionStatus,
  sendAudioBufferMessage,
  serializeWhatsAppMessageKey,
} from "../core/baileys";
import { messageHistory } from "../core/messageHistory";
import { getSupabaseClient } from "../infra/supabaseClient";
import { ghlService } from "../services/ghl.service";
import type { GHLContact, GHLIntegration } from "../types";
import { logger } from "../utils/logger";

export const audioRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 16 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const isAudio =
      file.mimetype.startsWith("audio/") ||
      file.mimetype === "application/octet-stream";
    cb(null, isAudio);
  },
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

function extensionForMime(mimetype: string): string {
  if (mimetype.includes("ogg")) return ".ogg";
  if (mimetype.includes("mpeg") || mimetype.includes("mp3")) return ".mp3";
  if (mimetype.includes("mp4")) return ".m4a";
  if (mimetype.includes("wav")) return ".wav";
  return ".webm";
}

async function runFfmpeg(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", args);
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve();
      reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`));
    });
  });
}

async function convertToOggOpus(
  input: Buffer,
  mimetype: string,
): Promise<{ buffer: Buffer; mimetype: string }> {
  if (input.length < 1024) {
    throw new Error("Audio muito curto ou vazio. Grave novamente.");
  }

  if (mimetype.includes("ogg") && mimetype.includes("opus")) {
    return { buffer: input, mimetype: "audio/ogg; codecs=opus" };
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-audio-"));
  const inputPath = path.join(tmpDir, `input${extensionForMime(mimetype)}`);
  const outputPath = path.join(tmpDir, "voice.ogg");

  try {
    await fs.writeFile(inputPath, input);
    try {
      await runFfmpeg([
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        inputPath,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "48000",
        "-c:a",
        "libopus",
        "-b:a",
        "32k",
        "-f",
        "ogg",
        outputPath,
      ]);
    } catch (error: any) {
      logger.warn("Audio Nexus invalido para conversao", {
        event: "nexus.audio.invalid_input",
        mimetype,
        size: input.length,
        error: error.message,
      });
      throw new Error("Audio gravado chegou invalido. Grave novamente.");
    }

    return {
      buffer: await fs.readFile(outputPath),
      mimetype: "audio/ogg; codecs=opus",
    };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

function multerSingleAudio(req: Request, res: Response, next: NextFunction) {
  upload.single("audio")(req, res, (error) => {
    if (!error) return next();
    logger.warn("Upload de audio Nexus recusado", {
      event: "nexus.audio.upload_error",
      error: error.message,
    });
    return res.status(400).json({
      success: false,
      error: error.message || "Audio invalido",
    });
  });
}

audioRouter.use((req: Request, res: Response, next: NextFunction) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

audioRouter.post(
  "/audio/send",
  multerSingleAudio,
  async (req: Request, res: Response) => {
    const origin = req.headers.origin;
    if (!isAllowedOrigin(origin)) {
      return res.status(403).json({ success: false, error: "Origem invalida" });
    }

    const locationId = getString(req.body.locationId);
    const contactId = getString(req.body.contactId);
    const requestedInstanceId = getString(req.body.instanceId);

    if (!locationId || !contactId) {
      return res.status(400).json({
        success: false,
        error: "locationId e contactId sao obrigatorios",
      });
    }
    if (!req.file?.buffer?.length) {
      return res.status(400).json({
        success: false,
        error: "Arquivo de audio ausente. Use o campo multipart audio.",
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

      const originalMimetype = req.file.mimetype || "audio/webm";
      const converted = await convertToOggOpus(
        req.file.buffer,
        originalMimetype,
      );

      const waKey = await sendAudioBufferMessage(
        finalInstanceId,
        destination.to,
        converted.buffer,
        converted.mimetype,
        true,
      );

      await messageHistory.add({
        instanceId: finalInstanceId,
        type: "outbound",
        to: destination.to,
        text: "[Audio gravado via Nexus]",
        status: "sent",
        metadata: {
          source: "nexus-audio-recorder",
          locationId,
          contactId,
          contactKind: destination.kind,
          originalMimetype,
          sentMimetype: converted.mimetype,
          originalSize: req.file.size,
          sentSize: converted.buffer.length,
          waKey: serializeWhatsAppMessageKey(waKey),
        },
      });

      const marker = await ghlService.sendInboundMessage(
        integration,
        contactId,
        "[Audio enviado pelo Nexus]",
        new Date(),
        "outbound",
      );

      if (!marker.success) {
        logger.warn("Audio enviado, mas marcador GHL falhou", {
          event: "nexus.audio.ghl_marker_failed",
          locationId,
          contactId,
          error: marker.error,
        });
      }

      logger.info("Audio Nexus enviado", {
        event: "nexus.audio.sent",
        locationId,
        contactId,
        instanceId: finalInstanceId,
        contactKind: destination.kind,
      });

      return res.json({
        success: true,
        instanceId: finalInstanceId,
        contactKind: destination.kind,
        ghlMarker: marker.success,
      });
    } catch (error: any) {
      const isInvalidAudio =
        error.message?.includes("Audio muito curto") ||
        error.message?.includes("Audio gravado chegou invalido");
      logger.error("Erro enviando audio Nexus", {
        event: "nexus.audio.error",
        locationId,
        contactId,
        error: error.message,
      });
      return res.status(isInvalidAudio ? 400 : 500).json({
        success: false,
        error: error.message || "Erro interno enviando audio",
      });
    }
  },
);
