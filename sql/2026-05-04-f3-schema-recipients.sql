-- =============================================================
-- Migration: 2026-05-04-f3-schema-recipients.sql
-- Fase: F3-A — Disparo Inteligente (Nexus)
-- Data: 2026-05-04 BRT
-- Volume estimado: 5 clientes × 1000 msgs × 10 campanhas/mês
--   = 50k rows/mês. Índices em campaign_id+status são suficientes
--   para 300k rows em 6 meses (sem partitioning necessário agora).
-- Autor: supabase-dba agent
-- =============================================================

-- Depende de: campaigns, campaign_variants

-- ════════════════════════════════════════════════════
-- UP
-- ════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.campaign_recipients (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id     uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    tenant_id       uuid NOT NULL,
    -- tenant_id denormalizado para RLS sem JOIN

    phone           text NOT NULL,
    -- E.164 normalizado (+5511999998888), validado via libphonenumber no backend

    name            text,
    ghl_contact_id  text,
    -- ID do contato no GHL (quando audience_source = ghl_tag | ghl_segment)

    extra_data      jsonb,
    -- Campos extras do CSV ou GHL para merge tags futuras (ex: {empresa, cargo})

    status          text NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','sending','sent','failed','replied','skipped','opted_out')),

    variant_id      uuid REFERENCES public.campaign_variants(id),
    -- Variação usada neste envio (preenchida pelo worker na hora do disparo)

    bullmq_job_id   text,
    -- Job BullMQ associado — necessário para cancelamento granular

    sent_at         timestamptz,
    failed_at       timestamptz,
    fail_reason     text,
    retry_count     int NOT NULL DEFAULT 0,

    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),

    UNIQUE (campaign_id, phone)
    -- Garante 1 envio por número por campanha — evita duplicatas em re-upload de CSV
);

-- Comments
COMMENT ON TABLE  public.campaign_recipients                IS 'Lista de destinatários de uma campanha. 1 row por contato. Status rastreado individualmente.';
COMMENT ON COLUMN public.campaign_recipients.id             IS 'PK UUID';
COMMENT ON COLUMN public.campaign_recipients.campaign_id    IS 'FK para campaigns — cascade delete';
COMMENT ON COLUMN public.campaign_recipients.tenant_id      IS 'Denormalizado de campaigns.tenant_id para RLS direta sem JOIN';
COMMENT ON COLUMN public.campaign_recipients.phone          IS 'Número E.164 normalizado (+5511999998888). Validado via libphonenumber no upload.';
COMMENT ON COLUMN public.campaign_recipients.name           IS 'Nome para personalização futura de merge tags';
COMMENT ON COLUMN public.campaign_recipients.ghl_contact_id IS 'ID do contato no GHL quando audiência veio de ghl_tag ou ghl_segment';
COMMENT ON COLUMN public.campaign_recipients.extra_data     IS 'JSONB com campos extras do CSV/GHL para merge tags (empresa, cargo, etc.)';
COMMENT ON COLUMN public.campaign_recipients.status         IS 'queued=aguardando | sending=em envio | sent=enviado | failed=falhou | replied=respondeu | skipped=pulado | opted_out=optou por sair';
COMMENT ON COLUMN public.campaign_recipients.variant_id     IS 'FK para campaign_variants — qual variação foi usada. Preenchida pelo worker.';
COMMENT ON COLUMN public.campaign_recipients.bullmq_job_id  IS 'ID do job BullMQ para cancelamento granular se necessário';
COMMENT ON COLUMN public.campaign_recipients.fail_reason    IS 'Motivo da falha (ex: chip offline, número inválido, rate limit)';
COMMENT ON COLUMN public.campaign_recipients.retry_count    IS 'Número de tentativas de reenvio';

-- Indexes (volume alto — críticos para performance do worker)
CREATE INDEX IF NOT EXISTS ix_campaign_recipients_campaign_id
    ON public.campaign_recipients(campaign_id);

CREATE INDEX IF NOT EXISTS ix_campaign_recipients_campaign_status
    ON public.campaign_recipients(campaign_id, status);

CREATE INDEX IF NOT EXISTS ix_campaign_recipients_tenant_id
    ON public.campaign_recipients(tenant_id);

CREATE INDEX IF NOT EXISTS ix_campaign_recipients_queued
    ON public.campaign_recipients(campaign_id, created_at)
    WHERE status = 'queued';
-- Usado pelo worker para pegar o próximo lote em ordem FIFO

CREATE INDEX IF NOT EXISTS ix_campaign_recipients_ghl_contact
    ON public.campaign_recipients(ghl_contact_id)
    WHERE ghl_contact_id IS NOT NULL;

-- RLS
ALTER TABLE public.campaign_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recipients_tenant_select"
    ON public.campaign_recipients FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "recipients_tenant_insert"
    ON public.campaign_recipients FOR INSERT
    WITH CHECK (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "recipients_tenant_update"
    ON public.campaign_recipients FOR UPDATE
    USING (tenant_id = public.get_auth_tenant_id())
    WITH CHECK (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "recipients_tenant_delete"
    ON public.campaign_recipients FOR DELETE
    USING (tenant_id = public.get_auth_tenant_id());

-- =============================================================
-- ROLLBACK
-- =============================================================
-- BEGIN;
-- DROP TABLE IF EXISTS public.campaign_recipients CASCADE;
-- COMMIT;
