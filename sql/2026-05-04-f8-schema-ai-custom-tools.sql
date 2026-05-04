-- =============================================================
-- migration: 2026-05-04-f8-schema-ai-custom-tools.sql
-- fase: Nexus F8 — IA Inbox
-- data: 2026-05-04 BRT
-- decisao: 3.A tool call sincrono 8s timeout + circuit breaker (3 falhas -> disabled)
--          BONUS hard limit 10 tools por agente (enforced via CHECK em ai_agents.tools_max)
-- descricao: Tools customizadas por agente. LLM emite tool_call, Nexus chama webhook_url.
--            Circuit breaker: 3 falhas consecutivas -> circuit_breaker_opened_at + enabled=false.
-- =============================================================

-- ============================================================
-- UP
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_custom_tools (
    id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    ai_agent_id                 uuid        NOT NULL REFERENCES public.ai_agents(id) ON DELETE CASCADE,
    tenant_id                   uuid        NOT NULL,
    name                        text        NOT NULL,
    description                 text        NOT NULL,
    parameters_schema           jsonb       NOT NULL DEFAULT '{}',
    webhook_url                 text        NOT NULL,
    webhook_secret              text,
    timeout_ms                  int         NOT NULL DEFAULT 8000
                                CHECK (timeout_ms BETWEEN 1000 AND 30000),
    circuit_breaker_failures    int         NOT NULL DEFAULT 0,
    circuit_breaker_opened_at   timestamptz,
    enabled                     boolean     NOT NULL DEFAULT true,
    created_at                  timestamptz NOT NULL DEFAULT now(),
    updated_at                  timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT uq_ai_custom_tools_agent_name UNIQUE (ai_agent_id, name),
    CONSTRAINT chk_ai_custom_tools_name_format
        CHECK (name ~ '^[a-z][a-z0-9_]*$')
);

COMMENT ON TABLE  public.ai_custom_tools IS 'Tools customizadas por agente. Nexus chama webhook_url quando LLM emite tool_call. Max 10 por agente (hard limit em ai_agents.tools_max, enforced no backend antes do INSERT). Decisao 3.A.';
COMMENT ON COLUMN public.ai_custom_tools.id IS 'PK uuid.';
COMMENT ON COLUMN public.ai_custom_tools.ai_agent_id IS 'FK ai_agents ON DELETE CASCADE.';
COMMENT ON COLUMN public.ai_custom_tools.tenant_id IS 'Denormalizado para RLS sem JOIN.';
COMMENT ON COLUMN public.ai_custom_tools.name IS 'Nome da tool em snake_case. Enviado ao LLM como identificador. Ex: consultar_pedido.';
COMMENT ON COLUMN public.ai_custom_tools.description IS 'Instrucao pro LLM de quando e como usar essa tool.';
COMMENT ON COLUMN public.ai_custom_tools.parameters_schema IS 'JSON Schema dos parametros aceitos pela tool. Passado ao LLM no tool definition.';
COMMENT ON COLUMN public.ai_custom_tools.webhook_url IS 'URL que o Nexus chama via HTTP POST quando LLM emite tool_call.';
COMMENT ON COLUMN public.ai_custom_tools.webhook_secret IS 'Secret HMAC-SHA256 opcional. Nexus assina payload com X-Nexus-Signature header.';
COMMENT ON COLUMN public.ai_custom_tools.timeout_ms IS 'Timeout da chamada ao webhook em ms. Default 8000 (8s). Max 30s. Decisao 3.A.';
COMMENT ON COLUMN public.ai_custom_tools.circuit_breaker_failures IS 'Contador de falhas consecutivas. Resetado em sucesso. Se >= 3, abre o circuit breaker.';
COMMENT ON COLUMN public.ai_custom_tools.circuit_breaker_opened_at IS 'Timestamp de quando o circuit breaker abriu (3 falhas atingidas). NULL = circuito fechado (saudavel).';
COMMENT ON COLUMN public.ai_custom_tools.enabled IS 'false quando circuit breaker abre automaticamente. Pode ser desabilitado manualmente pelo cliente.';

CREATE INDEX IF NOT EXISTS ix_ai_custom_tools_ai_agent_id
    ON public.ai_custom_tools(ai_agent_id);

CREATE INDEX IF NOT EXISTS ix_ai_custom_tools_tenant_id
    ON public.ai_custom_tools(tenant_id);

CREATE INDEX IF NOT EXISTS ix_ai_custom_tools_enabled
    ON public.ai_custom_tools(ai_agent_id, enabled)
    WHERE enabled = true;

ALTER TABLE public.ai_custom_tools ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_custom_tools_tenant_select"
    ON public.ai_custom_tools FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "ai_custom_tools_tenant_insert"
    ON public.ai_custom_tools FOR INSERT
    WITH CHECK (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "ai_custom_tools_tenant_update"
    ON public.ai_custom_tools FOR UPDATE
    USING (tenant_id = public.get_auth_tenant_id())
    WITH CHECK (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "ai_custom_tools_tenant_delete"
    ON public.ai_custom_tools FOR DELETE
    USING (tenant_id = public.get_auth_tenant_id());

COMMIT;

-- ============================================================
-- DOWN (rollback)
-- ============================================================
-- BEGIN;
-- DROP TABLE IF EXISTS public.ai_custom_tools CASCADE;
-- COMMIT;
