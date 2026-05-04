-- =============================================================
-- Migration: 2026-05-04-f3-schema-tenant-ai-keys.sql
-- Fase: F3-A — Disparo Inteligente (Nexus)
-- Data: 2026-05-04 BRT
-- Decisao 1.A BYO key: cliente traz seu próprio API key LLM.
--   MOTTIVME não vira revendedor. Custo LLM = R$0 para MOTTIVME.
--   Keys armazenadas criptografadas (pgp_sym_encrypt via backend).
--   NUNCA exposta via REST — backend acessa via service_role + decripta em memória.
-- Autor: supabase-dba agent
-- =============================================================

-- ════════════════════════════════════════════════════
-- UP
-- ════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.tenant_ai_keys (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid NOT NULL REFERENCES public.ghl_wa_tenants(id) ON DELETE CASCADE,

    provider            text NOT NULL
                        CHECK (provider IN ('openai','gemini','claude','groq')),

    api_key_encrypted   text NOT NULL,
    -- Armazenado via pgp_sym_encrypt(key, ENCRYPTION_SECRET) no backend Express.
    -- NUNCA plaintext. Backend decripta em memória apenas quando necessário para chamada LLM.
    -- Clientes NÃO acessam este campo via REST (policy SELECT exclui via RPC dedicada).

    label               text,
    -- Rótulo amigável para UI: ex: "Minha conta OpenAI"

    is_active           boolean NOT NULL DEFAULT true,
    last_used_at        timestamptz,
    last_error          text,
    -- Último erro de autenticação: ex: "Invalid API Key" — exibido na UI sem expor a key

    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),

    UNIQUE (tenant_id, provider)
    -- 1 key ativa por provider por tenant. Para trocar: UPDATE, não INSERT duplicado.
);

-- Comments
COMMENT ON TABLE  public.tenant_ai_keys                     IS 'BYO keys LLM dos tenants (Decisão 1.A). Criptografadas em repouso. Nunca expostas via REST.';
COMMENT ON COLUMN public.tenant_ai_keys.id                  IS 'PK UUID';
COMMENT ON COLUMN public.tenant_ai_keys.tenant_id           IS 'FK para ghl_wa_tenants — cascade delete';
COMMENT ON COLUMN public.tenant_ai_keys.provider            IS 'Provider LLM: openai|gemini|claude|groq';
COMMENT ON COLUMN public.tenant_ai_keys.api_key_encrypted   IS 'API key criptografada com pgp_sym_encrypt(key, ENCRYPTION_SECRET). Backend decripta em memória.';
COMMENT ON COLUMN public.tenant_ai_keys.label               IS 'Rótulo opcional para UI: ex: "Minha conta OpenAI"';
COMMENT ON COLUMN public.tenant_ai_keys.is_active           IS 'false = key desativada (ex: cliente trocou o plano)';
COMMENT ON COLUMN public.tenant_ai_keys.last_used_at        IS 'Última vez que a key foi usada para chamada LLM';
COMMENT ON COLUMN public.tenant_ai_keys.last_error          IS 'Último erro de autenticação registrado. Exibido na UI para diagnóstico.';

-- Indexes
CREATE INDEX IF NOT EXISTS ix_tenant_ai_keys_tenant_id
    ON public.tenant_ai_keys(tenant_id);

CREATE INDEX IF NOT EXISTS ix_tenant_ai_keys_tenant_provider
    ON public.tenant_ai_keys(tenant_id, provider)
    WHERE is_active = true;

-- RLS
ALTER TABLE public.tenant_ai_keys ENABLE ROW LEVEL SECURITY;

-- SELECT: tenant vê apenas seus registros — mas api_key_encrypted NUNCA é exposto via REST.
-- Backend (service_role) acessa a key para decriptar; frontend usa GET /api/settings/ai-keys
-- que retorna apenas {provider, label, is_active, last_used_at, last_error} sem a key.
CREATE POLICY "ai_keys_tenant_select"
    ON public.tenant_ai_keys FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "ai_keys_tenant_insert"
    ON public.tenant_ai_keys FOR INSERT
    WITH CHECK (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "ai_keys_tenant_update"
    ON public.tenant_ai_keys FOR UPDATE
    USING (tenant_id = public.get_auth_tenant_id())
    WITH CHECK (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "ai_keys_tenant_delete"
    ON public.tenant_ai_keys FOR DELETE
    USING (tenant_id = public.get_auth_tenant_id());

-- =============================================================
-- ROLLBACK
-- =============================================================
-- BEGIN;
-- DROP TABLE IF EXISTS public.tenant_ai_keys CASCADE;
-- COMMIT;
