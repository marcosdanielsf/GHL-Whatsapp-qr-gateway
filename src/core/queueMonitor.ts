import * as messageQueue from './queue';
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
      const stats = await messageQueue.getQueueStats() as {
        waiting: number;
        active: number;
        completed: number;
        failed: number;
        delayed: number;
        total: number;
      };
      // Map database stats to the monitor format
      const counts = {
        waiting: stats.waiting,
        active: stats.active,
        completed: stats.completed,
        failed: stats.failed,
        delayed: stats.delayed,
        paused: 0
      };
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


