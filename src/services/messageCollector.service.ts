/**
 * Clone Message Collector
 * Collects all owner (fromMe) messages for personality analysis.
 * Fire-and-forget — never blocks the main message flow.
 * Uses batch buffer to minimize Supabase hits.
 */

import { logger } from '../utils/logger';

interface OwnerMessage {
  phone_to: string;
  content: string;
  is_group: boolean;
  group_jid?: string;
  contact_name?: string;
  word_count: number;
  message_timestamp: string;
  instance_id: string;
}

// Batch buffer
const messageBuffer: OwnerMessage[] = [];
const BATCH_SIZE = 10;
const FLUSH_INTERVAL_MS = 30_000;
let flushTimer: ReturnType<typeof setInterval> | null = null;

function startFlushTimer(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    if (messageBuffer.length > 0) {
      flushBuffer().catch(err =>
        logger.error('Clone collector flush error', { event: 'clone.flush_error', error: err.message })
      );
    }
  }, FLUSH_INTERVAL_MS);
}

async function flushBuffer(): Promise<void> {
  if (messageBuffer.length === 0) return;

  const supabaseUrl = process.env.JARVIS_SUPABASE_URL;
  const supabaseKey = process.env.JARVIS_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    logger.warn('Clone collector: missing JARVIS_SUPABASE_URL or JARVIS_SUPABASE_ANON_KEY');
    return;
  }

  // Drain buffer atomically
  const batch = messageBuffer.splice(0, messageBuffer.length);

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/owner_messages`, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(batch),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Clone collector INSERT failed', {
        event: 'clone.insert_error',
        status: response.status,
        error: errorText,
        batchSize: batch.length,
      });
      // Re-enqueue for retry (cap at 100 to prevent unbounded growth)
      if (messageBuffer.length + batch.length <= 100) {
        messageBuffer.unshift(...batch);
      }
      return;
    }

    logger.info('Clone collector batch saved', {
      event: 'clone.batch_saved',
      count: batch.length,
    });
  } catch (err: any) {
    logger.error('Clone collector network error', {
      event: 'clone.network_error',
      error: err.message,
      batchSize: batch.length,
    });
    // Re-enqueue for retry (cap at 100 to prevent unbounded growth)
    if (messageBuffer.length + batch.length <= 100) {
      messageBuffer.unshift(...batch);
    }
  }
}

export async function collectOwnerMessage(params: {
  phone: string;
  text: string;
  isGroup: boolean;
  groupJid?: string;
  contactName?: string;
  instanceId: string;
  timestamp: number;
}): Promise<void> {
  if (process.env.CLONE_COLLECTOR_ENABLED !== 'true') return;

  const msg: OwnerMessage = {
    phone_to: params.phone,
    content: params.text,
    is_group: params.isGroup,
    group_jid: params.groupJid,
    contact_name: params.contactName,
    word_count: params.text.split(/\s+/).filter(Boolean).length,
    message_timestamp: new Date(params.timestamp * 1000).toISOString(),
    instance_id: params.instanceId,
  };

  messageBuffer.push(msg);
  startFlushTimer();

  if (messageBuffer.length >= BATCH_SIZE) {
    await flushBuffer();
  }
}
