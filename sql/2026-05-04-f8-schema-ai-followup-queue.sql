-- =============================================================
-- migration: 2026-05-04-f8-schema-ai-followup-queue.sql
-- fase: Nexus F8 — IA Inbox
-- data: 2026-05-04 BRT
-- decisao: F8-D BullMQ delayed job por conversa para follow-up preciso
-- descricao: Log permanente de follow-ups agendados/enviados/cancelados.
--            O job BullMQ e efemero (Redis); este log e auditoria permanente.
--            Lock otimista: UPDATE SET status=sent WHERE status=scheduled evita race condition.
-- =============================================================

-- ============================================================
-- UP
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_followup_queue (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id     uuid        NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
    ai_agent_id         uuid        NOT NULL,
    tenant_id           uuid        NOT NULL,
    check_at            timestamptz NOT NULL,
    sent                boolean     NOT NULL DEFAULT false,
    sent_at             timestamptz,
    cancelled           boolean     NOT NULL DEFAULT false,
    reason              text,
    created_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.ai_followup_queue IS 'Registro de auditoria de follow-ups. O BullMQ job e efemero (Redis); este log e permanente. Lock otimista para race condition: UPDATE SET sent=true WHERE id=X AND sent=false AND cancelled=false — 0 rows afetadas = outro processo ja processou. Decisao F8-D.';
COMMENT ON COLUMN public.ai_followup_queue.id IS 'PK uuid.';
COMMENT ON COLUMN public.ai_followup_queue.conversation_id IS 'FK ai_conversations ON DELETE CASCADE.';
COMMENT ON COLUMN public.ai_followup_queue.ai_agent_id IS 'Denormalizado para queries por agente sem JOIN.';
COMMENT ON COLUMN public.ai_followup_queue.tenant_id IS 'Denormalizado para RLS sem JOIN.';
COMMENT ON COLUMN public.ai_followup_queue.check_at IS 'Timestamp de quando o cron/job deve processar este follow-up.';
COMMENT ON COLUMN public.ai_followup_queue.sent IS 'true = nudge enviado ao contato.';
COMMENT ON COLUMN public.ai_followup_queue.sent_at IS 'Timestamp de envio efetivo.';
COMMENT ON COLUMN public.ai_followup_queue.cancelled IS 'true = contato respondeu antes do check_at, follow-up cancelado.';
COMMENT ON COLUMN public.ai_followup_queue.reason IS 'Descricao do motivo para debug. Ex: customer_replied, max_attempts_reached.';

-- Index para o job BullMQ consultar follow-ups pendentes
CREATE INDEX IF NOT EXISTS ix_ai_followup_queue_check_at
    ON public.ai_followup_queue(check_at)
    WHERE sent = false AND cancelled = false;

CREATE INDEX IF NOT EXISTS ix_ai_followup_queue_conversation_id
    ON public.ai_followup_queue(conversation_id);

CREATE INDEX IF NOT EXISTS ix_ai_followup_queue_tenant_id
    ON public.ai_followup_queue(tenant_id);

ALTER TABLE public.ai_followup_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_followup_queue_tenant_select"
    ON public.ai_followup_queue FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "ai_followup_queue_tenant_insert"
    ON public.ai_followup_queue FOR INSERT
    WITH CHECK (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "ai_followup_queue_tenant_update"
    ON public.ai_followup_queue FOR UPDATE
    USING (tenant_id = public.get_auth_tenant_id())
    WITH CHECK (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "ai_followup_queue_tenant_delete"
    ON public.ai_followup_queue FOR DELETE
    USING (tenant_id = public.get_auth_tenant_id());

COMMIT;

-- ============================================================
-- DOWN (rollback)
-- ============================================================
-- BEGIN;
-- DROP TABLE IF EXISTS public.ai_followup_queue CASCADE;
-- COMMIT;
