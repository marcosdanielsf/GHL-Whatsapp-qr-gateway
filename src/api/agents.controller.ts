/**
 * agents.controller.ts — F8 IA Inbox
 * CRUD de ai_agents + playground
 */

import { Router, Response } from 'express';
import { getSupabaseClient } from '../infra/supabaseClient';
import { getDecryptedKey } from '../core/decrypt-ai-key';
import { getConnectionStatus } from '../core/baileys';
import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';
import { AuthenticatedRequest } from '../middleware/auth';
import { logger } from '../utils/logger';

export const agentsRouter = Router();

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function buildModel(provider: string, model: string, apiKey: string) {
  switch (provider.toLowerCase()) {
    case 'openai':
      return createOpenAI({ apiKey })(model);
    case 'anthropic':
      return createAnthropic({ apiKey })(model);
    case 'google':
      return createGoogleGenerativeAI({ apiKey })(model);
    case 'groq':
      return createGroq({ apiKey })(model);
    default:
      return createOpenAI({ apiKey })(model);
  }
}

// ─────────────────────────────────────────────
// POST /api/agents — create agent
// ─────────────────────────────────────────────

agentsRouter.post('/', async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(400).json({ error: 'Tenant ID ausente' });

  const {
    instance_id,
    name,
    provider = 'openai',
    model = 'gpt-4o-mini',
    system_prompt,
    temperature = 0.7,
    max_tokens = 1000,
    max_history_msgs = 20,
    rag_enabled = false,
    tools_enabled = false,
    followup_enabled = false,
    business_hours_enabled = false,
    out_of_hours_message = null,
  } = req.body;

  if (!instance_id || !name || !system_prompt) {
    return res.status(400).json({ error: 'instance_id, name e system_prompt são obrigatórios' });
  }

  const fullInstanceId = `${tenantId}-${instance_id}`;

  const supabase = getSupabaseClient();

  // Check if agent already exists for this instance
  const { data: existing } = await supabase
    .from('ai_agents')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('instance_id', fullInstanceId)
    .not('status', 'eq', 'deleted')
    .single();

  if (existing) {
    return res.status(409).json({ error: 'Já existe um agente para esta instância' });
  }

  const { data: agent, error } = await supabase
    .from('ai_agents')
    .insert({
      tenant_id: tenantId,
      instance_id: fullInstanceId,
      name,
      provider,
      model,
      system_prompt,
      temperature,
      max_tokens,
      max_history_msgs,
      rag_enabled,
      tools_enabled,
      followup_enabled,
      business_hours_enabled,
      out_of_hours_message,
      status: 'draft',
    })
    .select('*')
    .single();

  if (error || !agent) {
    logger.error('[AGENTS] Create failed', { error: error?.message, tenantId });
    return res.status(500).json({ error: 'Erro ao criar agente' });
  }

  logger.info('[AGENTS] Agent created', {
    event: 'agents.created',
    agentId: agent.id,
    tenantId,
    instanceId: fullInstanceId,
  });

  return res.status(201).json({ agent });
});

// ─────────────────────────────────────────────
// GET /api/agents — list
// ─────────────────────────────────────────────

agentsRouter.get('/', async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(400).json({ error: 'Tenant ID ausente' });

  const { status, instance_id } = req.query;
  const limit = Math.min(Number(req.query.limit) || 20, 100);

  const supabase = getSupabaseClient();

  let query = supabase
    .from('ai_agents')
    .select('id, name, provider, model, status, instance_id, rag_enabled, tools_enabled, followup_enabled, created_at, updated_at')
    .eq('tenant_id', tenantId)
    .not('status', 'eq', 'deleted')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (status) query = query.eq('status', status as string);
  if (instance_id) query = query.eq('instance_id', `${tenantId}-${instance_id}`);

  const { data, error } = await query;

  if (error) {
    return res.status(500).json({ error: 'Erro ao listar agentes' });
  }

  return res.json({ agents: data ?? [] });
});

// ─────────────────────────────────────────────
// GET /api/agents/:id — detail with counts
// ─────────────────────────────────────────────

agentsRouter.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(400).json({ error: 'Tenant ID ausente' });
  const { id } = req.params;

  const supabase = getSupabaseClient();

  const { data: agent, error } = await supabase
    .from('ai_agents')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .not('status', 'eq', 'deleted')
    .single();

  if (error || !agent) return res.status(404).json({ error: 'Agente não encontrado' });

  const [{ count: docCount }, { count: toolCount }, { count: convCount }] = await Promise.all([
    supabase
      .from('ai_documents')
      .select('id', { count: 'exact', head: true })
      .eq('agent_id', id),
    supabase
      .from('ai_custom_tools')
      .select('id', { count: 'exact', head: true })
      .eq('agent_id', id)
      .eq('enabled', true),
    supabase
      .from('ai_conversations')
      .select('id', { count: 'exact', head: true })
      .eq('agent_id', id)
      .eq('tenant_id', tenantId),
  ]);

  return res.json({
    agent,
    counts: {
      documents: docCount ?? 0,
      tools: toolCount ?? 0,
      conversations: convCount ?? 0,
    },
  });
});

// ─────────────────────────────────────────────
// PATCH /api/agents/:id — update
// ─────────────────────────────────────────────

agentsRouter.patch('/:id', async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(400).json({ error: 'Tenant ID ausente' });
  const { id } = req.params;

  const allowed = [
    'name', 'provider', 'model', 'system_prompt', 'temperature', 'max_tokens',
    'max_history_msgs', 'rag_enabled', 'tools_enabled', 'followup_enabled',
    'business_hours_enabled', 'out_of_hours_message', 'summarize_after_tokens',
    'followup_message',
  ];

  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in req.body) updates[key] = req.body[key];
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Nenhum campo válido para atualizar' });
  }

  const supabase = getSupabaseClient();

  const { data: agent, error } = await supabase
    .from('ai_agents')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .not('status', 'eq', 'deleted')
    .select('*')
    .single();

  if (error || !agent) {
    return res.status(404).json({ error: 'Agente não encontrado ou erro ao atualizar' });
  }

  return res.json({ agent });
});

// ─────────────────────────────────────────────
// DELETE /api/agents/:id — only if draft
// ─────────────────────────────────────────────

agentsRouter.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(400).json({ error: 'Tenant ID ausente' });
  const { id } = req.params;

  const supabase = getSupabaseClient();

  const { data: agent } = await supabase
    .from('ai_agents')
    .select('id, status')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .single();

  if (!agent) return res.status(404).json({ error: 'Agente não encontrado' });

  if (agent.status !== 'draft') {
    return res.status(409).json({
      error: `Só é possível deletar agentes em status draft (atual: ${agent.status})`,
    });
  }

  await supabase.from('ai_agents').update({ status: 'deleted' }).eq('id', id);

  return res.json({ ok: true });
});

// ─────────────────────────────────────────────
// POST /api/agents/:id/activate
// ─────────────────────────────────────────────

agentsRouter.post('/:id/activate', async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(400).json({ error: 'Tenant ID ausente' });
  const { id } = req.params;

  const supabase = getSupabaseClient();

  const { data: agent } = await supabase
    .from('ai_agents')
    .select('id, status, instance_id, provider')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .single();

  if (!agent) return res.status(404).json({ error: 'Agente não encontrado' });

  if (agent.status !== 'draft' && agent.status !== 'paused') {
    return res.status(409).json({ error: `Não é possível ativar agente com status '${agent.status}'` });
  }

  // Validate instance is connected
  const connStatus = getConnectionStatus(agent.instance_id);
  if (connStatus !== 'ONLINE') {
    return res.status(422).json({
      error: `Instância '${agent.instance_id}' não está conectada (status: ${connStatus}). Conecte antes de ativar o agente.`,
    });
  }

  // Validate AI key exists
  const keyRecord = await getDecryptedKey(supabase, tenantId, agent.provider);
  if (!keyRecord) {
    return res.status(422).json({
      error: `Nenhuma API key configurada para provider '${agent.provider}'. Configure em /api/settings/ai-keys.`,
    });
  }

  await supabase
    .from('ai_agents')
    .update({ status: 'active', activated_at: new Date().toISOString() })
    .eq('id', id);

  logger.info('[AGENTS] Agent activated', { event: 'agents.activated', agentId: id, tenantId });

  return res.json({ ok: true, status: 'active' });
});

// ─────────────────────────────────────────────
// POST /api/agents/:id/pause
// ─────────────────────────────────────────────

agentsRouter.post('/:id/pause', async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(400).json({ error: 'Tenant ID ausente' });
  const { id } = req.params;

  const supabase = getSupabaseClient();

  const { data: agent } = await supabase
    .from('ai_agents')
    .select('id, status')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .single();

  if (!agent) return res.status(404).json({ error: 'Agente não encontrado' });

  if (agent.status !== 'active') {
    return res.status(409).json({ error: `Agente não está ativo (status: ${agent.status})` });
  }

  await supabase.from('ai_agents').update({ status: 'paused' }).eq('id', id);

  return res.json({ ok: true, status: 'paused' });
});

// ─────────────────────────────────────────────
// POST /api/agents/:id/playground — test without sending to WhatsApp
// ─────────────────────────────────────────────

agentsRouter.post('/:id/playground', async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(400).json({ error: 'Tenant ID ausente' });
  const { id } = req.params;
  const { message, contact_phone = '+5511999999999' } = req.body;

  if (!message) return res.status(400).json({ error: 'message é obrigatório' });

  const supabase = getSupabaseClient();

  const { data: agent } = await supabase
    .from('ai_agents')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .not('status', 'eq', 'deleted')
    .single();

  if (!agent) return res.status(404).json({ error: 'Agente não encontrado' });

  const keyRecord = await getDecryptedKey(supabase, tenantId, agent.provider);
  if (!keyRecord) {
    return res.status(422).json({ error: 'Nenhuma API key configurada para este provider' });
  }

  const startTime = Date.now();
  const ragHits: Array<{ content: string; similarity: number }> = [];

  // RAG fetch if enabled
  let ragContext = '';
  if (agent.rag_enabled) {
    const embResp = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${keyRecord.api_key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: message,
        dimensions: 1536,
      }),
    });

    if (embResp.ok) {
      const embData = await embResp.json() as { data: Array<{ embedding: number[] }> };
      const embedding = embData.data?.[0]?.embedding;

      if (embedding) {
        const { data: chunks } = await supabase.rpc('match_ai_documents', {
          p_agent_id: id,
          p_query_embedding: embedding,
          p_top_k: 5,
        });

        if (chunks && chunks.length > 0) {
          ragHits.push(...(chunks as Array<{ content: string; similarity: number }>));
          ragContext = '\n\n--- Contexto da base de conhecimento ---\n' +
            ragHits.map((c, i) => `[${i + 1}]: ${c.content}`).join('\n\n') +
            '\n--- Fim do contexto ---';
        }
      }
    }
  }

  const model = buildModel(agent.provider, agent.model, keyRecord.api_key);

  let response: string;
  let tokensIn = 0;
  let tokensOut = 0;
  const toolsCalled: string[] = [];

  try {
    const result = await generateText({
      model,
      system: agent.system_prompt + ragContext,
      messages: [{ role: 'user', content: message }],
      temperature: agent.temperature ?? 0.7,
      maxTokens: agent.max_tokens ?? 1000,
    });

    response = result.text;
    tokensIn = result.usage?.promptTokens ?? 0;
    tokensOut = result.usage?.completionTokens ?? 0;
  } catch (err: any) {
    return res.status(502).json({ error: `LLM call failed: ${err.message}` });
  }

  const latencyMs = Date.now() - startTime;

  // Create ephemeral conversation record (playground phone marker)
  const playgroundPhone = `+playground-${id}`;
  await supabase.from('ai_conversations').upsert(
    {
      agent_id: id,
      tenant_id: tenantId,
      contact_phone: playgroundPhone,
      history_messages: [
        { role: 'user', content: message, created_at: new Date().toISOString() },
        { role: 'assistant', content: response, created_at: new Date().toISOString() },
      ],
      status: 'playground',
      last_response_at: new Date().toISOString(),
    },
    { onConflict: 'agent_id,contact_phone' },
  );

  return res.json({
    response,
    rag_hits: ragHits.map((h) => ({ content: h.content.slice(0, 200), similarity: h.similarity })),
    tools_called: toolsCalled,
    tokens: { input: tokensIn, output: tokensOut },
    latency_ms: latencyMs,
  });
});
