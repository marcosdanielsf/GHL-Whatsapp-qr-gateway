import { Router, Response } from 'express';
import { getSupabaseClient } from '../infra/supabaseClient';
import { logger } from '../utils/logger';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';

export const settingsRouter = Router();

settingsRouter.use(requireAuth);

// ─────────────────────────────────────────────
// Multi-provider config
// ─────────────────────────────────────────────

// Naming alinhado com a constraint tenant_ai_keys_provider_check (legado F3):
// 'openai' | 'claude' | 'gemini' | 'groq'. UI mostra "Anthropic" / "Google AI" como labels.
const SUPPORTED_PROVIDERS = ['openai', 'claude', 'gemini', 'groq'] as const;
type Provider = (typeof SUPPORTED_PROVIDERS)[number];

const DEFAULT_MODELS: Record<Provider, string> = {
  openai: 'gpt-4o-mini',
  claude: 'claude-haiku-4-5-20251001',
  gemini: 'gemini-2.5-flash',
  groq: 'llama-3.1-70b-versatile',
};

function isProvider(value: unknown): value is Provider {
  return typeof value === 'string' && (SUPPORTED_PROVIDERS as readonly string[]).includes(value);
}

interface ValidationResult {
  ok: boolean;
  status?: number;
  error?: string;
}

async function validateProviderKey(
  provider: Provider,
  apiKey: string,
): Promise<ValidationResult> {
  try {
    if (provider === 'openai') {
      const r = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (r.status === 401) return { ok: false, status: 422, error: 'API key OpenAI inválida ou revogada.' };
      if (!r.ok) return { ok: false, status: 422, error: `OpenAI retornou ${r.status}` };
      return { ok: true };
    }

    if (provider === 'claude') {
      const r = await fetch('https://api.anthropic.com/v1/models', {
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      });
      if (r.status === 401) return { ok: false, status: 422, error: 'API key Anthropic inválida.' };
      if (!r.ok) return { ok: false, status: 422, error: `Anthropic retornou ${r.status}` };
      return { ok: true };
    }

    if (provider === 'gemini') {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
      );
      if (r.status === 400 || r.status === 401 || r.status === 403)
        return { ok: false, status: 422, error: 'API key Google AI inválida.' };
      if (!r.ok) return { ok: false, status: 422, error: `Google AI retornou ${r.status}` };
      return { ok: true };
    }

    if (provider === 'groq') {
      const r = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (r.status === 401) return { ok: false, status: 422, error: 'API key Groq inválida.' };
      if (!r.ok) return { ok: false, status: 422, error: `Groq retornou ${r.status}` };
      return { ok: true };
    }

    return { ok: false, status: 400, error: 'Provider não suportado' };
  } catch (err: any) {
    return { ok: false, status: 422, error: `Falha ao validar key: ${err?.message ?? 'erro desconhecido'}` };
  }
}

// ─────────────────────────────────────────────
// GET /api/settings/ai-keys
// Sem query → lista todos os providers do tenant
// Com ?provider=X → metadata daquele provider (compat com versão antiga)
// ─────────────────────────────────────────────

settingsRouter.get('/ai-keys', async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(400).json({ error: 'Tenant ID ausente' });

  const supabase = getSupabaseClient();
  const queryProvider = req.query.provider;

  if (typeof queryProvider === 'string') {
    if (!isProvider(queryProvider)) {
      return res.status(400).json({ error: 'Provider inválido' });
    }
    const { data, error } = await supabase
      .from('tenant_ai_keys')
      .select('provider, model, created_at')
      .eq('tenant_id', tenantId)
      .eq('provider', queryProvider)
      .maybeSingle();

    if (error) {
      logger.error('[SETTINGS] Erro ao buscar ai-key', { error: error.message, tenantId, provider: queryProvider });
      return res.status(500).json({ error: 'Erro ao buscar configuração de AI' });
    }

    return res.json({
      provider: queryProvider,
      model: data?.model ?? null,
      has_key: !!data,
      created_at: data?.created_at ?? null,
    });
  }

  const { data, error } = await supabase
    .from('tenant_ai_keys')
    .select('provider, model, created_at')
    .eq('tenant_id', tenantId);

  if (error) {
    logger.error('[SETTINGS] Erro ao listar ai-keys', { error: error.message, tenantId });
    return res.status(500).json({ error: 'Erro ao buscar configurações de AI' });
  }

  const byProvider = new Map((data ?? []).map((row) => [row.provider, row]));
  const keys = SUPPORTED_PROVIDERS.map((provider) => {
    const row = byProvider.get(provider);
    return {
      provider,
      model: row?.model ?? null,
      has_key: !!row,
      created_at: row?.created_at ?? null,
    };
  });

  return res.json({ keys });
});

// ─────────────────────────────────────────────
// POST /api/settings/ai-keys
// Body: { provider, api_key, model? }
// ─────────────────────────────────────────────

settingsRouter.post('/ai-keys', async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(400).json({ error: 'Tenant ID ausente' });

  const { provider, api_key, model } = req.body ?? {};

  if (!isProvider(provider)) {
    return res.status(400).json({
      error: `Provider obrigatório. Suportados: ${SUPPORTED_PROVIDERS.join(', ')}`,
    });
  }

  if (!api_key || typeof api_key !== 'string') {
    return res.status(400).json({ error: 'api_key é obrigatório' });
  }

  const finalModel = typeof model === 'string' && model.trim() ? model.trim() : DEFAULT_MODELS[provider];

  const validation = await validateProviderKey(provider, api_key);
  if (!validation.ok) {
    return res.status(validation.status ?? 422).json({ error: validation.error });
  }

  const passphrase = process.env.AI_KEY_PASSPHRASE ?? '';
  if (!passphrase) {
    logger.error('[SETTINGS] AI_KEY_PASSPHRASE não configurada');
    return res.status(500).json({ error: 'Configuração de vault ausente no servidor' });
  }

  const supabase = getSupabaseClient();
  const { error } = await supabase.rpc('upsert_tenant_ai_key', {
    p_tenant_id: tenantId,
    p_provider: provider,
    p_api_key: api_key,
    p_model: finalModel,
    p_passphrase: passphrase,
  });

  if (error) {
    logger.error('[SETTINGS] Erro ao salvar ai-key', { error: error.message, tenantId, provider });
    return res.status(500).json({ error: 'Erro ao salvar chave de AI' });
  }

  logger.info('[SETTINGS] AI key salva/atualizada', {
    event: 'settings.ai_key.upsert',
    tenantId,
    provider,
    model: finalModel,
  });

  return res.json({ ok: true, provider, model: finalModel });
});

// ─────────────────────────────────────────────
// DELETE /api/settings/ai-keys?provider=X
// ─────────────────────────────────────────────

settingsRouter.delete('/ai-keys', async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(400).json({ error: 'Tenant ID ausente' });

  const provider = req.query.provider;
  if (!isProvider(provider)) {
    return res.status(400).json({
      error: `Provider obrigatório no query string. Suportados: ${SUPPORTED_PROVIDERS.join(', ')}`,
    });
  }

  const supabase = getSupabaseClient();

  const { error } = await supabase
    .from('tenant_ai_keys')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('provider', provider);

  if (error) {
    logger.error('[SETTINGS] Erro ao deletar ai-key', { error: error.message, tenantId, provider });
    return res.status(500).json({ error: 'Erro ao remover chave de AI' });
  }

  logger.info('[SETTINGS] AI key removida', {
    event: 'settings.ai_key.deleted',
    tenantId,
    provider,
  });

  return res.json({ ok: true, provider });
});
