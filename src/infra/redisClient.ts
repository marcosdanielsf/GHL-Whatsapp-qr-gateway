import Redis, { RedisOptions } from 'ioredis';
import { logger } from '../utils/logger';

let redisClient: Redis | null = null;

function buildOptions(): RedisOptions {
  const host = process.env.REDIS_HOST || 'localhost';
  const port = Number(process.env.REDIS_PORT) || 6379;
  const password = process.env.REDIS_PASSWORD;

  return {
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
    lazyConnect: true,
    host,
    port,
    password,
  };
}

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = process.env.REDIS_URL
      ? new Redis(process.env.REDIS_URL, {
          maxRetriesPerRequest: null,
          enableOfflineQueue: false,
          lazyConnect: true,
        })
      : new Redis(buildOptions());

    redisClient.on('error', (err) => {
      logger.error('Error en Redis', {
        event: 'redis.error',
        error: err.message,
      });
    });

    redisClient.on('connect', () => {
      logger.info('Redis conectado para store auxiliar', {
        event: 'redis.connected',
      });
    });
  }
  return redisClient;
}


