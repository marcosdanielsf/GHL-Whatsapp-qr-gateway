-- =============================================================
-- migration: 2026-05-04-f8-rpcs.sql
-- fase: Nexus F8 — IA Inbox
-- data: 2026-05-04 BRT
-- decisao: 2.A pgvector cosine distance <=> | 3.A circuit breaker atomico
-- descricao: 3 RPCs helper:
--   1. match_ai_documents — busca semantica top-K por agente (cosine distance)
--   2. increment_circuit_breaker — atomicamente incrementa contador, abre circuito em 3 falhas
--   3. reset_circuit_breaker — reseta circuito (operador ou apos janela de cooldown)
-- =============================================================

-- ============================================================
-- UP
-- ============================================================
BEGIN;

-- ---------------------------------------------------------------
-- RPC 1: match_ai_documents
-- Busca semantica top-K em ai_document_chunks por agent_id.
-- Chamada pelo RAGService (service_role). SECURITY DEFINER para bypassar RLS nos chunks.
-- Retorna chunks ordenados por similaridade coseno decrescente.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_ai_documents(
    p_agent_id      uuid,
    p_query_embedding vector(1536),
    p_top_k         int DEFAULT 5
)
RETURNS TABLE (
    chunk_id        uuid,
    document_id     uuid,
    content         text,
    similarity      float
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        c.id            AS chunk_id,
        c.document_id   AS document_id,
        c.content       AS content,
        (1 - (c.embedding <=> p_query_embedding))::float AS similarity
    FROM public.ai_document_chunks c
    INNER JOIN public.ai_documents d ON d.id = c.document_id
    WHERE c.document_id IN (
        SELECT id FROM public.ai_documents
        WHERE ai_agent_id = p_agent_id
          AND upload_status = 'indexed'
    )
    ORDER BY c.embedding <=> p_query_embedding
    LIMIT p_top_k;
END;
$$;

COMMENT ON FUNCTION public.match_ai_documents(uuid, vector, int) IS 'Busca semantica top-K em ai_document_chunks para um agente. Usa cosine distance (pgvector <=>). Filtra por upload_status=indexed. SECURITY DEFINER — chamado pelo backend service_role. Decisao 2.A.';

GRANT EXECUTE ON FUNCTION public.match_ai_documents(uuid, vector, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_ai_documents(uuid, vector, int) TO service_role;

-- ---------------------------------------------------------------
-- RPC 2: increment_circuit_breaker
-- Incrementa circuit_breaker_failures atomicamente em 1.
-- Se atingir 3: seta circuit_breaker_opened_at = NOW() e enabled = false.
-- Retorna o novo valor de circuit_breaker_failures.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.increment_circuit_breaker(
    p_tool_id uuid
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_new_failures int;
BEGIN
    UPDATE public.ai_custom_tools
    SET
        circuit_breaker_failures  = circuit_breaker_failures + 1,
        circuit_breaker_opened_at = CASE
            WHEN circuit_breaker_failures + 1 >= 3 THEN NOW()
            ELSE circuit_breaker_opened_at
        END,
        enabled = CASE
            WHEN circuit_breaker_failures + 1 >= 3 THEN false
            ELSE enabled
        END,
        updated_at = NOW()
    WHERE id = p_tool_id
    RETURNING circuit_breaker_failures INTO v_new_failures;

    RETURN v_new_failures;
END;
$$;

COMMENT ON FUNCTION public.increment_circuit_breaker(uuid) IS 'Incrementa circuit_breaker_failures atomicamente. Se novo valor >= 3: abre circuito (circuit_breaker_opened_at=NOW(), enabled=false). Retorna novo contador. SECURITY DEFINER. Decisao 3.A — 3 falhas consecutivas desativam a tool.';

GRANT EXECUTE ON FUNCTION public.increment_circuit_breaker(uuid) TO service_role;

-- ---------------------------------------------------------------
-- RPC 3: reset_circuit_breaker
-- Reseta o circuit breaker de uma tool: failures=0, opened_at=NULL, enabled=true.
-- Chamado pelo operador via UI ou automaticamente apos cooldown de 30min.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reset_circuit_breaker(
    p_tool_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.ai_custom_tools
    SET
        circuit_breaker_failures  = 0,
        circuit_breaker_opened_at = NULL,
        enabled                   = true,
        updated_at                = NOW()
    WHERE id = p_tool_id;
END;
$$;

COMMENT ON FUNCTION public.reset_circuit_breaker(uuid) IS 'Reseta circuit breaker de uma tool: failures=0, opened_at=NULL, enabled=true. Chamado pelo operador via UI (botao Reativar Tool) ou automaticamente pelo backend apos 30min de cooldown. SECURITY DEFINER.';

GRANT EXECUTE ON FUNCTION public.reset_circuit_breaker(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_circuit_breaker(uuid) TO service_role;

COMMIT;

-- ============================================================
-- DOWN (rollback)
-- ============================================================
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.match_ai_documents(uuid, vector, int);
-- DROP FUNCTION IF EXISTS public.increment_circuit_breaker(uuid);
-- DROP FUNCTION IF EXISTS public.reset_circuit_breaker(uuid);
-- COMMIT;
