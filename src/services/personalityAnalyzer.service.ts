/**
 * Personality Analyzer
 * Fetches owner messages and uses Anthropic to generate a personality profile.
 * Saves result to jarvis_memories for future use by Jarvis.
 */

import { logger } from '../utils/logger';

export interface PersonalityProfile {
  tom_de_voz: string;
  vocabulario_frequente: string[];
  comprimento_medio_mensagem: number;
  emojis_frequentes: string[];
  padroes_saudacao: string[];
  padroes_despedida: string[];
  nivel_assertividade: string;
  girias_expressoes: string[];
  estilo_instrucoes: string;
  estilo_pedidos: string;
  uso_pontuacao: string;
  resumo_geral: string;
}

async function fetchOwnerMessages(limit: number = 500): Promise<string[]> {
  const supabaseUrl = process.env.JARVIS_SUPABASE_URL;
  const supabaseKey = process.env.JARVIS_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing JARVIS_SUPABASE_URL or JARVIS_SUPABASE_ANON_KEY');
  }

  const response = await fetch(
    `${supabaseUrl}/rest/v1/owner_messages?select=content,is_group,message_timestamp&order=message_timestamp.desc&limit=${limit}`,
    {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch owner messages: ${response.status} - ${errorText}`);
  }

  const messages = await response.json() as Array<{ content: string; is_group: boolean; message_timestamp: string }>;
  return messages.map(m => m.content);
}

async function saveProfileToMemory(profile: PersonalityProfile): Promise<void> {
  const supabaseUrl = process.env.JARVIS_SUPABASE_URL;
  const supabaseKey = process.env.JARVIS_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) return;

  // Insert new profile first, then delete old ones (safer than DELETE-first)
  const insertRes = await fetch(`${supabaseUrl}/rest/v1/jarvis_memories`, {
    method: 'POST',
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify({
      category: 'personality_profile',
      content: JSON.stringify(profile),
    }),
  });

  if (insertRes.ok) {
    const inserted = await insertRes.json() as Array<{ id: string }>;
    const newId = inserted?.[0]?.id;
    // Delete old profiles (keep the one just inserted)
    if (newId) {
      await fetch(
        `${supabaseUrl}/rest/v1/jarvis_memories?category=eq.personality_profile&id=neq.${newId}`,
        {
          method: 'DELETE',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
          },
        }
      );
    }
  }
}

export async function analyzePersonality(): Promise<PersonalityProfile> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }

  const messages = await fetchOwnerMessages(500);

  if (messages.length < 10) {
    throw new Error(`Not enough messages for analysis (found ${messages.length}, need at least 10)`);
  }

  const MAX_CHARS = 80_000; // ~20k tokens — cost guard
  const sampleText = messages.join('\n---\n').substring(0, MAX_CHARS);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: `Voce e um linguista especializado em analise de personalidade atraves de escrita.
Analise as mensagens de WhatsApp abaixo (todas do mesmo autor) e gere um perfil detalhado de personalidade e estilo de escrita.

IMPORTANTE: Responda APENAS com JSON valido, sem markdown, sem backticks, sem explicacao.

O JSON deve ter exatamente estas chaves:
- tom_de_voz: string (ex: "informal e direto", "misto formal/informal")
- vocabulario_frequente: string[] (top 30 palavras/expressoes mais usadas)
- comprimento_medio_mensagem: number (palavras por mensagem)
- emojis_frequentes: string[] (emojis mais usados, vazio se nenhum)
- padroes_saudacao: string[] (como ele cumprimenta)
- padroes_despedida: string[] (como ele se despede)
- nivel_assertividade: string (baixo/medio/alto com explicacao)
- girias_expressoes: string[] (girias, expressoes regionais, bordoes)
- estilo_instrucoes: string (como ele da instrucoes/ordens)
- estilo_pedidos: string (como ele pede favores)
- uso_pontuacao: string (usa ponto final? virgula? exclamacao?)
- resumo_geral: string (2-3 paragrafos descrevendo o estilo de escrita completo)`,
      messages: [
        {
          role: 'user',
          content: `Analise estas ${messages.length} mensagens de WhatsApp:\n\n${sampleText}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as { content?: Array<{ text?: string }> };
  const rawText = data.content?.[0]?.text || '';

  let profile: PersonalityProfile;
  try {
    profile = JSON.parse(rawText);
  } catch {
    throw new Error(`Failed to parse personality profile JSON: ${rawText.substring(0, 200)}`);
  }

  // Save to jarvis_memories
  await saveProfileToMemory(profile);

  logger.info('Personality analysis completed', {
    event: 'clone.personality_analyzed',
    messagesAnalyzed: messages.length,
    vocabularySize: profile.vocabulario_frequente?.length || 0,
  });

  return profile;
}
