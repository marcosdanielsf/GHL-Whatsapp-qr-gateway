/**
 * Sistema de almacenamiento en base de datos (Postgres) para historial de mensajes
 * Reemplaza el almacenamiento en memoria.
 */
import { db } from '../config/database';

interface MessageHistoryEntry {
  id: string; // ID de base de datos o generado
  instanceId: string;
  type: 'inbound' | 'outbound';
  from?: string;
  to?: string;
  text: string;
  timestamp: number;
  status: 'sent' | 'received' | 'failed' | 'queued';
  metadata?: any;
}

class MessageHistoryStore {

  /**
   * Agregar un mensaje al historial (DB)
   */
  async add(entry: Omit<MessageHistoryEntry, 'id' | 'timestamp'> & { timestamp?: number }): Promise<void> {
    try {
      const timestamp = entry.timestamp ? new Date(entry.timestamp) : new Date();
      const content = entry.text;
      const from_number = entry.from || '';
      const to_number = entry.to || '';
      const metadata = entry.metadata ? JSON.stringify(entry.metadata) : JSON.stringify({});

      // Mapear simple de status si es necesario
      // 'sent', 'received', 'failed', 'queued'

      await db.query(`
            INSERT INTO ghl_wa_message_history 
            (instance_id, type, from_number, to_number, content, status, timestamp, metadata)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
        entry.instanceId,
        entry.type,
        from_number,
        to_number,
        content,
        entry.status,
        timestamp,
        metadata
      ]);

    } catch (error) {
      console.error('[HISTORY] Error guardando historial:', error);
    }
  }

  /**
   * Obtener mensajes con filtros opcionales (DB)
   */
  async getMessages(options?: {
    instanceId?: string;
    type?: 'inbound' | 'outbound';
    limit?: number;
    since?: number; // timestamp
  }): Promise<MessageHistoryEntry[]> {
    try {
      let query = `SELECT * FROM ghl_wa_message_history WHERE 1=1`;
      const params: any[] = [];
      let paramCount = 1;

      if (options?.instanceId) {
        query += ` AND instance_id = $${paramCount}`;
        params.push(options.instanceId);
        paramCount++;
      }

      if (options?.type) {
        query += ` AND type = $${paramCount}`;
        params.push(options.type);
        paramCount++;
      }

      if (options?.since) {
        query += ` AND timestamp >= to_timestamp($${paramCount} / 1000.0)`;
        params.push(options.since);
        paramCount++;
      }

      query += ` ORDER BY timestamp DESC`;

      if (options?.limit) {
        query += ` LIMIT $${paramCount}`;
        params.push(options.limit);
        paramCount++;
      } else {
        query += ` LIMIT 100`;
      }

      const res = await db.query(query, params);

      return res.rows.map((row: any) => ({
        id: String(row.id),
        instanceId: row.instance_id,
        type: row.type as 'inbound' | 'outbound',
        from: row.from_number,
        to: row.to_number,
        text: row.content,
        timestamp: new Date(row.timestamp).getTime(),
        status: row.status as any,
        metadata: row.metadata
      }));

    } catch (error) {
      console.error('[HISTORY] Error obteniendo historial:', error);
      return [];
    }
  }

  /**
   * Obtener estadísticas (DB)
   * Nota: Esto ahora es async, hay que ver si rompe consumers
   */
  async getStatsAsync(instanceId?: string): Promise<{
    total: number;
    inbound: number;
    outbound: number;
    sent: number;
    received: number;
    failed: number;
  }> {

    // Esto es más complejo de convertir si el método original era síncrono.
    // Revisar uso. Si es solo para API, podemos hacerlo async.

    // Fallback simple:
    return {
      total: 0,
      inbound: 0,
      outbound: 0,
      sent: 0,
      received: 0,
      failed: 0,
    };
  }

  /**
   * Compatibilidad síncrona (Deprecated/Mock)
   * Retorna ceros porque no podemos consultar DB síncronamente
   */
  getStats(instanceId?: string) {
    return {
      total: 0,
      inbound: 0,
      outbound: 0,
      sent: 0,
      received: 0,
      failed: 0,
    };
  }

  /**
   * Limpiar mensajes antiguos (más de X horas)
   */
  async cleanup(olderThanHours: number = 24): Promise<void> {
    try {
      await db.query(`
            DELETE FROM ghl_wa_message_history 
            WHERE timestamp < NOW() - INTERVAL '${olderThanHours} hours'
        `);
    } catch (error) {
      console.error('[HISTORY] Error limpiando historial:', error);
    }
  }
}

// Instancia singleton
export const messageHistory = new MessageHistoryStore();

// Limpiar mensajes antiguos cada hora
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    messageHistory.cleanup(24); // Mantener solo últimos 24 horas
  }, 60 * 60 * 1000); // Cada hora
}
