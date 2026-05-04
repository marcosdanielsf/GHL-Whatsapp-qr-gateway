import { Queue, Worker, Job } from 'bullmq';
import type { RedisOptions } from 'ioredis';
import { sendTextMessage } from './baileys';
import { getSupabaseClient } from '../infra/supabaseClient';
import { logger } from '../utils/logger';

// ─────────────────────────────────────────────
// Redis connection (reusa lógica do queue.ts)
// ─────────────────────────────────────────────

function parseRedisUrl(url: string): Partial<RedisOptions> {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
    password: parsed.password || undefined,
    username: parsed.username || undefined,
  };
}

function buildRedisConnection(): RedisOptions {
  if (process.env.REDIS_URL) {
    return {
      ...parseRedisUrl(process.env.REDIS_URL),
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
    };
  }
  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
  };
}

export const redisConnection = buildRedisConnection();

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface CampaignJobPayload {
  campaign_id: string;
  recipient_id: string;
  tenant_id: string;
}

// In-memory registry to avoid duplicate workers per tenant
const activeQueues = new Map<string, Queue<CampaignJobPayload>>();
const activeWorkers = new Map<string, Worker<CampaignJobPayload>>();

// Per-tenant batch counter (in-memory — resets on restart, acceptable)
const batchCounters = new Map<string, number>();

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function applyVariables(
  template: string,
  variables: Record<string, string> | null | undefined,
): string {
  if (!variables) return template;
  return template.replace(/\{(\w+)\}/g, (_, key) => variables[key] ?? `{${key}}`);
}

function getOrCreateQueue(tenantId: string): Queue<CampaignJobPayload> {
  const existing = activeQueues.get(tenantId);
  if (existing) return existing;

  const q = new Queue<CampaignJobPayload>(`campaigns:${tenantId}`, {
    connection: redisConnection,
    defaultJobOptions: {
      removeOnComplete: { age: 3600, count: 500 },
      removeOnFail: { age: 86400 },
    },
  });
  activeQueues.set(tenantId, q);
  return q;
}

// ─────────────────────────────────────────────
// Worker processor
// ─────────────────────────────────────────────

async function processCampaignJob(job: Job<CampaignJobPayload>): Promise<void> {
  const { campaign_id, recipient_id, tenant_id } = job.data;
  const supabase = getSupabaseClient();

  // 1. Buscar campaign
  const { data: campaign, error: campErr } = await supabase
    .from('campaigns')
    .select(
      'id, status, instance_id, delay_min_ms, delay_max_ms, batch_size, batch_pause_ms',
    )
    .eq('id', campaign_id)
    .eq('tenant_id', tenant_id)
    .single();

  if (campErr || !campaign) {
    throw new Error(`Campaign ${campaign_id} não encontrada`);
  }

  // 4. Verificar se campanha está pausada
  if (campaign.status === 'paused') {
    logger.info('[CAMPAIGN-WORKER] Campanha pausada — re-enfileirando', {
      event: 'campaign.worker.paused',
      campaign_id,
      recipient_id,
    });
    const q = getOrCreateQueue(tenant_id);
    await q.add(
      `campaign-msg`,
      { campaign_id, recipient_id, tenant_id },
      { delay: 30_000 },
    );
    return;
  }

  if (campaign.status !== 'running') {
    logger.warn('[CAMPAIGN-WORKER] Campanha não está running, descartando job', {
      event: 'campaign.worker.not_running',
      campaign_id,
      status: campaign.status,
    });
    return;
  }

  // 2. Buscar recipient
  const { data: recipient, error: recErr } = await supabase
    .from('campaign_recipients')
    .select('id, phone_e164, name, variables, status, retry_count')
    .eq('id', recipient_id)
    .eq('tenant_id', tenant_id)
    .single();

  if (recErr || !recipient) {
    throw new Error(`Recipient ${recipient_id} não encontrado`);
  }

  // Idempotência: se já foi enviado, ignorar
  if (recipient.status === 'sent') {
    logger.debug('[CAMPAIGN-WORKER] Recipient já enviado, ignorando', {
      event: 'campaign.worker.duplicate',
      recipient_id,
    });
    return;
  }

  // 3. Buscar 5 variants
  const { data: variants, error: varErr } = await supabase
    .from('campaign_variants')
    .select('id, variant_index, text_template')
    .eq('campaign_id', campaign_id)
    .eq('tenant_id', tenant_id)
    .order('variant_index', { ascending: true });

  if (varErr || !variants || variants.length === 0) {
    throw new Error(`Variants não encontradas para campaign ${campaign_id}`);
  }

  // 5. Verificar rate-limit do chip
  const { data: instance, error: instErr } = await supabase
    .from('ghl_wa_instances')
    .select('id, daily_sent_count, daily_limit, warmup_phase')
    .eq('id', campaign.instance_id)
    .single();

  if (instErr || !instance) {
    throw new Error(`Instance ${campaign.instance_id} não encontrada`);
  }

  const dailyLimit = instance.daily_limit ?? getDailyLimitByPhase(instance.warmup_phase);

  if ((instance.daily_sent_count ?? 0) >= dailyLimit) {
    logger.warn('[CAMPAIGN-WORKER] Daily limit atingido — re-enfileirando em 1h', {
      event: 'campaign.worker.rate_limit',
      instance_id: campaign.instance_id,
      daily_sent_count: instance.daily_sent_count,
      daily_limit: dailyLimit,
    });
    const q = getOrCreateQueue(tenant_id);
    await q.add(
      `campaign-msg`,
      { campaign_id, recipient_id, tenant_id },
      { delay: 3_600_000 },
    );
    return;
  }

  // 6. Sortear variante (equal distribution)
  const variantIndex = Math.floor(Math.random() * variants.length);
  const variant = variants[variantIndex];
  const messageText = applyVariables(variant.text_template, recipient.variables as Record<string, string> | null);

  // 7. Enviar mensagem via Baileys
  try {
    await sendTextMessage(campaign.instance_id, recipient.phone_e164, messageText);
  } catch (sendErr: any) {
    const retryCount = (recipient.retry_count ?? 0) + 1;
    const isFinal = retryCount >= 3;

    await supabase
      .from('campaign_recipients')
      .update({
        status: isFinal ? 'failed' : 'queued',
        error_message: sendErr.message,
        fail_reason: isFinal ? 'max_retries' : null,
        retry_count: retryCount,
      })
      .eq('id', recipient_id);

    if (!isFinal) {
      const q = getOrCreateQueue(tenant_id);
      await q.add(
        `campaign-msg`,
        { campaign_id, recipient_id, tenant_id },
        { delay: 60_000 * retryCount },
      );
    } else {
      // Incrementa failed_count na campanha
      await supabase.rpc('increment_campaign_counter', {
        p_campaign_id: campaign_id,
        p_field: 'failed_count',
      });
    }

    throw sendErr;
  }

  // 8. UPDATE recipient + counters
  await supabase
    .from('campaign_recipients')
    .update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      variant_index: variantIndex,
    })
    .eq('id', recipient_id);

  // Incrementa sent_count na campanha
  await supabase.rpc('increment_campaign_counter', {
    p_campaign_id: campaign_id,
    p_field: 'sent_count',
  });

  // Incrementa daily_sent_count no chip
  await supabase
    .from('ghl_wa_instances')
    .update({ daily_sent_count: (instance.daily_sent_count ?? 0) + 1 })
    .eq('id', campaign.instance_id);

  // 9. Jitter anti-ban entre mensagens
  const jitterMs = randomBetween(
    campaign.delay_min_ms ?? 3000,
    campaign.delay_max_ms ?? 6000,
  );

  // 10. Batch pause: a cada batch_size mensagens, dormir batch_pause_ms
  const batchSize = campaign.batch_size ?? 20;
  const batchPause = campaign.batch_pause_ms ?? 60_000;
  const batchKey = `${campaign_id}:${tenant_id}`;
  const current = (batchCounters.get(batchKey) ?? 0) + 1;
  batchCounters.set(batchKey, current);

  if (current % batchSize === 0) {
    logger.info('[CAMPAIGN-WORKER] Batch pause', {
      event: 'campaign.worker.batch_pause',
      campaign_id,
      batch_number: Math.floor(current / batchSize),
      pause_ms: batchPause,
    });
    await sleep(batchPause);
  } else {
    await sleep(jitterMs);
  }

  // Verificar se campanha completou
  await checkAndCompleteCampaign(campaign_id, tenant_id);
}

// ─────────────────────────────────────────────
// Check completion
// ─────────────────────────────────────────────

async function checkAndCompleteCampaign(campaignId: string, tenantId: string): Promise<void> {
  const supabase = getSupabaseClient();

  const { data: pending } = await supabase
    .from('campaign_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .in('status', ['queued', 'sending']);

  if (pending === null) return; // query error, skip

  const { count } = await supabase
    .from('campaign_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .in('status', ['queued', 'sending']);

  if ((count ?? 0) === 0) {
    await supabase
      .from('campaigns')
      .update({ status: 'done', completed_at: new Date().toISOString() })
      .eq('id', campaignId)
      .eq('tenant_id', tenantId);

    logger.info('[CAMPAIGN-WORKER] Campanha concluída', {
      event: 'campaign.completed',
      campaign_id: campaignId,
    });
  }
}

// ─────────────────────────────────────────────
// Start worker for a single tenant
// ─────────────────────────────────────────────

function startWorkerForTenant(tenantId: string): void {
  if (activeWorkers.has(tenantId)) return;

  const queue = getOrCreateQueue(tenantId);

  const worker = new Worker<CampaignJobPayload>(
    `campaigns:${tenantId}`,
    processCampaignJob,
    {
      connection: redisConnection,
      concurrency: 1, // sequencial por tenant — anti-ban
    },
  );

  worker.on('completed', (job) => {
    logger.debug('[CAMPAIGN-WORKER] Job concluído', {
      event: 'campaign.job.completed',
      jobId: job.id,
      campaign_id: job.data.campaign_id,
    });
  });

  worker.on('failed', (job, err) => {
    logger.error('[CAMPAIGN-WORKER] Job falhou', {
      event: 'campaign.job.failed',
      jobId: job?.id,
      campaign_id: job?.data?.campaign_id,
      error: err.message,
    });
  });

  worker.on('error', (err) => {
    logger.error('[CAMPAIGN-WORKER] Worker error', {
      event: 'campaign.worker.error',
      tenantId,
      error: err.message,
    });
  });

  activeWorkers.set(tenantId, worker);
  logger.info('[CAMPAIGN-WORKER] Worker iniciado para tenant', {
    event: 'campaign.worker.started',
    tenantId,
  });
}

// ─────────────────────────────────────────────
// Enqueue all recipients for a campaign
// ─────────────────────────────────────────────

export async function enqueueCampaign(campaignId: string, tenantId: string): Promise<number> {
  const supabase = getSupabaseClient();

  const { data: recipients, error } = await supabase
    .from('campaign_recipients')
    .select('id')
    .eq('campaign_id', campaignId)
    .eq('tenant_id', tenantId)
    .eq('status', 'queued');

  if (error) {
    throw new Error(`Erro ao buscar recipients: ${error.message}`);
  }

  if (!recipients || recipients.length === 0) return 0;

  startWorkerForTenant(tenantId);
  const queue = getOrCreateQueue(tenantId);

  const jobs = recipients.map((r) => ({
    name: 'campaign-msg',
    data: { campaign_id: campaignId, recipient_id: r.id, tenant_id: tenantId },
    opts: {
      jobId: `campaign:${campaignId}:recipient:${r.id}`, // idempotência — evita duplicado
    },
  }));

  await queue.addBulk(jobs);

  logger.info('[CAMPAIGN-WORKER] Jobs enfileirados', {
    event: 'campaign.enqueued',
    campaign_id: campaignId,
    tenant_id: tenantId,
    count: jobs.length,
  });

  return jobs.length;
}

// ─────────────────────────────────────────────
// Bootstrap: recovery após restart
// ─────────────────────────────────────────────

export async function startCampaignWorkers(): Promise<void> {
  const supabase = getSupabaseClient();

  const { data: running, error } = await supabase
    .from('campaigns')
    .select('id, tenant_id')
    .eq('status', 'running');

  if (error) {
    logger.error('[CAMPAIGN-WORKER] Erro ao buscar campaigns running', {
      event: 'campaign.worker.bootstrap.error',
      error: error.message,
    });
    return;
  }

  if (!running || running.length === 0) {
    logger.info('[CAMPAIGN-WORKER] Nenhuma campanha running no boot', {
      event: 'campaign.worker.bootstrap.empty',
    });
    return;
  }

  const tenants = new Set(running.map((c) => c.tenant_id as string));
  for (const tenantId of tenants) {
    startWorkerForTenant(tenantId);
  }

  logger.info('[CAMPAIGN-WORKER] Workers recovery concluído', {
    event: 'campaign.worker.bootstrap.done',
    tenants: tenants.size,
    campaigns: running.length,
  });
}

// ─────────────────────────────────────────────
// Utils
// ─────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getDailyLimitByPhase(phase: number | null | undefined): number {
  switch (phase) {
    case 1: return 50;
    case 2: return 100;
    case 3: return 250;
    default: return 50;
  }
}
