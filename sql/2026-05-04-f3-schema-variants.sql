-- =============================================================
-- Migration: 2026-05-04-f3-schema-variants.sql
-- Fase: F3-A — Disparo Inteligente (Nexus)
-- Data: 2026-05-04 BRT
-- Decisao 2.B: cache de 5 variações geradas 1x no wizard (step 3)
--   antes do disparo. Worker sorteia variant_index na hora do envio.
--   Custo ~$0,001/campanha vs $0,14 em call-por-msg.
-- Autor: supabase-dba agent
-- =============================================================

-- Depende de: campaigns (2026-05-04-f3-schema-campaigns.sql)

-- ════════════════════════════════════════════════════
-- UP
-- ════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.campaign_variants (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id     uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    tenant_id       uuid NOT NULL,
    -- tenant_id denormalizado: evita JOIN em cada verificação RLS no worker
    -- deve ser preenchido com o mesmo tenant_id da campaign

    variant_index   smallint NOT NULL CHECK (variant_index BETWEEN 1 AND 10),
    content         text NOT NULL,
    approved        boolean NOT NULL DEFAULT true,
    generated_by    text NOT NULL DEFAULT 'ai'
                    CHECK (generated_by IN ('ai','manual')),

    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),

    UNIQUE (campaign_id, variant_index)
);

-- Comments
COMMENT ON TABLE  public.campaign_variants                IS 'Variações de texto geradas por IA (ou editadas) para uma campanha. Max 10 por campanha, default 5.';
COMMENT ON COLUMN public.campaign_variants.id             IS 'PK UUID';
COMMENT ON COLUMN public.campaign_variants.campaign_id    IS 'FK para campaigns — cascade delete';
COMMENT ON COLUMN public.campaign_variants.tenant_id      IS 'Denormalizado de campaigns.tenant_id para RLS direta sem JOIN';
COMMENT ON COLUMN public.campaign_variants.variant_index  IS 'Índice da variação (1..10). Worker sorteia aleatoriamente entre aprovadas.';
COMMENT ON COLUMN public.campaign_variants.content        IS 'Texto da variação. Editável pelo cliente no wizard antes de confirmar o disparo.';
COMMENT ON COLUMN public.campaign_variants.approved       IS 'false = variação desativada pelo cliente. Worker ignora variações não aprovadas.';
COMMENT ON COLUMN public.campaign_variants.generated_by   IS 'ai = gerada pelo LLM | manual = digitada/editada pelo cliente';

-- Indexes
CREATE INDEX IF NOT EXISTS ix_campaign_variants_campaign_id
    ON public.campaign_variants(campaign_id);

CREATE INDEX IF NOT EXISTS ix_campaign_variants_approved
    ON public.campaign_variants(campaign_id, variant_index)
    WHERE approved = true;

-- RLS
ALTER TABLE public.campaign_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "variants_tenant_select"
    ON public.campaign_variants FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "variants_tenant_insert"
    ON public.campaign_variants FOR INSERT
    WITH CHECK (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "variants_tenant_update"
    ON public.campaign_variants FOR UPDATE
    USING (tenant_id = public.get_auth_tenant_id())
    WITH CHECK (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "variants_tenant_delete"
    ON public.campaign_variants FOR DELETE
    USING (tenant_id = public.get_auth_tenant_id());

-- =============================================================
-- ROLLBACK
-- =============================================================
-- BEGIN;
-- DROP TABLE IF EXISTS public.campaign_variants CASCADE;
-- COMMIT;
