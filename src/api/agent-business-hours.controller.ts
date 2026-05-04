/**
 * agent-business-hours.controller.ts — F8
 * GET/PUT /api/agents/:id/business-hours
 */

import { Router, Response } from 'express';
import { getSupabaseClient } from '../infra/supabaseClient';
import { AuthenticatedRequest } from '../middleware/auth';

export const agentBusinessHoursRouter = Router({ mergeParams: true });

// ─────────────────────────────────────────────
// GET /api/agents/:id/business-hours
// ─────────────────────────────────────────────

agentBusinessHoursRouter.get('/:id/business-hours', async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(400).json({ error: 'Tenant ID ausente' });
  const { id: agentId } = req.params;

  const supabase = getSupabaseClient();

  // Verify ownership
  const { data: agent } = await supabase
    .from('ai_agents')
    .select('id')
    .eq('id', agentId)
    .eq('tenant_id', tenantId)
    .not('status', 'eq', 'deleted')
    .single();

  if (!agent) return res.status(404).json({ error: 'Agente não encontrado' });

  const { data: bh } = await supabase
    .from('ai_business_hours')
    .select('*')
    .eq('agent_id', agentId)
    .single();

  if (!bh) {
    return res.json({
      business_hours: null,
      message: 'Horário comercial não configurado. Agente responde 24/7 quando ativo.',
    });
  }

  return res.json({ business_hours: bh });
});

// ─────────────────────────────────────────────
// PUT /api/agents/:id/business-hours — upsert
// ─────────────────────────────────────────────

agentBusinessHoursRouter.put('/:id/business-hours', async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(400).json({ error: 'Tenant ID ausente' });
  const { id: agentId } = req.params;

  const {
    timezone = 'America/Sao_Paulo',
    schedule,
    holidays = [],
    out_of_hours_action = 'silent',
  } = req.body;

  if (!schedule || typeof schedule !== 'object') {
    return res.status(400).json({
      error: 'schedule é obrigatório. Formato: { "monday": { "start": "09:00", "end": "18:00" }, "tuesday": null, ... }',
    });
  }

  const validActions = ['silent', 'respond', 'queue'];
  if (!validActions.includes(out_of_hours_action)) {
    return res.status(422).json({
      error: `out_of_hours_action inválido. Use: ${validActions.join(', ')}`,
    });
  }

  const supabase = getSupabaseClient();

  // Verify ownership
  const { data: agent } = await supabase
    .from('ai_agents')
    .select('id')
    .eq('id', agentId)
    .eq('tenant_id', tenantId)
    .not('status', 'eq', 'deleted')
    .single();

  if (!agent) return res.status(404).json({ error: 'Agente não encontrado' });

  const { data: bh, error } = await supabase
    .from('ai_business_hours')
    .upsert(
      {
        agent_id: agentId,
        tenant_id: tenantId,
        timezone,
        schedule,
        holidays,
        out_of_hours_action,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'agent_id' },
    )
    .select('*')
    .single();

  if (error || !bh) {
    return res.status(500).json({ error: 'Erro ao salvar horário comercial' });
  }

  return res.json({ business_hours: bh });
});
