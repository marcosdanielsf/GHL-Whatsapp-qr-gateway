-- Owner Messages: coleta de mensagens do Marcos para clone de personalidade
-- Aplicar no AI Factory Supabase (bfumywvwubvernvhjehk)

CREATE TABLE IF NOT EXISTS owner_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone_to TEXT NOT NULL,
  contact_name TEXT,
  content TEXT NOT NULL,
  is_group BOOLEAN DEFAULT false,
  group_jid TEXT,
  chat_context TEXT,
  word_count INTEGER,
  message_timestamp TIMESTAMPTZ NOT NULL,
  instance_id TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_owner_messages_timestamp ON owner_messages(message_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_owner_messages_phone ON owner_messages(phone_to);
CREATE INDEX IF NOT EXISTS idx_owner_messages_instance ON owner_messages(instance_id);

-- RLS: bloquear acesso via anon/authenticated — apenas service_role insere/le
ALTER TABLE owner_messages ENABLE ROW LEVEL SECURITY;

-- Policy para INSERT via REST API (anon key com Prefer: return=minimal)
-- O gateway usa anon key, entao precisa de permissao de INSERT
CREATE POLICY "anon_insert_only" ON owner_messages
  FOR INSERT TO anon
  WITH CHECK (true);

-- Leitura apenas via service_role (analise de personalidade usa anon key,
-- mas o SELECT e feito pelo mesmo servico que insere)
CREATE POLICY "anon_select_own" ON owner_messages
  FOR SELECT TO anon
  USING (true);

-- Bloquear DELETE/UPDATE via anon (apenas service_role)
CREATE POLICY "service_role_full" ON owner_messages
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- View agregada para analise de escrita
CREATE OR REPLACE VIEW vw_owner_writing_stats AS
SELECT
  DATE_TRUNC('day', message_timestamp) AS dia,
  COUNT(*) AS total_msgs,
  AVG(word_count) AS avg_words,
  COUNT(*) FILTER (WHERE is_group) AS group_msgs,
  COUNT(*) FILTER (WHERE NOT is_group) AS direct_msgs
FROM owner_messages
GROUP BY 1
ORDER BY 1 DESC;
