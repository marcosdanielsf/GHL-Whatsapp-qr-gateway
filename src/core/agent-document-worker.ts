/**
 * agent-document-worker.ts — F8 BullMQ worker para indexação de documentos RAG
 *
 * Queue por tenant: ai-documents:{tenantId}
 * Job: download → parse → chunk → embed → INSERT ai_document_chunks
 */

import { Queue, Worker, Job } from 'bullmq';
import type { RedisOptions } from 'ioredis';
import { getSupabaseClient } from '../infra/supabaseClient';
import { getDecryptedKey } from './decrypt-ai-key';
import { logger } from '../utils/logger';

// ─────────────────────────────────────────────
// Redis connection (same as campaign-worker pattern)
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

const redisConnection = buildRedisConnection();

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface DocumentIndexJob {
  document_id: string;
  agent_id: string;
  tenant_id: string;
  storage_path: string;
  file_type: 'pdf' | 'docx' | 'txt' | 'md';
  file_name: string;
}

// ─────────────────────────────────────────────
// Active workers registry (prevent duplicate workers per tenant)
// ─────────────────────────────────────────────

const activeQueues = new Map<string, Queue<DocumentIndexJob>>();
const activeWorkers = new Map<string, Worker<DocumentIndexJob>>();

function getOrCreateQueue(tenantId: string): Queue<DocumentIndexJob> {
  const existing = activeQueues.get(tenantId);
  if (existing) return existing;

  const q = new Queue<DocumentIndexJob>(`ai-documents:${tenantId}`, {
    connection: redisConnection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { age: 86400, count: 100 },
      removeOnFail: { age: 604800 },
    },
  });

  activeQueues.set(tenantId, q);
  return q;
}

// ─────────────────────────────────────────────
// Text extraction
// ─────────────────────────────────────────────

async function extractText(buffer: Buffer, fileType: DocumentIndexJob['file_type']): Promise<string> {
  if (fileType === 'pdf') {
    // Dynamic import to avoid issues if pdf-parse fails to load
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>;
    const result = await pdfParse(buffer);
    return result.text;
  }

  if (fileType === 'docx') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mammoth = require('mammoth') as {
      extractRawText: (opts: { buffer: Buffer }) => Promise<{ value: string }>;
    };
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  // txt or md: raw UTF-8
  return buffer.toString('utf-8');
}

// ─────────────────────────────────────────────
// Chunking
// ─────────────────────────────────────────────

function chunkText(text: string, chunkSize = 800, overlap = 100): string[] {
  const chunks: string[] = [];

  // First, split by paragraphs (blank lines)
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  let currentChunk = '';

  for (const para of paragraphs) {
    if ((currentChunk + '\n\n' + para).length <= chunkSize) {
      currentChunk = currentChunk ? currentChunk + '\n\n' + para : para;
    } else {
      if (currentChunk) {
        chunks.push(currentChunk);
        // Overlap: keep last N chars of previous chunk
        const overlapText = currentChunk.slice(-overlap);
        currentChunk = overlapText + '\n\n' + para;
      } else {
        // Single paragraph exceeds chunkSize — split by character
        let pos = 0;
        while (pos < para.length) {
          const end = Math.min(pos + chunkSize, para.length);
          chunks.push(para.slice(pos, end));
          pos += chunkSize - overlap;
        }
        currentChunk = '';
      }
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks.filter((c) => c.trim().length > 20);
}

// ─────────────────────────────────────────────
// Embedding via OpenAI API (batch up to 100 chunks)
// ─────────────────────────────────────────────

async function embedChunks(
  chunks: string[],
  apiKey: string,
): Promise<Array<number[]>> {
  const BATCH_SIZE = 100;
  const allEmbeddings: Array<number[]> = [];

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const resp = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: batch,
        dimensions: 1536,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Embedding API error ${resp.status}: ${errText}`);
    }

    const data = await resp.json() as { data: Array<{ embedding: number[]; index: number }> };
    // Sort by index to maintain order
    const sorted = data.data.sort((a, b) => a.index - b.index);
    allEmbeddings.push(...sorted.map((d) => d.embedding));
  }

  return allEmbeddings;
}

// ─────────────────────────────────────────────
// Job processor
// ─────────────────────────────────────────────

async function processDocumentJob(job: Job<DocumentIndexJob>): Promise<void> {
  const { document_id, agent_id, tenant_id, storage_path, file_type, file_name } = job.data;
  const supabase = getSupabaseClient();

  logger.info('[DOC-WORKER] Processing document', {
    event: 'agent_doc.processing',
    document_id,
    agent_id,
    tenant_id,
    file_type,
  });

  // Mark as processing
  await supabase
    .from('ai_documents')
    .update({ upload_status: 'processing' })
    .eq('id', document_id);

  try {
    // 1. Download from Supabase Storage
    const { data: fileData, error: dlErr } = await supabase.storage
      .from('ai-documents')
      .download(storage_path);

    if (dlErr || !fileData) {
      throw new Error(`Storage download failed: ${dlErr?.message}`);
    }

    const buffer = Buffer.from(await fileData.arrayBuffer());

    // 2. Extract text
    const rawText = await extractText(buffer, file_type);

    if (!rawText || rawText.trim().length < 10) {
      throw new Error('Document is empty or could not be parsed');
    }

    // 3. Chunk
    const chunks = chunkText(rawText);

    if (chunks.length === 0) {
      throw new Error('No valid chunks produced from document');
    }

    logger.info('[DOC-WORKER] Document chunked', {
      document_id,
      chunk_count: chunks.length,
    });

    // 4. Get API key (always OpenAI for embeddings regardless of agent provider)
    const keyRecord = await getDecryptedKey(supabase, tenant_id, 'openai');
    if (!keyRecord) {
      throw new Error('No OpenAI key configured for tenant — required for embeddings');
    }

    // 5. Embed all chunks
    const embeddings = await embedChunks(chunks, keyRecord.api_key);

    if (embeddings.length !== chunks.length) {
      throw new Error(`Embedding count mismatch: ${embeddings.length} vs ${chunks.length}`);
    }

    // 6. Delete old chunks if reindexing
    await supabase.from('ai_document_chunks').delete().eq('document_id', document_id);

    // 7. INSERT chunks in batches of 50 (avoid Supabase row size limits)
    const BATCH = 50;
    for (let i = 0; i < chunks.length; i += BATCH) {
      const rows = chunks.slice(i, i + BATCH).map((content, idx) => ({
        document_id,
        agent_id,
        tenant_id,
        content,
        embedding: embeddings[i + idx],
        chunk_index: i + idx,
      }));

      const { error: insertErr } = await supabase
        .from('ai_document_chunks')
        .insert(rows);

      if (insertErr) {
        throw new Error(`Chunk insert failed at batch ${i}: ${insertErr.message}`);
      }
    }

    // 8. Update document status
    await supabase
      .from('ai_documents')
      .update({
        upload_status: 'indexed',
        chunk_count: chunks.length,
        indexed_at: new Date().toISOString(),
        error_message: null,
      })
      .eq('id', document_id);

    logger.info('[DOC-WORKER] Document indexed', {
      event: 'agent_doc.indexed',
      document_id,
      chunk_count: chunks.length,
    });
  } catch (err: any) {
    logger.error('[DOC-WORKER] Indexing failed', {
      event: 'agent_doc.failed',
      document_id,
      error: err.message,
    });

    await supabase
      .from('ai_documents')
      .update({
        upload_status: 'failed',
        error_message: err.message,
      })
      .eq('id', document_id);

    throw err; // Let BullMQ retry
  }
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

export async function enqueueDocumentIndex(
  tenantId: string,
  jobData: DocumentIndexJob,
): Promise<string> {
  const q = getOrCreateQueue(tenantId);
  const job = await q.add(`index-doc-${jobData.document_id}`, jobData, {
    jobId: `doc-${jobData.document_id}`,
    attempts: 3,
  });
  return job.id ?? jobData.document_id;
}

export function startAgentDocumentWorkers(): void {
  // This is called at boot. Workers are created on-demand when a job is enqueued
  // per tenant. We start a global catch-all worker per known queue pattern.
  // In practice, per-tenant workers are created in getOrCreateWorker below.
  logger.info('[DOC-WORKER] Agent document worker system ready', {
    event: 'agent_doc.worker.ready',
  });
}

export function getOrCreateWorker(tenantId: string): Worker<DocumentIndexJob> {
  const existing = activeWorkers.get(tenantId);
  if (existing) return existing;

  const w = new Worker<DocumentIndexJob>(
    `ai-documents:${tenantId}`,
    processDocumentJob,
    {
      connection: redisConnection,
      concurrency: 2,
    },
  );

  w.on('failed', (job, err) => {
    logger.error('[DOC-WORKER] Job failed', {
      event: 'agent_doc.job_failed',
      jobId: job?.id,
      documentId: job?.data?.document_id,
      error: err.message,
    });
  });

  activeWorkers.set(tenantId, w);
  return w;
}
