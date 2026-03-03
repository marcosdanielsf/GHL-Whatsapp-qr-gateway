-- Fix 11: RLS policy ghl_wa_integrations — tenant isolation
-- Supabase: bfumywvwubvernvhjehk
-- Branch: fix/p3-security
-- Autor: Claude / Marcos Daniels | 2026-03-03
--
-- NOTA: O gateway usa SUPABASE_SERVICE_KEY (service role), que bypassa RLS
-- automaticamente. Estas policies protegem acesso via anon key + JWT do usuário,
-- prevenindo vazamento entre tenants caso alguém acesse a API diretamente.
--
-- ROLLBACK: Seção no final do arquivo

-- ─────────────────────────────────────────────────────────────
-- PRÉ-CONDIÇÃO: verificar se a tabela existe
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name   = 'ghl_wa_integrations'
  ) THEN
    RAISE EXCEPTION 'Tabela ghl_wa_integrations não existe. Abortando.';
  END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- PASSO 1: Habilitar RLS
-- ─────────────────────────────────────────────────────────────
ALTER TABLE ghl_wa_integrations ENABLE ROW LEVEL SECURITY;

-- FORCE garante que mesmo o owner da tabela (postgres) é bloqueado,
-- exceto o service role (bypassa RLS sempre no Supabase).
ALTER TABLE ghl_wa_integrations FORCE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────
-- PASSO 2: Remover policies antigas (idempotência)
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "tenant_isolation_select" ON ghl_wa_integrations;
DROP POLICY IF EXISTS "tenant_isolation_insert" ON ghl_wa_integrations;
DROP POLICY IF EXISTS "tenant_isolation_update" ON ghl_wa_integrations;
DROP POLICY IF EXISTS "tenant_isolation_delete" ON ghl_wa_integrations;
DROP POLICY IF EXISTS "tenant_isolation"        ON ghl_wa_integrations;

-- ─────────────────────────────────────────────────────────────
-- PASSO 3: Policy unificada — usuario só acessa seu tenant
-- Lookup em ghl_wa_users conecta auth.uid() → tenant_id
-- ─────────────────────────────────────────────────────────────
CREATE POLICY "tenant_isolation"
  ON ghl_wa_integrations
  FOR ALL
  USING (
    tenant_id = (
      SELECT tenant_id
      FROM   ghl_wa_users
      WHERE  id = auth.uid()
      LIMIT  1
    )
  )
  WITH CHECK (
    tenant_id = (
      SELECT tenant_id
      FROM   ghl_wa_users
      WHERE  id = auth.uid()
      LIMIT  1
    )
  );

-- ─────────────────────────────────────────────────────────────
-- VERIFICAÇÃO: listar policies ativas na tabela
-- ─────────────────────────────────────────────────────────────
SELECT
  schemaname,
  tablename,
  policyname,
  roles,
  cmd,
  qual
FROM pg_policies
WHERE tablename = 'ghl_wa_integrations'
ORDER BY policyname;

-- ─────────────────────────────────────────────────────────────
-- ROLLBACK (executar apenas se precisar reverter)
-- ─────────────────────────────────────────────────────────────
-- DROP POLICY IF EXISTS "tenant_isolation" ON ghl_wa_integrations;
-- ALTER TABLE ghl_wa_integrations DISABLE ROW LEVEL SECURITY;
