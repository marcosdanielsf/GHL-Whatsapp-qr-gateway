import { Router, Request, Response } from 'express';
import { getConnectionStatus } from '../core/baileys';
import { queueMessage, getQueueStats } from '../core/queue';
import { messageHistory } from '../core/messageHistory';
import { logger } from '../utils/logger';

export const sendRouter = Router();

/**
 * POST /api/send
 * Envía un mensaje (texto o imagen)
 * 
 * Body:
 * {
 *   "instanceId": "wa-01",
 *   "to": "+51999999999",
 *   "type": "text",
 *   "message": "Hola desde GHL"
 * }
 * 
 * O para imagen:
 * {
 *   "instanceId": "wa-01",
 *   "to": "+51999999999",
 *   "type": "image",
 *   "mediaUrl": "https://picsum.photos/400"
 * }
 */
/**
 * POST /api/send
 * Envía un mensaje (texto o imagen) usando cola con rate limiting
 * 
 * Body:
 * {
 *   "instanceId": "wa-01",
 *   "to": "+51999999999",
 *   "type": "text",
 *   "message": "Hola desde GHL"
 * }
 * 
 * O para imagen:
 * {
 *   "instanceId": "wa-01",
 *   "to": "+51999999999",
 *   "type": "image",
 *   "mediaUrl": "https://picsum.photos/400"
 * }
 */
sendRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { instanceId, to, type, message, mediaUrl } = req.body;

    // Validaciones
    if (!instanceId || !to || !type) {
      logger.warn('Request de envío inválido', {
        event: 'message.send.invalid',
        body: req.body,
      });
      return res.status(400).json({
        success: false,
        error: 'Faltan campos requeridos: instanceId, to, type',
      });
    }

    // Validar tipo
    if (type !== 'text' && type !== 'image') {
      return res.status(400).json({
        success: false,
        error: 'Tipo no soportado. Use "text" o "image"',
      });
    }

    // Validar campos según tipo
    if (type === 'text' && !message) {
      return res.status(400).json({
        success: false,
        error: 'Campo "message" es requerido para tipo text',
      });
    }

    if (type === 'image' && !mediaUrl) {
      return res.status(400).json({
        success: false,
        error: 'Campo "mediaUrl" es requerido para tipo image',
      });
    }

    // Verificar que la instancia esté conectada
    const status = getConnectionStatus(instanceId);
    if (status !== 'ONLINE') {
      logger.warn('Intento de envío a instancia no conectada', {
        event: 'message.send.not_connected',
        instanceId,
        status,
      });
      return res.status(400).json({
        success: false,
        error: `Instancia ${instanceId} no está conectada. Estado: ${status}`,
      });
    }

    // Agregar mensaje a la cola (con rate limiting automático)
    const jobId = await queueMessage(
      instanceId,
      type,
      to,
      type === 'text' ? message : mediaUrl
    );

    // Registrar en el historial con estado 'queued'
    const messageText = type === 'text' ? message : `[Imagen: ${mediaUrl}]`;
    messageHistory.add({
      instanceId,
      type: 'outbound',
      to,
      text: messageText,
      status: 'queued',
      metadata: {
        jobId,
        source: 'frontend',
      },
    });

    logger.info('Mensaje encolado exitosamente', {
      event: 'message.queue.success',
      instanceId,
      type,
      to,
      jobId,
    });

    res.json({
      success: true,
      message: `Mensaje ${type} encolado para envío a ${to}`,
      instanceId,
      type,
      jobId,
      status: 'queued',
    });
  } catch (error: any) {
    logger.error('Error al encolar mensaje', {
      event: 'message.queue.error',
      error: error.message,
      stack: error.stack,
      body: req.body,
    });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/send/stats
 * Obtiene estadísticas de la cola de mensajes
 */
sendRouter.get('/stats', async (req: Request, res: Response) => {
  try {
    const stats = await getQueueStats();
    res.json({
      success: true,
      stats,
    });
  } catch (error: any) {
    logger.error('Error al obtener estadísticas de cola', {
      event: 'queue.stats.error',
      error: error.message,
    });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});
