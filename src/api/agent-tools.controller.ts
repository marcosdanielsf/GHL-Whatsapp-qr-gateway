/**
 * agent-tools.controller.ts — F8 custom tools CRUD + circuit breaker reset
 */

import { Router, Response } from 'express';
import { getSupabaseClient } from '../infra/supabaseClient';
import { AuthenticatedRequest } from '../middleware/auth';
import { logger } from '../utils/logger';

export const agentToolsRouter = Router({ mergeParams: true });

const TOOLS_HARD_LIMIT = 10;

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

async function assertAgentOwnership(
  supabase: ReturnType<typeof getSupabaseClient>,
  agentId: string,
  tenantId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('ai_agents')
    .select('id')
    .eq('id', agentId)
    .eq('tenant_id', tenantId)
    .not('status', 'eq', 'deleted')
    .single();
  return !!data;
}

function validateJsonSchema(schema: unknown): { valid: boolean; error?: string } {
  if (typeof schema !== 'object' || schema === null) {
    return { valid: false, error: 'parameters_schema deve ser um objeto JSON Schema válido' };
  }
  const s = schema as Record<string, unknown>;
  if (s.type !== 'object') {
    return { valid: false, error: 'parameters_schema.type deve ser "object"' };
  }
  if (typeof s.properties !== 'object') {
    return { valid: false, error: 'parameters_schema.properties é obrigatório' };
  }
  return { valid: true };
}

// ─────────────────────────────────────────────
// POST /api/agents/:id/tools
// ─────────────────────────────────────────────

agentToolsRouter.post('/:id/tools', async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(400).json({ error: 'Tenant ID ausente' });
  const { id: agentId } = req.params;

  const {
    name,
    description,
    parameters_schema,
    webhook_url,
    webhook_secret,
    timeout_ms = 8000,
  } = req.body;

  if (!name || !description || !parameters_schema || !webhook_url) {
    return res.status(400).json({
      error: 'name, description, parameters_schema e webhook_url são obrigatórios',
    });
  }

  const schemaValidation = validateJsonSchema(parameters_schema);
  if (!schemaValidation.valid) {
    return res.status(422).json({ error: schemaValidation.error });
  }

  // Validate tool name (alphanumeric + underscore, no spaces)
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(name)) {
    return res.status(422).json({
      error: 'Tool name deve começar com letra minúscula e conter apenas letras, números e underscores (máx 64 chars)',
    });
  }

  const supabase = getSupabaseClient();

  if (!(await assertAgentOwnership(supabase, agentId, tenantId))) {
    return res.status(404).json({ error: 'Agente não encontrado' });
  }

  // Check hard limit
  const { count } = await supabase
    .from('ai_custom_tools')
    .select('id', { count: 'exact', head: true })
    .eq('agent_id', agentId)
    .eq('enabled', true);

  if ((count ?? 0) >= TOOLS_HARD_LIMIT) {
    return res.status(409).json({
      error: `Limite de ${TOOLS_HARD_LIMIT} tools por agente atingido. Desative uma tool antes de adicionar nova.`,
    });
  }

  const { data: newTool, error } = await supabase
    .from('ai_custom_tools')
    .insert({
      agent_id: agentId,
      tenant_id: tenantId,
      name,
      description,
      parameters_schema,
      webhook_url,
      webhook_secret: webhook_secret ?? null,
      timeout_ms,
      circuit_breaker_failures: 0,
      enabled: true,
    })
    .select('*')
    .single();

  if (error || !newTool) {
    logger.error('[AGENT-TOOLS] Create failed', { error: error?.message });
    return res.status(500).json({ error: 'Erro ao criar tool' });
  }

  return res.status(201).json({ tool: newTool });
});

// ─────────────────────────────────────────────
// GET /api/agents/:id/tools
// ─────────────────────────────────────────────

agentToolsRouter.get('/:id/tools', async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(400).json({ error: 'Tenant ID ausente' });
  const { id: agentId } = req.params;

  const supabase = getSupabaseClient();

  if (!(await assertAgentOwnership(supabase, agentId, tenantId))) {
    return res.status(404).json({ error: 'Agente não encontrado' });
  }

  const { data, error } = await supabase
    .from('ai_custom_tools')
    .select('id, name, description, parameters_schema, webhook_url, timeout_ms, circuit_breaker_failures, enabled, created_at')
    .eq('agent_id', agentId)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true });

  if (error) return res.status(500).json({ error: 'Erro ao listar tools' });

  return res.json({ tools: data ?? [] });
});

// ─────────────────────────────────────────────
// PATCH /api/agents/:id/tools/:tool_id
// ─────────────────────────────────────────────

agentToolsRouter.patch('/:id/tools/:tool_id', async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(400).json({ error: 'Tenant ID ausente' });
  const { id: agentId, tool_id } = req.params;

  const supabase = getSupabaseClient();

  const { data: tool } = await supabase
    .from('ai_custom_tools')
    .select('id')
    .eq('id', tool_id)
    .eq('agent_id', agentId)
    .eq('tenant_id', tenantId)
    .single();

  if (!tool) return res.status(404).json({ error: 'Tool não encontrada' });

  const allowed = ['name', 'description', 'parameters_schema', 'webhook_url', 'webhook_secret', 'timeout_ms', 'enabled'];
  const updates: Record<string, unknown> = {};

  for (const key of allowed) {
    if (key in req.body) updates[key] = req.body[key];
  }

  if (updates.parameters_schema) {
    const v = validateJsonSchema(updates.parameters_schema);
    if (!v.valid) return res.status(422).json({ error: v.error });
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Nenhum campo válido para atualizar' });
  }

  const { data: updated, error } = await supabase
    .from('ai_custom_tools')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', tool_id)
    .select('*')
    .single();

  if (error) return res.status(500).json({ error: 'Erro ao atualizar tool' });

  return res.json({ tool: updated });
});

// ─────────────────────────────────────────────
// DELETE /api/agents/:id/tools/:tool_id
// ─────────────────────────────────────────────

agentToolsRouter.delete('/:id/tools/:tool_id', async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(400).json({ error: 'Tenant ID ausente' });
  const { id: agentId, tool_id } = req.params;

  const supabase = getSupabaseClient();

  const { data: tool } = await supabase
    .from('ai_custom_tools')
    .select('id')
    .eq('id', tool_id)
    .eq('agent_id', agentId)
    .eq('tenant_id', tenantId)
    .single();

  if (!tool) return res.status(404).json({ error: 'Tool não encontrada' });

  await supabase.from('ai_custom_tools').delete().eq('id', tool_id);

  return res.json({ ok: true });
});

// ─────────────────────────────────────────────
// POST /api/agents/:id/tools/:tool_id/reset-breaker
// ─────────────────────────────────────────────

agentToolsRouter.post(
  '/:id/tools/:tool_id/reset-breaker',
  async (req: AuthenticatedRequest, res: Response) => {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(400).json({ error: 'Tenant ID ausente' });
    const { id: agentId, tool_id } = req.params;

    const supabase = getSupabaseClient();

    const { data: tool } = await supabase
      .from('ai_custom_tools')
      .select('id, circuit_breaker_failures')
      .eq('id', tool_id)
      .eq('agent_id', agentId)
      .eq('tenant_id', tenantId)
      .single();

    if (!tool) return res.status(404).json({ error: 'Tool não encontrada' });

    const { error } = await supabase.rpc('reset_circuit_breaker', { p_tool_id: tool_id });

    if (error) {
      logger.error('[AGENT-TOOLS] reset_circuit_breaker RPC failed', { error: error.message });
      return res.status(500).json({ error: 'Erro ao resetar circuit breaker' });
    }

    logger.info('[AGENT-TOOLS] Circuit breaker reset', {
      event: 'agents.tools.breaker_reset',
      toolId: tool_id,
      tenantId,
      previousFailures: tool.circuit_breaker_failures,
    });

    return res.json({ ok: true, previous_failures: tool.circuit_breaker_failures });
  },
);
