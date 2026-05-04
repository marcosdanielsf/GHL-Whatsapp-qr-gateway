-- =============================================================
-- migration: 2026-05-04-f8-schema-ai-business-hours.sql
-- fase: Nexus F8 — IA Inbox
-- data: 2026-05-04 BRT
-- decisao: Decisao 6 — modelo simples timezone + horarios seg-dom por dia
--          Formato schedule JSONB: {"mon":[["09:00","18:00"]],"tue":[],...}
-- descricao: Horarios comerciais por agente. 1 row por agente (schedule JSONB).
--            Backend valida se agora esta dentro do horario antes de chamar LLM.
-- =============================================================

-- ============================================================
-- UP
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_business_hours (
    id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    ai_agent_id           uuid        NOT NULL UNIQUE REFERENCES public.ai_agents(id) ON DELETE CASCADE,
    tenant_id             uuid        NOT NULL,
    timezone              text        NOT NULL DEFAULT 'America/Sao_Paulo',
    schedule              jsonb       NOT NULL DEFAULT '{"mon":[["09:00","18:00"]],"tue":[["09:00","18:00"]],"wed":[["09:00","18:00"]],"thu":[["09:00","18:00"]],"fri":[["09:00","18:00"]],"sat":[],"sun":[]}',
    holidays              jsonb       NOT NULL DEFAULT '[]',
    out_of_hours_action   text        NOT NULL DEFAULT 'respond'
                          CHECK (out_of_hours_action IN ('respond','queue','silent')),
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.ai_business_hours IS '1 row por agente. Horarios comerciais usados pelo AIInboxService antes de chamar o LLM. Formato schedule: {"mon":[["09:00","18:00"]],...,"sat":[],"sun":[]}. Array vazio = dia fechado. Feriados em holidays como array de YYYY-MM-DD. Decisao 6.';
COMMENT ON COLUMN public.ai_business_hours.id IS 'PK uuid.';
COMMENT ON COLUMN public.ai_business_hours.ai_agent_id IS 'FK ai_agents UNIQUE — 1 configuracao por agente. ON DELETE CASCADE.';
COMMENT ON COLUMN public.ai_business_hours.tenant_id IS 'Denormalizado para RLS.';
COMMENT ON COLUMN public.ai_business_hours.timezone IS 'Timezone IANA. Ex: America/Sao_Paulo, America/New_York. Default BRT.';
COMMENT ON COLUMN public.ai_business_hours.schedule IS 'JSONB com horarios por dia da semana. Chaves: mon|tue|wed|thu|fri|sat|sun. Valor: array de pares ["HH:MM","HH:MM"]. Array vazio = fechado. Ex: {"mon":[["09:00","18:00"],["19:00","21:00"]],"sat":[]}.';
COMMENT ON COLUMN public.ai_business_hours.holidays IS 'Array de datas YYYY-MM-DD em que o agente nao responde. Ex: ["2026-12-25","2026-01-01"].';
COMMENT ON COLUMN public.ai_business_hours.out_of_hours_action IS 'respond=envia out_of_hours_message (ai_agents) | queue=enfileira sem responder | silent=ignora mensagem.';

CREATE INDEX IF NOT EXISTS ix_ai_business_hours_ai_agent_id
    ON public.ai_business_hours(ai_agent_id);

CREATE INDEX IF NOT EXISTS ix_ai_business_hours_tenant_id
    ON public.ai_business_hours(tenant_id);

ALTER TABLE public.ai_business_hours ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_business_hours_tenant_select"
    ON public.ai_business_hours FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "ai_business_hours_tenant_insert"
    ON public.ai_business_hours FOR INSERT
    WITH CHECK (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "ai_business_hours_tenant_update"
    ON public.ai_business_hours FOR UPDATE
    USING (tenant_id = public.get_auth_tenant_id())
    WITH CHECK (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "ai_business_hours_tenant_delete"
    ON public.ai_business_hours FOR DELETE
    USING (tenant_id = public.get_auth_tenant_id());

COMMIT;

-- ============================================================
-- DOWN (rollback)
-- ============================================================
-- BEGIN;
-- DROP TABLE IF EXISTS public.ai_business_hours CASCADE;
-- COMMIT;
