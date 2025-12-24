-- Schema para WhatsApp Gateway com prefixo ghl_wa_
-- Projeto: Supabase CEO (bfumywvwubvernvhjehk)
-- Data: 2025-12-19
-- NOTA: ghl_wa_instances já existe, criando apenas as tabelas faltantes

-- ============================================
-- 1. FILA DE MENSAGENS (substitui Bull Queue)
-- ============================================
CREATE TABLE IF NOT EXISTS ghl_wa_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting', -- waiting, active, completed, failed, delayed
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  error_message TEXT,
  scheduled_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ghl_wa_queue_status ON ghl_wa_queue(status);
CREATE INDEX IF NOT EXISTS idx_ghl_wa_queue_instance ON ghl_wa_queue(instance_id);
CREATE INDEX IF NOT EXISTS idx_ghl_wa_queue_created ON ghl_wa_queue(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ghl_wa_queue_scheduled ON ghl_wa_queue(scheduled_at) WHERE scheduled_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS ghl_wa_message_queue (
  id BIGSERIAL PRIMARY KEY,
  instance_id TEXT NOT NULL,
  type TEXT NOT NULL,
  to_number TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ghl_wa_message_queue_status ON ghl_wa_message_queue(status);
CREATE INDEX IF NOT EXISTS idx_ghl_wa_message_queue_next_attempt ON ghl_wa_message_queue(next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_ghl_wa_message_queue_instance ON ghl_wa_message_queue(instance_id);
CREATE INDEX IF NOT EXISTS idx_ghl_wa_message_queue_status_next_attempt_created ON ghl_wa_message_queue(status, next_attempt_at, created_at);

-- ============================================
-- 2. MENSAGENS PENDENTES POR NÚMERO
-- ============================================
CREATE TABLE IF NOT EXISTS ghl_wa_pending_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id TEXT NOT NULL,
  normalized_number TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ghl_wa_pending_instance_number ON ghl_wa_pending_messages(instance_id, normalized_number);
CREATE INDEX IF NOT EXISTS idx_ghl_wa_pending_created ON ghl_wa_pending_messages(created_at DESC);

-- ============================================
-- 3. SESSÕES BAILEYS (WhatsApp)
-- ============================================
CREATE TABLE IF NOT EXISTS ghl_wa_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id TEXT NOT NULL UNIQUE,
  session_data JSONB NOT NULL,
  qr_code TEXT,
  status TEXT DEFAULT 'disconnected', -- disconnected, connecting, connected, qr_ready
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ghl_wa_sessions_instance ON ghl_wa_sessions(instance_id);
CREATE INDEX IF NOT EXISTS idx_ghl_wa_sessions_status ON ghl_wa_sessions(status);

-- ============================================
-- 4. CACHE GENÉRICO (substitui Redis)
-- ============================================
CREATE TABLE IF NOT EXISTS ghl_wa_cache (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ghl_wa_cache_expires ON ghl_wa_cache(expires_at) WHERE expires_at IS NOT NULL;

-- ============================================
-- FUNÇÕES AUXILIARES
-- ============================================

-- Auto-update do updated_at (criar apenas se não existir)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers para updated_at
DROP TRIGGER IF EXISTS update_ghl_wa_queue_updated_at ON ghl_wa_queue;
CREATE TRIGGER update_ghl_wa_queue_updated_at
  BEFORE UPDATE ON ghl_wa_queue
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_ghl_wa_message_queue_updated_at ON ghl_wa_message_queue;
CREATE TRIGGER update_ghl_wa_message_queue_updated_at
  BEFORE UPDATE ON ghl_wa_message_queue
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_ghl_wa_sessions_updated_at ON ghl_wa_sessions;
CREATE TRIGGER update_ghl_wa_sessions_updated_at
  BEFORE UPDATE ON ghl_wa_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_ghl_wa_cache_updated_at ON ghl_wa_cache;
CREATE TRIGGER update_ghl_wa_cache_updated_at
  BEFORE UPDATE ON ghl_wa_cache
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Função para limpar cache expirado
CREATE OR REPLACE FUNCTION clean_expired_ghl_wa_cache()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM ghl_wa_cache
  WHERE expires_at IS NOT NULL AND expires_at < NOW();

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Função para obter estatísticas da fila
CREATE OR REPLACE FUNCTION get_ghl_wa_queue_stats()
RETURNS TABLE(
  status TEXT,
  count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    q.status,
    COUNT(*)::BIGINT
  FROM ghl_wa_message_queue q
  GROUP BY q.status;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION create_tenant_with_user(
  p_tenant_name TEXT,
  p_tenant_slug TEXT,
  p_user_email TEXT,
  p_user_id UUID
)
RETURNS VOID
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
BEGIN
  IF p_user_id IS NULL OR p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  INSERT INTO ghl_wa_tenants (name, slug, subscription_status, subscription_plan, max_instances, trial_ends_at)
  VALUES (p_tenant_name, p_tenant_slug, 'trial', 'starter', 3, NOW() + INTERVAL '14 days')
  RETURNING id INTO v_tenant_id;

  INSERT INTO ghl_wa_users (id, tenant_id, email, role)
  VALUES (p_user_id, v_tenant_id, p_user_email, 'owner');
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION create_tenant_with_user(TEXT, TEXT, TEXT, UUID) TO authenticated;

-- ============================================
-- POLÍTICAS RLS (Row Level Security)
-- ============================================

ALTER TABLE ghl_wa_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE ghl_wa_pending_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ghl_wa_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ghl_wa_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE ghl_wa_message_queue ENABLE ROW LEVEL SECURITY;

-- Política para service_role ter acesso total
CREATE POLICY "Service role has full access to ghl_wa_queue" ON ghl_wa_queue
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role has full access to ghl_wa_message_queue" ON ghl_wa_message_queue
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role has full access to ghl_wa_pending" ON ghl_wa_pending_messages
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role has full access to ghl_wa_sessions" ON ghl_wa_sessions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role has full access to ghl_wa_cache" ON ghl_wa_cache
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================
-- GRANTS
-- ============================================

GRANT ALL ON ghl_wa_queue TO service_role;
GRANT ALL ON ghl_wa_pending_messages TO service_role;
GRANT ALL ON ghl_wa_sessions TO service_role;
GRANT ALL ON ghl_wa_cache TO service_role;
GRANT ALL ON ghl_wa_message_queue TO service_role;

-- ============================================
-- COMENTÁRIOS
-- ============================================

COMMENT ON TABLE ghl_wa_queue IS 'Fila de mensagens WhatsApp para GHL (substitui Bull Queue do Redis)';
COMMENT ON TABLE ghl_wa_pending_messages IS 'Mensagens pendentes aguardando envio por número';
COMMENT ON TABLE ghl_wa_sessions IS 'Sessões ativas do Baileys (WhatsApp) para GHL';
COMMENT ON TABLE ghl_wa_cache IS 'Cache genérico com TTL (substitui Redis)';

CREATE TABLE IF NOT EXISTS ghl_wa_tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  subscription_status TEXT NOT NULL DEFAULT 'trial',
  subscription_plan TEXT NOT NULL DEFAULT 'starter',
  max_instances INTEGER NOT NULL DEFAULT 3,
  trial_ends_at TIMESTAMPTZ,
  webhook_url TEXT,
  webhook_secret TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ghl_wa_tenants_slug ON ghl_wa_tenants(slug);

DROP TRIGGER IF EXISTS update_ghl_wa_tenants_updated_at ON ghl_wa_tenants;
CREATE TRIGGER update_ghl_wa_tenants_updated_at
  BEFORE UPDATE ON ghl_wa_tenants
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE ghl_wa_tenants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to ghl_wa_tenants" ON ghl_wa_tenants
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can select own tenant" ON ghl_wa_tenants
  FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM ghl_wa_users u WHERE u.tenant_id = ghl_wa_tenants.id AND u.id = auth.uid()));

CREATE POLICY "Owners/Admins can update own tenant" ON ghl_wa_tenants
  FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM ghl_wa_users u WHERE u.tenant_id = ghl_wa_tenants.id AND u.id = auth.uid() AND u.role IN ('owner','admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM ghl_wa_users u WHERE u.tenant_id = ghl_wa_tenants.id AND u.id = auth.uid() AND u.role IN ('owner','admin')));

GRANT ALL ON ghl_wa_tenants TO service_role;

CREATE TABLE IF NOT EXISTS ghl_wa_users (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT fk_tenant FOREIGN KEY (tenant_id) REFERENCES ghl_wa_tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ghl_wa_users_tenant ON ghl_wa_users(tenant_id);

DROP TRIGGER IF EXISTS update_ghl_wa_users_updated_at ON ghl_wa_users;
CREATE TRIGGER update_ghl_wa_users_updated_at
  BEFORE UPDATE ON ghl_wa_users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE ghl_wa_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to ghl_wa_users" ON ghl_wa_users
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Users can select own profile" ON ghl_wa_users
  FOR SELECT
  TO authenticated
  USING (id = auth.uid());

GRANT ALL ON ghl_wa_users TO service_role;

CREATE TABLE IF NOT EXISTS ghl_wa_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  location_id TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  scope TEXT,
  user_type TEXT,
  company_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT fk_integration_tenant FOREIGN KEY (tenant_id) REFERENCES ghl_wa_tenants(id) ON DELETE CASCADE,
  CONSTRAINT uq_integration_tenant_location UNIQUE (tenant_id, location_id)
);

CREATE INDEX IF NOT EXISTS idx_ghl_wa_integrations_tenant ON ghl_wa_integrations(tenant_id);

DROP TRIGGER IF EXISTS update_ghl_wa_integrations_updated_at ON ghl_wa_integrations;
CREATE TRIGGER update_ghl_wa_integrations_updated_at
  BEFORE UPDATE ON ghl_wa_integrations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE ghl_wa_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to ghl_wa_integrations" ON ghl_wa_integrations
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can select own integrations" ON ghl_wa_integrations
  FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM ghl_wa_users u WHERE u.tenant_id = ghl_wa_integrations.tenant_id AND u.id = auth.uid()));

GRANT ALL ON ghl_wa_integrations TO service_role;

CREATE INDEX IF NOT EXISTS idx_ghl_wa_instances_tenant_name ON ghl_wa_instances(tenant_id, name);
