import { Queue, Worker, Job } from 'bullmq';
import { RedisOptions } from 'ioredis';
import { sendTextMessage, sendImageMessage, getConnectionStatus } from './baileys';
import { logMessage } from '../utils/logger';
import { messageHistory } from './messageHistory';

// Configuración de Redis (puede ser local o remoto)
const redisConnection: RedisOptions = {
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD,
  maxRetriesPerRequest: null,
  // Para desarrollo sin Redis, usar modo "lazyConnect"
  lazyConnect: true,
  retryStrategy: (times: number) => {
    // Reintentar hasta 3 veces, luego dar error
    if (times > 3) {
      return null; // No reintentar más
    }
    return Math.min(times * 200, 2000); // Delay exponencial
  },
  enableOfflineQueue: false, // No encolar comandos si está offline
};

// Tipos para los jobs
export interface TextMessageJob {
  instanceId: string;
  to: string;
  message: string;
  type: 'text';
}

export interface ImageMessageJob {
  instanceId: string;
  to: string;
  mediaUrl: string;
  type: 'image';
}

export type MessageJob = TextMessageJob | ImageMessageJob;

// Crear cola de mensajes
export const messageQueue = new Queue<MessageJob>('whatsapp-messages', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: {
      age: 3600, // Mantener jobs completados por 1 hora
      count: 1000, // Máximo 1000 jobs completados
    },
    removeOnFail: {
      age: 86400, // Mantener jobs fallidos por 24 horas
    },
  },
});

// Worker para procesar mensajes (con manejo de errores)
let messageWorker: Worker<MessageJob> | null = null;

try {
  messageWorker = new Worker<MessageJob>(
    'whatsapp-messages',
    async (job: Job<MessageJob>) => {
      const { instanceId, type, to } = job.data;

      logMessage.queue(instanceId, job.id!, type, job.opts.delay as number || 0);

      // Verificar que la instancia esté conectada
      const status = getConnectionStatus(instanceId);
      if (status !== 'ONLINE') {
        throw new Error(`Instancia ${instanceId} no está conectada. Estado: ${status}`);
      }

      try {
        console.log(`\n[QUEUE] Procesando job ${job.id} - ${type} a ${to}`);
        
        if (type === 'text') {
          const { message } = job.data as TextMessageJob;
          logMessage.send(instanceId, 'text', to, 'processing');
          console.log(`[QUEUE] Enviando texto: "${message.substring(0, 50)}${message.length > 50 ? '...' : ''}"`);
          await sendTextMessage(instanceId, to, message);
          console.log(`[QUEUE] ✅ Texto enviado exitosamente`);
          logMessage.send(instanceId, 'text', to, 'sent', { jobId: job.id });
          
          // Actualizar historial: cambiar de 'queued' a 'sent'
          messageHistory.add({
            instanceId,
            type: 'outbound',
            to,
            text: message,
            status: 'sent',
            metadata: { jobId: job.id },
          });
        } else if (type === 'image') {
          const { mediaUrl } = job.data as ImageMessageJob;
          logMessage.send(instanceId, 'image', to, 'processing');
          console.log(`[QUEUE] Enviando imagen desde: ${mediaUrl}`);
          await sendImageMessage(instanceId, to, mediaUrl);
          console.log(`[QUEUE] ✅ Imagen enviada exitosamente`);
          logMessage.send(instanceId, 'image', to, 'sent', { jobId: job.id });
          
          // Actualizar historial: cambiar de 'queued' a 'sent'
          messageHistory.add({
            instanceId,
            type: 'outbound',
            to,
            text: `[Imagen: ${mediaUrl}]`,
            status: 'sent',
            metadata: { jobId: job.id, type: 'image' },
          });
        }

        return { success: true, instanceId, type, to };
      } catch (error: any) {
        if (error?.code === 'WAITING_CONTACT') {
          console.warn(
            `[QUEUE] ⏳ El número ${to} aún no ha iniciado conversación. Pendiente hasta que escriba.`
          );
          logMessage.send(instanceId, type, to, 'waiting_contact', {
            jobId: job.id,
            reason: 'contact_inactive',
            pendingId: error?.data?.pendingId,
          });
          return {
            success: true,
            instanceId,
            type,
            to,
            deferred: true,
            pendingId: error?.data?.pendingId,
          };
        }

        console.error(`[QUEUE] ❌ Error procesando job ${job?.id}:`, error?.message);
        logMessage.send(instanceId, type, to, 'failed', {
          jobId: job?.id,
          error: error?.message,
        });
        throw error;
      }
    },
    {
      connection: redisConnection,
      concurrency: 1, // Procesar un mensaje a la vez por instancia
      limiter: {
        max: 1,
        duration: 1000, // Máximo 1 mensaje por segundo globalmente
      },
    }
  );

  // Event listeners para el worker
  messageWorker.on('completed', (job) => {
    console.log(`✅ Job ${job.id} completado: ${job.data.type} a ${job.data.to}`);
  });

  messageWorker.on('failed', (job, err) => {
    console.error(`❌ Job ${job?.id} falló:`, err.message);
  });

  messageWorker.on('error', (err) => {
    console.error('❌ Error en worker:', err);
  });
} catch (error: any) {
  console.warn('⚠️  No se pudo inicializar el worker de colas:', error.message);
  console.warn('   Los mensajes se encolarán pero no se procesarán sin Redis');
}

// Exportar worker (puede ser null si Redis no está disponible)
export { messageWorker };

// Función helper para agregar mensaje a la cola con rate limiting
export async function queueMessage(
  instanceId: string,
  type: 'text' | 'image',
  to: string,
  messageOrUrl: string
): Promise<string> {
  // Calcular delay basado en el tipo de mensaje
  let delay = 0;
  if (type === 'text') {
    // Delay aleatorio entre 3-4 segundos para texto
    delay = 3000 + Math.random() * 1000; // 3000-4000ms
  } else if (type === 'image') {
    // Delay aleatorio entre 6-9 segundos para media
    delay = 6000 + Math.random() * 3000; // 6000-9000ms
  }

  const jobData: MessageJob =
    type === 'text'
      ? {
          instanceId,
          to,
          message: messageOrUrl,
          type: 'text',
        }
      : {
          instanceId,
          to,
          mediaUrl: messageOrUrl,
          type: 'image',
        };

  const job = await messageQueue.add(
    `send-${type}-${instanceId}`,
    jobData,
    {
      delay: Math.round(delay),
      jobId: `${instanceId}-${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      attempts: 3, // Reintentar 3 veces
    }
  );

  logMessage.send(instanceId, type, to, 'queued', {
    jobId: job.id,
    delay: Math.round(delay),
  });

  return job.id!;
}

// Función para obtener estadísticas de la cola
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

