/**
 * Jarvis WhatsApp Service
 * Handles owner messages via Anthropic API + AI Factory memories
 * Zero new dependencies — uses native fetch
 */

import { logger } from '../utils/logger';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const RATE_LIMIT_MS = 2000;
const MAX_TOKENS = 512;
const MODEL = process.env.JARVIS_MODEL || 'claude-haiku-4-5-20251001';

// Rate limiting per phone
const lastMessageTime: Map<string, number> = new Map();

// Simple conversation buffer (last N exchanges per phone)
const conversationBuffer: Map<string, Array<{ role: 'user' | 'assistant'; content: string }>> = new Map();
const MAX_HISTORY = 10;

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/#{1,6}\s/g, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`(.*?)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
    .replace(/^[-*]\s/gm, '- ')
    .trim();
}

async function fetchMemories(): Promise<string> {
  const supabaseUrl = process.env.JARVIS_SUPABASE_URL;
  const supabaseKey = process.env.JARVIS_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) return '';

  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/jarvis_memories?select=content,category&order=updated_at.desc&limit=20`,
      {
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
        },
      }
    );

    if (!response.ok) return '';

    const memories = await response.json();
    if (!Array.isArray(memories) || memories.length === 0) return '';

    return memories
      .map((m: any) => `[${m.category || 'geral'}] ${m.content}`)
      .join('\n');
  } catch {
    return '';
  }
}

function getConversation(phone: string): Array<{ role: 'user' | 'assistant'; content: string }> {
  if (!conversationBuffer.has(phone)) {
    conversationBuffer.set(phone, []);
  }
  return conversationBuffer.get(phone)!;
}

function addToConversation(phone: string, role: 'user' | 'assistant', content: string): void {
  const history = getConversation(phone);
  history.push({ role, content });
  if (history.length > MAX_HISTORY * 2) {
    history.splice(0, 2);
  }
}

export async function handleJarvisMessage(phone: string, text: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }

  // Rate limiting
  const now = Date.now();
  const lastTime = lastMessageTime.get(phone) || 0;
  if (now - lastTime < RATE_LIMIT_MS) {
    throw new Error('Rate limited');
  }
  lastMessageTime.set(phone, now);

  // Fetch memories
  const memories = await fetchMemories();

  const systemPrompt = `Voce e o Jarvis, assistente pessoal do Marcos Daniels, fundador da MOTTIVME.
Responda de forma concisa e direta — estamos no WhatsApp, mensagens curtas.
Use PT-BR. Sem markdown complexo (sem blocos de codigo, sem headers #, sem negrito **).
Apenas texto simples, listas com - se necessario.
Seja util, proativo e objetivo como um verdadeiro assistente executivo.
${memories ? `\nMemorias relevantes:\n${memories}` : ''}`;

  // Build messages with conversation history (add current message without persisting yet)
  const history = getConversation(phone);
  const messages = [...history, { role: 'user' as const, content: text }];

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Anthropic API error', {
        event: 'jarvis.api_error',
        status: response.status,
        error: errorText,
      });
      throw new Error(`Anthropic API error: ${response.status}`);
    }

    const data = await response.json() as { content?: Array<{ text?: string }> };
    const rawText = data.content?.[0]?.text || '(sem resposta)';
    const reply = stripMarkdown(rawText);

    // Persist both messages only after successful API call
    addToConversation(phone, 'user', text);
    addToConversation(phone, 'assistant', reply);

    logger.info('Jarvis response sent', {
      event: 'jarvis.response',
      phone,
      inputLength: text.length,
      outputLength: reply.length,
    });

    return reply;
  } catch (error: any) {
    logger.error('Jarvis processing error', {
      event: 'jarvis.error',
      phone,
      error: error.message,
    });
    throw error;
  }
}
