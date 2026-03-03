-- Fix 12: x-jarvis-key hardening — RPC de auditoria + rate limiting
-- Supabase: bfumywvwubvernvhjehk
-- Branch: fix/p3-security
-- Autor: Claude / Marcos Daniels | 2026-03-03
--
-- DESIGN:
--   - Validação da chave fica no Node.js (crypto.timingSafeEqual)
--   - Esta RPC faz SOMENTE: rate limiting + log de auditoria
--   - A chave é enviada como HMAC-SHA256 (nunca plaintext para o DB)
--
-- ROLLBACK: Seção no final do arquivo

-- ─────────────────────────────────────────────────────────────
-- PASSO 1: Tabela de auditoria
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ghl_wa_api_key_attempts (
  id           BIGSERIAL    PRIMARY KEY,
  attempted_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  source_ip    TEXT,
  key_hmac     TEXT,        -- HMAC-SHA256 da chave (nunca plaintext)
  success      BOOLEAN      NOT NULL,
  blocked      BOOLEAN      NOT NULL DEFAULT false  -- true = bloqueado por rate limit
);

-- Índice para queries de rate limiting (busca por IP + tempo)
CREATE INDEX IF NOT EXISTS idx_api_key_attempts_ip_time
  ON ghl_wa_api_key_attempts (source_ip, attempted_at DESC);

-- Índice para limpeza periódica (janela de 7 dias)
CREATE INDEX IF NOT EXISTS idx_api_key_attempts_time
  ON ghl_wa_api_key_attempts (attempted_at DESC);

-- ─────────────────────────────────────────────────────────────
-- PASSO 2: RPC — log + rate limiting
-- Retorna:
--   'ok'        — tentativa válida registrada
--   'blocked'   — bloqueado por rate limit (>5 falhas/min por IP)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION log_api_key_attempt(
  p_success    boolean,
  p_source_ip  text    DEFAULT NULL,
  p_key_hmac   text    DEFAULT NULL  -- HMAC da chave, para correlação em debug
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recent_failures int;
BEGIN
  -- Rate limit: máx 5 falhas por minuto por IP
  IF p_source_ip IS NOT NULL THEN
    SELECT COUNT(*) INTO v_recent_failures
    FROM   ghl_wa_api_key_attempts
    WHERE  success       = false
      AND  blocked       = false
      AND  source_ip     = p_source_ip
      AND  attempted_at  > NOW() - INTERVAL '1 minute';

    IF v_recent_failures >= 5 THEN
      -- Registrar o bloqueio mas não revelar quantas tentativas faltam
      INSERT INTO ghl_wa_api_key_attempts (source_ip, key_hmac, success, blocked)
      VALUES (p_source_ip, p_key_hmac, false, true);
      RETURN 'blocked';
    END IF;
  END IF;

  -- Registrar tentativa normal
  INSERT INTO ghl_wa_api_key_attempts (source_ip, key_hmac, success, blocked)
  VALUES (p_source_ip, p_key_hmac, p_success, false);

  RETURN 'ok';
END;
$$;

-- Garantir que apenas service role chama a função
REVOKE ALL ON FUNCTION log_api_key_attempt(boolean, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION log_api_key_attempt(boolean, text, text) TO service_role;

-- ─────────────────────────────────────────────────────────────
-- PASSO 3: Limpeza automática — manter apenas 7 dias de logs
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cleanup_api_key_attempts()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  DELETE FROM ghl_wa_api_key_attempts
  WHERE attempted_at < NOW() - INTERVAL '7 days';
$$;

-- ─────────────────────────────────────────────────────────────
-- VERIFICAÇÃO
-- ─────────────────────────────────────────────────────────────
SELECT 'Table created:' AS status, COUNT(*) AS rows FROM ghl_wa_api_key_attempts;
SELECT 'Function created:' AS status, proname FROM pg_proc WHERE proname = 'log_api_key_attempt';

-- ─────────────────────────────────────────────────────────────
-- ROLLBACK (executar apenas se precisar reverter)
-- ─────────────────────────────────────────────────────────────
-- DROP FUNCTION IF EXISTS log_api_key_attempt(boolean, text, text);
-- DROP FUNCTION IF EXISTS cleanup_api_key_attempts();
-- DROP TABLE IF EXISTS ghl_wa_api_key_attempts;
