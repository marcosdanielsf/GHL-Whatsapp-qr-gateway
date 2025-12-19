import { logger } from '../utils/logger';
import { getSupabaseClient } from '../infra/supabaseClient';

export type PendingMessageType = 'text' | 'image';

interface PendingMessageBase {
  id: string;
  instanceId: string;
  to: string;
  normalizedNumber: string; // solo dígitos, sin +
  type: PendingMessageType;
  reason: 'contact_inactive' | 'unknown';
  createdAt: number;
}

export interface PendingTextMessage extends PendingMessageBase {
  type: 'text';
  message: string;
}

export interface PendingImageMessage extends PendingMessageBase {
  type: 'image';
  mediaUrl: string;
}

export type PendingMessage = PendingTextMessage | PendingImageMessage;

async function addPendingMessage(pending: PendingMessage): Promise<PendingMessage> {
  const supabase = getSupabaseClient();

  const { error } = await supabase
    .from('ghl_wa_pending_messages')
    .insert({
      instance_id: pending.instanceId,
      normalized_number: pending.normalizedNumber,
      payload: pending,
    });

  if (error) {
    logger.error('Error adding pending message', {
      event: 'message.pending.add_error',
      error: error.message,
    });
    throw error;
  }

  logger.info('Mensaje pendiente registrado', {
    event: 'message.pending.add',
    instanceId: pending.instanceId,
    to: pending.to,
    normalizedNumber: pending.normalizedNumber,
    pendingId: pending.id,
    type: pending.type,
    reason: pending.reason,
  });

  return pending;
}

export async function addPendingTextMessage(
  instanceId: string,
  to: string,
  normalizedNumber: string,
  message: string,
  reason: PendingTextMessage['reason'] = 'unknown'
): Promise<PendingTextMessage> {
  return (await addPendingMessage({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    instanceId,
    to,
    normalizedNumber,
    type: 'text',
    message,
    reason,
    createdAt: Date.now(),
  })) as PendingTextMessage;
}

export async function addPendingImageMessage(
  instanceId: string,
  to: string,
  normalizedNumber: string,
  mediaUrl: string,
  reason: PendingImageMessage['reason'] = 'unknown'
): Promise<PendingImageMessage> {
  return (await addPendingMessage({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    instanceId,
    to,
    normalizedNumber,
    type: 'image',
    mediaUrl,
    reason,
    createdAt: Date.now(),
  })) as PendingImageMessage;
}

export async function consumePendingMessages(
  instanceId: string,
  normalizedNumber: string
): Promise<PendingMessage[]> {
  const supabase = getSupabaseClient();

  // Get all pending messages for this instance and number
  const { data, error } = await supabase
    .from('ghl_wa_pending_messages')
    .select('*')
    .eq('instance_id', instanceId)
    .eq('normalized_number', normalizedNumber)
    .order('created_at', { ascending: true });

  if (error) {
    logger.error('Error fetching pending messages', {
      event: 'message.pending.fetch_error',
      error: error.message,
    });
    return [];
  }

  if (!data || data.length === 0) {
    return [];
  }

  // Delete the messages
  const ids = data.map((row) => row.id);
  await supabase
    .from('ghl_wa_pending_messages')
    .delete()
    .in('id', ids);

  logger.info('Procesando mensajes pendientes', {
    event: 'message.pending.consume',
    instanceId,
    normalizedNumber,
    count: data.length,
  });

  return data
    .map((row) => {
      try {
        return row.payload as PendingMessage;
      } catch (error) {
        logger.error('No se pudo parsear mensaje pendiente', {
          event: 'message.pending.parse_error',
          instanceId,
          normalizedNumber,
          error: (error as Error).message,
        });
        return null;
      }
    })
    .filter((item: PendingMessage | null): item is PendingMessage => Boolean(item));
}

export async function getPendingCount(instanceId: string, normalizedNumber: string): Promise<number> {
  const supabase = getSupabaseClient();

  const { count, error } = await supabase
    .from('ghl_wa_pending_messages')
    .select('*', { count: 'exact', head: true })
    .eq('instance_id', instanceId)
    .eq('normalized_number', normalizedNumber);

  if (error) {
    logger.error('Error counting pending messages', {
      event: 'message.pending.count_error',
      error: error.message,
    });
    return 0;
  }

  return count || 0;
}

export async function getPendingSummary(): Promise<{
  total: number;
  perInstance: Record<string, number>;
}> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('ghl_wa_pending_messages')
    .select('instance_id');

  if (error) {
    logger.error('Error getting pending summary', {
      event: 'message.pending.summary_error',
      error: error.message,
    });
    return { total: 0, perInstance: {} };
  }

  if (!data || data.length === 0) {
    return { total: 0, perInstance: {} };
  }

  const perInstance: Record<string, number> = {};
  let total = 0;

  data.forEach((row) => {
    const instanceId = row.instance_id;
    perInstance[instanceId] = (perInstance[instanceId] || 0) + 1;
    total += 1;
  });

  return { total, perInstance };
}
