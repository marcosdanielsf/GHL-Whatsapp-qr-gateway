-- 2026-05-03 BRT — F1 Task 2: RLS multi-tenant em ghl_wa_message_history
-- Roadmap: nexus-paridade-stevo-roadmap-2026-05-03.md F1
--
-- Mapping descoberto durante implementação:
--   ghl_wa_message_history.instance_id (text) = tenant_id || '-' || ghl_wa_instances.name
--   Exemplo real: "e496ec12-078c-4003-b42f-d15df61bc4b7-wa-01"
-- Por isso usamos LIKE prefix em vez de JOIN direto (não há tenant_id na tabela).

ALTER TABLE public.ghl_wa_message_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own tenant messages" ON public.ghl_wa_message_history;

CREATE POLICY "Users can view own tenant messages"
  ON public.ghl_wa_message_history
  FOR SELECT
  USING (instance_id LIKE public.get_auth_tenant_id()::text || '-%');

-- Backend Express usa SUPABASE_SERVICE_ROLE_KEY que bypassa RLS — INSERT/UPDATE/DELETE seguem funcionando.

-- ROLLBACK:
-- DROP POLICY IF EXISTS "Users can view own tenant messages" ON public.ghl_wa_message_history;
-- ALTER TABLE public.ghl_wa_message_history DISABLE ROW LEVEL SECURITY;
