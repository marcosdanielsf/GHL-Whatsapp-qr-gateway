import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../utils/logger';

let supabaseClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!supabaseClient) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
    }

    supabaseClient = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    logger.info('Supabase client initialized', {
      event: 'supabase.initialized',
      url: supabaseUrl,
    });
  }

  return supabaseClient;
}

// Helper para limpar cache expirado
export async function cleanExpiredCache(): Promise<number> {
  const client = getSupabaseClient();

  const { data, error } = await client.rpc('clean_expired_ghl_wa_cache');

  if (error) {
    logger.error('Error cleaning expired cache', {
      event: 'supabase.cache.clean_error',
      error: error.message,
    });
    return 0;
  }

  return data || 0;
}

// Helper para obter estatísticas da fila
export async function getQueueStats(): Promise<Record<string, number>> {
  const client = getSupabaseClient();

  const { data, error } = await client.rpc('get_ghl_wa_queue_stats');

  if (error) {
    logger.error('Error getting queue stats', {
      event: 'supabase.queue.stats_error',
      error: error.message,
    });
    return {};
  }

  const stats: Record<string, number> = {};
  if (data) {
    data.forEach((row: { status: string; count: number }) => {
      stats[row.status] = row.count;
    });
  }

  return stats;
}
