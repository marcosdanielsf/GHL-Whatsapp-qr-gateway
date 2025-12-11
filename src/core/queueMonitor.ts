import { messageQueue } from './queue';
import { notifyQueueMetrics } from '../utils/monitoring';
import { getPendingSummary } from './pendingMessages';
import { logger } from '../utils/logger';

const DEFAULT_INTERVAL = Number(process.env.QUEUE_METRICS_INTERVAL_MS || 15000);
let monitorStarted = false;

export function startQueueMonitor() {
  if (monitorStarted) return;
  monitorStarted = true;

  const interval = setInterval(async () => {
    try {
      const counts = await messageQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'paused');
      const pending = await getPendingSummary();

      await notifyQueueMetrics({
        queue: 'whatsapp-messages',
        counts,
        pendingMessages: pending,
      });
    } catch (error: any) {
      logger.error('Error recolectando métricas de cola', {
        event: 'monitoring.queue_metrics.error',
        error: error.message,
      });
    }
  }, DEFAULT_INTERVAL);

  interval.unref?.();

  logger.info('Monitor de cola iniciado', {
    event: 'queue.monitor.started',
    intervalMs: DEFAULT_INTERVAL,
  });
}


