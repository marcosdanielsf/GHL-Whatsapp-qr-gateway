-- =============================================================
-- Migration: 2026-05-04-f3-schema-campaigns.sql
-- Fase: F3-A — Disparo Inteligente (Nexus)
-- Data: 2026-05-04 BRT
-- Decisoes: 1.A BYO key | 2.B cache 5 variações | 3.B fila por tenant
-- Autor: supabase-dba agent
-- =============================================================

-- ════════════════════════════════════════════════════
-- UP
-- ════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.campaigns (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               uuid NOT NULL REFERENCES public.ghl_wa_tenants(id) ON DELETE CASCADE,
    instance_id             text NOT NULL,
    -- FK lógica para ghl_wa_instances.alias — sem FK real para evitar cascade issues com sessions

    name                    text NOT NULL,

    -- Template base digitado pelo cliente
    base_message            text NOT NULL,

    -- Provider LLM do tenant (key fica em tenant_ai_keys)
    provider                text NOT NULL DEFAULT 'openai'
                            CHECK (provider IN ('openai','gemini','claude')),

    -- Status do ciclo de vida
    status                  text NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft','scheduled','running','paused','completed','failed','cancelled')),

    -- Configuração de disparo
    send_immediately        boolean NOT NULL DEFAULT true,
    scheduled_at            timestamptz,
    delay_min_seconds       int NOT NULL DEFAULT 10 CHECK (delay_min_seconds >= 5),
    delay_max_seconds       int NOT NULL DEFAULT 20 CHECK (delay_max_seconds <= 30),
    batch_size              int NOT NULL DEFAULT 20,
    batch_delay_min_seconds int NOT NULL DEFAULT 60,
    batch_delay_max_seconds int NOT NULL DEFAULT 300,

    -- Origem da audiência
    audience_source         text NOT NULL DEFAULT 'csv'
                            CHECK (audience_source IN ('csv','ghl_tag','ghl_segment','manual')),
    ghl_filter              jsonb,

    -- Contadores denormalizados (dashboard rápido sem JOIN)
    total_recipients        int NOT NULL DEFAULT 0,
    sent_count              int NOT NULL DEFAULT 0,
    failed_count            int NOT NULL DEFAULT 0,
    replied_count           int NOT NULL DEFAULT 0,

    -- Metadados
    created_by              uuid NOT NULL REFERENCES auth.users(id),
    created_at              timestamptz NOT NULL DEFAULT now(),
    started_at              timestamptz,
    completed_at            timestamptz,
    updated_at              timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT chk_delay_range   CHECK (delay_min_seconds <= delay_max_seconds),
    CONSTRAINT chk_batch_delay   CHECK (batch_delay_min_seconds <= batch_delay_max_seconds),
    CONSTRAINT chk_scheduled_at  CHECK (send_immediately = true OR scheduled_at IS NOT NULL)
);

-- Comments
COMMENT ON TABLE  public.campaigns                    IS 'Campanhas de disparo em massa via WhatsApp. 1 campanha por tenant por chip.';
COMMENT ON COLUMN public.campaigns.id                 IS 'PK UUID';
COMMENT ON COLUMN public.campaigns.tenant_id          IS 'FK para ghl_wa_tenants — isolamento por tenant';
COMMENT ON COLUMN public.campaigns.instance_id        IS 'Alias/ID do chip Baileys que dispara (FK lógica, sem constraint)';
COMMENT ON COLUMN public.campaigns.name               IS 'Nome da campanha visível no dashboard';
COMMENT ON COLUMN public.campaigns.base_message       IS 'Mensagem original digitada pelo cliente — base para geração de variações IA';
COMMENT ON COLUMN public.campaigns.provider           IS 'Provider LLM usado para gerar variações. Key em tenant_ai_keys.';
COMMENT ON COLUMN public.campaigns.status             IS 'draft|scheduled|running|paused|completed|failed|cancelled';
COMMENT ON COLUMN public.campaigns.send_immediately   IS 'true = disparo imediato ao criar; false = aguarda scheduled_at';
COMMENT ON COLUMN public.campaigns.scheduled_at       IS 'Data/hora de início do disparo se send_immediately=false (BRT)';
COMMENT ON COLUMN public.campaigns.delay_min_seconds  IS 'Delay mínimo entre mensagens em segundos (anti-ban). Min absoluto: 5s.';
COMMENT ON COLUMN public.campaigns.delay_max_seconds  IS 'Delay máximo entre mensagens em segundos (anti-ban). Max absoluto: 30s.';
COMMENT ON COLUMN public.campaigns.batch_size         IS 'Quantidade de mensagens antes de pausa longa entre lotes';
COMMENT ON COLUMN public.campaigns.batch_delay_min_seconds IS 'Pausa mínima entre lotes em segundos';
COMMENT ON COLUMN public.campaigns.batch_delay_max_seconds IS 'Pausa máxima entre lotes em segundos';
COMMENT ON COLUMN public.campaigns.audience_source    IS 'Origem da lista: csv|ghl_tag|ghl_segment|manual';
COMMENT ON COLUMN public.campaigns.ghl_filter         IS 'Filtro GHL para importação: {"tag":"lead-frio"} ou {"segment_id":"abc"}';
COMMENT ON COLUMN public.campaigns.total_recipients   IS 'Total de destinatários da campanha (denormalizado)';
COMMENT ON COLUMN public.campaigns.sent_count         IS 'Mensagens enviadas com sucesso (denormalizado)';
COMMENT ON COLUMN public.campaigns.failed_count       IS 'Mensagens com falha (denormalizado)';
COMMENT ON COLUMN public.campaigns.replied_count      IS 'Destinatários que responderam (denormalizado)';
COMMENT ON COLUMN public.campaigns.created_by         IS 'FK auth.users — usuário que criou a campanha';
COMMENT ON COLUMN public.campaigns.started_at         IS 'Timestamp de início real do disparo';
COMMENT ON COLUMN public.campaigns.completed_at       IS 'Timestamp de conclusão (sent+failed = total)';

-- Indexes
CREATE INDEX IF NOT EXISTS ix_campaigns_tenant_id
    ON public.campaigns(tenant_id);

CREATE INDEX IF NOT EXISTS ix_campaigns_tenant_status
    ON public.campaigns(tenant_id, status);

CREATE INDEX IF NOT EXISTS ix_campaigns_scheduled
    ON public.campaigns(scheduled_at)
    WHERE scheduled_at IS NOT NULL AND status = 'scheduled';

CREATE INDEX IF NOT EXISTS ix_campaigns_running
    ON public.campaigns(tenant_id, instance_id)
    WHERE status = 'running';

-- RLS
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "campaigns_tenant_select"
    ON public.campaigns FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "campaigns_tenant_insert"
    ON public.campaigns FOR INSERT
    WITH CHECK (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "campaigns_tenant_update"
    ON public.campaigns FOR UPDATE
    USING (tenant_id = public.get_auth_tenant_id())
    WITH CHECK (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "campaigns_tenant_delete"
    ON public.campaigns FOR DELETE
    USING (tenant_id = public.get_auth_tenant_id());

-- =============================================================
-- ROLLBACK
-- =============================================================
-- BEGIN;
-- DROP TABLE IF EXISTS public.campaigns CASCADE;
-- COMMIT;
