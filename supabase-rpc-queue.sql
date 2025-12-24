-- Função RPC para buscar e travar jobs da fila de forma atômica
-- Isso permite usar a API REST do Supabase em vez de conexão direta com banco
-- Substitui a necessidade de conexão na porta 5432 (pg)

-- DROP na função antiga para evitar erro de assinatura (42P13)
DROP FUNCTION IF EXISTS fetch_pending_jobs(INT);

CREATE OR REPLACE FUNCTION fetch_pending_jobs(batch_size INT)
RETURNS TABLE (
  id BIGINT,
  instance_id TEXT,
  type TEXT,
  to_number TEXT,
  content TEXT,
  attempts INT,
  max_attempts INT,
  next_attempt_at TIMESTAMPTZ,
  last_error TEXT,
  status TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
) AS $$
DECLARE
  v_selected_ids BIGINT[];
BEGIN
  -- 1. Selecionar IDs para travar (Locking)
  WITH locked_rows AS (
    SELECT q.id
    FROM ghl_wa_message_queue q
    WHERE q.status = 'pending' 
      AND q.next_attempt_at <= NOW()
    ORDER BY q.created_at ASC
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  )
  SELECT array_agg(locked_rows.id) INTO v_selected_ids FROM locked_rows;

  -- Se não achou nada, retorna vazio
  IF v_selected_ids IS NULL THEN
    RETURN;
  END IF;

  -- 2. Atualizar status para 'processing' e retornar as linhas atualizadas
  RETURN QUERY
  UPDATE ghl_wa_message_queue q
  SET 
    status = 'processing',
    updated_at = NOW()
  WHERE q.id = ANY(v_selected_ids)
  RETURNING 
    q.id,
    q.instance_id,
    q.type,
    q.to_number,
    q.content,
    q.attempts,
    q.max_attempts,
    q.next_attempt_at,
    q.last_error,
    q.status,
    q.created_at,
    q.updated_at;
END;
$$ LANGUAGE plpgsql;

-- Notificar PostgREST para recarregar o cache de esquema
NOTIFY pgrst, 'reload config';

-- Tabela de histórico de mensagens (caso não exista, necessária para messageHistory.ts)
CREATE TABLE IF NOT EXISTS ghl_wa_message_history (
  id BIGSERIAL PRIMARY KEY,
  instance_id TEXT NOT NULL,
  type TEXT NOT NULL, -- inbound, outbound
  from_number TEXT,
  to_number TEXT,
  content TEXT,
  status TEXT, -- sent, received, failed, queued
  metadata JSONB,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ghl_wa_history_instance ON ghl_wa_message_history(instance_id);
CREATE INDEX IF NOT EXISTS idx_ghl_wa_history_timestamp ON ghl_wa_message_history(timestamp DESC);
