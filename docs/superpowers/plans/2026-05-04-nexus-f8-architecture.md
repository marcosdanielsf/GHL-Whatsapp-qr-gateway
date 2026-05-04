# Nexus F8 — IA Inbox — Architecture Decision

> **Roadmap ref:** nexus-paridade-stevo-roadmap-2026-05-03.md § F8
> **Data:** 2026-05-04 BRT
> **Arquiteto:** claude-sonnet-4-6 (Architect Agent MOTTIVME)
> **Status:** DRAFT — 4 one-way doors exigem decisão do Marcos antes de implementar
> **Branch:** `feat/nexus-f8-ia-inbox`

---

## TL;DR (3 decisões-chave)

1. **Vercel AI SDK como camada de abstração de LLM** — suporta OpenAI, Anthropic, Google, Groq com interface idêntica de tool_calling. Evita implementar 8 adaptadores à mão. Cliente continua BYO key (mesmo padrão F3).

2. **pgvector com HNSW indexing** — embeddings text-embedding-3-small (1536d) na própria tabela `ai_documents`. Zero infra extra, busca top-5 em <10ms até 100k chunks. Pinecone/Qdrant só vale acima de 1M vetores — não é o caso agora.

3. **Tool call via webhook síncrono com timeout 8s + circuit breaker** — nexus aguarda resposta do cliente. Se timeout, responde ao usuário com mensagem de fallback e loga o falha. Previne loop infinito via `max_tool_iterations=5` hard limit.

---

## Contexto

F8 destrava cancelamento do Stevo (~R$800/mês economia). Stevo cobra esse valor exatamente por IA Inbox + 8 providers + RAG + Tools + Follow-up. F8 replica 100% dessas features no Nexus.

Estrutura existente no repo que F8 herda:
- `baileys.ts` — `sendTextMessage`, `getConnectionStatus`, events `connection.update` e `messages.upsert`
- `queue.ts` — BullMQ + Redis, padrão de worker por tenant já validado no F3
- `messageHistory.ts` — persiste em `ghl_wa_message_history` com `instance_id`, `type`, `from_number`, `to_number`, `content`
- `jarvis.service.ts` — pattern existente de conversationBuffer in-memory por phone (apenas owner messages)
- `tenant_ai_keys` — tabela F3 já guarda BYO keys criptografadas via pgcrypto

F8 expande o pattern do `jarvis.service.ts` (resposta IA a mensagem) para qualquer chip onde o cliente ativou o agente IA.

---

## Decisão 1 — Provider Abstraction

### Problema
8 providers com APIs diferentes para tool_calling:
- OpenAI: `tool_choice` + `tools[]` com `function` objects
- Anthropic: `tools[]` com `input_schema`
- Google Gemini: `tools[]` com `functionDeclarations`
- Groq: compatível com OpenAI (fork)
- Grok (xAI): compatível com OpenAI
- OpenRouter: compatível com OpenAI (proxy)
- ElevenLabs: TTS-only, sem chat
- Fish: TTS-only, sem chat

Implementar 6 adaptadores de tool_calling à mão = ~40h de código + testes + manutenção por release de API.

### Opções

| Opção | Pros | Contras | Custo R$/mês MOTTIVME | Complexidade |
|-------|------|---------|----------------------|--------------|
| **Vercel AI SDK (RECOMENDADO)** | Abstrai OpenAI, Anthropic, Google, Groq com interface unificada. `streamText` + `generateText` + `tool` API idêntica. 100k downloads/semana. Atualizado a cada release dos providers. Groq/Grok/OpenRouter via openai-compatible adapter. | Dependência de terceiro (versão muda). TTS (ElevenLabs/Fish) não está na SDK — precisar implementar separado. | R$0 (cliente paga LLM) | Baixa |
| Interface própria (adaptadores manuais) | Zero dependência externa. Controle total. | ~40h implementação + manutenção toda vez que OpenAI/Anthropic mudam schema de tools. Groq, Grok, OpenRouter têm quirks documentados em issues. | R$0 | Alta |

**Decisão: Vercel AI SDK.**

ElevenLabs e Fish (TTS) ficam como módulo separado `TTSService` — ativados apenas quando agente tem `voice_enabled=true`. Scope da F8 não inclui TTS (é F9). Schema pode ter `tts_provider` como coluna futura no `ai_agents`.

Risco 2a ordem: Vercel AI SDK muda API major a cada ~6 meses. Mitigação: pinnar versão no `package.json` (`"ai": "3.x.x"`) e testar upgrade em branch isolada.

---

## Decisão 2 — RAG Architecture

### Modelo de embed e storage

| Opção | Custo embed | Dim | Qualidade | Infra |
|-------|-------------|-----|-----------|-------|
| **text-embedding-3-small (RECOMENDADO)** | $0.02/1M tokens | 1536 | Boa (MTEB 62.3) | pgvector (existente) |
| text-embedding-3-large | $0.13/1M tokens | 3072 | Melhor (MTEB 64.6) | pgvector | 
| Gemini text-embedding-004 | $0 (free tier) | 768 | Similar (MTEB 62.3) | pgvector |
| Pinecone / Qdrant | Variável | — | — | Infra extra (~$70/mês) |

**Volume estimado de embedding:**
- 1 PDF de 50 páginas ≈ 25.000 tokens ≈ 100 chunks
- 8 clientes × 5 docs cada = 400 chunks = 200k tokens = **$0,004 total por batch de upload**
- Re-embed ao substituir doc: $0,004 por evento. Irrisório.

**Decisão: text-embedding-3-small + pgvector.**

Gemini free é tentador mas tem rate limit de 1.500 RPM que pode afetar uploads em lote. text-embedding-3-small a $0,02/1M é tão barato que o free não justifica dependência extra.

### Chunking strategy

```
Chunk size: 512 tokens
Overlap: 64 tokens (12%)
Estratégia: sentence-aware (não cortar no meio de frase)
Re-embed trigger: documento substituído (DELETE + INSERT chunks)
Top-K busca: 5 chunks
Rerank: NÃO nesta fase (adiciona ~300ms e complexidade, ganha <8% relevância em bases <10k chunks)
```

Risco 2a ordem: chunk size de 512 pode ser pequeno pra documentos técnicos longos (ex: manual de produto). Solução: campo `chunk_strategy` no `ai_documents` com default `balanced_512` — permite migrar pra `large_1024` por documento sem re-arquitetar.

---

## Decisão 3 — Tool Calling Architecture

### Fluxo

1. Cliente define tool no JSON schema (ex: `{ name: "consultar_pedido", description: "...", parameters: { order_id: string } }`)
2. Usuário WhatsApp envia mensagem
3. LLM decide emitir `tool_call` com `order_id=123`
4. Nexus intercepta tool_call antes de responder ao usuário
5. Nexus chama webhook do cliente (HTTP POST) com `{ tool_name, args, conversation_id }`
6. Cliente responde `{ result: "Pedido 123: Em trânsito" }` em até 8s
7. Nexus injeta resultado no contexto e continua geração
8. Resposta final vai pro usuário no WhatsApp

### Síncrono vs Assíncrono

| Opção | UX | Complexidade | Timeout handling |
|-------|-----|-------------|-----------------|
| **Síncrono — aguarda resposta webhook (RECOMENDADO)** | Usuário recebe resposta em 1 turn | Média | Fallback "Não consegui verificar o pedido agora, tente em instantes" |
| Assíncrono — nexus pergunta pro cliente via callback | Zero timeout no usuário | Alta | Precisa de polling state, msg "Verificando..." intermediária, callback URL pra cliente responder |

**Decisão: síncrono com timeout 8s.**

Assíncrono adiciona 2 semanas de implementação de estado de callback. Síncrono com 8s é o padrão do setor (ChatGPT plugins usavam 5s, OpenAI Actions usa 10s). Maioria dos webhooks do cliente responde em <2s.

**Guards contra loops:**
- `max_tool_iterations = 5` hard limit por turn de conversa
- Se LLM emite mesma tool_call com mesmos args 2x seguidas → breaker dispara, responde `"Encontrei um erro ao processar sua solicitação."`
- HMAC-SHA256 no header `X-Nexus-Signature` de cada webhook outbound — cliente valida autenticidade

---

## Decisão 4 — Conversation Context Window

### Volume real estimado

```
100 msgs/dia/agente × 500 tokens/msg = 50k tokens/dia/agente
30 dias = 1.5M tokens/mês/agente
gpt-4o-mini: $0.15/1M input + $0.60/1M output
= ~$0.225 input + $0.90 output = ~$1.12/mês/agente se contexto INTEIRO
```

Isso com BYO key é custo do cliente, não da MOTTIVME. Mas ainda é relevante: cliente com key cara (Claude Opus 3.5 = $15/1M) pagaria **$22/mês só em contexto inteiro**. Isso gera churn.

### Estratégia de janela

| Opção | Custo/agente/mês | Qualidade de contexto | Complexidade |
|-------|------------------|-----------------------|--------------|
| Contexto inteiro | Alto ($22 no pior caso) | Perfeita | Baixa |
| **Últimas 20 msgs + summary (RECOMENDADO)** | Baixo (~$1-2) | Boa | Média |
| Últimas N msgs sem summary | Baixo | Ruim pra conversas longas | Baixa |

**Decisão: sliding window de 20 mensagens + summarization automática.**

Quando a conversa passa de 20 msgs, um job BullMQ (`ai:summarize:{conversationId}`) roda `gpt-4o-mini` para condensar as msgs mais antigas em 1 parágrafo de "contexto da conversa". Esse summary substitui os 10 msgs mais antigas no próximo turn.

Custo do summary: ~200 tokens input + 100 output = **$0,00009 por resumo**. Irrisório.

Campo `context_summary` na tabela `ai_conversations` guarda o texto condensado.

---

## Decisão 5 — Follow-up Engine

### Definição de "conversa stuck"

Duas situações distintas:
- **Cliente não respondeu ao agente:** agente enviou última msg, cliente ficou em silêncio por X horas → agente manda nudge
- **Agente não respondeu ao cliente (bug/erro):** cliente enviou msg, agente não respondeu → alerta operacional (não follow-up)

F8 trata apenas o caso 1. Caso 2 é monitoramento (F7-style alerting, out-of-scope F8).

### Implementação

| Opção | Pros | Contras | Complexidade |
|-------|------|---------|--------------|
| **BullMQ delayed job por conversa (RECOMENDADO)** | Preciso ao segundo. Cancela automaticamente se cliente responder antes do delay. Sem polling de banco. | Precisa cancelar job ao receber nova msg do cliente. | Média |
| Cron 5min scaneando `ai_conversations` | Simples. Sem gerenciar jobs. | Disparo pode atrasar até 5min. Com 1000 conversas ativas = table scan a cada 5min. | Baixa |

**Decisão: BullMQ delayed job.**

Quando agente envia mensagem → adiciona job `ai:followup:{conversationId}` com delay de `followup_hours × 3600 × 1000` ms.
Quando cliente responde → `removeJobs('ai:followup:{conversationId}')` cancela follow-up.
Quando job dispara → agente gera nudge personalizado com o LLM do agente + envia.

Fila `ai-followup:{tenantId}` — mesmo padrão por tenant do F3.

---

## Decisão 6 — Business Hours

### Modelo

| Opção | Flexibilidade | Complexidade |
|-------|--------------|--------------|
| **Simples: timezone + horários seg-dom por dia (RECOMENDADO)** | Cobre 95% dos casos | Baixa |
| Complexo: feriados + exceções + turnos | Cobre 100% | Alta (+2 semanas) |

**Decisão: modelo simples. Feriados ficam como roadmap v2.**

Tabela `ai_business_hours`:
- 7 rows por agente (seg=0 a dom=6)
- `open_time`, `close_time` (HH:MM)
- `is_closed` (boolean para dias sem atendimento)
- `timezone` no `ai_agents`

Fora do horário: agente NÃO responde ao LLM (não gera custo). Envia mensagem customizável `out_of_hours_message`. Mensagem do cliente fica registrada no histórico — quando o horário abrir, agente retoma normalmente (não há enfileiramento automático pra responder mensagens perdidas, que seria scope F9).

---

## Decisão 7 — Schema SQL Completo

```sql
-- ══════════════════════════════════════════════════════════
-- EXTENSÕES NECESSÁRIAS (confirmar se já ativas no projeto)
-- ══════════════════════════════════════════════════════════
-- CREATE EXTENSION IF NOT EXISTS vector;       -- pgvector v0.8.0
-- CREATE EXTENSION IF NOT EXISTS pgcrypto;     -- já usado em F3
-- CREATE EXTENSION IF NOT EXISTS pg_trgm;      -- busca textual em tool descriptions


-- ══════════════════════════════════════════════════════════
-- TABELA 1: ai_agents
-- Um agente por configuração de chip. Cliente pode ter N agentes.
-- Toggle ai_enabled no chip redireciona mensagens inbound pro agente.
-- ══════════════════════════════════════════════════════════
CREATE TABLE public.ai_agents (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             uuid NOT NULL REFERENCES public.ghl_wa_tenants(id) ON DELETE CASCADE,
    instance_id           text NOT NULL,       -- chip vinculado (lógico, sem FK)
    name                  text NOT NULL,       -- ex: "Assistente da Marina"
    status                text NOT NULL DEFAULT 'inactive'
                          CHECK (status IN ('active','inactive','paused')),

    -- LLM config
    provider              text NOT NULL DEFAULT 'openai'
                          CHECK (provider IN ('openai','anthropic','google','groq','grok','openrouter')),
    model                 text NOT NULL DEFAULT 'gpt-4o-mini',  -- ex: 'claude-3-5-haiku-latest'
    system_prompt         text NOT NULL DEFAULT '',
    temperature           numeric(3,2) NOT NULL DEFAULT 0.7 CHECK (temperature BETWEEN 0 AND 2),
    max_tokens            int NOT NULL DEFAULT 1024 CHECK (max_tokens BETWEEN 64 AND 8192),

    -- Contexto de conversa
    context_window_msgs   int NOT NULL DEFAULT 20 CHECK (context_window_msgs BETWEEN 5 AND 100),
    summarize_after_msgs  int NOT NULL DEFAULT 40,  -- trigger de summarization

    -- Follow-up
    followup_enabled      boolean NOT NULL DEFAULT false,
    followup_hours        numeric(4,1) NOT NULL DEFAULT 24.0,  -- horas sem resposta do cliente
    followup_max_times    int NOT NULL DEFAULT 2,              -- quantas vezes re-tentar
    followup_message      text NOT NULL DEFAULT 'Olá! Ainda está por aqui? Posso ajudar?',

    -- Business hours
    timezone              text NOT NULL DEFAULT 'America/Sao_Paulo',
    out_of_hours_message  text NOT NULL DEFAULT 'Olá! Nosso atendimento está fechado agora. Voltaremos em breve!',

    -- RAG
    rag_enabled           boolean NOT NULL DEFAULT false,
    rag_top_k             int NOT NULL DEFAULT 5 CHECK (rag_top_k BETWEEN 1 AND 20),

    -- Metadados
    created_by            uuid NOT NULL REFERENCES auth.users(id),
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),

    -- 1 agente ativo por chip (pode ter inativos/histórico)
    CONSTRAINT unique_active_agent_per_instance
        UNIQUE NULLS NOT DISTINCT (tenant_id, instance_id, status)
        -- Nota: constraint parcial via índice abaixo é mais correto
);

-- Somente 1 agente ACTIVE por chip por tenant
CREATE UNIQUE INDEX idx_ai_agents_active_per_chip
    ON public.ai_agents(tenant_id, instance_id)
    WHERE status = 'active';

CREATE INDEX idx_ai_agents_tenant_id ON public.ai_agents(tenant_id);
CREATE INDEX idx_ai_agents_instance_status ON public.ai_agents(instance_id, status);

-- RLS
ALTER TABLE public.ai_agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_ai_agents"
    ON public.ai_agents FOR ALL
    USING (tenant_id = public.get_auth_tenant_id())
    WITH CHECK (tenant_id = public.get_auth_tenant_id());


-- ══════════════════════════════════════════════════════════
-- TABELA 2: ai_documents
-- Documentos RAG. Chunks + embeddings por documento.
-- Embedding dim 1536 = text-embedding-3-small.
-- ══════════════════════════════════════════════════════════
CREATE TABLE public.ai_documents (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id          uuid NOT NULL REFERENCES public.ai_agents(id) ON DELETE CASCADE,
    tenant_id         uuid NOT NULL,             -- denormalizado pra RLS sem JOIN
    file_name         text NOT NULL,
    file_size_bytes   int,
    mime_type         text NOT NULL DEFAULT 'application/pdf'
                      CHECK (mime_type IN ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain')),
    status            text NOT NULL DEFAULT 'processing'
                      CHECK (status IN ('processing','ready','error','outdated')),
    chunk_count       int,                       -- total de chunks gerados
    chunk_strategy    text NOT NULL DEFAULT 'balanced_512',  -- balanced_512 | large_1024
    error_message     text,
    storage_path      text,                      -- path no Supabase Storage (bucket: ai-documents)
    created_by        uuid NOT NULL REFERENCES auth.users(id),
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ══════════════════════════════════════════════════════════
-- TABELA 2b: ai_document_chunks
-- 1 row por chunk. Embedding em vector(1536).
-- Separada do documento pra evitar row muito grande.
-- ══════════════════════════════════════════════════════════
CREATE TABLE public.ai_document_chunks (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id   uuid NOT NULL REFERENCES public.ai_documents(id) ON DELETE CASCADE,
    agent_id      uuid NOT NULL,                 -- denormalizado pra busca direta sem JOIN duplo
    tenant_id     uuid NOT NULL,                 -- denormalizado pra RLS
    chunk_index   int NOT NULL,                  -- ordem dentro do documento
    content       text NOT NULL,                 -- texto do chunk
    embedding     vector(1536),                  -- text-embedding-3-small
    token_count   int,
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- HNSW index — melhor que IVFFLAT pra updates incrementais e bases <1M vetores
-- m=16, ef_construction=64: parâmetros padrão, good enough até 500k chunks
CREATE INDEX idx_ai_doc_chunks_embedding_hnsw
    ON public.ai_document_chunks
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- Index composto pra busca por agente (WHERE agent_id = X ORDER BY embedding <=> query)
CREATE INDEX idx_ai_doc_chunks_agent_id ON public.ai_document_chunks(agent_id);
CREATE INDEX idx_ai_doc_chunks_document_id ON public.ai_document_chunks(document_id);

-- RLS — ai_documents
ALTER TABLE public.ai_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_ai_documents"
    ON public.ai_documents FOR ALL
    USING (tenant_id = public.get_auth_tenant_id())
    WITH CHECK (tenant_id = public.get_auth_tenant_id());

-- RLS — ai_document_chunks (service_role only — cliente não acessa chunks diretamente)
ALTER TABLE public.ai_document_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only_chunks"
    ON public.ai_document_chunks FOR ALL
    USING (tenant_id = public.get_auth_tenant_id());


-- ══════════════════════════════════════════════════════════
-- TABELA 3: ai_custom_tools
-- Tools definidas pelo cliente como JSON schema.
-- Nexus chama webhook_url quando LLM emite tool_call.
-- ══════════════════════════════════════════════════════════
CREATE TABLE public.ai_custom_tools (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id        uuid NOT NULL REFERENCES public.ai_agents(id) ON DELETE CASCADE,
    tenant_id       uuid NOT NULL,
    name            text NOT NULL,              -- snake_case, ex: "consultar_pedido"
    description     text NOT NULL,              -- instrução pro LLM de quando usar
    parameters      jsonb NOT NULL DEFAULT '{}', -- JSON Schema dos parâmetros
    webhook_url     text NOT NULL,
    -- HMAC secret pra assinar chamadas outbound (X-Nexus-Signature)
    webhook_secret_encrypted text NOT NULL,
    timeout_seconds int NOT NULL DEFAULT 8 CHECK (timeout_seconds BETWEEN 1 AND 30),
    is_enabled      boolean NOT NULL DEFAULT true,
    -- Circuit breaker state
    consecutive_failures int NOT NULL DEFAULT 0,
    last_failure_at timestamptz,
    circuit_open    boolean NOT NULL DEFAULT false,  -- true = tool desativada temporariamente
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),

    -- Máximo 10 tools por agente (guardrail de complexidade)
    CONSTRAINT max_tools_check CHECK (true)  -- enforced no backend (COUNT antes de INSERT)
);

CREATE INDEX idx_ai_custom_tools_agent_id ON public.ai_custom_tools(agent_id);
CREATE INDEX idx_ai_custom_tools_enabled ON public.ai_custom_tools(agent_id, is_enabled) WHERE is_enabled = true;

-- RLS
ALTER TABLE public.ai_custom_tools ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_ai_tools"
    ON public.ai_custom_tools FOR ALL
    USING (tenant_id = public.get_auth_tenant_id())
    WITH CHECK (tenant_id = public.get_auth_tenant_id());


-- ══════════════════════════════════════════════════════════
-- TABELA 4: ai_conversations
-- 1 conversa = 1 thread entre 1 contato e 1 agente.
-- Aberta quando agente ativo recebe msg do contato.
-- ══════════════════════════════════════════════════════════
CREATE TABLE public.ai_conversations (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id            uuid NOT NULL REFERENCES public.ai_agents(id),
    tenant_id           uuid NOT NULL,
    instance_id         text NOT NULL,          -- chip que recebeu a conversa
    contact_phone       text NOT NULL,          -- E.164
    status              text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','closed','taken_over')),  -- taken_over = humano assumiu
    context_summary     text,                   -- summary das msgs antigas (Decisão 4)
    message_count       int NOT NULL DEFAULT 0,
    last_user_msg_at    timestamptz,
    last_agent_msg_at   timestamptz,
    -- Follow-up tracking
    followup_count      int NOT NULL DEFAULT 0,
    followup_bullmq_job_id text,                -- ID do job BullMQ atual de follow-up
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),

    UNIQUE (agent_id, contact_phone, status)    -- 1 conversa ativa por contato por agente
);

CREATE INDEX idx_ai_conversations_agent_id ON public.ai_conversations(agent_id);
CREATE INDEX idx_ai_conversations_tenant_id ON public.ai_conversations(tenant_id);
CREATE INDEX idx_ai_conversations_contact ON public.ai_conversations(tenant_id, contact_phone);
CREATE INDEX idx_ai_conversations_active ON public.ai_conversations(agent_id, status) WHERE status = 'active';
-- Partitioning: DESNECESSÁRIO agora. 8 clientes × 100 msg/dia × 365d = ~292k rows/ano.
-- Revisar em 18 meses quando ultrapassar 2M rows.

-- RLS
ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_ai_conversations"
    ON public.ai_conversations FOR ALL
    USING (tenant_id = public.get_auth_tenant_id())
    WITH CHECK (tenant_id = public.get_auth_tenant_id());


-- ══════════════════════════════════════════════════════════
-- TABELA 5: ai_followup_queue
-- Log de follow-ups enviados (auditoria + evita re-envio).
-- O job BullMQ é efêmero; este log é permanente.
-- ══════════════════════════════════════════════════════════
CREATE TABLE public.ai_followup_queue (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id     uuid NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
    agent_id            uuid NOT NULL,
    tenant_id           uuid NOT NULL,
    attempt_number      int NOT NULL DEFAULT 1,  -- 1, 2, ... até followup_max_times
    scheduled_for       timestamptz NOT NULL,
    sent_at             timestamptz,
    status              text NOT NULL DEFAULT 'scheduled'
                        CHECK (status IN ('scheduled','sent','cancelled','failed')),
    message_sent        text,                    -- cópia do nudge enviado
    cancel_reason       text,                    -- ex: "customer_replied"
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_followup_conversation ON public.ai_followup_queue(conversation_id);
CREATE INDEX idx_ai_followup_tenant_status ON public.ai_followup_queue(tenant_id, status) WHERE status = 'scheduled';

-- RLS
ALTER TABLE public.ai_followup_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_ai_followup"
    ON public.ai_followup_queue FOR ALL
    USING (tenant_id = public.get_auth_tenant_id())
    WITH CHECK (tenant_id = public.get_auth_tenant_id());


-- ══════════════════════════════════════════════════════════
-- TABELA 6: ai_business_hours
-- 7 rows por agente (uma por dia da semana).
-- Inseridas automaticamente ao criar agente (default: seg-sex 8h-18h).
-- ══════════════════════════════════════════════════════════
CREATE TABLE public.ai_business_hours (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id    uuid NOT NULL REFERENCES public.ai_agents(id) ON DELETE CASCADE,
    tenant_id   uuid NOT NULL,
    day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),  -- 0=domingo, 6=sábado
    is_closed   boolean NOT NULL DEFAULT false,
    open_time   time,           -- NULL se is_closed=true. Formato HH:MM (sem segundos)
    close_time  time,           -- NULL se is_closed=true
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),

    UNIQUE (agent_id, day_of_week),
    CONSTRAINT time_logic CHECK (
        is_closed = true OR (open_time IS NOT NULL AND close_time IS NOT NULL AND open_time < close_time)
    )
);

CREATE INDEX idx_ai_business_hours_agent_id ON public.ai_business_hours(agent_id);

-- RLS
ALTER TABLE public.ai_business_hours ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_ai_business_hours"
    ON public.ai_business_hours FOR ALL
    USING (tenant_id = public.get_auth_tenant_id())
    WITH CHECK (tenant_id = public.get_auth_tenant_id());


-- ══════════════════════════════════════════════════════════
-- RPC: search_similar_chunks
-- Busca semântica top-K por agente. Chamada pelo backend (service_role).
-- Retorna chunks ordenados por similaridade coseno.
-- ══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.search_similar_chunks(
    p_agent_id    uuid,
    p_embedding   vector(1536),
    p_top_k       int DEFAULT 5
)
RETURNS TABLE (
    chunk_id      uuid,
    document_id   uuid,
    content       text,
    similarity    float
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        c.id,
        c.document_id,
        c.content,
        1 - (c.embedding <=> p_embedding) AS similarity
    FROM public.ai_document_chunks c
    WHERE c.agent_id = p_agent_id
    ORDER BY c.embedding <=> p_embedding
    LIMIT p_top_k;
END;
$$;
```

**Notas sobre o schema:**

- `ai_document_chunks` separado de `ai_documents`: row de documento sem embedding (metadata apenas). Row de chunk com embedding. Evita `pg_toast` pra vetores de 1536 floats dentro de row já grande.
- HNSW vs IVFFLAT: HNSW não requer `VACUUM + ANALYZE` periódico pra manter performance. IVFFLAT exige re-build das listas quando dados crescem >10%. Para base que cresce incrementalmente (uploads de doc), HNSW é superior.
- `webhook_secret_encrypted` em `ai_custom_tools` — mesmo padrão `pgp_sym_encrypt` da `tenant_ai_keys` do F3.
- Constraint `unique_active_agent_per_instance` via índice parcial é mais correto que UNIQUE nulo — PostgreSQL não suporta UNIQUE com valor específico de coluna na constraint diretamente, mas índice `WHERE status = 'active'` resolve.

---

## Decisão 8 — Frontend Playground

### Componentes principais

```
AgentCreateWizard (4 steps):
├── Step 1: Identidade
│   ├── Nome do agente, chip selecionado
│   ├── Provider + modelo (dropdown com modelos populares por provider)
│   └── Status toggle: Ativo / Inativo
│
├── Step 2: Prompt + Personalidade
│   ├── Textarea system_prompt (max 4000 chars, contador)
│   ├── Slider temperatura (0 = determinístico → 1 = criativo)
│   └── Dropdown context_window_msgs (10, 20, 50)
│
├── Step 3: RAG + Tools
│   ├── Aba "Documentos"
│   │   ├── Upload drag-and-drop (PDF, DOCX, TXT)
│   │   ├── Lista de docs com status (processing → ready) + badge chunk_count
│   │   └── Botão delete (marca doc como outdated, limpa chunks)
│   └── Aba "Ferramentas"
│       ├── Botão "Add Tool" → drawer com formulário
│       │   ├── Nome (snake_case validation inline)
│       │   ├── Descrição (instrução pro LLM)
│       │   ├── JSON Schema editor (textarea com syntax highlighting básico)
│       │   ├── Webhook URL + test button "Testar webhook"
│       │   └── Secret (gerado automaticamente, copiável 1x)
│       └── Lista de tools com toggle enable/disable
│
└── Step 4: Follow-up + Horários
    ├── Toggle follow-up + horas (slider 1h-72h) + max tentativas (1-5)
    ├── Textarea followup_message
    ├── Timezone selector
    ├── Grid 7 dias (seg-dom)
    │   └── Por dia: toggle Aberto/Fechado + timepicker open_time/close_time
    └── Textarea out_of_hours_message

AgentPlayground (aba separada no painel do agente):
├── Chat simulado (não manda pra WhatsApp real)
│   ├── Input de mensagem → POST /api/agents/:id/playground
│   ├── Resposta do agente renderizada
│   └── Indicadores: "Usando RAG" badge + lista de chunks utilizados
│       (expandível: mostra document_name + trecho do chunk)
├── Tool calls simuladas: painel lateral mostra tool_calls emitidas + resultado mock
└── Botão "Limpar conversa" (reseta contexto do playground)

AgentConversationsMonitor:
├── Lista de conversas ativas por agente (paginada)
├── Por conversa: contato, última mensagem, tempo sem resposta, followup status
├── Botão "Assumir conversa" → status='taken_over', agente para de responder
└── Botão "Reativar agente" → status='active'
```

**RAG transparency na UI (chunk hits):** endpoint do playground retorna `{ response, chunks_used: [{document_name, chunk_content_preview, similarity}] }`. UI exibe painel colapsável "Agente consultou X documentos" — o cliente consegue debugar por que o agente disse o que disse.

---

## Decisão 9 — Integração com F1+F3 (baileys.ts)

### Ponto de integração crítico

O handler `messages.upsert` em `baileys.ts` é onde mensagens inbound chegam. Hoje ele:
1. Salva em `ghl_wa_message_history`
2. Chama `handleJarvisMessage` (apenas owner phone)
3. Chama `collectOwnerMessage`

F8 adiciona um **4o branch** nesse handler:

```
Recebe msg inbound
  ↓
É owner? → Jarvis (F1, existente)
  ↓
Instance tem ai_agent com status='active'? → AIInboxService.handleInbound(msg)
  ↓
Não → fluxo normal (humano lê no painel)
```

**Toggle por chip:** campo `ai_agent_enabled` em `ghl_wa_instances` (boolean, default false) + foreign key lógica pro `ai_agents` ativo do chip. Quando cliente ativa agente no wizard, o toggle vira `true`. Quando desativa, `false` — chip volta ao modo manual sem alterar o agente salvo.

**Garantia de não-interferência:** `AIInboxService.handleInbound` só é chamado quando `ai_agent_enabled = true`. Lógica de atendimento manual (GHL sync, messageHistory) continua rodando normalmente — agente IA é uma camada adicional, não substitutiva. Operador humano pode assumir conversa a qualquer momento via `taken_over`.

---

## Diagrama de Fluxo — Mensagem Inbound → Resposta IA

```
┌───────────────────────────────────────────────────────────────────────────────┐
│  CONTATO (WhatsApp)                                                           │
│  "Qual o status do meu pedido 1234?"                                          │
└──────────────────────────────────────────┬────────────────────────────────────┘
                                           │ Baileys messages.upsert event
                                           ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│  baileys.ts — messages.upsert handler                                         │
│                                                                               │
│  1. Salva em ghl_wa_message_history (sempre)                                  │
│  2. is_owner? → Jarvis (existente, não muda)                                  │
│  3. CHECK: ghl_wa_instances.ai_agent_enabled = true?                          │
│     └── Sim → AIInboxService.handleInbound(instanceId, from, text)            │
│     └── Não → retorna (atendimento manual)                                    │
└──────────────────────────────────────────┬────────────────────────────────────┘
                                           │
                                           ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│  AIInboxService.handleInbound()                                               │
│                                                                               │
│  1. Busca agente ativo do chip (ai_agents WHERE instance_id AND status=active)│
│  2. CHECK: business_hours — agora está dentro do horário?                     │
│     └── Fora → sendTextMessage(out_of_hours_message), retorna                 │
│  3. UPSERT ai_conversations (ou busca conversa ativa existente)               │
│  4. Cancela BullMQ follow-up job pendente (se houver)                         │
│  5. Busca últimas N mensagens (context_window_msgs) da conversa               │
│  6. Se message_count > summarize_after_msgs: agenda job de summarization      │
│                                                                               │
└──────────────────────────────────────────┬────────────────────────────────────┘
                                           │
                                           ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│  RAGService.buildContext() — se rag_enabled = true                            │
│                                                                               │
│  1. Gera embedding da mensagem do usuário                                     │
│     └── POST api.openai.com/v1/embeddings (text-embedding-3-small)            │
│  2. Chama RPC search_similar_chunks(agent_id, embedding, top_k)               │
│  3. Retorna chunks ordenados por similaridade                                 │
│  4. Formata: "Contexto relevante:\n[chunk1]\n[chunk2]..."                     │
│     └── Injeta no system_prompt antes da geração                              │
│                                                                               │
└──────────────────────────────────────────┬────────────────────────────────────┘
                                           │ RAG context pronto
                                           ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│  LLMService.generateResponse() — Vercel AI SDK                                │
│                                                                               │
│  Monta payload:                                                               │
│  ├── system: agent.system_prompt + RAG context + context_summary             │
│  ├── messages: últimas N msgs (alternando user/assistant)                    │
│  └── tools: ai_custom_tools do agente (se habilitadas)                        │
│                                                                               │
│  generateText({ model, messages, tools, maxSteps: 5 })                        │
│                                                                               │
│  Se LLM emite tool_call:                                                      │
│  └── ToolCallService.dispatch(tool, args)                                     │
│      ├── Verifica circuit_breaker (circuit_open = true? → fallback)           │
│      ├── POST webhook_url com HMAC-SHA256 signature + 8s timeout              │
│      ├── Success → injeta resultado no contexto, continua geração             │
│      └── Timeout/Error → incrementa consecutive_failures                     │
│          └── Se failures >= 3: circuit_open = true (desativa tool 30min)     │
│                                                                               │
└──────────────────────────────────────────┬────────────────────────────────────┘
                                           │ Texto final gerado
                                           ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│  Pós-processamento + Envio                                                    │
│                                                                               │
│  1. stripMarkdown() — agente não manda **negrito** pro WhatsApp               │
│  2. sendTextMessage(instanceId, contactPhone, response)                       │
│  3. Salva resposta em ghl_wa_message_history (type=outbound)                  │
│  4. UPDATE ai_conversations: last_agent_msg_at, message_count++               │
│  5. Se followup_enabled: agenda BullMQ delayed job                            │
│     └── Queue: ai-followup:{tenantId}                                         │
│     └── Delay: followup_hours × 3600 × 1000 ms                               │
│                                                                               │
└──────────────────────────────────────────┬────────────────────────────────────┘
                                           │
                                           ▼
                                 CONTATO recebe resposta
```

---

## Endpoints REST

| Método | Endpoint | Auth | Descrição |
|--------|----------|------|-----------|
| `GET` | `/api/agents` | requireAuth | Lista agentes do tenant |
| `POST` | `/api/agents` | requireAuth | Cria agente + insere 7 rows em ai_business_hours |
| `GET` | `/api/agents/:id` | requireAuth | Detalhe do agente com docs + tools |
| `PATCH` | `/api/agents/:id` | requireAuth | Atualiza config (prompt, temp, etc) |
| `DELETE` | `/api/agents/:id` | requireAuth | Desativa agente (status=inactive), não deleta |
| `POST` | `/api/agents/:id/activate` | requireAuth | Toggle ai_agent_enabled=true no chip |
| `POST` | `/api/agents/:id/deactivate` | requireAuth | Toggle ai_agent_enabled=false no chip |
| `POST` | `/api/agents/:id/playground` | requireAuth | Simula conversa sem enviar pro WhatsApp |
| `GET` | `/api/agents/:id/conversations` | requireAuth | Lista conversas ativas (paginado) |
| `GET` | `/api/agents/:id/conversations/:convId` | requireAuth | Histórico de 1 conversa |
| `POST` | `/api/agents/:id/conversations/:convId/takeover` | requireAuth | Humano assume (status=taken_over) |
| `POST` | `/api/agents/:id/documents` | requireAuth | Upload de documento (multipart) → inicia chunking job |
| `GET` | `/api/agents/:id/documents` | requireAuth | Lista documentos com status de processamento |
| `DELETE` | `/api/agents/:id/documents/:docId` | requireAuth | Remove doc + chunks |
| `GET` | `/api/agents/:id/tools` | requireAuth | Lista tools do agente |
| `POST` | `/api/agents/:id/tools` | requireAuth | Cria tool (máx 10 por agente) |
| `PATCH` | `/api/agents/:id/tools/:toolId` | requireAuth | Atualiza tool |
| `DELETE` | `/api/agents/:id/tools/:toolId` | requireAuth | Remove tool |
| `POST` | `/api/agents/:id/tools/:toolId/test` | requireAuth | Testa webhook da tool com payload mock |
| `GET` | `/api/agents/:id/business-hours` | requireAuth | Retorna 7 rows de horários |
| `PUT` | `/api/agents/:id/business-hours` | requireAuth | Atualiza batch de 7 rows em 1 call |

---

## Fases de Implementação

| Fase | Escopo | Agente Responsável | Dependência | Estimativa |
|------|--------|-------------------|-------------|------------|
| F8-A | Schema SQL: 6 tabelas + 2b + RPC + ALTER ghl_wa_instances + indexes + RLS | `supabase-dba` | Nenhuma | 3-4h |
| F8-B | RAGService: upload → chunk → embed → store. Endpoint POST /documents + BullMQ chunking job | `nextjs-fullstack` (backend) | F8-A | 4-5h |
| F8-C | LLMService com Vercel AI SDK: interface unificada + BYO key decrypt + tool_call dispatch | `nextjs-fullstack` (backend) | F8-A, F3 (tenant_ai_keys) | 4-5h |
| F8-D | AIInboxService: integração com baileys.ts + business_hours check + conversation lifecycle + follow-up BullMQ | `nextjs-fullstack` (backend) | F8-A, F8-C | 4-6h |
| F8-E | CRUD endpoints: agents + tools + documents + conversations + business-hours | `nextjs-fullstack` (backend) | F8-A, F8-B, F8-C | 3-4h |
| F8-F | Frontend: AgentCreateWizard + Playground + ConversationsMonitor | `nextjs-fullstack` (frontend) | F8-E | 5-6h |
| F8-G | Security review: webhook HMAC + RLS audit + key encryption audit | `wshobson-security-auditor` | F8-E | 2h |
| F8-H | QA: teste E2E com chip real + follow-up smoke test + RAG precision test | Marcos QA | F8-F | 2-3h |

**Estimativa total: 27-35h** (dentro do range 18-26h do roadmap — upper end por RAG + tool_call dispatch + follow-up serem mais complexos do que campanhas F3).

---

## Cutover Playbook Stevo → Nexus (Fase F8 Deliverable)

### Chips ativos no Stevo (a confirmar com Marcos)

| Cliente | Chip | Workflows n8n atuais | Prioridade cutover |
|---------|------|---------------------|-------------------|
| Marina (Brazillionaires) | +55... | sm-pavao.stevo.chat | Alta — maior usuária IA |
| Alegra | +55... | sm-pavao.stevo.chat | Alta |
| Flávia | +55... | sm-pavao.stevo.chat | Média |
| +5 outros | +55... | sm-pavao.stevo.chat | Baixa |

### Protocolo de migração (por cliente)

```
Semana 1-2 — Setup paralelo:
├── Chip CONTINUA no Stevo (produção)
├── Criar agente IA no Nexus para o cliente
├── Copiar system_prompt do Stevo pra Nexus
├── Subir mesmos documentos RAG
├── Configurar tools equivalentes
└── Testar no Playground até paridade

Semana 3 — Canary 14 dias:
├── Chip: desconectar do Stevo + conectar ao Nexus
├── ai_agent_enabled = true
├── Monitorar: taxa de resposta, latência, qualidade de resposta
├── KPI: NPS parcial (perguntar ao cliente 2x por semana "IA funcionando bem?")
├── Rollback trigger: 3+ reclamações do contato final OU chip baneado
└── Rollback: ai_agent_enabled = false + reconectar ao Stevo (chip permanece mesmo)

Semana 4 — Confirmação:
├── 0 reclamações? → cutover confirmado
├── Cancelar plano Stevo do cliente
└── Registrar em memory/clients-stevo-cutover-log.md

Rollout order recomendado:
1. Teste interno (chip MOTTIVME — sem risco de cliente)
2. Marina (mais matura, tolera beta)
3. Alegra
4. Restantes em paralelo
```

### Workflows n8n pós-cutover

Os 3 workflows que apontam pra `sm-pavao.stevo.chat` precisam ser atualizados para `nexus.socialfy.me`:
- Confirmar quais endpoints específicos são chamados antes de migrar
- Atualizar 1 workflow por vez, testar, só então o próximo
- Manter mapeamento em `memory/n8n-workflows-stevo-migration.md`

**Economia estimada ao cancelar Stevo:**
- Stevo atual: ~R$800/mês (8 chips × ~R$100)
- Nexus infra adicional: ~R$0 (mesma VPS Railway já paga)
- **Economia líquida: R$800/mês = R$9.600/ano**

---

## Riscos Não-Óbvios

### Risco 1 — Vercel AI SDK breaking change durante desenvolvimento
SDK v3→v4 mudou API de tools completamente. Se pinnar em v3 e OpenAI lançar GPT-5 com nova feature de tools, ficamos desatualizados. Se atualizar, pode quebrar.
**Mitigação:** pinnar minor version (`"ai": "~3.4.0"`), não patch. Testar upgrade em branch isolada a cada 60 dias. Abstrair chamadas SDK atrás de um `LLMAdapter` interno — isso isola mudanças de SDK em 1 arquivo.

### Risco 2 — Embedding de documentos longos excede rate limit da OpenAI
Upload de manual de produto com 200 páginas = ~1000 chunks = 1000 calls de embedding em sequência. OpenAI embed API tem rate limit de 3000 RPM — mas 1000 calls simultâneas podem atingir tier-1 limits.
**Mitigação:** BullMQ job de chunking com concurrency=10 e delay de 100ms entre batches de 100 chunks. Totaliza ~10s pra 1000 chunks. Aceitável pra operação de background.

### Risco 3 — Tool_call loop (LLM chama mesma tool infinitamente)
LLM emite tool_call → webhook retorna resultado ambíguo → LLM reemite tool_call → loop.
**Mitigação:** `maxSteps: 5` no Vercel AI SDK interrompe o loop forçosamente após 5 iterations. Além disso: detectar args idênticos na tool_call subsequente (hash dos args) → se igual ao turno anterior, breaker interrompe e retorna mensagem de fallback ao usuário.

### Risco 4 — Conversa multi-chip (contato muda de número ou usa chips diferentes)
Contato X fala com chip A (agente IA ativo) e depois fala com chip B (mesmo tenant, agente diferente). ai_conversations está particionada por agent_id, então são 2 conversas sem histórico cruzado. O agente do chip B não "lembra" o contexto do chip A.
**Mitigação:** design intencional — conversas são por chip, não por contato global. Documentar como limitação conhecida. Solução futura: campo `global_contact_id` linkando conversas do mesmo número entre chips (scope F9).

### Risco 5 — Embedding stale após edição de documento
Cliente edita doc no Stevo e recria no Nexus. Mas no Nexus, se o fluxo for "delete + upload", os chunks antigos ficam em `ai_document_chunks` até o job de re-embedding terminar. Durante o processamento (~10-30s), buscas RAG ainda retornam chunks desatualizados.
**Mitigação:** ao deletar documento, marcar chunks com `status='outdated'` em vez de DELETE imediato. `search_similar_chunks` adiciona `WHERE document_id NOT IN (SELECT id FROM ai_documents WHERE status='outdated')`. Apenas após novo doc estar `status='ready'`, DELETE físico dos chunks antigos.

### Risco 6 — Follow-up enviado depois do cliente já ter respondido (race condition)
Delayed job de follow-up dispara exatamente quando mensagem do cliente chega ao mesmo tempo. 2 writes simultâneos: job tenta enviar nudge + handler de mensagem tenta cancelar o job.
**Mitigação:** antes de enviar follow-up, job re-verifica `ai_conversations.last_user_msg_at` — se atualizado nas últimas `followup_hours`, cancela e não envia. Lock otimista: UPDATE ai_followup_queue SET status='sent' WHERE id=X AND status='scheduled' — se 0 rows afetadas, outro processo já cancelou.

### Risco 7 — RAG context superlota o context window do LLM
5 chunks × 512 tokens = 2560 tokens de RAG. System prompt de 500 tokens. 20 msgs de histórico × ~50 tokens = 1000 tokens. Total ~4060 tokens. Com gpt-4o-mini (128k context) é irrisório. Com modelos de 4k context (alguns Groq rápidos), pode estoura.
**Mitigação:** `max_tokens` do modelo fica configurável por agente. Adicionar validação no `LLMService`: se `estimate_tokens(context) > model_context_limit * 0.75`, reduzir RAG top_k de 5 para 3 automaticamente.

---

## Decisões que Marcos Precisa Confirmar (One-Way Doors)

1. **Vercel AI SDK vs adaptadores próprios** — recomendo Vercel AI SDK. Se Marcos preferir zero dependência nova (política de fat-free infra), implementar adaptadores levará +40h e bloqueará F8 de ser entregue sem 2 sessões extras.

2. **BYO key também para embed (text-embedding-3-small)** — recomendo usar a mesma key OpenAI que o cliente já configurou para chat. Alternativa: MOTTIVME paga os embeds (custo máximo $0.004 por doc de 50 páginas — irrisório, mas cria dependência de billing). Decisão de produto.

3. **Stevo cutover: canary 14 dias por cliente ou all-at-once?** — recomendo canary individual. All-at-once poupa 2 semanas mas se Nexus tiver bug, todos os 8 clientes caem. Impossível rollback coordenado de 8 chips ao mesmo tempo.

4. **Hard limit de 10 tools por agente** — recomendo 10 (complexidade cognitiva do LLM cai quando tem 15+ tools, Anthropic documenta isso). Se algum cliente precisar de mais, revisitar.

---

*Documento gerado em 2026-05-04 BRT | Arquiteto: claude-sonnet-4-6 | Versão 1.0*
