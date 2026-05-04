/**
 * agent-documents.controller.ts — F8 RAG document CRUD
 * Upload, list, delete, reindex
 */

import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { getSupabaseClient } from '../infra/supabaseClient';
import { enqueueDocumentIndex, getOrCreateWorker } from '../core/agent-document-worker';
import { AuthenticatedRequest } from '../middleware/auth';
import { logger } from '../utils/logger';

export const agentDocumentsRouter = Router({ mergeParams: true });

// Multer: memory storage (buffer → Supabase Storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.pdf', '.docx', '.txt', '.md'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(null, false);
    }
  },
});

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

async function assertAgentOwnership(
  supabase: ReturnType<typeof getSupabaseClient>,
  agentId: string,
  tenantId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('ai_agents')
    .select('id')
    .eq('id', agentId)
    .eq('tenant_id', tenantId)
    .not('status', 'eq', 'deleted')
    .single();
  return !!data;
}

// ─────────────────────────────────────────────
// POST /api/agents/:id/documents — upload
// ─────────────────────────────────────────────

agentDocumentsRouter.post(
  '/:id/documents',
  upload.single('file'),
  async (req: AuthenticatedRequest, res: Response) => {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(400).json({ error: 'Tenant ID ausente' });
    const { id: agentId } = req.params;

    if (!req.file) return res.status(400).json({ error: 'Arquivo obrigatório (campo: file)' });

    const supabase = getSupabaseClient();

    if (!(await assertAgentOwnership(supabase, agentId, tenantId))) {
      return res.status(404).json({ error: 'Agente não encontrado' });
    }

    const ext = path.extname(req.file.originalname).toLowerCase().replace('.', '') as
      | 'pdf'
      | 'docx'
      | 'txt'
      | 'md';

    const safeFileName = `${Date.now()}-${req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const storagePath = `${tenantId}/${agentId}/${safeFileName}`;

    // Upload to Supabase Storage
    const { error: storageErr } = await supabase.storage
      .from('ai-documents')
      .upload(storagePath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false,
      });

    if (storageErr) {
      logger.error('[AGENT-DOCS] Storage upload failed', { error: storageErr.message });
      return res.status(500).json({ error: 'Erro ao fazer upload do arquivo' });
    }

    // Insert document row
    const { data: doc, error: docErr } = await supabase
      .from('ai_documents')
      .insert({
        agent_id: agentId,
        tenant_id: tenantId,
        file_name: req.file.originalname,
        file_type: ext,
        file_size: req.file.size,
        storage_path: storagePath,
        upload_status: 'pending',
        chunk_count: 0,
      })
      .select('*')
      .single();

    if (docErr || !doc) {
      // Cleanup storage on DB failure
      await supabase.storage.from('ai-documents').remove([storagePath]);
      return res.status(500).json({ error: 'Erro ao registrar documento' });
    }

    // Ensure worker is running for this tenant
    getOrCreateWorker(tenantId);

    // Enqueue indexing job
    await enqueueDocumentIndex(tenantId, {
      document_id: doc.id,
      agent_id: agentId,
      tenant_id: tenantId,
      storage_path: storagePath,
      file_type: ext,
      file_name: req.file.originalname,
    });

    logger.info('[AGENT-DOCS] Document uploaded, queued for indexing', {
      event: 'agent_doc.uploaded',
      documentId: doc.id,
      agentId,
      tenantId,
    });

    return res.status(202).json({ document: doc });
  },
);

// ─────────────────────────────────────────────
// GET /api/agents/:id/documents — list
// ─────────────────────────────────────────────

agentDocumentsRouter.get('/:id/documents', async (req: AuthenticatedRequest, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(400).json({ error: 'Tenant ID ausente' });
  const { id: agentId } = req.params;

  const supabase = getSupabaseClient();

  if (!(await assertAgentOwnership(supabase, agentId, tenantId))) {
    return res.status(404).json({ error: 'Agente não encontrado' });
  }

  const { data, error } = await supabase
    .from('ai_documents')
    .select('id, file_name, file_type, file_size, upload_status, chunk_count, indexed_at, error_message, created_at')
    .eq('agent_id', agentId)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: 'Erro ao listar documentos' });

  return res.json({ documents: data ?? [] });
});

// ─────────────────────────────────────────────
// DELETE /api/agents/:id/documents/:doc_id
// ─────────────────────────────────────────────

agentDocumentsRouter.delete(
  '/:id/documents/:doc_id',
  async (req: AuthenticatedRequest, res: Response) => {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(400).json({ error: 'Tenant ID ausente' });
    const { id: agentId, doc_id } = req.params;

    const supabase = getSupabaseClient();

    const { data: doc } = await supabase
      .from('ai_documents')
      .select('id, storage_path')
      .eq('id', doc_id)
      .eq('agent_id', agentId)
      .eq('tenant_id', tenantId)
      .single();

    if (!doc) return res.status(404).json({ error: 'Documento não encontrado' });

    // Delete chunks first (FK)
    await supabase.from('ai_document_chunks').delete().eq('document_id', doc_id);

    // Delete from storage
    if (doc.storage_path) {
      await supabase.storage.from('ai-documents').remove([doc.storage_path]);
    }

    // Delete document row
    await supabase.from('ai_documents').delete().eq('id', doc_id);

    return res.json({ ok: true });
  },
);

// ─────────────────────────────────────────────
// POST /api/agents/:id/documents/:doc_id/reindex
// ─────────────────────────────────────────────

agentDocumentsRouter.post(
  '/:id/documents/:doc_id/reindex',
  async (req: AuthenticatedRequest, res: Response) => {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(400).json({ error: 'Tenant ID ausente' });
    const { id: agentId, doc_id } = req.params;

    const supabase = getSupabaseClient();

    const { data: doc } = await supabase
      .from('ai_documents')
      .select('*')
      .eq('id', doc_id)
      .eq('agent_id', agentId)
      .eq('tenant_id', tenantId)
      .single();

    if (!doc) return res.status(404).json({ error: 'Documento não encontrado' });

    if (doc.upload_status === 'processing') {
      return res.status(409).json({ error: 'Documento já está sendo processado' });
    }

    // Reset status
    await supabase
      .from('ai_documents')
      .update({ upload_status: 'pending', error_message: null })
      .eq('id', doc_id);

    getOrCreateWorker(tenantId);

    await enqueueDocumentIndex(tenantId, {
      document_id: doc_id,
      agent_id: agentId,
      tenant_id: tenantId,
      storage_path: doc.storage_path,
      file_type: doc.file_type,
      file_name: doc.file_name,
    });

    return res.json({ ok: true, status: 'queued' });
  },
);
