import { Router, Response } from 'express';
import OpenAI from 'openai';
import { getSupabaseClient } from '../infra/supabaseClient';
import { logger } from '../utils/logger';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';

export const settingsRouter = Router();

settingsRouter.use(requireAuth);

// ─────────────────────────────────────────────
// GET /api/settings/ai-keys
// Retorna metadados da key (sem expor o valor criptografado)
// ─────────────────────────────────────────────

settingsRouter.get('/ai-keys', async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(400).json({ error: 'Tenant ID ausente' });

  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('tenant_ai_keys')
    .select('provider, model, created_at')
    .eq('tenant_id', tenantId)
    .eq('provider', 'openai')
    .maybeSingle();

  if (error) {
    logger.error('[SETTINGS] Erro ao buscar ai-keys', { error: error.message, tenantId });
    return res.status(500).json({ error: 'Erro ao buscar configuração de AI' });
  }

  return res.json({
    provider: data?.provider ?? 'openai',
    model: data?.model ?? null,
    has_key: !!data,
    created_at: data?.created_at ?? null,
  });
});

// ─────────────────────────────────────────────
// POST /api/settings/ai-keys
// Salva/atualiza key OpenAI (criptografada via pgp_sym_encrypt no Supabase)
// ─────────────────────────────────────────────

settingsRouter.post('/ai-keys', async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(400).json({ error: 'Tenant ID ausente' });

  const { provider = 'openai', api_key, model = 'gpt-4o-mini' } = req.body;

  if (!api_key || typeof api_key !== 'string') {
    return res.status(400).json({ error: 'api_key é obrigatório' });
  }

  if (provider !== 'openai') {
    return res.status(400).json({ error: 'Apenas provider openai é suportado por ora' });
  }

  // Validar key com 1 chamada teste antes de salvar
  try {
    const testClient = new OpenAI({ apiKey: api_key });
    await testClient.models.list();
  } catch (err: any) {
    if (err?.status === 401) {
      return res.status(422).json({ error: 'API key OpenAI inválida ou revogada.' });
    }
    return res.status(422).json({ error: `Falha ao validar API key: ${err?.message}` });
  }

  const passphrase = process.env.AI_KEY_PASSPHRASE ?? '';
  if (!passphrase) {
    logger.error('[SETTINGS] AI_KEY_PASSPHRASE não configurada');
    return res.status(500).json({ error: 'Configuração de vault ausente no servidor' });
  }

  // Criptografar e upsert via RPC (evita expor passphrase em query inline)
  const supabase = getSupabaseClient();
  const { error } = await supabase.rpc('upsert_tenant_ai_key', {
    p_tenant_id: tenantId,
    p_provider: provider,
    p_api_key: api_key,
    p_model: model,
    p_passphrase: passphrase,
  });

  if (error) {
    logger.error('[SETTINGS] Erro ao salvar ai-key', { error: error.message, tenantId });
    return res.status(500).json({ error: 'Erro ao salvar chave de AI' });
  }

  logger.info('[SETTINGS] AI key salva/atualizada', {
    event: 'settings.ai_key.upsert',
    tenantId,
    provider,
    model,
  });

  return res.json({ ok: true });
});

// ─────────────────────────────────────────────
// DELETE /api/settings/ai-keys
// ─────────────────────────────────────────────

settingsRouter.delete('/ai-keys', async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(400).json({ error: 'Tenant ID ausente' });

  const supabase = getSupabaseClient();

  const { error } = await supabase
    .from('tenant_ai_keys')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('provider', 'openai');

  if (error) {
    logger.error('[SETTINGS] Erro ao deletar ai-key', { error: error.message, tenantId });
    return res.status(500).json({ error: 'Erro ao remover chave de AI' });
  }

  logger.info('[SETTINGS] AI key removida', {
    event: 'settings.ai_key.deleted',
    tenantId,
  });

  return res.json({ ok: true });
});
