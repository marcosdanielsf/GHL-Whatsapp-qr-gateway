-- Função RPC para buscar e travar jobs da fila de forma atômica
-- Isso permite usar a API REST do Supabase em vez de conexão direta com banco
-- Substitui a necessidade de conexão na porta 5432 (pg)

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
  selected_ids BIGINT[];
BEGIN
  -- 1. Selecionar IDs para travar (Locking)
  WITH locked_rows AS (
    SELECT id
    FROM ghl_wa_message_queue
    WHERE status = 'pending' 
      AND next_attempt_at <= NOW()
    ORDER BY created_at ASC
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  )
  SELECT array_agg(id) INTO selected_ids FROM locked_rows;

  -- Se não achou nada, retorna vazio
  IF selected_ids IS NULL THEN
    RETURN;
  END IF;

  -- 2. Atualizar status para 'processing' e retornar as linhas atualizadas
  RETURN QUERY
  UPDATE ghl_wa_message_queue
  SET 
    status = 'processing',
    updated_at = NOW()
  WHERE id = ANY(selected_ids)
  RETURNING 
    ghl_wa_message_queue.id,
    ghl_wa_message_queue.instance_id,
    ghl_wa_message_queue.type,
    ghl_wa_message_queue.to_number,
    ghl_wa_message_queue.content,
    ghl_wa_message_queue.attempts,
    ghl_wa_message_queue.max_attempts,
    ghl_wa_message_queue.next_attempt_at,
    ghl_wa_message_queue.last_error,
    ghl_wa_message_queue.status,
    ghl_wa_message_queue.created_at,
    ghl_wa_message_queue.updated_at;
END;
$$ LANGUAGE plpgsql;

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
