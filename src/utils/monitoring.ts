import { logger } from './logger';

interface ConnectionAlertPayload {
  instanceId: string;
  status: 'connecting' | 'connected' | 'disconnected';
  reason?: string;
  details?: Record<string, any>;
}

interface QueueMetricsPayload {
  queue: string;
  counts: Record<string, number>;
  pendingMessages: {
    total: number;
    perInstance: Record<string, number>;
  };
}

type MonitoringEvent =
  | {
      type: 'connection_alert';
      payload: ConnectionAlertPayload;
    }
  | {
      type: 'queue_metrics';
      payload: QueueMetricsPayload;
    };

const webhookUrl = process.env.MONITORING_WEBHOOK_URL;
const webhookToken = process.env.MONITORING_WEBHOOK_TOKEN;

async function postToWebhook(body: any) {
  if (!webhookUrl) {
    return;
  }

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(webhookToken ? { Authorization: `Bearer ${webhookToken}` } : {}),
      },
      body: JSON.stringify({
        source: 'whatsapp-ghl-gateway',
        timestamp: new Date().toISOString(),
        ...body,
      }),
    });
  } catch (error: any) {
    logger.warn('No se pudo enviar alerta al webhook de monitoreo', {
      event: 'monitoring.webhook.error',
      error: error.message,
    });
  }
}

export async function notifyMonitoring(event: MonitoringEvent) {
  await postToWebhook(event);
}

export async function notifyConnectionAlert(params: ConnectionAlertPayload) {
  logger.warn('Alerta de conexión', {
    event: 'monitoring.connection_alert',
    ...params,
  });
  await notifyMonitoring({
    type: 'connection_alert',
    payload: params,
  });
}

export async function notifyQueueMetrics(payload: QueueMetricsPayload) {
  logger.info('Métricas de cola', {
    event: 'monitoring.queue_metrics',
    ...payload,
  });
  await notifyMonitoring({
    type: 'queue_metrics',
    payload,
  });
}


