-- =============================================================
-- migration: 2026-05-04-f8-schema-ai-documents.sql
-- fase: Nexus F8 — IA Inbox
-- data: 2026-05-04 BRT
-- decisao: 2.A BYO key OpenAI para embeddings | text-embedding-3-small 1536d | HNSW m=16 ef=64
-- descricao: Documentos RAG e chunks com pgvector.
--            ai_documents = metadata do arquivo.
--            ai_document_chunks = chunks com embeddings vector(1536).
-- =============================================================

-- ============================================================
-- UP
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_documents (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    ai_agent_id       uuid        NOT NULL REFERENCES public.ai_agents(id) ON DELETE CASCADE,
    tenant_id         uuid        NOT NULL,
    filename          text        NOT NULL,
    file_type         text        NOT NULL
                      CHECK (file_type IN ('pdf','docx','txt','md')),
    file_size_bytes   int,
    source_url        text,
    upload_status     text        NOT NULL DEFAULT 'uploaded'
                      CHECK (upload_status IN ('uploaded','processing','indexed','failed')),
    chunk_count       int         NOT NULL DEFAULT 0,
    chunk_strategy    text        NOT NULL DEFAULT 'balanced_512',
    error_message     text,
    created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.ai_documents IS 'Documentos RAG por agente. Chunks e embeddings ficam em ai_document_chunks. Upload -> chunking job BullMQ -> status=indexed.';
COMMENT ON COLUMN public.ai_documents.id IS 'PK uuid.';
COMMENT ON COLUMN public.ai_documents.ai_agent_id IS 'FK ai_agents — documento pertence a um agente especifico.';
COMMENT ON COLUMN public.ai_documents.tenant_id IS 'Denormalizado para RLS sem JOIN em ai_document_chunks.';
COMMENT ON COLUMN public.ai_documents.filename IS 'Nome original do arquivo enviado pelo cliente.';
COMMENT ON COLUMN public.ai_documents.file_type IS 'Tipo do arquivo: pdf | docx | txt | md.';
COMMENT ON COLUMN public.ai_documents.file_size_bytes IS 'Tamanho em bytes para exibicao na UI.';
COMMENT ON COLUMN public.ai_documents.source_url IS 'Path no Supabase Storage (bucket ai-documents).';
COMMENT ON COLUMN public.ai_documents.upload_status IS 'uploaded=recebido | processing=chunking em andamento | indexed=pronto pra RAG | failed=erro no job.';
COMMENT ON COLUMN public.ai_documents.chunk_count IS 'Total de chunks gerados. Atualizado pelo job BullMQ apos indexacao.';
COMMENT ON COLUMN public.ai_documents.chunk_strategy IS 'Estrategia de chunking: balanced_512 (default) | large_1024.';
COMMENT ON COLUMN public.ai_documents.error_message IS 'Mensagem de erro do job de chunking em caso de falha.';

CREATE INDEX IF NOT EXISTS ix_ai_documents_ai_agent_id
    ON public.ai_documents(ai_agent_id);

CREATE INDEX IF NOT EXISTS ix_ai_documents_tenant_id
    ON public.ai_documents(tenant_id);

ALTER TABLE public.ai_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_documents_tenant_select"
    ON public.ai_documents FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "ai_documents_tenant_insert"
    ON public.ai_documents FOR INSERT
    WITH CHECK (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "ai_documents_tenant_update"
    ON public.ai_documents FOR UPDATE
    USING (tenant_id = public.get_auth_tenant_id())
    WITH CHECK (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "ai_documents_tenant_delete"
    ON public.ai_documents FOR DELETE
    USING (tenant_id = public.get_auth_tenant_id());

-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ai_document_chunks (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id   uuid        NOT NULL REFERENCES public.ai_documents(id) ON DELETE CASCADE,
    tenant_id     uuid        NOT NULL,
    chunk_index   int         NOT NULL,
    content       text        NOT NULL,
    embedding     vector(1536),
    token_count   int,
    created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.ai_document_chunks IS 'Chunks de documentos RAG com embeddings text-embedding-3-small (1536d). Separado de ai_documents para evitar row oversized. Buscado via RPC match_ai_documents com cosine distance.';
COMMENT ON COLUMN public.ai_document_chunks.id IS 'PK uuid.';
COMMENT ON COLUMN public.ai_document_chunks.document_id IS 'FK ai_documents ON DELETE CASCADE — chunks orfaos sao impossíveis.';
COMMENT ON COLUMN public.ai_document_chunks.tenant_id IS 'Denormalizado para performance de RLS sem JOIN duplo.';
COMMENT ON COLUMN public.ai_document_chunks.chunk_index IS 'Indice ordinal do chunk dentro do documento. Comeca em 0.';
COMMENT ON COLUMN public.ai_document_chunks.content IS 'Texto do chunk. 512 tokens por default (balanced_512).';
COMMENT ON COLUMN public.ai_document_chunks.embedding IS 'Vetor 1536 dimensoes gerado pelo text-embedding-3-small da OpenAI (BYO key).';
COMMENT ON COLUMN public.ai_document_chunks.token_count IS 'Contagem de tokens do chunk para controle de custo.';

-- HNSW index para busca coseno — melhor que IVFFLAT para updates incrementais
-- m=16, ef_construction=64: parametros padrao, adequado ate 500k chunks
CREATE INDEX IF NOT EXISTS ix_ai_document_chunks_embedding_hnsw
    ON public.ai_document_chunks
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS ix_ai_document_chunks_document_id
    ON public.ai_document_chunks(document_id);

CREATE INDEX IF NOT EXISTS ix_ai_document_chunks_tenant_id
    ON public.ai_document_chunks(tenant_id);

ALTER TABLE public.ai_document_chunks ENABLE ROW LEVEL SECURITY;

-- Chunks nao sao acessados diretamente pelo frontend — apenas via RPC search_similar_chunks (service_role)
-- RLS mantida com get_auth_tenant_id para defense-in-depth
CREATE POLICY "ai_document_chunks_tenant_select"
    ON public.ai_document_chunks FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "ai_document_chunks_tenant_insert"
    ON public.ai_document_chunks FOR INSERT
    WITH CHECK (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "ai_document_chunks_tenant_update"
    ON public.ai_document_chunks FOR UPDATE
    USING (tenant_id = public.get_auth_tenant_id())
    WITH CHECK (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "ai_document_chunks_tenant_delete"
    ON public.ai_document_chunks FOR DELETE
    USING (tenant_id = public.get_auth_tenant_id());

COMMIT;

-- ============================================================
-- DOWN (rollback)
-- ============================================================
-- BEGIN;
-- DROP TABLE IF EXISTS public.ai_document_chunks CASCADE;
-- DROP TABLE IF EXISTS public.ai_documents CASCADE;
-- COMMIT;
