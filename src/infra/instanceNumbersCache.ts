import { getSupabaseClient } from './supabaseClient';
import { logger } from '../utils/logger';

const INSTANCE_NUMBERS_PREFIX = 'instance_number:';

/**
 * Registra o número de telefone de uma instância
 */
export async function registerInstanceNumber(
  instanceId: string,
  normalizedNumber: string
): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    const key = `${INSTANCE_NUMBERS_PREFIX}${instanceId}`;

    const { error } = await supabase
      .from('ghl_wa_cache')
      .upsert({
        key,
        value: { normalizedNumber, instanceId },
        expires_at: null, // Nunca expira
      });

    if (error) {
      throw error;
    }

    logger.info('Instance number registered', {
      event: 'instance.number.registered',
      instanceId,
      normalizedNumber,
    });
  } catch (e) {
    logger.warn('Could not register instance number', {
      event: 'instance.number.register_error',
      error: (e as Error)?.message,
    });
  }
}

/**
 * Remove o registro do número de uma instância
 */
export async function unregisterInstanceNumber(instanceId: string): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    const key = `${INSTANCE_NUMBERS_PREFIX}${instanceId}`;

    const { error } = await supabase
      .from('ghl_wa_cache')
      .delete()
      .eq('key', key);

    if (error) {
      throw error;
    }

    logger.info('Instance number unregistered', {
      event: 'instance.number.unregistered',
      instanceId,
    });
  } catch (e) {
    logger.warn('Could not unregister instance number', {
      event: 'instance.number.unregister_error',
      error: (e as Error)?.message,
    });
  }
}

/**
 * Verifica se um número normalizado pertence a alguma instância
 */
export async function isInternalNumberGlobal(normalized: string): Promise<boolean> {
  try {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('ghl_wa_cache')
      .select('value')
      .like('key', `${INSTANCE_NUMBERS_PREFIX}%`);

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {
      return false;
    }

    // Verificar se algum valor contém o número normalizado
    return data.some((row) => {
      const value = row.value as { normalizedNumber: string; instanceId: string };
      return value.normalizedNumber === normalized;
    });
  } catch {
    return false;
  }
}

/**
 * Obtém todos os números de instâncias registrados
 */
export async function getAllInstanceNumbers(): Promise<Record<string, string>> {
  try {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('ghl_wa_cache')
      .select('key, value')
      .like('key', `${INSTANCE_NUMBERS_PREFIX}%`);

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {
      return {};
    }

    const result: Record<string, string> = {};
    data.forEach((row) => {
      const instanceId = row.key.replace(INSTANCE_NUMBERS_PREFIX, '');
      const value = row.value as { normalizedNumber: string };
      result[instanceId] = value.normalizedNumber;
    });

    return result;
  } catch (e) {
    logger.error('Error getting all instance numbers', {
      event: 'instance.numbers.get_all_error',
      error: (e as Error).message,
    });
    return {};
  }
}
