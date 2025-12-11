import express, { Express, Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import cors, { CorsOptions } from 'cors';
import path from 'path';
import { qrRouter } from './api/qr.controller';
import { sendRouter } from './api/send.controller';
import { ghlRouter, outboundTestRouter } from './api/ghl.controller';
import { messageWorker } from './core/queue';
import { startQueueMonitor } from './core/queueMonitor';
import { logger } from './utils/logger';
import { messageHistory } from './core/messageHistory';

// Cargar variables de entorno
dotenv.config();

const app: Express = express();
const PORT = process.env.PORT || 8080;
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsOptions: CorsOptions = {
  origin: allowedOrigins.length ? allowedOrigins : true,
  credentials: true,
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
  console.log(`\n🌐 [${timestamp}] ${req.method} ${req.path}`);
  
  // Log detallado para peticiones a /api/ghl/outbound
  if (req.path.includes('ghl') || req.path.includes('outbound')) {
    console.log(`  📍 URL completa: ${req.url}`);
    console.log(`  📋 Headers:`, JSON.stringify({ 
      'content-type': req.headers['content-type'],
      'user-agent': req.headers['user-agent']?.substring(0, 50),
      'ngrok-skip': req.headers['ngrok-skip-browser-warning'],
      'host': req.headers['host']
    }, null, 2));
    console.log(`  🔗 IP: ${req.ip || req.socket.remoteAddress}`);
  }
  
  next();
});

app.use(express.json({
  limit: '10mb',
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logger simple de requests (después del parsing) - PRIMERO para capturar TODAS las peticiones
app.use((req: Request, res: Response, next) => {
  const timestamp = new Date().toISOString();
  console.log(`\n🌐 [${timestamp}] ${req.method} ${req.path}`);
  
  // Log detallado para peticiones a /api/ghl/outbound
  if (req.path.includes('ghl') || req.path.includes('outbound')) {
    console.log(`  📍 URL completa: ${req.url}`);
    console.log(`  📋 Headers:`, JSON.stringify({ 
      'content-type': req.headers['content-type'],
      'user-agent': req.headers['user-agent']?.substring(0, 50),
      'ngrok-skip': req.headers['ngrok-skip-browser-warning'],
      'host': req.headers['host']
    }, null, 2));
    console.log(`  🔗 IP: ${req.ip || req.socket.remoteAddress}`);
  }
  
  next();
});

// Rutas API primero (antes del frontend estático)
app.use('/api/wa', qrRouter);
app.use('/api/send', sendRouter);
app.use('/api/ghl', ghlRouter);
app.use('/outbound-test', outboundTestRouter);

// Endpoint para obtener historial de mensajes
app.get('/api/messages/history', (req: Request, res: Response) => {
  try {
    const instanceId = req.query.instanceId as string | undefined;
    const type = req.query.type as 'inbound' | 'outbound' | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
    const since = req.query.since ? parseInt(req.query.since as string) : undefined;

    logger.info('Consultando historial de mensajes', {
      event: 'messages.history.request',
      instanceId: instanceId || 'all',
      type: type || 'all',
      limit,
    });

    const messages = messageHistory.getMessages({
      instanceId,
      type,
      limit,
      since,
    });

    res.json({
      success: true,
      count: messages.length,
      messages,
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
  // Si es una petición a /api/*, no hacer fallback
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
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
  console.error('[GLOBAL ERROR HANDLER]', err);
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
  console.log('\n🚀 WhatsApp GHL Gateway');
  console.log(`📡 Servidor corriendo en http://localhost:${PORT}`);
  console.log(`📂 Sesiones guardadas en: ${process.env.SESSION_DIR || './data/sessions'}`);
  
  // Inicializar worker de colas
  try {
    // El worker se inicializa automáticamente al importar
    logger.info('Worker de colas inicializado', {
      event: 'queue.worker.ready',
    });
    console.log('✅ Worker de colas activo');

    startQueueMonitor();
  } catch (error: any) {
    logger.warn('No se pudo conectar a Redis, el worker puede no funcionar', {
      event: 'queue.worker.error',
      error: error.message,
    });
    console.log('⚠️  Advertencia: Redis no disponible. Algunas funciones pueden no estar disponibles.');
    console.log('   Para desarrollo sin Redis, los mensajes se encolarán pero no se procesarán.');
  }
  
  console.log('\n✅ Listo para recibir requests\n');
});

// Manejo de cierre graceful
process.on('SIGTERM', async () => {
  logger.info('Cerrando aplicación...', { event: 'app.shutdown' });
  if (messageWorker) {
    await messageWorker.close();
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('Cerrando aplicación...', { event: 'app.shutdown' });
  if (messageWorker) {
    await messageWorker.close();
  }
  process.exit(0);
});

export default app;
