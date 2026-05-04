/**
 * agent-conversations.controller.ts — F8
 * Monitoring, detail, SSE stream, takeover
 */

import { Router, Response } from 'express';
import { getSupabaseClient } from '../infra/supabaseClient';
import { AuthenticatedRequest } from '../middleware/auth';
import { logger } from '../utils/logger';

export const agentConversationsRouter = Router({ mergeParams: true });

// ─────────────────────────────────────────────
// Ownership helper
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

// ─────────────────────────────────────────────
// GET /api/agents/:id/conversations
// ─────────────────────────────────────────────

agentConversationsRouter.get('/:id/conversations', async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(400).json({ error: 'Tenant ID ausente' });
  const { id: agentId } = req.params;

  const status = req.query.status as string | undefined;
  const limit = Math.min(Number(req.query.limit) || 50, 200);

  const supabase = getSupabaseClient();

  if (!(await assertAgentOwnership(supabase, agentId, tenantId))) {
    return res.status(404).json({ error: 'Agente não encontrado' });
  }

  let query = supabase
    .from('ai_conversations')
    .select(
      'id, contact_phone, contact_name, status, total_tokens_input, total_tokens_output, last_response_at, last_message_at, created_at',
    )
    .eq('ai_agent_id', agentId)
    .eq('tenant_id', tenantId)
    .order('last_response_at', { ascending: false, nullsFirst: false })
    .limit(limit);

  if (status) query = query.eq('status', status);

  const { data, error } = await query;

  if (error) return res.status(500).json({ error: 'Erro ao listar conversas' });

  return res.json({ conversations: data ?? [] });
});

// ─────────────────────────────────────────────
// GET /api/agents/:id/conversations/:conv_id
// ─────────────────────────────────────────────

agentConversationsRouter.get(
  '/:id/conversations/:conv_id',
  async (req: AuthenticatedRequest, res: Response) => {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(400).json({ error: 'Tenant ID ausente' });
    const { id: agentId, conv_id } = req.params;

    const supabase = getSupabaseClient();

    const { data: conv, error } = await supabase
      .from('ai_conversations')
      .select('*')
      .eq('id', conv_id)
      .eq('ai_agent_id', agentId)
      .eq('tenant_id', tenantId)
      .single();

    if (error || !conv) return res.status(404).json({ error: 'Conversa não encontrada' });

    return res.json({ conversation: conv });
  },
);

// ─────────────────────────────────────────────
// GET /api/agents/:id/conversations/:conv_id/stream — SSE (2s polling)
// ─────────────────────────────────────────────

agentConversationsRouter.get(
  '/:id/conversations/:conv_id/stream',
  async (req: AuthenticatedRequest, res: Response) => {
    const tenantId = req.tenantId;
    if (!tenantId) {
      res.status(400).json({ error: 'Tenant ID ausente' });
      return;
    }
    const { id: agentId, conv_id } = req.params;

    const supabase = getSupabaseClient();

    // Verify ownership before streaming
    const { data: conv } = await supabase
      .from('ai_conversations')
      .select('id')
      .eq('id', conv_id)
      .eq('ai_agent_id', agentId)
      .eq('tenant_id', tenantId)
      .single();

    if (!conv) {
      res.status(404).json({ error: 'Conversa não encontrada' });
      return;
    }

    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const send = (data: object) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    let closed = false;

    const interval = setInterval(async () => {
      if (closed) return;

      const { data: latest } = await supabase
        .from('ai_conversations')
        .select('status, total_tokens_input, total_tokens_output, last_response_at, history_messages')
        .eq('id', conv_id)
        .single();

      if (!latest) {
        clearInterval(interval);
        res.end();
        return;
      }

      const history = (latest.history_messages as Array<{ role: string; created_at: string }>) ?? [];
      const lastMessage = history[history.length - 1];

      send({
        status: latest.status,
        total_tokens: (latest.total_tokens_input ?? 0) + (latest.total_tokens_output ?? 0),
        last_response_at: latest.last_response_at,
        message_count: history.length,
        last_message_role: lastMessage?.role ?? null,
        last_message_at: lastMessage?.created_at ?? null,
      });

      if (['taken_over', 'closed'].includes(latest.status)) {
        clearInterval(interval);
        res.end();
      }
    }, 2000);

    req.on('close', () => {
      closed = true;
      clearInterval(interval);
    });
  },
);

// ─────────────────────────────────────────────
// POST /api/agents/:id/conversations/:conv_id/takeover
// Pausa IA para essa conversa — humano assume
// ─────────────────────────────────────────────

agentConversationsRouter.post(
  '/:id/conversations/:conv_id/takeover',
  async (req: AuthenticatedRequest, res: Response) => {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(400).json({ error: 'Tenant ID ausente' });
    const { id: agentId, conv_id } = req.params;

    const supabase = getSupabaseClient();

    const { data: conv } = await supabase
      .from('ai_conversations')
      .select('id, status')
      .eq('id', conv_id)
      .eq('ai_agent_id', agentId)
      .eq('tenant_id', tenantId)
      .single();

    if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });

    if (conv.status === 'taken_over') {
      return res.status(409).json({ error: 'Conversa já está em modo takeover' });
    }

    const { error } = await supabase
      .from('ai_conversations')
      .update({
        status: 'taken_over',
        taken_over_at: new Date().toISOString(),
        taken_over_by: req.user?.id ?? null,
        taken_over_source: 'manual_button',
      })
      .eq('id', conv_id);

    if (error) return res.status(500).json({ error: 'Erro ao registrar takeover' });

    // Cancel any pending follow-ups for this conversation
    await supabase
      .from('ai_followup_queue')
      .update({ cancelled: true })
      .eq('conversation_id', conv_id)
      .eq('sent', false);

    logger.info('[AGENT-CONV] Takeover registered', {
      event: 'agent_conv.takeover',
      conversationId: conv_id,
      agentId,
      tenantId,
      operatorId: req.user?.id,
    });

    return res.json({ ok: true, status: 'taken_over' });
  },
);
