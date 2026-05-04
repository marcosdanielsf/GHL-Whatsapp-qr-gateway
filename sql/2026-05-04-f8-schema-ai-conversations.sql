-- =============================================================
-- migration: 2026-05-04-f8-schema-ai-conversations.sql
-- fase: Nexus F8 — IA Inbox
-- data: 2026-05-04 BRT
-- decisao: 4.B sliding window 20 msgs + summarization automatica
-- descricao: Historico de conversas por contato por agente.
--            1 conversa ativa por (ai_agent_id, contact_phone).
--            history_messages = array JSONB {role, content, tokens} (ultimas N msgs).
--            history_summary = texto condensado das msgs antigas (gerado pelo job BullMQ ai:summarize).
-- =============================================================

-- ============================================================
-- UP
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_conversations (
    id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    ai_agent_id             uuid        NOT NULL REFERENCES public.ai_agents(id),
    tenant_id               uuid        NOT NULL,
    contact_phone           text        NOT NULL,
    contact_name            text,
    status                  text        NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active','idle','closed')),
    last_message_at         timestamptz,
    last_response_at        timestamptz,
    history_messages        jsonb       NOT NULL DEFAULT '[]',
    history_summary         text,
    total_tokens_input      int         NOT NULL DEFAULT 0,
    total_tokens_output     int         NOT NULL DEFAULT 0,
    tools_called            int         NOT NULL DEFAULT 0,
    rag_hits                int         NOT NULL DEFAULT 0,
    created_at              timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT uq_ai_conversations_agent_phone UNIQUE (ai_agent_id, contact_phone)
);

COMMENT ON TABLE  public.ai_conversations IS 'Thread de conversa entre 1 contato e 1 agente. UNIQUE por (ai_agent_id, contact_phone). history_messages mantem sliding window das ultimas N msgs. history_summary e gerado quando janela estoura (job BullMQ ai:summarize:{id}). Decisao 4.B.';
COMMENT ON COLUMN public.ai_conversations.id IS 'PK uuid.';
COMMENT ON COLUMN public.ai_conversations.ai_agent_id IS 'FK ai_agents — agente responsavel pela conversa.';
COMMENT ON COLUMN public.ai_conversations.tenant_id IS 'Denormalizado para RLS e queries de dashboard.';
COMMENT ON COLUMN public.ai_conversations.contact_phone IS 'Numero do contato em formato E.164. Ex: +5511999999999.';
COMMENT ON COLUMN public.ai_conversations.contact_name IS 'Nome do contato se disponivel via baileys pushName.';
COMMENT ON COLUMN public.ai_conversations.status IS 'active=agente respondendo | idle=sem atividade recente | closed=encerrada ou assumida por humano.';
COMMENT ON COLUMN public.ai_conversations.last_message_at IS 'Timestamp da ultima mensagem recebida do contato.';
COMMENT ON COLUMN public.ai_conversations.last_response_at IS 'Timestamp da ultima resposta enviada pelo agente.';
COMMENT ON COLUMN public.ai_conversations.history_messages IS 'Array JSONB de mensagens: [{role: user|assistant, content: string, tokens: int}]. Sliding window de max_history_msgs msgs.';
COMMENT ON COLUMN public.ai_conversations.history_summary IS 'Resumo das msgs antigas gerado pelo gpt-4o-mini quando janela estoura. Injetado no system prompt como contexto adicional.';
COMMENT ON COLUMN public.ai_conversations.total_tokens_input IS 'Acumulado de tokens de input consumidos. Para relatorio de custo por conversa.';
COMMENT ON COLUMN public.ai_conversations.total_tokens_output IS 'Acumulado de tokens de output consumidos. Para relatorio de custo por conversa.';
COMMENT ON COLUMN public.ai_conversations.tools_called IS 'Contador de tool_calls executadas nesta conversa. Para analytics.';
COMMENT ON COLUMN public.ai_conversations.rag_hits IS 'Contador de vezes que o RAG retornou chunks relevantes nesta conversa.';

-- Index parcial para conversas ativas (hot path do AIInboxService)
CREATE INDEX IF NOT EXISTS ix_ai_conversations_active
    ON public.ai_conversations(ai_agent_id, status)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS ix_ai_conversations_last_message_at
    ON public.ai_conversations(last_message_at DESC);

CREATE INDEX IF NOT EXISTS ix_ai_conversations_ai_agent_id
    ON public.ai_conversations(ai_agent_id);

CREATE INDEX IF NOT EXISTS ix_ai_conversations_tenant_id
    ON public.ai_conversations(tenant_id);

ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_conversations_tenant_select"
    ON public.ai_conversations FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "ai_conversations_tenant_insert"
    ON public.ai_conversations FOR INSERT
    WITH CHECK (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "ai_conversations_tenant_update"
    ON public.ai_conversations FOR UPDATE
    USING (tenant_id = public.get_auth_tenant_id())
    WITH CHECK (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "ai_conversations_tenant_delete"
    ON public.ai_conversations FOR DELETE
    USING (tenant_id = public.get_auth_tenant_id());

COMMIT;

-- ============================================================
-- DOWN (rollback)
-- ============================================================
-- BEGIN;
-- DROP TABLE IF EXISTS public.ai_conversations CASCADE;
-- COMMIT;
