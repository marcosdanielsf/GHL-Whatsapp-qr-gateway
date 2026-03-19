import { Queue, Worker, Job, UnrecoverableError } from "bullmq";
import type { RedisOptions } from "ioredis";
import {
  sendTextMessage,
  sendImageMessage,
  getConnectionStatus,
} from "./baileys";
import { logMessage, logger } from "../utils/logger";
import { messageHistory } from "./messageHistory";
import { getSupabaseClient } from "../infra/supabaseClient";

// ─────────────────────────────────────────────
// Redis connection
// ─────────────────────────────────────────────

function buildRedisConnection(): RedisOptions {
  // REDIS_URL (padrão Railway) tem prioridade sobre host/port/password separados
  if (process.env.REDIS_URL) {
    return {
      ...parseRedisUrl(process.env.REDIS_URL),
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
    };
  }
  return {
    host: process.env.REDIS_HOST || "localhost",
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
  };
}

function parseRedisUrl(url: string): Partial<RedisOptions> {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
    password: parsed.password || undefined,
    username: parsed.username || undefined,
  };
}

const redisConnection = buildRedisConnection();

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface MessageJob {
  instanceId: string;
  type: "text" | "image";
  to: string;
  content: string;
  maxAttempts: number;
  supabaseId?: number;
}

// ─────────────────────────────────────────────
// Permanent error detection (preserved from original)
// ─────────────────────────────────────────────

function isPermanentError(message: string): boolean {
  return (
    message.includes("instancias internas") ||
    message.includes("no tiene WhatsApp") ||
    message.includes("não tem WhatsApp") ||
    message.includes("no ha iniciado una conversación") ||
    message.includes("não iniciou uma conversa") ||
    message.includes("No se puede enviar") ||
    message.includes("não pode enviar") ||
    message.includes("no tiene la función sendMessage")
  );
}

// ─────────────────────────────────────────────
// Queue + Worker
// ─────────────────────────────────────────────

const QUEUE_NAME = "whatsapp-messages";
const MAX_ATTEMPTS = 10;

export const messageQueue = new Queue<MessageJob>(QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: MAX_ATTEMPTS,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: {
      age: 3600,
      count: 1000,
    },
    removeOnFail: {
      age: 86400,
    },
  },
});

let worker: Worker<MessageJob> | null = null;

async function syncSupabaseStatus(
  supabaseId: number | undefined,
  status: "completed" | "failed",
  extra: Record<string, unknown> = {},
): Promise<void> {
  if (!supabaseId) return;
  try {
    const supabase = getSupabaseClient();
    await supabase
      .from("ghl_wa_message_queue")
      .update({
        status,
        updated_at: new Date().toISOString(),
        ...extra,
      })
      .eq("id", supabaseId);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("[QUEUE] Falha ao sincronizar Supabase", {
      event: "queue.supabase_sync.error",
      supabaseId,
      error: msg,
    });
  }
}

export function startQueueWorker(): void {
  if (worker) return;

  logger.info("[QUEUE] Iniciando Worker BullMQ + Redis...", {
    event: "queue.worker.starting",
    redis: `${redisConnection.host}:${redisConnection.port}`,
  });

  worker = new Worker<MessageJob>(
    QUEUE_NAME,
    async (job: Job<MessageJob>) => {
      const { instanceId, type, to, content, supabaseId } = job.data;

      const status = getConnectionStatus(instanceId);
      if (status !== "ONLINE") {
        throw new Error(
          `Instancia ${instanceId} no está conectada. Estado: ${status}`,
        );
      }

      logger.debug(`[QUEUE] Processando job ${job.id} - ${type} a ${to}`);
      logMessage.queue(instanceId, job.id ?? "unknown", type, job.opts.delay || 0);

      try {
        if (type === "text") {
          logMessage.send(instanceId, "text", to, "processing");
          await sendTextMessage(instanceId, to, content);
          logMessage.send(instanceId, "text", to, "sent", { jobId: job.id });

          messageHistory.add({
            instanceId,
            type: "outbound",
            to,
            text: content,
            status: "sent",
            metadata: { jobId: job.id },
          });
        } else if (type === "image") {
          logMessage.send(instanceId, "image", to, "processing");
          await sendImageMessage(instanceId, to, content);
          logMessage.send(instanceId, "image", to, "sent", { jobId: job.id });

          messageHistory.add({
            instanceId,
            type: "outbound",
            to,
            text: `[Imagen: ${content}]`,
            status: "sent",
            metadata: { jobId: job.id, type: "image" },
          });
        }
      } catch (sendError: unknown) {
        const errMsg = sendError instanceof Error ? sendError.message : String(sendError);
        if (isPermanentError(errMsg)) {
          throw new UnrecoverableError(errMsg);
        }
        throw sendError;
      }

      await syncSupabaseStatus(supabaseId, "completed");
      logger.debug(`[QUEUE] Job ${job.id} completado`);
    },
    {
      connection: redisConnection,
      concurrency: 1,
      limiter: {
        max: 1,
        duration: 1000,
      },
    },
  );

  worker.on("completed", (job) => {
    logger.debug(`[QUEUE] Job ${job.id} completado: ${job.data.type} a ${job.data.to}`);
  });

  worker.on("failed", (job, err) => {
    if (!job) return;
    const { instanceId, type, to, supabaseId } = job.data;

    logMessage.send(instanceId, type, to, "failed", {
      jobId: job.id,
      error: err.message,
      permanent: isPermanentError(err.message),
    });

    syncSupabaseStatus(supabaseId, "failed", {
      last_error: err.message,
      attempts: job.attemptsMade,
    });

    if (isPermanentError(err.message)) {
      logger.warn(`[QUEUE] Job ${job.id} — erro permanente, sem retry`, {
        event: "queue.job.permanent_failure",
        jobId: job.id,
        instanceId,
        to,
        error: err.message,
      });
    } else {
      logger.error(
        `[QUEUE] Job ${job.id} falhou (tentativa ${job.attemptsMade}/${job.opts.attempts})`,
        {
          event: "queue.job.transient_failure",
          jobId: job.id,
          instanceId,
          to,
          error: err.message,
        },
      );
    }
  });

  worker.on("error", (err) => {
    logger.error("[QUEUE] Worker error:", {
      event: "queue.worker.error",
      error: err.message,
    });
  });

  logger.info("[QUEUE] Worker BullMQ ativo", { event: "queue.worker.ready" });
}

export async function stopQueueWorker(): Promise<void> {
  await messageWorker.close();
}

export const messageWorker = {
  close: async () => {
    if (worker) {
      await worker.close();
      worker = null;
      logger.info("[QUEUE] Worker BullMQ encerrado", {
        event: "queue.worker.stopped",
      });
    }
    await messageQueue.close();
  },
};

// ─────────────────────────────────────────────
// Enqueue (dual-write: Supabase log + BullMQ)
// ─────────────────────────────────────────────

export async function queueMessage(
  instanceId: string,
  type: "text" | "image",
  to: string,
  messageOrUrl: string,
  maxAttempts: number = MAX_ATTEMPTS,
): Promise<string> {
  // 1. Gravar no Supabase (log + dashboard)
  let supabaseId: number | undefined;
  try {
    const supabase = getSupabaseClient();
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

    if (!error && data) {
      supabaseId = data.id;
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("[QUEUE] Supabase insert falhou (BullMQ continua)", {
      event: "queue.supabase_insert.error",
      error: msg,
    });
  }

  // 2. Calcular delay humanizado (anti-ban WhatsApp)
  let delay = 0;
  if (type === "text") {
    delay = 3000 + Math.random() * 1000; // 3-4s
  } else if (type === "image") {
    delay = 6000 + Math.random() * 3000; // 6-9s
  }

  // 3. Enfileirar no BullMQ
  const jobData: MessageJob = {
    instanceId,
    type,
    to,
    content: messageOrUrl,
    maxAttempts,
    supabaseId,
  };

  const job = await messageQueue.add(
    `send-${type}-${instanceId}`,
    jobData,
    {
      delay: Math.round(delay),
      attempts: maxAttempts,
      jobId: `${instanceId}-${type}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    },
  );

  logMessage.send(instanceId, type, to, "queued", {
    jobId: job.id,
    delay: Math.round(delay),
    supabaseId,
  });

  return job.id!;
}

// ─────────────────────────────────────────────
// Stats (BullMQ nativo — rápido, sem queries SQL)
// ─────────────────────────────────────────────

export async function getQueueStats() {
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    messageQueue.getWaitingCount(),
    messageQueue.getActiveCount(),
    messageQueue.getCompletedCount(),
    messageQueue.getFailedCount(),
    messageQueue.getDelayedCount(),
  ]);

  return {
    waiting,
    active,
    completed,
    failed,
    delayed,
    total: waiting + active + completed + failed + delayed,
  };
}
