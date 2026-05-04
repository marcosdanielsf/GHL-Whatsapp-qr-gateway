import OpenAI from 'openai';
import { logger } from '../utils/logger';

const SYSTEM_PROMPT = `Você gera variações anti-ban de mensagens WhatsApp em PT-BR.
Receba uma mensagem template. Retorne JSON com 5 variações que:
- Mantêm O MESMO significado e tom
- Trocam estrutura de frases, sinônimos, ordem
- Preservam placeholders {nome}, {valor}, etc EXATAMENTE
- Não mudam intenção ou call-to-action
- Cada variação deve soar como pessoa diferente escrevendo a mesma ideia
Formato: {"variants": ["v1", "v2", "v3", "v4", "v5"]}`;

export interface VariantsResult {
  variants: string[];
  token_cost: number;
}

export async function generateVariants(
  apiKey: string,
  template: string,
  model = 'gpt-4o-mini',
): Promise<VariantsResult> {
  const client = new OpenAI({ apiKey });

  let response;
  try {
    response = await client.chat.completions.create({
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Template: "${template}"` },
      ],
      temperature: 0.9,
    });
  } catch (err: any) {
    const code = err?.status ?? err?.code;
    if (code === 429) {
      throw new Error('Cota OpenAI esgotada — verifique seu plano ou billing.');
    }
    if (code === 401) {
      throw new Error('API key OpenAI inválida ou revogada.');
    }
    throw new Error(`Erro OpenAI: ${err?.message ?? String(err)}`);
  }

  const raw = response.choices[0]?.message?.content ?? '';
  let parsed: { variants: string[] };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('OpenAI retornou JSON inválido para variações.');
  }

  if (!Array.isArray(parsed.variants) || parsed.variants.length !== 5) {
    throw new Error('OpenAI não retornou exatamente 5 variações.');
  }

  const token_cost = response.usage?.total_tokens ?? 0;

  logger.info('[OPENAI] Variantes geradas', {
    event: 'openai.variants.generated',
    model,
    token_cost,
  });

  return { variants: parsed.variants, token_cost };
}
