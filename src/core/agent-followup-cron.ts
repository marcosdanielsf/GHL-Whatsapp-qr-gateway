/**
 * agent-followup-cron.ts — F8 follow-up scheduler
 *
 * Roda a cada 5 minutos. Verifica ai_followup_queue e envia nudge
 * se o contato não respondeu após check_at.
 */

import { getSupabaseClient } from '../infra/supabaseClient';
import { handleInboundMessage } from './agent-runtime';
import { logger } from '../utils/logger';

let cronHandle: NodeJS.Timeout | null = null;

interface FollowupRow {
  id: string;
  agent_id: string;
  conversation_id: string;
  tenant_id: string;
  check_at: string;
  sent: boolean;
  cancelled: boolean;
}

interface ConversationRow {
  id: string;
  contact_phone: string;
  last_response_at: string | null;
  agent_id: string;
  status: string;
}

interface AgentRow {
  id: string;
  instance_id: string;
  followup_message: string | null;
}

async function runFollowupCheck(): Promise<void> {
  const supabase = getSupabaseClient();

  const now = new Date().toISOString();

  const { data: due, error } = await supabase
    .from('ai_followup_queue')
    .select('*')
    .lte('check_at', now)
    .eq('sent', false)
    .eq('cancelled', false)
    .limit(50);

  if (error) {
    logger.error('[FOLLOWUP-CRON] Query error', { error: error.message });
    return;
  }

  if (!due || due.length === 0) return;

  logger.info('[FOLLOWUP-CRON] Processing due follow-ups', { count: due.length });

  for (const row of due as FollowupRow[]) {
    try {
      // Load conversation to check if user replied after check_at
      const { data: conv } = await supabase
        .from('ai_conversations')
        .select('id, contact_phone, last_response_at, agent_id, status')
        .eq('id', row.conversation_id)
        .single();

      if (!conv) {
        // Conversation gone — cancel
        await supabase.from('ai_followup_queue').update({ cancelled: true }).eq('id', row.id);
        continue;
      }

      const convTyped = conv as ConversationRow;

      // If human replied after the follow-up was scheduled — cancel
      if (convTyped.last_response_at && convTyped.last_response_at > row.check_at) {
        await supabase.from('ai_followup_queue').update({ cancelled: true }).eq('id', row.id);
        continue;
      }

      // If conversation was taken over — cancel
      if (convTyped.status === 'taken_over') {
        await supabase.from('ai_followup_queue').update({ cancelled: true }).eq('id', row.id);
        continue;
      }

      // Load agent to get instance_id
      const { data: agent } = await supabase
        .from('ai_agents')
        .select('id, instance_id, followup_message')
        .eq('id', row.agent_id)
        .eq('status', 'active')
        .single();

      if (!agent) {
        await supabase.from('ai_followup_queue').update({ cancelled: true }).eq('id', row.id);
        continue;
      }

      const agentTyped = agent as AgentRow;

      // Extract instanceName from instance_id (format: {tenantId}-{instanceName})
      const instanceName = agentTyped.instance_id.replace(`${row.tenant_id}-`, '');

      const nudgeText =
        agentTyped.followup_message ||
        'Olá! Só passando para ver se posso ajudar com mais alguma coisa. 😊';

      // Send via agent runtime (processes as if it's an inbound from the contact)
      // We use a synthetic inbound to leverage the full agent pipeline
      const result = await handleInboundMessage({
        tenantId: row.tenant_id,
        instanceName,
        fromPhone: convTyped.contact_phone,
        text: `__followup__: ${nudgeText}`,
        timestamp: Math.floor(Date.now() / 1000),
      });

      if (result === 'agent-replied') {
        await supabase.from('ai_followup_queue').update({ sent: true }).eq('id', row.id);

        logger.info('[FOLLOWUP-CRON] Follow-up sent', {
          event: 'followup.sent',
          followupId: row.id,
          conversationId: row.conversation_id,
          contact: convTyped.contact_phone,
        });
      } else {
        // Agent not active anymore — cancel
        await supabase.from('ai_followup_queue').update({ cancelled: true }).eq('id', row.id);
      }
    } catch (err: any) {
      logger.error('[FOLLOWUP-CRON] Error processing row', {
        followupId: row.id,
        error: err.message,
      });
      // Don't mark as sent or cancelled — will retry on next cron run
    }
  }
}

export function startAgentFollowupCron(): void {
  if (cronHandle) return;

  const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

  // Run immediately on start, then every 5 min
  runFollowupCheck().catch((err) =>
    logger.error('[FOLLOWUP-CRON] Initial run error', { error: err.message }),
  );

  cronHandle = setInterval(() => {
    runFollowupCheck().catch((err) =>
      logger.error('[FOLLOWUP-CRON] Cron run error', { error: err.message }),
    );
  }, INTERVAL_MS);

  logger.info('[FOLLOWUP-CRON] Follow-up cron started', {
    event: 'followup.cron.started',
    interval_ms: INTERVAL_MS,
  });
}

export function stopAgentFollowupCron(): void {
  if (cronHandle) {
    clearInterval(cronHandle);
    cronHandle = null;
    logger.info('[FOLLOWUP-CRON] Cron stopped', { event: 'followup.cron.stopped' });
  }
}
