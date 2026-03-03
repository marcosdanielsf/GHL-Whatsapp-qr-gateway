-- Migration: Adicionar FK ghl_wa_instances.ghl_integration_id
-- Supabase: bfumywvwubvernvhjehk
-- Branch: fix/p2-types | Fix 10
-- Autor: Claude / Marcos Daniels
-- Data: 2026-03-03

-- ─────────────────────────────────────────────────────────────
-- PASSO 1: Adicionar coluna se ainda não existir
-- ─────────────────────────────────────────────────────────────
ALTER TABLE ghl_wa_instances
  ADD COLUMN IF NOT EXISTS ghl_integration_id UUID;

-- ─────────────────────────────────────────────────────────────
-- PASSO 2: Adicionar FK para ghl_wa_integrations
-- Usar IF NOT EXISTS via bloco DO para evitar erro se já existir
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   information_schema.table_constraints
    WHERE  constraint_name = 'ghl_wa_instances_ghl_integration_id_fkey'
      AND  table_name      = 'ghl_wa_instances'
  ) THEN
    ALTER TABLE ghl_wa_instances
      ADD CONSTRAINT ghl_wa_instances_ghl_integration_id_fkey
      FOREIGN KEY (ghl_integration_id)
      REFERENCES ghl_wa_integrations(id)
      ON DELETE SET NULL;
  END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- PASSO 3: Índice para performance nas lookups por integração
-- ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ghl_wa_instances_integration_id
  ON ghl_wa_instances(ghl_integration_id);

-- ─────────────────────────────────────────────────────────────
-- PASSO 4: Preencher ghl_integration_id nas instâncias existentes
-- que ainda não têm o campo preenchido mas têm tenant_id
-- (busca a integração ativa do mesmo tenant)
-- ─────────────────────────────────────────────────────────────
UPDATE ghl_wa_instances inst
SET    ghl_integration_id = (
  SELECT integ.id
  FROM   ghl_wa_integrations integ
  WHERE  integ.tenant_id = inst.tenant_id
    AND  integ.is_active  = true
  ORDER BY integ.created_at DESC
  LIMIT 1
)
WHERE  inst.ghl_integration_id IS NULL
  AND  inst.tenant_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- VERIFICAÇÃO — roda como SELECT (não altera nada)
-- ─────────────────────────────────────────────────────────────
SELECT
  i.id,
  i.name,
  i.tenant_id,
  i.ghl_integration_id,
  integ.location_id AS integration_location_id
FROM ghl_wa_instances i
LEFT JOIN ghl_wa_integrations integ ON integ.id = i.ghl_integration_id
ORDER BY i.created_at DESC
LIMIT 20;
