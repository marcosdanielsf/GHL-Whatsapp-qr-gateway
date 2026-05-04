-- =============================================================
-- Migration: 2026-05-04-f3-instances-rate-state.sql
-- Fase: F3-A — Disparo Inteligente (Nexus)
-- Data: 2026-05-04 BRT
-- Decisao 3.B: token bucket por chip para anti-ban.
--   Adiciona colunas de rate-limit em ghl_wa_instances.
--   Worker verifica daily_sent_count < daily_limit antes de cada envio.
--   Reset diário às 00:00 BRT via cron (pg_cron ou worker job).
--   cold=50 msgs/dia | warming=150 msgs/dia | hot=250 msgs/dia
-- Autor: supabase-dba agent
-- =============================================================

-- ════════════════════════════════════════════════════
-- UP
-- ════════════════════════════════════════════════════

ALTER TABLE public.ghl_wa_instances
    ADD COLUMN IF NOT EXISTS daily_sent_count    int NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS daily_limit         int NOT NULL DEFAULT 200,
    ADD COLUMN IF NOT EXISTS warmup_phase        text NOT NULL DEFAULT 'hot'
                                                 CHECK (warmup_phase IN ('cold','warming','hot')),
    ADD COLUMN IF NOT EXISTS rate_last_reset_at  timestamptz NOT NULL DEFAULT now();

-- Comments
COMMENT ON COLUMN public.ghl_wa_instances.daily_sent_count   IS 'Mensagens enviadas hoje por este chip. Resetado às 00:00 BRT pelo worker ou pg_cron.';
COMMENT ON COLUMN public.ghl_wa_instances.daily_limit        IS 'Limite diário de mensagens para este chip. cold=50, warming=150, hot=250. Editável pelo cliente.';
COMMENT ON COLUMN public.ghl_wa_instances.warmup_phase       IS 'Fase de aquecimento do chip: cold (<7 dias) | warming (7-30 dias) | hot (>30 dias com histórico orgânico)';
COMMENT ON COLUMN public.ghl_wa_instances.rate_last_reset_at IS 'Timestamp do último reset de daily_sent_count. Usado pelo worker para detectar que o dia mudou.';

-- Index para o worker consultar instâncias com bucket disponível
CREATE INDEX IF NOT EXISTS ix_instances_rate_state
    ON public.ghl_wa_instances(tenant_id, daily_sent_count, daily_limit)
    WHERE daily_sent_count < daily_limit;

-- =============================================================
-- ROLLBACK
-- =============================================================
-- BEGIN;
-- ALTER TABLE public.ghl_wa_instances
--     DROP COLUMN IF EXISTS daily_sent_count,
--     DROP COLUMN IF EXISTS daily_limit,
--     DROP COLUMN IF EXISTS warmup_phase,
--     DROP COLUMN IF EXISTS rate_last_reset_at;
-- DROP INDEX IF EXISTS ix_instances_rate_state;
-- COMMIT;
