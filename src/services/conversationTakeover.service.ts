/**
 * Auto-takeover service.
 *
 * When the human answers a lead through the native WhatsApp app on the same
 * chip, the AI conversation must pause so the agent stops auto-replying.
 *
 * triggerAutoTakeover() is called by the Baileys handler whenever a fromMe
 * event arrives whose message id is NOT in the sentMessageTracker (i.e. it
 * did not come from the Nexus API). It marks the matching `ai_conversations`
 * row as `taken_over` and cancels pending follow-ups, mirroring what the
 * manual `/api/agents/:id/conversations/:conv_id/takeover` endpoint does.
 */

import { getSupabaseClient } from '../infra/supabaseClient';
import { logger } from '../utils/logger';

const UUID_PREFIX_RE =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(.+)$/i;

export type TakeoverSource = 'manual_button' | 'inline_send' | 'native_app';

export interface AutoTakeoverResult {
  triggered: boolean;
  reason?: 'no_active_conversation' | 'instance_not_found' | 'invalid_instance_id';
  conversationId?: string;
  agentId?: string;
}

export async function triggerAutoTakeover(
  scopedInstanceId: string,
  contactPhone: string,
  source: TakeoverSource = 'native_app',
  takenOverBy: string | null = null,
): Promise<AutoTakeoverResult> {
  const m = scopedInstanceId.match(UUID_PREFIX_RE);
  if (!m) {
    return { triggered: false, reason: 'invalid_instance_id' };
  }
  const tenantId = m[1];
  const instanceName = m[2];

  const supabase = getSupabaseClient();

  // Ensure we are looking at a real instance the tenant owns.
  const { data: instance } = await supabase
    .from('ghl_wa_instances')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('name', instanceName)
    .maybeSingle();

  if (!instance) {
    return { triggered: false, reason: 'instance_not_found' };
  }

  // Find an active AI conversation for this tenant + contact_phone.
  // contact_phone matches whatever the agent runtime stored — usually the
  // normalized phone from jidToNormalizedNumber().
  const { data: conv } = await supabase
    .from('ai_conversations')
    .select('id, ai_agent_id, status')
    .eq('tenant_id', tenantId)
    .eq('contact_phone', contactPhone)
    .eq('status', 'active')
    .maybeSingle();

  if (!conv) {
    return { triggered: false, reason: 'no_active_conversation' };
  }

  const { error: updateError } = await supabase
    .from('ai_conversations')
    .update({
      status: 'taken_over',
      taken_over_at: new Date().toISOString(),
      taken_over_source: source,
      taken_over_by: takenOverBy,
    })
    .eq('id', conv.id);

  if (updateError) {
    logger.error('[auto-takeover] failed to update conversation', {
      conversationId: conv.id,
      error: updateError.message,
    });
    return { triggered: false };
  }

  // Cancel pending follow-ups so the agent does not nudge after the human
  // already answered.
  await supabase
    .from('ai_followup_queue')
    .update({ cancelled: true })
    .eq('conversation_id', conv.id)
    .eq('sent', false);

  logger.info('[takeover] conversation paused', {
    event: 'agent_conv.takeover',
    source,
    conversationId: conv.id,
    agentId: conv.ai_agent_id,
    tenantId,
    instanceName,
    contactPhone,
  });

  return {
    triggered: true,
    conversationId: conv.id,
    agentId: conv.ai_agent_id,
  };
}
