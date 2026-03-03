import { getSupabaseClient } from "../infra/supabaseClient";
import {
  sendTextMessage,
  sendImageMessage,
  getConnectionStatus,
} from "./baileys";
import { logMessage, logger } from "../utils/logger";
import { messageHistory } from "./messageHistory";
import type { MessageJobDB } from "../types";

/**
 * Erros permanentes (4xx equivalent): não retentar — falharão novamente.
 * Erros transientes (5xx equivalent): retentar com backoff.
 */
function isPermanentError(message: string): boolean {
  return (
    message.includes("instancias internas") || // anti-loop block
    message.includes("no tiene WhatsApp") || // número sem WA
    message.includes("não tem WhatsApp") || // idem PT
    message.includes("no ha iniciado una conversación") || // contato inativo (pending criado)
    message.includes("não iniciou uma conversa") || // idem PT
    message.includes("No se puede enviar") || // envio bloqueado
    message.includes("não pode enviar") || // idem PT
    message.includes("no tiene la función sendMessage") // socket quebrado (non-recoverable)
  );
}

export interface MessageJob {
  id?: number;
  instanceId: string;
  type: "text" | "image";
  to: string;
  message?: string;
  mediaUrl?: string;
}

const POLLING_INTERVAL = 1000; // 1 segundo
const BATCH_SIZE = 10;
let isPolling = false;

// Worker function: Polls DB for pending jobs
const processQueue = async () => {
  if (isPolling) return;
  isPolling = true;

  try {
    const supabase = getSupabaseClient();

    // 1. Fetch pending jobs using RPC (Atomic fetch & lock)
    const { data: jobs, error } = await supabase.rpc("fetch_pending_jobs", {
      batch_size: BATCH_SIZE,
    });

    if (error) {
      logger.error("[QUEUE] Error fetching jobs via RPC:", error);
      return;
    }

    if (jobs && jobs.length > 0) {
      // Process jobs concurrently
      await Promise.all(jobs.map(processJob));
    }
  } catch (error) {
    logger.error("[QUEUE] Worker error:", error);
  } finally {
    isPolling = false;
  }
};

// Process individual job
const processJob = async (job: MessageJobDB) => {
  const { id, instance_id, type, to_number, content, attempts, max_attempts } =
    job;
  const instanceId = instance_id;
  const to = to_number;
  const supabase = getSupabaseClient();

  try {
    // Verify connection status
    const status = getConnectionStatus(instanceId);
    if (status !== "ONLINE") {
      throw new Error(
        `Instancia ${instanceId} no está conectada. Estado: ${status}`,
      );
    }

    logger.debug(`\n[QUEUE] Procesando job ${id} - ${type} a ${to}`);
    logMessage.queue(instanceId, String(id), type, 0);

    // Send logic
    if (type === "text") {
      logMessage.send(instanceId, "text", to, "processing");
      await sendTextMessage(instanceId, to, content);
      logMessage.send(instanceId, "text", to, "sent", { jobId: id });

      // Update history
      messageHistory.add({
        instanceId,
        type: "outbound",
        to,
        text: content,
        status: "sent",
        metadata: { jobId: id },
      });
    } else if (type === "image") {
      logMessage.send(instanceId, "image", to, "processing");
      await sendImageMessage(instanceId, to, content);
      logMessage.send(instanceId, "image", to, "sent", { jobId: id });

      // Update history
      messageHistory.add({
        instanceId,
        type: "outbound",
        to,
        text: `[Imagen: ${content}]`,
        status: "sent",
        metadata: { jobId: id, type: "image" },
      });
    }

    // Mark as completed
    await supabase
      .from("ghl_wa_message_queue")
      .update({
        status: "completed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    logger.debug(`[QUEUE] ✅ Job ${id} completado existosamente`);
  } catch (error: any) {
    const permanent = isPermanentError(error.message || "");
    const nextAttempts = attempts + 1;

    // Erros permanentes (4xx): falhar imediatamente sem retry
    // Erros transientes (5xx/timeout): retentar com exponential backoff
    let nextStatus: string;
    let nextAttemptAt: Date;

    if (permanent) {
      nextStatus = "failed";
      nextAttemptAt = new Date();
      logger.warn(`[QUEUE] ❌ Job ${id} — erro permanente, sem retry`, {
        event: "queue.job.permanent_failure",
        jobId: id,
        instanceId,
        to,
        error: error.message,
      });
    } else {
      nextAttemptAt = new Date(
        Date.now() + Math.min(nextAttempts * 2000, 30000),
      );
      nextStatus = nextAttempts >= max_attempts ? "failed" : "pending";
      logger.error(
        `[QUEUE] ❌ Job ${id} falhou (tentativa ${nextAttempts}/${max_attempts})`,
        {
          event: "queue.job.transient_failure",
          jobId: id,
          instanceId,
          to,
          nextStatus,
          error: error.message,
        },
      );
    }

    await supabase
      .from("ghl_wa_message_queue")
      .update({
        status: nextStatus,
        attempts: nextAttempts,
        next_attempt_at: nextAttemptAt.toISOString(),
        last_error: error.message,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    logMessage.send(instanceId, type, to, "failed", {
      jobId: id,
      error: error.message,
      permanent,
    });
  }
};

// Start the worker
let timer: NodeJS.Timeout | null = null;

export const startQueueWorker = () => {
  if (timer) return;
  logger.debug("[QUEUE] ✨ Iniciando Worker Supabase RPC polling...");
  timer = setInterval(processQueue, POLLING_INTERVAL);
};

export const stopQueueWorker = () => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
};

export const messageWorker = {
  close: async () => stopQueueWorker(),
};

// Add to queue
export async function queueMessage(
  instanceId: string,
  type: "text" | "image",
  to: string,
  messageOrUrl: string,
  maxAttempts: number = 10,
): Promise<string> {
  const supabase = getSupabaseClient();

  // Insert into DB
  const { data, error } = await supabase
    .from("ghl_wa_message_queue")
    .insert({
      instance_id: instanceId,
      type,
      to_number: to,
      content: messageOrUrl,
      status: "pending",
      next_attempt_at: new Date().toISOString(),
      max_attempts: maxAttempts,
    })
    .select("id")
    .single();

  if (error) {
    logger.error("[QUEUE] Error enqueuing message:", error);
    throw new Error(`Error enqueuing message: ${error.message}`);
  }

  return String(data.id);
}

// Get Stats
export async function getQueueStats() {
  const supabase = getSupabaseClient();
  const { count: pending } = await supabase
    .from("ghl_wa_message_queue")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending");
  const { count: processing } = await supabase
    .from("ghl_wa_message_queue")
    .select("*", { count: "exact", head: true })
    .eq("status", "processing");
  const { count: failed } = await supabase
    .from("ghl_wa_message_queue")
    .select("*", { count: "exact", head: true })
    .eq("status", "failed");
  const { count: completed } = await supabase
    .from("ghl_wa_message_queue")
    .select("*", { count: "exact", head: true })
    .eq("status", "completed");

  const w = pending || 0;
  const a = processing || 0;
  const f = failed || 0;
  const c = completed || 0;

  return {
    waiting: w,
    active: a,
    failed: f,
    completed: c,
    delayed: 0,
    total: w + a + f + c,
  };
}
