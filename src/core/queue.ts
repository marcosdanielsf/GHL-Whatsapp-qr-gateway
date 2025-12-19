import { db } from '../config/database';
import { sendTextMessage, sendImageMessage, getConnectionStatus } from './baileys';
import { logMessage } from '../utils/logger';
import { messageHistory } from './messageHistory';

export interface MessageJob {
  id?: number;
  instanceId: string;
  type: 'text' | 'image';
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
    // 1. Fetch pending jobs ready to be processed
    // LOCK rows to prevent race conditions if multiple workers exist (though Node is single threaded here)
    const client = await db.getClient();

    try {
      await client.query('BEGIN');

      const res = await client.query(`
        SELECT * FROM ghl_wa_message_queue 
        WHERE status = 'pending' 
          AND next_attempt_at <= NOW()
        ORDER BY created_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      `, [BATCH_SIZE]);

      const jobs = res.rows;

      if (jobs.length > 0) {
        // Mark as processing
        const ids = jobs.map((j: any) => j.id);
        await client.query(`
          UPDATE ghl_wa_message_queue 
          SET status = 'processing', updated_at = NOW() 
          WHERE id = ANY($1::int[])
        `, [ids]);

        await client.query('COMMIT');

        // Process jobs concurrently
        await Promise.all(jobs.map(processJob));
      } else {
        await client.query('COMMIT');
      }
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[QUEUE] Error fetching jobs:', err);
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('[QUEUE] Worker error:', error);
  } finally {
    isPolling = false;
  }
};

// Process individual job
const processJob = async (job: any) => {
  const { id, instance_id, type, to_number, content, attempts, max_attempts } = job;
  const instanceId = instance_id;
  const to = to_number;

  try {
    // Verify connection status
    const status = getConnectionStatus(instanceId);
    if (status !== 'ONLINE') {
      throw new Error(`Instancia ${instanceId} no está conectada. Estado: ${status}`);
    }

    console.log(`\n[QUEUE] Procesando job ${id} - ${type} a ${to}`);
    logMessage.queue(instanceId, String(id), type, 0);

    // Send logic
    if (type === 'text') {
      logMessage.send(instanceId, 'text', to, 'processing');
      await sendTextMessage(instanceId, to, content);
      logMessage.send(instanceId, 'text', to, 'sent', { jobId: id });

      // Update history
      messageHistory.add({
        instanceId,
        type: 'outbound',
        to,
        text: content,
        status: 'sent',
        metadata: { jobId: id },
      });

    } else if (type === 'image') {
      logMessage.send(instanceId, 'image', to, 'processing');
      await sendImageMessage(instanceId, to, content);
      logMessage.send(instanceId, 'image', to, 'sent', { jobId: id });

      // Update history
      messageHistory.add({
        instanceId,
        type: 'outbound',
        to,
        text: `[Imagen: ${content}]`,
        status: 'sent',
        metadata: { jobId: id, type: 'image' },
      });
    }

    // Mark as completed
    await db.query(`
      UPDATE ghl_wa_message_queue 
      SET status = 'completed', updated_at = NOW() 
      WHERE id = $1
    `, [id]);

    console.log(`[QUEUE] ✅ Job ${id} completado existosamente`);

  } catch (error: any) {
    console.error(`[QUEUE] ❌ Job ${id} falló:`, error.message);

    // Check retry logic
    const nextAttempts = attempts + 1;
    let nextStatus = 'pending';
    let nextAttemptAt = new Date(Date.now() + Math.min(nextAttempts * 2000, 30000)); // Exponential backoff

    if (nextAttempts >= max_attempts) {
      nextStatus = 'failed';
    }

    await db.query(`
      UPDATE ghl_wa_message_queue 
      SET 
        status = $1, 
        attempts = $2, 
        next_attempt_at = $3, 
        last_error = $4,
        updated_at = NOW() 
      WHERE id = $5
    `, [nextStatus, nextAttempts, nextAttemptAt, error.message, id]);

    logMessage.send(instanceId, type, to, 'failed', {
      jobId: id,
      error: error.message,
    });
  }
};

// Start the worker
let timer: NodeJS.Timeout | null = null;

export const startQueueWorker = () => {
  if (timer) return;
  console.log('[QUEUE] ✨ Iniciando Worker Postgres polling...');
  timer = setInterval(processQueue, POLLING_INTERVAL);
};

export const stopQueueWorker = () => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
};

// Support existing API: messageWorker export for compatibility check? 
// No, existing code imports messageWorker to listen to events. We might need to mock or remove that usage.
export const messageWorker = {
  close: async () => stopQueueWorker(),
  // Mock event emitter if needed, but better to refactor consumers
};

// Add to queue
export async function queueMessage(
  instanceId: string,
  type: 'text' | 'image',
  to: string,
  messageOrUrl: string
): Promise<string> {

  // Calculate delay if needed (optional logic from previous queue)
  // For now we insert immediate execution (next_attempt_at = NOW())

  // Insert into DB
  const result = await db.query(`
    INSERT INTO ghl_wa_message_queue (instance_id, type, to_number, content, status, next_attempt_at)
    VALUES ($1, $2, $3, $4, 'pending', NOW())
    RETURNING id
  `, [instanceId, type, to, messageOrUrl]);

  const jobId = String(result.rows[0].id);

  logMessage.send(instanceId, type, to, 'queued', {
    jobId: jobId,
  });

  return jobId;
}

// Get Stats
export async function getQueueStats() {
  const res = await db.query(`
    SELECT status, COUNT(*) as count 
    FROM ghl_wa_message_queue 
    GROUP BY status
  `);

  const stats: Record<string, number> = {
    waiting: 0, // database 'pending'
    active: 0,  // database 'processing'
    completed: 0,
    failed: 0,
    delayed: 0,
  };

  res.rows.forEach((row: any) => {
    if (row.status === 'pending') stats.waiting += parseInt(row.count);
    if (row.status === 'processing') stats.active += parseInt(row.count);
    if (row.status === 'completed') stats.completed += parseInt(row.count);
    if (row.status === 'failed') stats.failed += parseInt(row.count);
  });

  // Logic for delayed? 'pending' with next_attempt_at > NOW() is delayed
  // Simplified for now.

  return {
    ...stats,
    total: Object.values(stats).reduce((a, b) => a + b, 0),
  };
}
