import { useState, useEffect, useCallback, useRef } from 'react';
import { agentApi, type AgentDocument, type DocumentChunkPreview } from '../../services/agentApi';
import { Icons } from '../icons';

interface AgentDocumentsProps {
  agentId: string;
}

function DocStatusPill({ status }: { status: AgentDocument['status'] }) {
  const map = {
    processing: { label: 'Processando', bg: 'rgba(251,191,36,0.15)', color: 'var(--warning)', border: 'rgba(251,191,36,0.3)', pulse: true },
    ready:      { label: 'Indexado',    bg: 'rgba(52,211,153,0.15)',  color: 'var(--success)', border: 'rgba(52,211,153,0.3)',  pulse: false },
    error:      { label: 'Erro',        bg: 'rgba(248,113,113,0.15)', color: 'var(--danger)',  border: 'rgba(248,113,113,0.3)', pulse: false },
    outdated:   { label: 'Desatualiz.', bg: 'rgba(148,163,184,0.1)',  color: 'var(--text-muted)', border: 'rgba(148,163,184,0.3)', pulse: false },
  };
  const s = map[status] ?? map.outdated;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 999,
      textTransform: 'uppercase', letterSpacing: '0.05em',
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
    }}>
      {s.pulse && <span className="ag-pulse-dot" />}
      {s.label}
    </span>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface ChunksModalProps {
  agentId: string;
  doc: AgentDocument;
  onClose: () => void;
}

function ChunksModal({ agentId, doc, onClose }: ChunksModalProps) {
  const [chunks, setChunks] = useState<DocumentChunkPreview[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    agentApi.getDocumentChunks(agentId, doc.id)
      .then(res => setChunks(res.chunks.slice(0, 10)))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [agentId, doc.id]);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1100,
      background: 'rgba(5,11,22,0.85)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }} onClick={onClose}>
      <div
        style={{
          background: 'var(--panel)', border: '1px solid var(--panel-border)',
          borderRadius: 16, width: '100%', maxWidth: 600, maxHeight: '80vh',
          overflow: 'hidden', display: 'flex', flexDirection: 'column',
          boxShadow: '0 24px 60px rgba(0,0,0,0.6)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--panel-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-main)' }}>{doc.file_name}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              Primeiros {Math.min(10, chunks.length)} chunks de {doc.chunk_count ?? '?'}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 22 }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>Carregando chunks...</div>
          ) : chunks.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>Nenhum chunk disponível.</div>
          ) : chunks.map((c, i) => (
            <div key={i} style={{
              padding: '12px 14px',
              background: 'rgba(15,23,42,0.6)',
              border: '1px solid var(--panel-border)',
              borderRadius: 10,
            }}>
              <div style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--primary)', marginBottom: 6 }}>
                Chunk #{c.chunk_index + 1}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-main)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                {c.content.slice(0, 200)}{c.content.length > 200 ? '…' : ''}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function AgentDocuments({ agentId }: AgentDocumentsProps) {
  const [documents, setDocuments] = useState<AgentDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<AgentDocument | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchDocs = useCallback(async () => {
    try {
      const res = await agentApi.listDocuments(agentId);
      setDocuments(res.documents ?? []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [agentId]);

  useEffect(() => {
    fetchDocs();
    const interval = setInterval(fetchDocs, 5000); // poll para status updates
    return () => clearInterval(interval);
  }, [fetchDocs]);

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        await agentApi.uploadDocument(agentId, file);
      }
      await fetchDocs();
    } catch (err: unknown) {
      console.error(err);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (docId: string) => {
    if (!confirm('Remover documento e todos os chunks?')) return;
    try {
      await agentApi.deleteDocument(agentId, docId);
      setDocuments(prev => prev.filter(d => d.id !== docId));
    } catch { /* show inline error in real impl */ }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleUpload(e.dataTransfer.files);
  };

  return (
    <div>
      {/* Drop zone */}
      <div
        style={{
          border: `2px dashed ${dragOver ? 'var(--primary)' : 'var(--panel-border)'}`,
          borderRadius: 14,
          padding: '32px 24px',
          textAlign: 'center',
          cursor: 'pointer',
          marginBottom: 20,
          background: dragOver ? 'rgba(96,165,250,0.06)' : 'rgba(15,23,42,0.3)',
          transition: 'all 0.2s',
        }}
        onDrop={handleDrop}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          style={{ display: 'none' }}
          accept=".pdf,.docx,.txt,.md"
          multiple
          onChange={e => handleUpload(e.target.files)}
        />
        <div style={{ fontSize: 28, marginBottom: 8 }}>📄</div>
        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-main)', marginBottom: 4 }}>
          {uploading ? 'Enviando...' : 'Arraste arquivos ou clique para upload'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Suportado: PDF, DOCX, TXT, MD
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)' }}>Carregando documentos...</div>
      ) : documents.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', border: '1px dashed var(--panel-border)', borderRadius: 10 }}>
          <p style={{ margin: 0 }}>Nenhum documento ainda. Faça upload para habilitar RAG.</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--panel-border)' }}>
                {['Arquivo', 'Tipo', 'Tamanho', 'Status', 'Chunks', 'Ações'].map(h => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-dim,#64748b)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {documents.map(doc => (
                <tr key={doc.id} style={{ borderBottom: '1px solid rgba(148,163,184,0.08)' }}>
                  <td style={{ padding: '10px 12px', color: 'var(--text-main)', fontWeight: 500, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {doc.file_name}
                  </td>
                  <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: 11, color: 'var(--text-dim,#64748b)' }}>
                    {doc.mime_type.split('/').pop()?.replace('vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx')}
                  </td>
                  <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)' }}>
                    {formatBytes(doc.file_size_bytes)}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <DocStatusPill status={doc.status} />
                    {doc.error_message && (
                      <div style={{ fontSize: 10, color: 'var(--danger)', marginTop: 2 }}>{doc.error_message.slice(0, 40)}</div>
                    )}
                  </td>
                  <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)' }}>
                    {doc.chunk_count ?? '—'}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {doc.status === 'ready' && (
                        <button
                          className="ag-btn-ghost"
                          style={{ padding: '4px 8px', fontSize: 10 }}
                          onClick={() => setPreviewDoc(doc)}
                        >
                          Chunks
                        </button>
                      )}
                      <button
                        className="ag-btn-ghost"
                        style={{ padding: '4px 8px', fontSize: 10, color: 'var(--danger)', borderColor: 'rgba(248,113,113,0.3)' }}
                        onClick={() => handleDelete(doc.id)}
                      >
                        <Icons.Trash style={{ width: 12, height: 12 }} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {previewDoc && (
        <ChunksModal agentId={agentId} doc={previewDoc} onClose={() => setPreviewDoc(null)} />
      )}

      <style>{`
        .ag-btn-ghost { background:rgba(15,23,42,0.6); color:var(--text-main); border:1px solid var(--panel-border); border-radius:8px; padding:8px 12px; font-weight:500; font-size:12px; cursor:pointer; display:inline-flex; align-items:center; gap:6px; transition:all 0.15s; }
        .ag-btn-ghost:hover { border-color:var(--primary); background:rgba(59,130,246,0.08); }
        .ag-pulse-dot { width:7px; height:7px; border-radius:50%; background:var(--warning); box-shadow:0 0 6px var(--warning); animation:ag-pulse 2s infinite; display:inline-block; }
        @keyframes ag-pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
      `}</style>
    </div>
  );
}
