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
  FROM ghl_wa_queue q
  GROUP BY q.status;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- POLÍTICAS RLS (Row Level Security)
-- ============================================

ALTER TABLE ghl_wa_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE ghl_wa_pending_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ghl_wa_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ghl_wa_cache ENABLE ROW LEVEL SECURITY;

-- Política para service_role ter acesso total
CREATE POLICY "Service role has full access to ghl_wa_queue" ON ghl_wa_queue
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

-- ============================================
-- COMENTÁRIOS
-- ============================================

COMMENT ON TABLE ghl_wa_queue IS 'Fila de mensagens WhatsApp para GHL (substitui Bull Queue do Redis)';
COMMENT ON TABLE ghl_wa_pending_messages IS 'Mensagens pendentes aguardando envio por número';
COMMENT ON TABLE ghl_wa_sessions IS 'Sessões ativas do Baileys (WhatsApp) para GHL';
COMMENT ON TABLE ghl_wa_cache IS 'Cache genérico com TTL (substitui Redis)';
