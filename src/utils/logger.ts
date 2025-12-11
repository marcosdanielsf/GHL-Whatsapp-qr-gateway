import winston from 'winston';
import fs from 'fs';
import path from 'path';

// Asegurar que el directorio de logs existe
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Configurar formato estructurado
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Formato para consola (más legible)
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(meta).length > 0) {
      msg += ` ${JSON.stringify(meta)}`;
    }
    return msg;
  })
);

// Crear logger
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  defaultMeta: { service: 'whatsapp-ghl-gateway' },
  transports: [
    // Archivo para logs de error
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    // Archivo para todos los logs
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
  ],
});

// En desarrollo, también mostrar en consola
if (process.env.NODE_ENV !== 'production') {
  logger.add(
    new winston.transports.Console({
      format: consoleFormat,
    })
  );
}

// Helper para logs estructurados
export const logMessage = {
  send: (
    instanceId: string,
    type: 'text' | 'image',
    to: string,
    status: 'queued' | 'processing' | 'sent' | 'failed' | 'waiting_contact' | 'deferred',
    meta?: any
  ) => {
    logger.info('Mensaje enviado', {
      event: 'message.send',
      instanceId,
      type,
      to,
      status,
      ...meta,
    });
  },
  receive: (instanceId: string, from: string, message: string) => {
    logger.info('Mensaje recibido', {
      event: 'message.receive',
      instanceId,
      from,
      message,
    });
  },
  queue: (instanceId: string, jobId: string, type: 'text' | 'image', delay: number) => {
    logger.info('Mensaje encolado', {
      event: 'message.queue',
      instanceId,
      jobId,
      type,
      delay,
    });
  },
  connection: (instanceId: string, status: 'connecting' | 'connected' | 'disconnected', meta?: any) => {
    logger.info('Estado de conexión', {
      event: 'connection.update',
      instanceId,
      status,
      ...meta,
    });
  },
};

