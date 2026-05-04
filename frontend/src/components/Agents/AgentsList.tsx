import { useState, useEffect, useCallback } from 'react';
import { agentApi, type Agent } from '../../services/agentApi';
import { Icons } from '../icons';

interface AgentsListProps {
  onNew: () => void;
  onSelect: (id: string) => void;
}

type FilterStatus = 'all' | 'active' | 'paused' | 'inactive';

function StatusPill({ status }: { status: Agent['status'] }) {
  const map: Record<string, { label: string; cls: string }> = {
    active:   { label: 'Ativo',     cls: 'ag-pill-active' },
    paused:   { label: 'Pausado',   cls: 'ag-pill-paused' },
    inactive: { label: 'Rascunho', cls: 'ag-pill-draft' },
  };
  const { label, cls } = map[status] ?? { label: status, cls: 'ag-pill-draft' };
  return (
    <span className={`ag-status-pill ${cls}`}>
      {status === 'active' && <span className="ag-pulse-dot" />}
      {label}
    </span>
  );
}

function AgentMetric({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div style={{
      background: 'rgba(15,23,42,0.6)',
      border: '1px solid var(--panel-border)',
      borderRadius: 10,
      padding: '10px 14px',
      flex: 1,
      minWidth: 0,
    }}>
      <div style={{ fontSize: 10, color: 'var(--text-dim,#64748b)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</div>
    </div>
  );
}

const PROVIDER_LABELS: Record<string, string> = {
  openai:     'OpenAI',
  anthropic:  'Anthropic',
  google:     'Google',
  groq:       'Groq',
  grok:       'Grok',
  openrouter: 'OpenRouter',
};

function AgentCard({ agent, onSelect }: { agent: Agent; onSelect: () => void }) {
  const [acting, setActing] = useState(false);

  const handleActivate = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setActing(true);
    try {
      await agentApi.activateAgent(agent.id);
    } finally {
      setActing(false);
    }
  };

  const handlePause = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setActing(true);
    try {
      await agentApi.pauseAgent(agent.id);
    } finally {
      setActing(false);
    }
  };

  return (
    <div style={{
      background: 'var(--panel)',
      border: `1px solid ${agent.status === 'active' ? 'rgba(96,165,250,0.3)' : 'var(--panel-border)'}`,
      borderRadius: 16,
      padding: 20,
      boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <h4 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {agent.name}
            </h4>
            <StatusPill status={agent.status} />
          </div>
          <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-dim,#64748b)', margin: 0 }}>
            {agent.instance_id} · {PROVIDER_LABELS[agent.provider] ?? agent.provider} / {agent.model}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button className="ag-btn-ghost" style={{ padding: '6px 10px', fontSize: 11 }} onClick={onSelect}>
            <Icons.Settings style={{ width: 12, height: 12 }} />
            Editar
          </button>
          {agent.status === 'active' ? (
            <button className="ag-btn-ghost" style={{ padding: '6px 10px', fontSize: 11 }} onClick={handlePause} disabled={acting}>
              Pausar
            </button>
          ) : (
            <button className="ag-btn-primary" style={{ padding: '6px 10px', fontSize: 11 }} onClick={handleActivate} disabled={acting}>
              Ativar
            </button>
          )}
        </div>
      </div>

      {/* Metrics */}
      <div style={{ display: 'flex', gap: 8 }}>
        <AgentMetric label="Conv. Ativas" value={agent.active_conversations ?? 0} color="var(--primary)" />
        <AgentMetric label="Msgs Hoje" value={agent.msgs_today ?? 0} color="var(--success)" />
        <AgentMetric label="Taxa Resp." value={`${agent.response_rate ?? 0}%`} color="var(--warning)" />
        <AgentMetric label="Tokens Hoje" value={(agent.tokens_today ?? 0).toLocaleString()} color="var(--text-muted)" />
      </div>
    </div>
  );
}

export function AgentsList({ onNew, onSelect }: AgentsListProps) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterStatus>('all');

  const fetchAgents = useCallback(async () => {
    try {
      const res = await agentApi.listAgents();
      setAgents(res.agents ?? []);
    } catch (err) {
      console.error('Error fetching agents:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAgents();
    const interval = setInterval(fetchAgents, 15000);
    return () => clearInterval(interval);
  }, [fetchAgents]);

  const filtered = filter === 'all' ? agents : agents.filter(a => a.status === filter);

  const counts: Record<FilterStatus, number> = {
    all:      agents.length,
    active:   agents.filter(a => a.status === 'active').length,
    paused:   agents.filter(a => a.status === 'paused').length,
    inactive: agents.filter(a => a.status === 'inactive').length,
  };

  const filterLabels: Record<FilterStatus, string> = {
    all:      `Todos (${counts.all})`,
    active:   `Ativos (${counts.active})`,
    paused:   `Pausados (${counts.paused})`,
    inactive: `Rascunhos (${counts.inactive})`,
  };

  return (
    <div style={{ padding: '24px 0' }}>
      <div style={{
        background: 'var(--panel)',
        border: '1px solid var(--panel-border)',
        borderRadius: 16,
        boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
        padding: 28,
      }}>
        {/* Top bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
          <div>
            <h3 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 4px 0', display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-main)' }}>
              <Icons.Sparkles style={{ width: 18, height: 18, color: 'var(--primary)' }} />
              Agentes IA
            </h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
              Resposta automática com IA + RAG + Tools no WhatsApp
            </p>
          </div>
          <button className="ag-btn-primary" onClick={onNew}>
            <Icons.Plus style={{ width: 16, height: 16 }} />
            + Novo Agente
          </button>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          {(Object.keys(filterLabels) as FilterStatus[]).map((f) => (
            <button
              key={f}
              className="ag-btn-ghost"
              style={{
                fontSize: 12,
                padding: '6px 12px',
                ...(filter === f ? { background: 'var(--gradient-primary)', border: 'none', color: 'white' } : {}),
              }}
              onClick={() => setFilter(f)}
            >
              {filterLabels[f]}
            </button>
          ))}
        </div>

        {/* List */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
            Carregando agentes...
          </div>
        ) : filtered.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '60px 0',
            color: 'var(--text-muted)',
            borderRadius: 12,
            border: '2px dashed var(--panel-border)',
          }}>
            <Icons.Sparkles style={{ width: 40, height: 40, margin: '0 auto 12px', opacity: 0.3 }} />
            <p style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>Nenhum agente ainda.</p>
            <p style={{ margin: '4px 0 16px', fontSize: 12, color: 'var(--text-dim,#64748b)' }}>
              Crie o primeiro agente IA para responder automaticamente.
            </p>
            <button className="ag-btn-primary" onClick={onNew}>
              <Icons.Plus style={{ width: 14, height: 14 }} />
              Novo Agente
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {filtered.map((a) => (
              <AgentCard key={a.id} agent={a} onSelect={() => onSelect(a.id)} />
            ))}
          </div>
        )}
      </div>

      <style>{`
        .ag-status-pill { font-size:10px; font-weight:700; letter-spacing:0.05em; padding:3px 9px; border-radius:999px; text-transform:uppercase; display:inline-flex; align-items:center; gap:4px; white-space:nowrap; }
        .ag-pill-active  { background:rgba(96,165,250,0.18); color:var(--primary); border:1px solid rgba(96,165,250,0.3); }
        .ag-pill-paused  { background:rgba(148,163,184,0.15); color:var(--text-muted); border:1px solid rgba(148,163,184,0.3); }
        .ag-pill-draft   { background:rgba(251,191,36,0.15); color:var(--warning); border:1px solid rgba(251,191,36,0.3); }
        .ag-pulse-dot { width:7px; height:7px; border-radius:50%; background:var(--success); box-shadow:0 0 8px var(--success); animation:ag-pulse 2s infinite; display:inline-block; }
        @keyframes ag-pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        .ag-btn-primary { background:var(--gradient-primary); color:white; border:none; border-radius:10px; padding:10px 16px; font-weight:600; font-size:13px; cursor:pointer; box-shadow:0 4px 14px rgba(37,99,235,0.3); display:inline-flex; align-items:center; gap:8px; transition:transform 0.15s; }
        .ag-btn-primary:hover { transform:translateY(-1px); }
        .ag-btn-primary:disabled { opacity:0.5; cursor:not-allowed; transform:none; }
        .ag-btn-ghost { background:rgba(15,23,42,0.6); color:var(--text-main); border:1px solid var(--panel-border); border-radius:10px; padding:10px 16px; font-weight:500; font-size:13px; cursor:pointer; display:inline-flex; align-items:center; gap:8px; transition:all 0.15s; }
        .ag-btn-ghost:hover { border-color:var(--primary); background:rgba(59,130,246,0.08); }
        .ag-btn-ghost:disabled { opacity:0.5; cursor:not-allowed; }
      `}</style>
    </div>
  );
}
