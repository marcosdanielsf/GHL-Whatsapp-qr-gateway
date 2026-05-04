-- =============================================================
-- migration: 2026-05-04-f8-schema-ai-agents.sql
-- fase: Nexus F8 — IA Inbox
-- data: 2026-05-04 BRT
-- decisao: 1.A Vercel AI SDK | 3.A tool call sincrono 8s | BONUS hard limit 10 tools
-- descricao: Tabela principal ai_agents — 1 agente por chip WhatsApp por tenant.
--            Toggle ai_agent_enabled em ghl_wa_instances controla ativacao.
-- =============================================================

-- ============================================================
-- UP
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_agents (
    id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             uuid        NOT NULL REFERENCES public.ghl_wa_tenants(id) ON DELETE CASCADE,
    instance_id           uuid        NOT NULL REFERENCES public.ghl_wa_instances(id) ON DELETE CASCADE,
    name                  text        NOT NULL,
    description           text,

    -- LLM config
    provider              text        NOT NULL DEFAULT 'openai'
                          CHECK (provider IN ('openai','anthropic','google','groq','grok','openrouter')),
    model                 text        NOT NULL DEFAULT 'gpt-4o-mini',
    system_prompt         text        NOT NULL DEFAULT ''
                          CHECK (char_length(system_prompt) <= 10000),
    temperature           numeric(3,2) NOT NULL DEFAULT 0.70
                          CHECK (temperature BETWEEN 0 AND 2),
    max_tokens            int         NOT NULL DEFAULT 1000
                          CHECK (max_tokens BETWEEN 64 AND 8192),

    -- Contexto de conversa
    max_history_msgs      int         NOT NULL DEFAULT 20
                          CHECK (max_history_msgs BETWEEN 5 AND 50),
    summarize_after_tokens int        NOT NULL DEFAULT 8000,

    -- Status e feature flags
    status                text        NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft','active','paused')),
    rag_enabled           boolean     NOT NULL DEFAULT false,
    tools_enabled         boolean     NOT NULL DEFAULT false,
    followup_enabled      boolean     NOT NULL DEFAULT false,
    business_hours_enabled boolean    NOT NULL DEFAULT false,
    out_of_hours_message  text        NOT NULL DEFAULT 'Voltamos em horário comercial.',

    -- Hard limit de tools por agente (BONUS — Decisao aprovada Marcos)
    tools_max             int         NOT NULL DEFAULT 10
                          CHECK (tools_max BETWEEN 0 AND 10),

    -- Follow-up
    followup_hours        numeric(4,1) NOT NULL DEFAULT 24.0,
    followup_max_times    int         NOT NULL DEFAULT 2,
    followup_message      text        NOT NULL DEFAULT 'Olá! Ainda está por aqui? Posso ajudar?',

    -- Business hours
    timezone              text        NOT NULL DEFAULT 'America/Sao_Paulo',

    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),

    -- 1 agente por chip (independente de status)
    CONSTRAINT uq_ai_agents_tenant_instance UNIQUE (tenant_id, instance_id)
);

COMMENT ON TABLE  public.ai_agents IS 'Agente IA por chip WhatsApp. 1 agente ativo por instância por tenant. Provider/model configurável por cliente (BYO key via tenant_ai_keys F3).';
COMMENT ON COLUMN public.ai_agents.id IS 'PK uuid gerado automaticamente.';
COMMENT ON COLUMN public.ai_agents.tenant_id IS 'FK ghl_wa_tenants — isolamento multi-tenant.';
COMMENT ON COLUMN public.ai_agents.instance_id IS 'FK ghl_wa_instances — chip vinculado. ON DELETE CASCADE.';
COMMENT ON COLUMN public.ai_agents.name IS 'Nome do agente exibido na UI. Ex: Assistente da Marina.';
COMMENT ON COLUMN public.ai_agents.description IS 'Descricao opcional do proposito do agente.';
COMMENT ON COLUMN public.ai_agents.provider IS 'Provider LLM. Mapeado ao Vercel AI SDK adapter. Decisao 1.A.';
COMMENT ON COLUMN public.ai_agents.model IS 'Identificador do modelo no provider. Ex: gpt-4o-mini, claude-3-5-haiku-latest.';
COMMENT ON COLUMN public.ai_agents.system_prompt IS 'Instrucao de sistema do agente. Max 10000 chars.';
COMMENT ON COLUMN public.ai_agents.temperature IS 'Criatividade do LLM. 0=deterministico, 2=maximo. Default 0.7.';
COMMENT ON COLUMN public.ai_agents.max_tokens IS 'Max tokens por resposta do LLM.';
COMMENT ON COLUMN public.ai_agents.max_history_msgs IS 'Janela de contexto em mensagens. Sliding window. Decisao 4.B.';
COMMENT ON COLUMN public.ai_agents.summarize_after_tokens IS 'Threshold de tokens para disparar job de sumarizacao do historico.';
COMMENT ON COLUMN public.ai_agents.status IS 'draft=configurando | active=respondendo mensagens | paused=pausado.';
COMMENT ON COLUMN public.ai_agents.rag_enabled IS 'Habilita busca semantica em ai_document_chunks antes de gerar resposta.';
COMMENT ON COLUMN public.ai_agents.tools_enabled IS 'Habilita tool_calling via webhooks do cliente. Decisao 3.A.';
COMMENT ON COLUMN public.ai_agents.followup_enabled IS 'Habilita follow-up automatico via BullMQ delayed job. Decisao F8-D.';
COMMENT ON COLUMN public.ai_agents.business_hours_enabled IS 'Se true, bloqueia resposta fora do horario e envia out_of_hours_message.';
COMMENT ON COLUMN public.ai_agents.out_of_hours_message IS 'Mensagem enviada fora do horario comercial quando business_hours_enabled=true.';
COMMENT ON COLUMN public.ai_agents.tools_max IS 'Hard limit de tools ativas por agente. Max 10. BONUS decisao aprovada.';
COMMENT ON COLUMN public.ai_agents.followup_hours IS 'Horas sem resposta do cliente para disparar nudge de follow-up.';
COMMENT ON COLUMN public.ai_agents.followup_max_times IS 'Quantas vezes o agente tenta follow-up antes de desistir.';
COMMENT ON COLUMN public.ai_agents.followup_message IS 'Template do nudge de follow-up. Pode ser personalizado pelo LLM.';
COMMENT ON COLUMN public.ai_agents.timezone IS 'Timezone IANA do agente para calculo de business hours. Default America/Sao_Paulo.';

-- Somente 1 agente com status=active por chip por tenant
CREATE UNIQUE INDEX IF NOT EXISTS ix_ai_agents_active_per_chip
    ON public.ai_agents(tenant_id, instance_id)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS ix_ai_agents_tenant_id
    ON public.ai_agents(tenant_id);

CREATE INDEX IF NOT EXISTS ix_ai_agents_instance_id
    ON public.ai_agents(instance_id);

CREATE INDEX IF NOT EXISTS ix_ai_agents_status
    ON public.ai_agents(status);

-- Toggle de ativacao no chip (sem FK — logico)
ALTER TABLE public.ghl_wa_instances
    ADD COLUMN IF NOT EXISTS ai_agent_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.ghl_wa_instances.ai_agent_enabled IS 'Toggle F8: se true, mensagens inbound sao roteadas ao AIInboxService. Controlado pelo wizard de agente.';

-- RLS
ALTER TABLE public.ai_agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_agents_tenant_select"
    ON public.ai_agents FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "ai_agents_tenant_insert"
    ON public.ai_agents FOR INSERT
    WITH CHECK (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "ai_agents_tenant_update"
    ON public.ai_agents FOR UPDATE
    USING (tenant_id = public.get_auth_tenant_id())
    WITH CHECK (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "ai_agents_tenant_delete"
    ON public.ai_agents FOR DELETE
    USING (tenant_id = public.get_auth_tenant_id());

COMMIT;

-- ============================================================
-- DOWN (rollback)
-- ============================================================
-- BEGIN;
-- DROP TABLE IF EXISTS public.ai_agents CASCADE;
-- ALTER TABLE public.ghl_wa_instances DROP COLUMN IF EXISTS ai_agent_enabled;
-- COMMIT;
