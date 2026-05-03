-- 2026-05-03 BRT — F1 Task 6: webhook events selecionáveis
-- Roadmap: nexus-paridade-stevo-roadmap-2026-05-03.md F1

ALTER TABLE public.ghl_wa_tenants
  ADD COLUMN IF NOT EXISTS webhook_events jsonb
  DEFAULT '["message_received","message_sent"]'::jsonb;

COMMENT ON COLUMN public.ghl_wa_tenants.webhook_events IS
  'Array de eventos que disparam webhook. Default: message_received, message_sent. Outros: instance_connected, instance_disconnected, qr_generated, message_failed.';

-- ROLLBACK:
-- ALTER TABLE public.ghl_wa_tenants DROP COLUMN IF EXISTS webhook_events;
