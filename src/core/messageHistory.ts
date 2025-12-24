/**
 * Sistema de almacenamiento en base de datos (Postgres) para historial de mensajes
 * Reemplaza el almacenamiento en memoria.
 */
import { getSupabaseClient } from '../infra/supabaseClient';

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
      const metadata = entry.metadata || {};
      const supabase = getSupabaseClient();

      // Mapear simple de status si es necesario
      // 'sent', 'received', 'failed', 'queued'

      const { error } = await supabase
        .from('ghl_wa_message_history')
        .insert({
          instance_id: entry.instanceId,
          type: entry.type,
          from_number: from_number,
          to_number: to_number,
          content: content,
          status: entry.status,
          timestamp: timestamp.toISOString(),
          metadata: metadata
        });

      if (error) {
        console.error('[HISTORY] Error guardando historial (Supabase):', error);
      }

    } catch (error) {
      console.error('[HISTORY] Error guardando historial:', error);
    }
  }

  /**
   * Obtener mensajes con filtros opcionales (DB)
   */
  async getMessages(options?: {
    instanceId?: string | string[];
    type?: 'inbound' | 'outbound';
    limit?: number;
    since?: number; // timestamp
  }): Promise<MessageHistoryEntry[]> {
    try {
      const supabase = getSupabaseClient();
      let query = supabase
        .from('ghl_wa_message_history')
        .select('*');

      if (options?.instanceId) {
        if (Array.isArray(options.instanceId)) {
           if (options.instanceId.length > 0) {
             query = query.in('instance_id', options.instanceId);
           } else {
             // Si el array está vacío, no devolver nada
             return [];
           }
        } else {
           query = query.eq('instance_id', options.instanceId);
        }
      }

      if (options?.type) {
        query = query.eq('type', options.type);
      }

      if (options?.since) {
        query = query.gte('timestamp', new Date(options.since).toISOString());
      }

      // Ordenar por timestamp DESC
      query = query.order('timestamp', { ascending: false });

      if (options?.limit) {
        query = query.limit(options.limit);
      } else {
        query = query.limit(100);
      }

      const { data, error } = await query;

      if (error) {
        console.error('[HISTORY] Error fetching messages:', error);
        return [];
      }

      if (!data) return [];

      return data.map((row: any) => ({
        id: String(row.id),
        instanceId: row.instance_id,
        type: row.type as 'inbound' | 'outbound',
        from: row.from_number,
        to: row.to_number,
        text: row.content,
        timestamp: new Date(row.timestamp).getTime(),
        status: row.status as any,
        metadata: row.metadata,
      }));

    } catch (error: any) {
      console.error('[HISTORY] Error general fetching messages:', error);
      return [];
    }
  }

  // Métodos in-memory legados (no usados si usamos DB)
  async get(instanceId: string): Promise<MessageHistoryEntry[]> {
    return this.getMessages({ instanceId });
  }

  async clear(instanceId: string): Promise<void> {
    // Implementar delete si necesario
    const supabase = getSupabaseClient();
    await supabase.from('ghl_wa_message_history').delete().eq('instance_id', instanceId);
  }
}

export const messageHistory = new MessageHistoryStore();
