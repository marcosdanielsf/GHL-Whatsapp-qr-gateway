-- Tabela para armazenar sessões do Baileys (substitui arquivos locais)
CREATE TABLE IF NOT EXISTS ghl_wa_sessions (
  instance_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (instance_id, key)
);

-- Index para buscar chaves rapidamente
CREATE INDEX IF NOT EXISTS idx_ghl_wa_sessions_instance ON ghl_wa_sessions(instance_id);

-- Tabela para gerenciar instâncias e vincular a Tenants (SaaS)
CREATE TABLE IF NOT EXISTS ghl_wa_instances (
  id TEXT PRIMARY KEY, -- Formato: "tenantId-instanceName"
  tenant_id UUID NOT NULL REFERENCES ghl_wa_tenants(id),
  name TEXT NOT NULL, -- Ex: "wa-01"
  alias TEXT,
  status TEXT DEFAULT 'offline',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ghl_wa_instances_tenant ON ghl_wa_instances(tenant_id);

-- Função para atualizar timestamp automaticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_ghl_wa_sessions_modtime ON ghl_wa_sessions;
CREATE TRIGGER update_ghl_wa_sessions_modtime
    BEFORE UPDATE ON ghl_wa_sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_ghl_wa_instances_modtime ON ghl_wa_instances;
CREATE TRIGGER update_ghl_wa_instances_modtime
    BEFORE UPDATE ON ghl_wa_instances
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
