import { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../utils/logger';

export interface AiKeyRecord {
  api_key: string;
  model: string;
}

/**
 * Busca e descriptografa a API key do tenant no Supabase.
 *
 * Usa pgp_sym_decrypt com a passphrase do setting postgres `app.vault_passphrase`.
 * Fallback: variável de ambiente AI_KEY_PASSPHRASE (Railway/Vercel).
 *
 * Retorna null se não existir registro para o tenant/provider.
 */
export async function getDecryptedKey(
  supabase: SupabaseClient,
  tenantId: string,
  provider = 'openai',
): Promise<AiKeyRecord | null> {
  const passphrase = process.env.AI_KEY_PASSPHRASE ?? '';

  // Tenta pgp_sym_decrypt via RPC — evita expor a passphrase em query SQL plana
  // Usa cast explícito para text no retorno da decrypt
  const { data, error } = await supabase.rpc('get_tenant_ai_key', {
    p_tenant_id: tenantId,
    p_provider: provider,
    p_passphrase: passphrase,
  });

  if (error) {
    // RPC pode não existir em ambientes antigos — fallback pra query direta
    logger.warn('[AI-KEY] RPC get_tenant_ai_key falhou, tentando query direta', {
      event: 'ai_key.rpc.fallback',
      error: error.message,
    });

    const { data: rows, error: qErr } = await supabase
      .from('tenant_ai_keys')
      .select('api_key_encrypted, model')
      .eq('tenant_id', tenantId)
      .eq('provider', provider)
      .limit(1);

    if (qErr || !rows || rows.length === 0) {
      logger.warn('[AI-KEY] Nenhuma key encontrada para tenant', {
        event: 'ai_key.not_found',
        tenantId,
        provider,
      });
      return null;
    }

    // api_key_encrypted = bytea gerada por pgp_sym_encrypt.
    // Sem acesso direto ao pgp_sym_decrypt no JS client, retornamos o valor cifrado
    // como sinal de que a key existe mas não pode ser descriptografada client-side.
    // O correto é usar a RPC get_tenant_ai_key acima. Se chegou aqui, é falha de setup.
    throw new Error(
      'Não foi possível descriptografar a AI key. Certifique-se de que a RPC get_tenant_ai_key está criada no Supabase e AI_KEY_PASSPHRASE está configurada.',
    );
  }

  if (!data || !data.api_key) {
    return null;
  }

  return {
    api_key: data.api_key as string,
    model: (data.model as string) ?? 'gpt-4o-mini',
  };
}
