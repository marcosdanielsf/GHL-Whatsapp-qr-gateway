import { useState, useEffect, useCallback } from 'react';
import { agentApi, type AgentTool, type CreateToolPayload } from '../../services/agentApi';
import { Icons } from '../icons';

interface AgentToolsProps {
  agentId: string;
}

const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

function ToolStatusPill({ tool }: { tool: AgentTool }) {
  if (tool.circuit_open) {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 999,
        textTransform: 'uppercase', letterSpacing: '0.05em',
        background: 'rgba(248,113,113,0.15)', color: 'var(--danger)',
        border: '1px solid rgba(248,113,113,0.3)',
      }}>
        Circuit Aberto
      </span>
    );
  }
  if (!tool.is_enabled) {
    return (
      <span style={{
        fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 999,
        textTransform: 'uppercase', letterSpacing: '0.05em',
        background: 'rgba(148,163,184,0.1)', color: 'var(--text-muted)',
        border: '1px solid rgba(148,163,184,0.3)',
      }}>
        Desativada
      </span>
    );
  }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 999,
      textTransform: 'uppercase', letterSpacing: '0.05em',
      background: 'rgba(52,211,153,0.15)', color: 'var(--success)',
      border: '1px solid rgba(52,211,153,0.3)',
    }}>
      <span className="ag-pulse-dot" style={{ background: 'var(--success)', boxShadow: '0 0 6px var(--success)' }} />
      Ativa
    </span>
  );
}

const blankTool: CreateToolPayload = {
  name: '',
  description: '',
  parameters: {},
  webhook_url: '',
  webhook_secret: '',
  timeout_seconds: 8,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'rgba(15,23,42,0.8)',
  border: '1px solid var(--panel-border)',
  borderRadius: 10,
  padding: '10px 14px',
  color: 'var(--text-main)',
  fontSize: 14,
  outline: 'none',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  marginBottom: 6,
  display: 'block',
};

interface ToolModalProps {
  agentId: string;
  editTool?: AgentTool;
  onClose: () => void;
  onSaved: () => void;
}

function ToolModal({ agentId, editTool, onClose, onSaved }: ToolModalProps) {
  const [form, setForm] = useState<CreateToolPayload>(
    editTool ? {
      name: editTool.name,
      description: editTool.description,
      parameters: editTool.parameters,
      webhook_url: editTool.webhook_url,
      timeout_seconds: editTool.timeout_seconds,
    } : blankTool,
  );
  const [schemaStr, setSchemaStr] = useState(() =>
    editTool ? JSON.stringify(editTool.parameters, null, 2) : '{}'
  );
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const validateSchema = (raw: string) => {
    try {
      JSON.parse(raw);
      setSchemaError(null);
      return true;
    } catch {
      setSchemaError('JSON inválido');
      return false;
    }
  };

  const handleSave = async () => {
    let valid = true;
    if (!TOOL_NAME_PATTERN.test(form.name)) {
      setNameError('Apenas letras minúsculas, números e _ (ex: consultar_pedido)');
      valid = false;
    } else {
      setNameError(null);
    }
    if (!validateSchema(schemaStr)) valid = false;
    if (!valid) return;

    setSaving(true);
    setApiError(null);
    try {
      const payload = { ...form, parameters: JSON.parse(schemaStr) };
      if (editTool) {
        await agentApi.updateTool(agentId, editTool.id, payload);
      } else {
        await agentApi.createTool(agentId, payload);
      }
      onSaved();
      onClose();
    } catch (err: unknown) {
      setApiError(err instanceof Error ? err.message : 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

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
          borderRadius: 16, width: '100%', maxWidth: 560,
          boxShadow: '0 24px 60px rgba(0,0,0,0.6)',
          display: 'flex', flexDirection: 'column', maxHeight: '90vh',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--panel-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-main)' }}>
            {editTool ? 'Editar Tool' : 'Nova Tool'}
          </span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 22 }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={labelStyle}>Nome (snake_case) *</label>
            <input
              style={{ ...inputStyle, borderColor: nameError ? 'var(--danger)' : undefined }}
              placeholder="consultar_pedido"
              value={form.name}
              disabled={!!editTool}
              onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
            />
            {nameError && <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 4 }}>{nameError}</div>}
          </div>

          <div>
            <label style={labelStyle}>Descrição *</label>
            <textarea
              style={{ ...inputStyle, height: 70, resize: 'vertical', lineHeight: 1.5 }}
              placeholder="Consulta o status de um pedido pelo ID"
              value={form.description}
              onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
            />
          </div>

          <div>
            <label style={labelStyle}>Parameters Schema (JSON Schema)</label>
            <textarea
              style={{
                ...inputStyle, height: 120, resize: 'vertical',
                fontFamily: 'monospace', fontSize: 12,
                borderColor: schemaError ? 'var(--danger)' : undefined,
              }}
              value={schemaStr}
              onChange={e => setSchemaStr(e.target.value)}
              onBlur={e => validateSchema(e.target.value)}
            />
            {schemaError && <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 4 }}>{schemaError}</div>}
          </div>

          <div>
            <label style={labelStyle}>Webhook URL *</label>
            <input
              style={inputStyle}
              placeholder="https://hooks.exemplo.com/pedidos"
              value={form.webhook_url}
              onChange={e => setForm(p => ({ ...p, webhook_url: e.target.value }))}
            />
          </div>

          <div>
            <label style={labelStyle}>Webhook Secret (opcional)</label>
            <input
              style={inputStyle}
              placeholder="Chave secreta para HMAC-SHA256"
              value={form.webhook_secret ?? ''}
              onChange={e => setForm(p => ({ ...p, webhook_secret: e.target.value }))}
            />
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <label style={{ ...labelStyle, margin: 0 }}>Timeout: {form.timeout_seconds}s</label>
            </div>
            <input
              type="range" min={1} max={30} step={1}
              value={form.timeout_seconds}
              onChange={e => setForm(p => ({ ...p, timeout_seconds: parseInt(e.target.value) }))}
              style={{ width: '100%', accentColor: 'var(--primary)' }}
            />
          </div>

          {apiError && (
            <div style={{ padding: '10px 14px', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 8, color: 'var(--danger)', fontSize: 13 }}>
              {apiError}
            </div>
          )}
        </div>

        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--panel-border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="ag-btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="ag-btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar Tool'}
          </button>
        </div>
      </div>

      <style>{`
        .ag-btn-primary { background:var(--gradient-primary); color:white; border:none; border-radius:10px; padding:10px 16px; font-weight:600; font-size:13px; cursor:pointer; box-shadow:0 4px 14px rgba(37,99,235,0.3); display:inline-flex; align-items:center; gap:8px; transition:transform 0.15s; }
        .ag-btn-primary:hover { transform:translateY(-1px); }
        .ag-btn-primary:disabled { opacity:0.5; cursor:not-allowed; transform:none; }
        .ag-btn-ghost { background:rgba(15,23,42,0.6); color:var(--text-main); border:1px solid var(--panel-border); border-radius:10px; padding:10px 16px; font-weight:500; font-size:13px; cursor:pointer; display:inline-flex; align-items:center; gap:8px; transition:all 0.15s; }
        .ag-btn-ghost:hover { border-color:var(--primary); background:rgba(59,130,246,0.08); }
      `}</style>
    </div>
  );
}

export function AgentTools({ agentId }: AgentToolsProps) {
  const [tools, setTools] = useState<AgentTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editTool, setEditTool] = useState<AgentTool | undefined>();

  const fetchTools = useCallback(async () => {
    try {
      const res = await agentApi.listTools(agentId);
      setTools(res.tools ?? []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [agentId]);

  useEffect(() => {
    fetchTools();
  }, [fetchTools]);

  const handleToggle = async (tool: AgentTool) => {
    try {
      await agentApi.updateTool(agentId, tool.id, { is_enabled: !tool.is_enabled });
      await fetchTools();
    } catch { /* silent */ }
  };

  const handleDelete = async (toolId: string) => {
    if (!confirm('Remover esta tool?')) return;
    try {
      await agentApi.deleteTool(agentId, toolId);
      await fetchTools();
    } catch { /* silent */ }
  };

  const handleResetBreaker = async (tool: AgentTool) => {
    try {
      await agentApi.resetCircuitBreaker(agentId, tool.id);
      await fetchTools();
    } catch { /* silent */ }
  };

  const canAddMore = tools.length < 10;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {tools.length}/10 tools configuradas
        </div>
        <button
          className="ag-btn-primary"
          style={{ fontSize: 12, padding: '6px 12px' }}
          onClick={() => { setEditTool(undefined); setModalOpen(true); }}
          disabled={!canAddMore}
        >
          <Icons.Plus style={{ width: 14, height: 14 }} />
          Nova Tool
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)' }}>Carregando tools...</div>
      ) : tools.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', border: '1px dashed var(--panel-border)', borderRadius: 10 }}>
          <p style={{ margin: 0 }}>Nenhuma tool configurada. Tools permitem o agente chamar seus sistemas externos.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {tools.map(tool => (
            <div key={tool.id} style={{
              padding: '14px 16px',
              background: 'rgba(15,23,42,0.6)',
              border: `1px solid ${tool.circuit_open ? 'rgba(248,113,113,0.3)' : 'var(--panel-border)'}`,
              borderRadius: 12,
              display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 13, color: 'var(--text-main)' }}>
                    {tool.name}
                  </span>
                  <ToolStatusPill tool={tool} />
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>{tool.description}</div>
                <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-dim,#64748b)', fontFamily: 'monospace' }}>
                  <span>{tool.call_count ?? 0} chamadas</span>
                  <span>{tool.success_rate ?? 100}% sucesso</span>
                  {tool.consecutive_failures > 0 && (
                    <span style={{ color: 'var(--danger)' }}>{tool.consecutive_failures} falhas seguidas</span>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0, marginLeft: 12 }}>
                {tool.circuit_open && (
                  <button
                    className="ag-btn-ghost"
                    style={{ padding: '4px 8px', fontSize: 10, color: 'var(--warning)', borderColor: 'rgba(251,191,36,0.3)' }}
                    onClick={() => handleResetBreaker(tool)}
                  >
                    Reset Breaker
                  </button>
                )}
                <button
                  className="ag-btn-ghost"
                  style={{ padding: '4px 8px', fontSize: 10 }}
                  onClick={() => handleToggle(tool)}
                >
                  {tool.is_enabled ? 'Desativar' : 'Ativar'}
                </button>
                <button
                  className="ag-btn-ghost"
                  style={{ padding: '4px 8px', fontSize: 10 }}
                  onClick={() => { setEditTool(tool); setModalOpen(true); }}
                >
                  Editar
                </button>
                <button
                  className="ag-btn-ghost"
                  style={{ padding: '4px 8px', fontSize: 10, color: 'var(--danger)', borderColor: 'rgba(248,113,113,0.3)' }}
                  onClick={() => handleDelete(tool.id)}
                >
                  <Icons.Trash style={{ width: 12, height: 12 }} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!canAddMore && (
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
          Limite de 10 tools atingido. Remova uma para adicionar outra.
        </div>
      )}

      {modalOpen && (
        <ToolModal
          agentId={agentId}
          editTool={editTool}
          onClose={() => setModalOpen(false)}
          onSaved={fetchTools}
        />
      )}

      <style>{`
        .ag-btn-primary { background:var(--gradient-primary); color:white; border:none; border-radius:10px; padding:10px 16px; font-weight:600; font-size:13px; cursor:pointer; box-shadow:0 4px 14px rgba(37,99,235,0.3); display:inline-flex; align-items:center; gap:8px; transition:transform 0.15s; }
        .ag-btn-primary:hover { transform:translateY(-1px); }
        .ag-btn-primary:disabled { opacity:0.5; cursor:not-allowed; transform:none; }
        .ag-btn-ghost { background:rgba(15,23,42,0.6); color:var(--text-main); border:1px solid var(--panel-border); border-radius:8px; padding:8px 12px; font-weight:500; font-size:12px; cursor:pointer; display:inline-flex; align-items:center; gap:6px; transition:all 0.15s; }
        .ag-btn-ghost:hover { border-color:var(--primary); background:rgba(59,130,246,0.08); }
        .ag-pulse-dot { width:7px; height:7px; border-radius:50%; animation:ag-pulse 2s infinite; display:inline-block; }
        @keyframes ag-pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
      `}</style>
    </div>
  );
}
