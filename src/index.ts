import express, { Express, Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import cors, { CorsOptions } from 'cors';
import path from 'path';
import { qrRouter, publicQrRouter } from './api/qr.controller';
import { sendRouter } from './api/send.controller';
import { groupsRouter } from './api/groups.controller';
import { ghlRouter, outboundTestRouter } from './api/ghl.controller';
import { authRouter } from './api/auth.controller';
import { messageWorker, startQueueWorker } from './core/queue';
import { closeAllInstances } from './core/baileys';
import { startQueueMonitor } from './core/queueMonitor';
import { logger } from './utils/logger';
import { messageHistory } from './core/messageHistory';
import { restoreSessions } from './core/baileys';
import { testDbConnection } from './config/database';
import { requireAuth, AuthenticatedRequest } from './middleware/auth'; // Import auth middleware
import { getSupabaseClient } from './infra/supabaseClient';
import { stripeWebhookRouter } from './api/webhooks/stripe.controller';
import { stripeRouter } from './api/stripe.controller';
import { campaignsRouter } from './api/campaigns.controller';
import { settingsRouter } from './api/settings.controller';
import { startCampaignWorkers } from './core/campaign-worker';
import { startTokenRefresher, stopTokenRefresher } from './core/tokenRefresher';
import { jarvisRouter } from './api/jarvis.controller';
import { statusRouter } from './api/status.controller';

// Cargar variables de entorno
dotenv.config();

// Test DB Connection
testDbConnection();

const app: Express = express();
const PORT = process.env.PORT || 8080;
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsOptions: CorsOptions = {
  origin: allowedOrigins.length ? allowedOrigins : true,
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'x-jarvis-key', 'ngrok-skip-browser-warning'],
};

// Middleware
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Middleware para aceptar ngrok-skip-browser-warning (headers especiales de ngrok)
app.use((req: Request, res: Response, next) => {
  // Ngrok puede enviar headers especiales que necesitamos aceptar
  // Permitir el header ngrok-skip-browser-warning
  if (req.headers['ngrok-skip-browser-warning']) {
    res.setHeader('ngrok-skip-browser-warning', 'true');
  }
  next();
});

// Middleware para parsear JSON con mejor manejo de errores
// Logger ANTES del parsing para capturar TODAS las peticiones
app.use((req: Request, res: Response, next) => {
  const timestamp = new Date().toISOString();
  logger.debug(`\n🌐 [${timestamp}] ${req.method} ${req.path}`);

  // Log detallado para peticiones a /api/ghl/outbound
  if (req.path.includes('ghl') || req.path.includes('outbound')) {
    logger.debug(`  📍 URL completa: ${req.url}`);
    logger.debug(`  📋 Headers:`, JSON.stringify({
      'content-type': req.headers['content-type'],
      'user-agent': req.headers['user-agent']?.substring(0, 50),
      'ngrok-skip': req.headers['ngrok-skip-browser-warning'],
      'host': req.headers['host']
    }, null, 2));
    logger.debug(`  🔗 IP: ${req.ip || req.socket.remoteAddress}`);
  }

  next();
});

// Stripe Webhook - MUST be before express.json() to get raw body
app.use('/api/webhooks/stripe', express.raw({ type: 'application/json' }), stripeWebhookRouter);

app.use(express.json({
  limit: '10mb',
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logger simple de requests (después del parsing) - PRIMERO para capturar TODAS las peticiones
app.use((req: Request, res: Response, next) => {
  const timestamp = new Date().toISOString();
  logger.debug(`\n🌐 [${timestamp}] ${req.method} ${req.path}`);

  // Log detallado para peticiones a /api/ghl/outbound
  if (req.path.includes('ghl') || req.path.includes('outbound')) {
    logger.debug(`  📍 URL completa: ${req.url}`);
    logger.debug(`  📋 Headers:`, JSON.stringify({
      'content-type': req.headers['content-type'],
      'user-agent': req.headers['user-agent']?.substring(0, 50),
      'ngrok-skip': req.headers['ngrok-skip-browser-warning'],
      'host': req.headers['host']
    }, null, 2));
    logger.debug(`  🔗 IP: ${req.ip || req.socket.remoteAddress}`);
  }

  next();
});

// Rutas API primero (antes del frontend estático)
app.use('/api/wa', publicQrRouter); // rotas públicas (qr-check, reconnect) — SEM auth
app.use('/api/wa', qrRouter);          // rotas protegidas — COM auth
app.use('/api/wa/groups', groupsRouter); // grupos (list, inviteinfo) — COM auth
app.use('/api/send', sendRouter);
app.use('/api/stripe', stripeRouter);
app.use('/api/campaigns', campaignsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/ghl', ghlRouter);
app.use('/api/ghl', authRouter); // Register Auth routes under /api/ghl
app.use('/api/oauth', authRouter); // Also register under /api/oauth (GHL blocks "ghl" in redirect URLs)
app.use('/api/jarvis', jarvisRouter);
app.use('/api/nexus', statusRouter); // Status endpoint for GHL injection scripts (sem auth)

// CORS aberto para scripts de injeção GHL
app.use('/scripts', (req: Request, res: Response, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Cache-Control', 'public, max-age=300');
  next();
});
app.use('/outbound-test', outboundTestRouter);

// Endpoint para obtener historial de mensajes
app.get('/api/messages/history', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(400).json({ success: false, error: 'Tenant ID missing' });
    }

    const instanceId = req.query.instanceId as string | undefined;
    const type = req.query.type as 'inbound' | 'outbound' | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
    const since = req.query.since ? parseInt(req.query.since as string) : undefined;

    let targetInstanceIds: string | string[];

    if (instanceId && instanceId !== 'all') {
      // Si se especifica una instancia, usar el ID escaneado
      targetInstanceIds = `${tenantId}-${instanceId}`;
    } else {
      // Si es 'all' o no se especifica, buscar todas las instancias del tenant
      const supabase = getSupabaseClient();
      const { data: instances, error } = await supabase
        .from('ghl_wa_instances')
        .select('id')
        .eq('tenant_id', tenantId);
      
      if (error) {
        logger.error('Error fetching tenant instances for history', { error });
        throw error;
      }
      
      targetInstanceIds = instances?.map(i => i.id) || [];
    }

    logger.info('Consultando historial de mensajes', {
      event: 'messages.history.request',
      tenantId,
      instanceId: instanceId || 'all',
      targetInstanceIds: Array.isArray(targetInstanceIds) ? targetInstanceIds.length : targetInstanceIds,
      type: type || 'all',
      limit,
    });

    const messages = await messageHistory.getMessages({
      instanceId: targetInstanceIds,
      type,
      limit,
      since,
    });

    // Des-escopar instanceId para el frontend
    const cleanMessages = messages.map(msg => ({
      ...msg,
      instanceId: msg.instanceId.replace(`${tenantId}-`, '')
    }));

    res.json({
      success: true,
      count: cleanMessages.length,
      messages: cleanMessages,
    });
  } catch (error: any) {
    logger.error('Error obteniendo historial', {
      event: 'messages.history.error',
      error: error.message,
    });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// API de health check
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    service: 'WhatsApp GHL Gateway',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      qr: 'GET /api/wa/qr/:instanceId',
      status: 'GET /api/wa/status/:instanceId',
      instances: 'GET /api/wa/instances',
      logout: 'POST /api/wa/logout/:instanceId',
      clear: 'POST /api/wa/clear/:instanceId',
      send: 'POST /api/send',
      stats: 'GET /api/send/stats',
      ghlOutbound: 'POST /api/ghl/outbound',
      ghlInboundTest: 'POST /api/ghl/inbound-test',
      outboundTest: 'POST /outbound-test',
    },
  });
});

// Servir frontend estático (React compilado)
const publicPath = path.join(__dirname, '..', 'public');
app.use(express.static(publicPath));

// SPA fallback: todas las rutas no-API sirven index.html (DEBE SER EL ÚLTIMO)
app.get('*', (req: Request, res: Response) => {
  // Si es una petición a /api/* o /scripts/*, no hacer fallback
  if (req.path.startsWith('/api/') || req.path.startsWith('/scripts/')) {
    return res.status(404).json({ error: 'Not found' });
  }

  // Servir index.html para todas las demás rutas (SPA routing)
  res.sendFile(path.join(publicPath, 'index.html'));
});

// Manejo de errores 404
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint no encontrado',
  });
});

// Manejo global de errores (evitar 502)
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  logger.error('[GLOBAL ERROR HANDLER]', err);
  logger.error('Error no manejado en el servidor', {
    event: 'server.unhandled_error',
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  if (!res.headersSent) {
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor',
      message: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
});

// Iniciar servidor
app.listen(PORT, async () => {
  logger.debug('\n🚀 WhatsApp GHL Gateway');
  logger.debug(`📡 Servidor corriendo en http://localhost:${PORT}`);
  logger.debug(`📂 Sesiones guardadas en: ${process.env.SESSION_DIR || './data/sessions'}`);

  // Inicializar worker de colas (BullMQ + Redis)
  try {
    startQueueWorker();
    startQueueMonitor();
    logger.debug('Worker de colas (BullMQ + Redis) activo');
  } catch (error: any) {
    logger.warn('Falha ao iniciar worker BullMQ — Redis pode estar indisponivel', {
      event: 'queue.worker.error',
      error: error.message,
    });
  }

  // Recovery de campanhas running após restart
  startCampaignWorkers().catch((err: any) => {
    logger.warn('Falha ao iniciar campaign workers no boot', {
      event: 'campaign.worker.bootstrap.error',
      error: err?.message,
    });
  });

  // Restaurar sesiones de WhatsApp
  restoreSessions();

  // Iniciar refresh automático de tokens GHL
  startTokenRefresher();

  logger.debug('\n✅ Listo para recibir requests\n');
});

// Manejo de cierre graceful
const gracefulShutdown = async (signal: string) => {
  logger.info(`Sinal ${signal} recebido. Iniciando graceful shutdown...`, { event: 'app.shutdown' });

  // Timeout de 10s: se travar, Railway mata com SIGKILL de qualquer forma
  const shutdownTimeout = setTimeout(() => {
    logger.error('Shutdown timeout (10s) excedido, forçando exit', { event: 'app.shutdown.timeout' });
    process.exit(1);
  }, 10000);

  try {
    closeAllInstances(); // fecha sockets WA — evita erro 440 "conflict" no próximo deploy
    stopTokenRefresher();
    if (messageWorker) {
      await messageWorker.close();
    }
  } catch (err: any) {
    logger.error('Erro durante shutdown', { event: 'app.shutdown.error', error: err?.message });
  } finally {
    clearTimeout(shutdownTimeout);
    process.exit(0);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Previne crash do Node por erros internos do Baileys (ex: 428 Connection Closed em retry handler)
process.on('unhandledRejection', (reason: any) => {
  logger.error('Unhandled promise rejection (non-fatal, Baileys internal)', {
    event: 'process.unhandledRejection',
    error: reason?.message || String(reason),
    statusCode: reason?.output?.statusCode,
  });
});

export default app;
