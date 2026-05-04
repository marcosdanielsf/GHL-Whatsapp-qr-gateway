/**
 * agent-runtime.ts — F8 IA Inbox core
 *
 * Recebe mensagem inbound já decodificada do baileys.ts e decide:
 *  1. Se há agente ativo para o instanceId → processa
 *  2. Retorna 'agent-replied' se respondeu, null se passou adiante
 */

import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';
import { generateText, tool, LanguageModel } from 'ai';
import { z } from 'zod';
import crypto from 'crypto';
import { getSupabaseClient } from '../infra/supabaseClient';
import { getDecryptedKey } from './decrypt-ai-key';
import { sendTextMessage } from './baileys';
import { logger } from '../utils/logger';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface InboundMessageParams {
  tenantId: string;
  instanceName: string;
  fromPhone: string; // E.164 format, ex: "+5511999999999"
  text: string;
  timestamp: number; // unix seconds
}

interface AiAgent {
  id: string;
  tenant_id: string;
  instance_id: string;
  provider: string;
  model: string;
  system_prompt: string;
  temperature: number;
  max_tokens: number;
  max_history_msgs: number;
  rag_enabled: boolean;
  tools_enabled: boolean;
  followup_enabled: boolean;
  business_hours_enabled: boolean;
  out_of_hours_message: string | null;
  tools_max: number;
  summarize_after_tokens: number | null;
}

interface AiConversation {
  id: string;
  agent_id: string;
  contact_phone: string;
  history_messages: ConversationMessage[];
  history_summary: string | null;
  total_tokens_input: number;
  total_tokens_output: number;
  last_response_at: string | null;
  status: string;
}

interface ConversationMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_name?: string;
  created_at: string;
}

interface BusinessHours {
  timezone: string;
  schedule: Record<string, { start: string; end: string } | null>;
  holidays: string[];
  out_of_hours_action: 'silent' | 'respond' | 'queue';
}

interface CustomTool {
  id: string;
  name: string;
  description: string;
  parameters_schema: Record<string, unknown>;
  webhook_url: string;
  webhook_secret: string | null;
  timeout_ms: number;
  circuit_breaker_failures: number;
  enabled: boolean;
}

// ─────────────────────────────────────────────
// Provider factory
// ─────────────────────────────────────────────

function buildModel(provider: string, model: string, apiKey: string): LanguageModel {
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
      // Fallback to openai-compatible
      return createOpenAI({ apiKey })(model);
  }
}

// ─────────────────────────────────────────────
// Business hours check
// ─────────────────────────────────────────────

function isWithinBusinessHours(bh: BusinessHours): boolean {
  const now = new Date();
  const tz = bh.timezone || 'America/Sao_Paulo';

  // Get current day and time in tenant's timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const weekday = parts.find((p) => p.type === 'weekday')?.value?.toLowerCase() ?? '';
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
  const currentMinutes = hour * 60 + minute;

  // Check holidays
  const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
  if (bh.holidays?.includes(dateStr)) return false;

  // Map weekday abbreviation to schedule key
  const dayMap: Record<string, string> = {
    sun: 'sunday',
    mon: 'monday',
    tue: 'tuesday',
    wed: 'wednesday',
    thu: 'thursday',
    fri: 'friday',
    sat: 'saturday',
  };
  const dayKey = dayMap[weekday] ?? weekday;
  const slot = bh.schedule?.[dayKey];
  if (!slot) return false; // day not configured = closed

  const [startH, startM] = slot.start.split(':').map(Number);
  const [endH, endM] = slot.end.split(':').map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}

// ─────────────────────────────────────────────
// RAG embedding + retrieval
// ─────────────────────────────────────────────

async function fetchRagContext(
  agentId: string,
  text: string,
  apiKey: string,
): Promise<string> {
  try {
    const openai = createOpenAI({ apiKey });
    // Use openai embeddings via raw fetch (Vercel AI SDK doesn't expose embed directly in all versions)
    const resp = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text,
        dimensions: 1536,
      }),
    });

    if (!resp.ok) {
      logger.warn('[AGENT-RUNTIME] Embedding request failed', { status: resp.status });
      return '';
    }

    const embData = await resp.json() as { data: Array<{ embedding: number[] }> };
    const embedding = embData.data?.[0]?.embedding;
    if (!embedding) return '';

    const supabase = getSupabaseClient();
    const { data: chunks, error } = await supabase.rpc('match_ai_documents', {
      p_agent_id: agentId,
      p_query_embedding: embedding,
      p_top_k: 5,
    });

    if (error || !chunks || chunks.length === 0) return '';

    const ragText = (chunks as Array<{ content: string; similarity: number }>)
      .map((c, i) => `[Contexto ${i + 1}]: ${c.content}`)
      .join('\n\n');

    return `\n\n--- Contexto relevante da base de conhecimento ---\n${ragText}\n--- Fim do contexto ---`;
  } catch (err: any) {
    logger.warn('[AGENT-RUNTIME] RAG fetch error', { error: err.message });
    return '';
  }
}

// ─────────────────────────────────────────────
// Tool webhook call with circuit breaker
// ─────────────────────────────────────────────

async function callToolWebhook(
  customTool: CustomTool,
  args: Record<string, unknown>,
): Promise<{ result: unknown; ok: boolean }> {
  const supabase = getSupabaseClient();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), customTool.timeout_ms || 8000);

  try {
    const body = JSON.stringify(args);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (customTool.webhook_secret) {
      const sig = crypto
        .createHmac('sha256', customTool.webhook_secret)
        .update(body)
        .digest('hex');
      headers['x-signature'] = `sha256=${sig}`;
    }

    const resp = await fetch(customTool.webhook_url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!resp.ok) {
      throw new Error(`Tool webhook HTTP ${resp.status}`);
    }

    const result = await resp.json();

    // Reset circuit breaker on success
    await supabase.rpc('reset_circuit_breaker', { p_tool_id: customTool.id });

    return { result, ok: true };
  } catch (err: any) {
    clearTimeout(timeoutId);
    logger.warn('[AGENT-RUNTIME] Tool webhook failed', {
      toolId: customTool.id,
      error: err.message,
    });

    // Increment circuit breaker
    await supabase.rpc('increment_circuit_breaker', { p_tool_id: customTool.id });

    return { result: { error: `Tool indisponível: ${err.message}` }, ok: false };
  }
}

// ─────────────────────────────────────────────
// Conversation history management
// ─────────────────────────────────────────────

function buildMessages(
  systemPrompt: string,
  ragContext: string,
  summary: string | null,
  history: ConversationMessage[],
) {
  const systemWithContext = ragContext
    ? `${systemPrompt}${ragContext}`
    : systemPrompt;

  const messages: Array<{ role: string; content: string }> = [];

  if (summary) {
    messages.push({
      role: 'user',
      content: `[Resumo da conversa anterior]: ${summary}`,
    });
    messages.push({
      role: 'assistant',
      content: 'Entendido. Continuando a conversa.',
    });
  }

  for (const msg of history) {
    messages.push({
      role: msg.role === 'tool' ? 'user' : msg.role,
      content: msg.role === 'tool'
        ? `[Resultado da ferramenta ${msg.tool_name}]: ${msg.content}`
        : msg.content,
    });
  }

  return { systemWithContext, messages };
}

// ─────────────────────────────────────────────
// Summarize when history is too long
// ─────────────────────────────────────────────

async function summarizeHistory(
  model: LanguageModel,
  history: ConversationMessage[],
): Promise<string> {
  const historyText = history
    .map((m) => `${m.role === 'user' ? 'Usuário' : 'Assistente'}: ${m.content}`)
    .join('\n');

  const { text } = await generateText({
    model,
    system: 'Você é um assistente que resume conversas de forma concisa. Preserve fatos importantes, preferências do usuário e pendências abertas.',
    prompt: `Resuma esta conversa em no máximo 3 parágrafos:\n\n${historyText}`,
    maxTokens: 500,
  });

  return text;
}

// ─────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────

export async function handleInboundMessage(
  params: InboundMessageParams,
): Promise<'agent-replied' | null> {
  const { tenantId, instanceName, fromPhone, text, timestamp } = params;
  const instanceId = `${tenantId}-${instanceName}`;

  const supabase = getSupabaseClient();

  // 1. Find active agent for this instance
  const { data: agent, error: agentErr } = await supabase
    .from('ai_agents')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('instance_id', instanceId)
    .eq('status', 'active')
    .single();

  if (agentErr || !agent) {
    return null; // No active agent — pass to normal GHL webhook flow
  }

  const agentTyped = agent as AiAgent;

  // 2. Decrypt AI key (BYO key from tenant_ai_keys, same as F3)
  const keyRecord = await getDecryptedKey(supabase, tenantId, agentTyped.provider);
  if (!keyRecord) {
    logger.warn('[AGENT-RUNTIME] No AI key for tenant', { tenantId, provider: agentTyped.provider });
    return null; // Can't process — let webhook through
  }

  // 3. Business hours check
  if (agentTyped.business_hours_enabled) {
    const { data: bh } = await supabase
      .from('ai_business_hours')
      .select('*')
      .eq('agent_id', agentTyped.id)
      .single();

    if (bh) {
      const bhTyped = bh as BusinessHours;
      const inHours = isWithinBusinessHours(bhTyped);

      if (!inHours) {
        if (bhTyped.out_of_hours_action === 'silent') {
          return null; // Silent — pass to GHL
        }
        if (bhTyped.out_of_hours_action === 'queue') {
          // Queue for next available slot — insert to followup queue with check_at = next opening
          // For now, treat as silent (complex scheduling out of scope here)
          return null;
        }
        // 'respond' falls through with optional custom message injected below
      }
    }
  }

  // 4. Find or create conversation
  let conversation: AiConversation;
  const { data: existingConv } = await supabase
    .from('ai_conversations')
    .select('*')
    .eq('agent_id', agentTyped.id)
    .eq('contact_phone', fromPhone)
    .eq('status', 'active')
    .single();

  if (existingConv) {
    conversation = existingConv as AiConversation;

    // Check if this conversation has been taken over by a human
    if ((existingConv as any).status === 'taken_over') {
      return null; // Human is handling — pass through
    }
  } else {
    const { data: newConv, error: convErr } = await supabase
      .from('ai_conversations')
      .insert({
        agent_id: agentTyped.id,
        tenant_id: tenantId,
        contact_phone: fromPhone,
        history_messages: [],
        history_summary: null,
        total_tokens_input: 0,
        total_tokens_output: 0,
        status: 'active',
      })
      .select('*')
      .single();

    if (convErr || !newConv) {
      logger.error('[AGENT-RUNTIME] Failed to create conversation', { error: convErr?.message });
      return null;
    }
    conversation = newConv as AiConversation;
  }

  // 5. RAG context if enabled
  let ragContext = '';
  if (agentTyped.rag_enabled) {
    ragContext = await fetchRagContext(agentTyped.id, text, keyRecord.api_key);
  }

  // 6. Build tools if enabled
  const toolsMap: Record<string, CustomTool> = {};
  const sdkTools: Record<string, ReturnType<typeof tool>> = {};

  if (agentTyped.tools_enabled) {
    const { data: customTools } = await supabase
      .from('ai_custom_tools')
      .select('*')
      .eq('agent_id', agentTyped.id)
      .eq('enabled', true)
      .lt('circuit_breaker_failures', 3)
      .limit(agentTyped.tools_max || 10);

    for (const ct of (customTools ?? []) as CustomTool[]) {
      toolsMap[ct.name] = ct;

      // Build zod schema from JSON schema (best-effort)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const zodShape: Record<string, z.ZodTypeAny> = {};
      const props = (ct.parameters_schema as any)?.properties ?? {};
      const required: string[] = (ct.parameters_schema as any)?.required ?? [];

      for (const [key, val] of Object.entries(props)) {
        const propSchema = val as { type?: string; description?: string };
        let zodType: z.ZodTypeAny =
          propSchema.type === 'number'
            ? z.number()
            : propSchema.type === 'boolean'
            ? z.boolean()
            : z.string();

        if (!required.includes(key)) {
          zodType = zodType.optional();
        }
        zodShape[key] = zodType;
      }

      sdkTools[ct.name] = tool({
        description: ct.description,
        parameters: z.object(zodShape),
        execute: async (args) => {
          const { result } = await callToolWebhook(ct, args as Record<string, unknown>);
          return result;
        },
      }) as any;
    }
  }

  // 7. Build message history
  const history = (conversation.history_messages ?? []) as ConversationMessage[];
  const lastN = history.slice(-(agentTyped.max_history_msgs || 20));

  const { systemWithContext, messages } = buildMessages(
    agentTyped.system_prompt,
    ragContext,
    conversation.history_summary,
    lastN,
  );

  // Append current user message
  messages.push({ role: 'user', content: text });

  // 8. Build model + call LLM
  const model = buildModel(agentTyped.provider, agentTyped.model, keyRecord.api_key);

  const startTime = Date.now();
  let llmResponse: Awaited<ReturnType<typeof generateText>>;

  try {
    llmResponse = await generateText({
      model,
      system: systemWithContext,
      messages: messages as Parameters<typeof generateText>[0]['messages'],
      tools: Object.keys(sdkTools).length > 0 ? sdkTools : undefined,
      maxSteps: 5,
      temperature: agentTyped.temperature ?? 0.7,
      maxTokens: agentTyped.max_tokens ?? 1000,
    });
  } catch (err: any) {
    logger.error('[AGENT-RUNTIME] LLM call failed', {
      agentId: agentTyped.id,
      tenantId,
      error: err.message,
    });
    return null; // Fallback to GHL webhook
  }

  const latencyMs = Date.now() - startTime;
  const responseText = llmResponse.text;

  if (!responseText) {
    logger.warn('[AGENT-RUNTIME] Empty LLM response', { agentId: agentTyped.id });
    return null;
  }

  // 9. Send via Baileys
  try {
    await sendTextMessage(instanceId, fromPhone, responseText);
  } catch (err: any) {
    logger.error('[AGENT-RUNTIME] Failed to send via Baileys', { error: err.message });
    return null; // Don't update conversation if send failed
  }

  // 10. Update conversation — append messages, increment tokens
  const newMessages: ConversationMessage[] = [
    ...history,
    {
      role: 'user',
      content: text,
      created_at: new Date(timestamp * 1000).toISOString(),
    },
    {
      role: 'assistant',
      content: responseText,
      created_at: new Date().toISOString(),
    },
  ];

  const tokensIn = llmResponse.usage?.promptTokens ?? 0;
  const tokensOut = llmResponse.usage?.completionTokens ?? 0;

  // Check if we need to summarize
  let summaryToSave = conversation.history_summary;
  let messagesToSave = newMessages;

  const totalTokens = (conversation.total_tokens_input + tokensIn) +
    (conversation.total_tokens_output + tokensOut);
  const summarizeThreshold = agentTyped.summarize_after_tokens ?? 8000;

  if (
    newMessages.length > (agentTyped.max_history_msgs || 20) ||
    totalTokens > summarizeThreshold
  ) {
    try {
      summaryToSave = await summarizeHistory(model, newMessages.slice(0, -4));
      messagesToSave = newMessages.slice(-4); // Keep last 4 messages after summarization
    } catch (err: any) {
      logger.warn('[AGENT-RUNTIME] Summarization failed', { error: err.message });
      // Keep full history on summarization failure
    }
  }

  // Atomic update: use RPC for token increment to avoid race condition
  // (two concurrent messages could both read stale counters if we do read-increment-write)
  const { error: updateErr } = await supabase.rpc('increment_conversation_tokens', {
    p_conversation_id: conversation.id,
    p_tokens_input: tokensIn,
    p_tokens_output: tokensOut,
    p_history_messages: messagesToSave,
    p_history_summary: summaryToSave,
  });

  // Fallback: if RPC doesn't exist yet, do plain update
  if (updateErr) {
    await supabase
      .from('ai_conversations')
      .update({
        history_messages: messagesToSave,
        history_summary: summaryToSave,
        total_tokens_input: (conversation.total_tokens_input ?? 0) + tokensIn,
        total_tokens_output: (conversation.total_tokens_output ?? 0) + tokensOut,
        last_response_at: new Date().toISOString(),
      })
      .eq('id', conversation.id);
  }

  // 11. Schedule follow-up if enabled
  if (agentTyped.followup_enabled) {
    const checkAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await supabase.from('ai_followup_queue').insert({
      agent_id: agentTyped.id,
      conversation_id: conversation.id,
      tenant_id: tenantId,
      check_at: checkAt,
      sent: false,
      cancelled: false,
    });
  }

  logger.info('[AGENT-RUNTIME] Message handled', {
    event: 'agent_runtime.handled',
    agentId: agentTyped.id,
    tenantId,
    instanceId,
    fromPhone,
    tokensIn,
    tokensOut,
    latencyMs,
  });

  return 'agent-replied';
}
