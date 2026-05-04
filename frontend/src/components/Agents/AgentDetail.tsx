import { useState, useEffect } from 'react';
import { agentApi, type Agent } from '../../services/agentApi';
import { AgentPlayground } from './AgentPlayground';
import { AgentDocuments } from './AgentDocuments';
import { AgentTools } from './AgentTools';
import { AgentBusinessHours } from './AgentBusinessHours';
import { AgentConversations } from './AgentConversations';
import { AgentBuilder } from './AgentBuilder';
import { Icons } from '../icons';

interface AgentDetailProps {
  agentId: string;
  onClose: () => void;
}

type Tab = 'playground' | 'documents' | 'tools' | 'business-hours' | 'conversations';

const TABS: { id: Tab; label: string }[] = [
  { id: 'playground',      label: 'Playground' },
  { id: 'documents',       label: 'Documentos RAG' },
  { id: 'tools',           label: 'Custom Tools' },
  { id: 'business-hours',  label: 'Horários' },
  { id: 'conversations',   label: 'Conversas' },
];

export function AgentDetail({ agentId, onClose }: AgentDetailProps) {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [tab, setTab] = useState<Tab>('playground');
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    agentApi.getAgent(agentId)
      .then(res => setAgent(res.agent))
      .catch(() => {});
  }, [agentId]);

  if (editing && agent) {
    return (
      <AgentBuilder
        agent={agent}
        onClose={() => setEditing(false)}
        onSaved={(updated) => { setAgent(updated); setEditing(false); }}
      />
    );
  }

  return (
    <div style={{
      background: 'var(--panel)',
      border: '1px solid var(--panel-border)',
      borderRadius: 16,
      boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 24px',
        borderBottom: '1px solid var(--panel-border)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        background: 'rgba(15,23,42,0.8)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}
          >
            ← Agentes
          </button>
          <span style={{ color: 'var(--panel-border)' }}>|</span>
          <Icons.Sparkles style={{ width: 16, height: 16, color: 'var(--primary)' }} />
          <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-main)' }}>
            {agent?.name ?? 'Carregando...'}
          </span>
          {agent && (
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
              background: agent.status === 'active' ? 'rgba(96,165,250,0.18)' : 'rgba(148,163,184,0.15)',
              color: agent.status === 'active' ? 'var(--primary)' : 'var(--text-muted)',
              border: `1px solid ${agent.status === 'active' ? 'rgba(96,165,250,0.3)' : 'rgba(148,163,184,0.3)'}`,
              textTransform: 'uppercase',
            }}>
              {agent.status === 'active' ? 'Ativo' : agent.status === 'paused' ? 'Pausado' : 'Rascunho'}
            </span>
          )}
        </div>
        <button
          className="ag-btn-ghost"
          style={{ fontSize: 12, padding: '5px 12px' }}
          onClick={() => setEditing(true)}
        >
          <Icons.Settings style={{ width: 13, height: 13 }} />
          Editar Configuração
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--panel-border)', overflowX: 'auto' }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '12px 20px',
              background: 'none',
              border: 'none',
              borderBottom: `2px solid ${tab === t.id ? 'var(--primary)' : 'transparent'}`,
              color: tab === t.id ? 'var(--primary)' : 'var(--text-muted)',
              fontWeight: tab === t.id ? 600 : 400,
              fontSize: 13,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'color 0.15s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ padding: 24 }}>
        {agent && (
          <>
            {tab === 'playground' && (
              <div style={{ height: 560, overflow: 'hidden', borderRadius: 12, border: '1px solid var(--panel-border)' }}>
                <AgentPlayground agentId={agentId} agentName={agent.name} />
              </div>
            )}
            {tab === 'documents' && <AgentDocuments agentId={agentId} />}
            {tab === 'tools' && <AgentTools agentId={agentId} />}
            {tab === 'business-hours' && <AgentBusinessHours agentId={agentId} />}
            {tab === 'conversations' && <AgentConversations agentId={agentId} />}
          </>
        )}
        {!agent && (
          <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-muted)' }}>
            Carregando agente...
          </div>
        )}
      </div>

      <style>{`
        .ag-btn-ghost { background:rgba(15,23,42,0.6); color:var(--text-main); border:1px solid var(--panel-border); border-radius:10px; padding:10px 16px; font-weight:500; font-size:13px; cursor:pointer; display:inline-flex; align-items:center; gap:8px; transition:all 0.15s; }
        .ag-btn-ghost:hover { border-color:var(--primary); background:rgba(59,130,246,0.08); }
      `}</style>
    </div>
  );
}
