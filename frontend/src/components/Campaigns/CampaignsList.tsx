import { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { campaignApi, type Campaign } from '../../services/campaignApi';
import { Icons } from '../icons';

interface CampaignsListProps {
  onNew: () => void;
  onSelect: (id: string) => void;
}

type FilterStatus = 'all' | 'running' | 'scheduled' | 'completed';

const STATUS_FILTER_MAP: Record<FilterStatus, string | undefined> = {
  all: undefined,
  running: 'running',
  scheduled: 'scheduled',
  completed: 'completed',
};

function StatusPill({ status }: { status: Campaign['status'] }) {
  const map: Record<string, { label: string; cls: string }> = {
    running: { label: 'Em curso', cls: 'status-running' },
    scheduled: { label: 'Agendada', cls: 'status-queued' },
    completed: { label: 'Concluída', cls: 'status-done' },
    paused: { label: 'Pausada', cls: 'status-paused' },
    failed: { label: 'Falhou', cls: 'status-failed' },
    cancelled: { label: 'Cancelada', cls: 'status-failed' },
    draft: { label: 'Rascunho', cls: 'status-paused' },
  };
  const { label, cls } = map[status] ?? { label: status, cls: 'status-paused' };
  return (
    <span className={`status-pill ${cls}`}>
      {status === 'running' && <span className="pulse-dot" />}
      {label}
    </span>
  );
}

function MetricCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{
      background: 'rgba(15,23,42,0.6)',
      border: '1px solid var(--panel-border)',
      borderRadius: 12,
      padding: 14,
      flex: 1,
    }}>
      <div style={{ fontSize: 10, color: 'var(--text-dim,#64748b)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color, fontFamily: 'monospace' }}>{value.toLocaleString()}</div>
    </div>
  );
}

function CampaignCard({ campaign, onSelect }: { campaign: Campaign; onSelect: () => void }) {
  const progress = campaign.total_recipients > 0
    ? Math.round((campaign.sent_count / campaign.total_recipients) * 100)
    : 0;
  const queueCount = campaign.total_recipients - campaign.sent_count - campaign.failed_count;

  return (
    <div style={{
      background: 'var(--panel)',
      border: `1px solid ${campaign.status === 'running' ? 'rgba(96,165,250,0.3)' : 'var(--panel-border)'}`,
      borderRadius: 16,
      padding: 20,
      boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <h4 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: 'var(--text-main)' }}>{campaign.name}</h4>
            <StatusPill status={campaign.status} />
          </div>
          <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-dim,#64748b)', margin: 0 }}>
            {campaign.instance_id} · {campaign.total_recipients.toLocaleString()} destinatários
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            className="btn-ghost"
            style={{ padding: '6px 10px', fontSize: 11 }}
            onClick={onSelect}
          >
            <Icons.ChartBar style={{ width: 12, height: 12 }} />
            Detalhes
          </button>
        </div>
      </div>

      {(campaign.status === 'running' || campaign.status === 'paused') && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, fontSize: 11 }}>
            <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>Progresso</span>
            <span style={{ fontFamily: 'monospace', color: 'var(--primary)', fontWeight: 600 }}>
              {campaign.sent_count.toLocaleString()} / {campaign.total_recipients.toLocaleString()} ({progress}%)
            </span>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {campaign.status === 'completed' && (
        <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-dim,#64748b)', margin: '0 0 14px 0' }}>
          {campaign.sent_count.toLocaleString()}/{campaign.total_recipients.toLocaleString()} enviadas
          {campaign.replied_count > 0 && ` · ${campaign.replied_count} respostas`}
        </p>
      )}

      {campaign.status !== 'scheduled' && campaign.status !== 'draft' && (
        <div style={{ display: 'flex', gap: 10 }}>
          <MetricCard label="Enviadas" value={campaign.sent_count} color="var(--success)" />
          <MetricCard label="Na Fila" value={Math.max(0, queueCount)} color="var(--warning)" />
          <MetricCard label="Falharam" value={campaign.failed_count} color="var(--danger)" />
          <MetricCard label="Responderam" value={campaign.replied_count} color="var(--primary)" />
        </div>
      )}

      {campaign.status === 'scheduled' && campaign.scheduled_at && (
        <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-dim,#64748b)', margin: 0 }}>
          dispara em {new Date(campaign.scheduled_at).toLocaleString('pt-BR')} · {campaign.total_recipients} destinatários
        </p>
      )}
    </div>
  );
}

export function CampaignsList({ onNew, onSelect }: CampaignsListProps) {
  const { t } = useLanguage();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterStatus>('all');

  const fetchCampaigns = useCallback(async () => {
    try {
      const statusParam = STATUS_FILTER_MAP[filter];
      const res = await campaignApi.listCampaigns(statusParam);
      setCampaigns(res.campaigns ?? []);
    } catch (err) {
      console.error('Error fetching campaigns:', err);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchCampaigns();
    const interval = setInterval(fetchCampaigns, 10000);
    return () => clearInterval(interval);
  }, [fetchCampaigns]);

  const counts = {
    all: campaigns.length,
    running: campaigns.filter(c => c.status === 'running').length,
    scheduled: campaigns.filter(c => c.status === 'scheduled').length,
    completed: campaigns.filter(c => c.status === 'completed').length,
  };

  const filterLabels: Record<FilterStatus, string> = {
    all: `${t('all')} (${counts.all})`,
    running: `Em curso (${counts.running})`,
    scheduled: `Agendadas (${counts.scheduled})`,
    completed: `Concluídas (${counts.completed})`,
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
              <Icons.Megaphone style={{ width: 18, height: 18, color: 'var(--primary)' }} />
              Campanhas WhatsApp
            </h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
              Disparo inteligente com variação IA anti-ban
            </p>
          </div>
          <button className="btn-primary" onClick={onNew}>
            <Icons.Plus style={{ width: 16, height: 16 }} />
            + Nova Campanha
          </button>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          {(Object.keys(filterLabels) as FilterStatus[]).map((f) => (
            <button
              key={f}
              className="btn-ghost"
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
            Carregando campanhas...
          </div>
        ) : campaigns.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '60px 0',
            color: 'var(--text-muted)',
            borderRadius: 12,
            border: '2px dashed var(--panel-border)',
          }}>
            <Icons.Megaphone style={{ width: 40, height: 40, margin: '0 auto 12px', opacity: 0.3 }} />
            <p style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>Nenhuma campanha ainda.</p>
            <p style={{ margin: '4px 0 16px', fontSize: 12, color: 'var(--text-dim,#64748b)' }}>
              Crie a primeira campanha de disparo inteligente.
            </p>
            <button className="btn-primary" onClick={onNew}>
              <Icons.Plus style={{ width: 14, height: 14 }} />
              Nova Campanha
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {campaigns.map((c) => (
              <CampaignCard key={c.id} campaign={c} onSelect={() => onSelect(c.id)} />
            ))}
          </div>
        )}
      </div>

      <style>{`
        .status-pill { font-size:10px; font-weight:700; letter-spacing:0.05em; padding:3px 9px; border-radius:999px; text-transform:uppercase; display:inline-flex; align-items:center; gap:4px; }
        .status-running { background:rgba(96,165,250,0.18); color:var(--primary); border:1px solid rgba(96,165,250,0.3); }
        .status-done { background:rgba(52,211,153,0.15); color:var(--success); border:1px solid rgba(52,211,153,0.3); }
        .status-failed { background:rgba(248,113,113,0.15); color:var(--danger); border:1px solid rgba(248,113,113,0.3); }
        .status-queued { background:rgba(251,191,36,0.15); color:var(--warning); border:1px solid rgba(251,191,36,0.3); }
        .status-paused { background:rgba(148,163,184,0.15); color:var(--text-muted); border:1px solid rgba(148,163,184,0.3); }
        .pulse-dot { width:8px; height:8px; border-radius:50%; background:var(--success); box-shadow:0 0 8px var(--success); animation:pulse-anim 2s infinite; display:inline-block; }
        @keyframes pulse-anim { 0%,100%{opacity:1} 50%{opacity:0.4} }
        .progress-track { width:100%; height:6px; background:rgba(96,165,250,0.12); border-radius:999px; overflow:hidden; }
        .progress-fill { height:100%; background:var(--gradient-primary); border-radius:999px; box-shadow:0 0 8px rgba(96,165,250,0.4); transition:width 0.3s ease; }
        .btn-primary { background:var(--gradient-primary); color:white; border:none; border-radius:10px; padding:10px 16px; font-weight:600; font-size:13px; cursor:pointer; box-shadow:0 4px 14px rgba(37,99,235,0.3); display:inline-flex; align-items:center; gap:8px; transition:transform 0.15s; }
        .btn-primary:hover { transform:translateY(-1px); }
        .btn-ghost { background:rgba(15,23,42,0.6); color:var(--text-main); border:1px solid var(--panel-border); border-radius:10px; padding:10px 16px; font-weight:500; font-size:13px; cursor:pointer; display:inline-flex; align-items:center; gap:8px; transition:all 0.15s; }
        .btn-ghost:hover { border-color:var(--primary); background:rgba(59,130,246,0.08); }
      `}</style>
    </div>
  );
}
