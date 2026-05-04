import { useState, useEffect, useRef } from 'react';
import { toast } from 'react-toastify';
import { campaignApi, type Campaign, type CampaignRecipient } from '../../services/campaignApi';
import { Icons } from '../icons';

interface CampaignDetailProps {
  id: string;
  onClose: () => void;
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    running: { label: 'Em curso', cls: 'status-running' },
    scheduled: { label: 'Agendada', cls: 'status-queued' },
    completed: { label: 'Concluída', cls: 'status-done' },
    paused: { label: 'Pausada', cls: 'status-paused' },
    failed: { label: 'Falhou', cls: 'status-failed' },
    cancelled: { label: 'Cancelada', cls: 'status-failed' },
    draft: { label: 'Rascunho', cls: 'status-paused' },
    sent: { label: 'Enviada', cls: 'status-done' },
    queued: { label: 'Na fila', cls: 'status-queued' },
    replied: { label: 'Respondeu', cls: 'status-replied' },
    skipped: { label: 'Ignorada', cls: 'status-paused' },
  };
  const { label, cls } = map[status] ?? { label: status, cls: 'status-paused' };
  return (
    <span className={`status-pill ${cls}`}>
      {status === 'running' && <span className="pulse-dot" />}
      {label}
    </span>
  );
}

function MetricCard5({ label, value, subtext, color, extra }: {
  label: string;
  value: string | number;
  subtext?: string;
  color?: string;
  extra?: React.ReactNode;
}) {
  return (
    <div style={{ background: 'rgba(15,23,42,0.6)', border: '1px solid var(--panel-border)', borderRadius: 12, padding: 14 }}>
      <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>{label}</div>
      {extra || (
        <div style={{ fontFamily: 'monospace', fontSize: 22, fontWeight: 700, color: color ?? 'var(--text-main)' }}>{value}</div>
      )}
      {subtext && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{subtext}</div>}
    </div>
  );
}

const PAGE_SIZE = 50;

export function CampaignDetail({ id, onClose }: CampaignDetailProps) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [recipients, setRecipients] = useState<CampaignRecipient[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const closeSSERef = useRef<(() => void) | null>(null);

  // Initial load
  useEffect(() => {
    const load = async () => {
      try {
        const res = await campaignApi.getCampaign(id);
        setCampaign(res.campaign);
        setRecipients(res.recipients ?? []);
      } catch (err: any) {
        toast.error(err.message || 'Erro ao carregar campanha.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  // SSE stream for live updates
  useEffect(() => {
    const cleanup = campaignApi.getCampaignStream(
      id,
      (data) => {
        setCampaign(prev => prev ? { ...prev, ...data } : prev);
        if (data.recipients) {
          setRecipients(data.recipients);
        }
      },
      (err) => console.warn('SSE error', err)
    );
    closeSSERef.current = cleanup;
    return () => {
      cleanup();
    };
  }, [id]);

  const handlePause = async () => {
    setActionLoading(true);
    try {
      await campaignApi.pauseCampaign(id);
      setCampaign(prev => prev ? { ...prev, status: 'paused' } : prev);
      toast.success('Campanha pausada.');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleResume = async () => {
    setActionLoading(true);
    try {
      await campaignApi.resumeCampaign(id);
      setCampaign(prev => prev ? { ...prev, status: 'running' } : prev);
      toast.success('Campanha retomada.');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!window.confirm('Cancelar a campanha? Esta ação não pode ser desfeita.')) return;
    setActionLoading(true);
    try {
      await campaignApi.cancelCampaign(id);
      setCampaign(prev => prev ? { ...prev, status: 'cancelled' } : prev);
      toast.success('Campanha cancelada.');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '80px 0' }}>
        <div style={{ width: 40, height: 40, border: '3px solid var(--panel-border)', borderTopColor: 'var(--primary)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto' }} />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  if (!campaign) {
    return (
      <div style={{ padding: 24 }}>
        <button className="btn-ghost" onClick={onClose}>← Voltar</button>
        <p style={{ color: 'var(--danger)', marginTop: 16 }}>Campanha não encontrada.</p>
      </div>
    );
  }

  const progress = campaign.total_recipients > 0
    ? Math.round((campaign.sent_count / campaign.total_recipients) * 100)
    : 0;
  const queueCount = Math.max(0, campaign.total_recipients - campaign.sent_count - campaign.failed_count);

  // Variant distribution bars
  const variantColors = ['var(--primary)', 'var(--warning)', 'var(--success)', '#a78bfa', '#f472b6'];
  const numVariants = 5;

  const pagedRecipients = recipients.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(recipients.length / PAGE_SIZE);

  return (
    <div style={{ padding: '24px 0' }}>
      {/* Back */}
      <button className="btn-ghost" style={{ marginBottom: 20, fontSize: 12 }} onClick={onClose}>
        ← Voltar para Campanhas
      </button>

      <div style={{
        background: 'var(--panel)',
        border: '1px solid var(--panel-border)',
        borderRadius: 16,
        boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
        padding: 28,
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, paddingBottom: 20, borderBottom: '1px solid var(--panel-border)' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <h3 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: 'var(--text-main)' }}>{campaign.name}</h3>
              <StatusPill status={campaign.status} />
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, display: 'flex', alignItems: 'center', gap: 16 }}>
              <span style={{ fontFamily: 'monospace' }}>{campaign.instance_id}</span>
              <span>{campaign.total_recipients.toLocaleString()} destinatários</span>
              {campaign.started_at && <span>iniciada {new Date(campaign.started_at).toLocaleTimeString('pt-BR')}</span>}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {campaign.status === 'running' && (
              <button className="btn-ghost" style={{ fontSize: 12 }} disabled={actionLoading} onClick={handlePause}>
                <Icons.Clock style={{ width: 14, height: 14 }} />
                Pausar
              </button>
            )}
            {campaign.status === 'paused' && (
              <button className="btn-primary" style={{ fontSize: 12 }} disabled={actionLoading} onClick={handleResume}>
                Retomar
              </button>
            )}
            {(campaign.status === 'running' || campaign.status === 'paused') && (
              <button
                className="btn-ghost"
                style={{ fontSize: 12, color: 'var(--danger)', borderColor: 'rgba(248,113,113,0.3)' }}
                disabled={actionLoading}
                onClick={handleCancel}
              >
                Cancelar
              </button>
            )}
          </div>
        </div>

        {/* Progress */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-main)' }}>Progresso geral</div>
              {campaign.status === 'running' && (
                <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)' }}>
                  streaming SSE · 2s
                </div>
              )}
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{
                fontFamily: 'monospace', fontSize: 24, fontWeight: 700,
                background: 'var(--gradient-primary)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              }}>
                {progress}%
              </div>
              <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#64748b' }}>
                {campaign.sent_count.toLocaleString()} / {campaign.total_recipients.toLocaleString()}
              </div>
            </div>
          </div>
          <div className="progress-track" style={{ height: 10 }}>
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>

        {/* 5 Metrics */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 28 }}>
          <MetricCard5 label="Enviadas" value={campaign.sent_count.toLocaleString()} subtext={campaign.total_recipients > 0 ? `${Math.round((campaign.sent_count/campaign.total_recipients)*100)}% sucesso` : ''} color="var(--success)" />
          <MetricCard5 label="Na fila" value={queueCount.toLocaleString()} subtext="aguardando worker" color="var(--warning)" />
          <MetricCard5 label="Falharam" value={campaign.failed_count.toLocaleString()} subtext="retry x3 esgotado" color="var(--danger)" />
          <MetricCard5 label="Responderam" value={campaign.replied_count.toLocaleString()} subtext={campaign.sent_count > 0 ? `${Math.round((campaign.replied_count/campaign.sent_count)*100)}% reply rate` : ''} color="var(--primary)" />
          <MetricCard5 label="Distribuição"
            value=""
            subtext={`${numVariants} variações ~${Math.round(100/numVariants)}% cada`}
            extra={
              <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 36, marginTop: 4 }}>
                {variantColors.map((c, i) => (
                  <div key={i} style={{ flex: 1, background: c, borderRadius: 2 }} title={`Var ${i+1}`} />
                ))}
              </div>
            }
          />
        </div>

        {/* Recipients table */}
        <div style={{ background: 'rgba(15,23,42,0.4)', border: '1px solid var(--panel-border)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--panel-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-main)' }}>
              Destinatários · {recipients.length.toLocaleString()} total
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
              {campaign.status === 'running' && (
                <>
                  <span className="pulse-dot" style={{ width: 6, height: 6 }} />
                  <span style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>streaming SSE · 2s</span>
                </>
              )}
            </div>
          </div>

          {/* Table header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '30px 2fr 1.5fr 100px 80px',
            gap: 12,
            padding: '8px 16px',
            background: 'rgba(15,23,42,0.6)',
            fontSize: 10,
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            color: '#64748b',
            fontWeight: 700,
            borderBottom: '1px solid var(--panel-border)',
          }}>
            <span />
            <span>Contato</span>
            <span>Mensagem (var)</span>
            <span>Status</span>
            <span style={{ textAlign: 'right' }}>Tempo</span>
          </div>

          {pagedRecipients.length === 0 ? (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
              Nenhum destinatário ainda.
            </div>
          ) : (
            pagedRecipients.map((r) => (
              <RecipientRow key={r.id} recipient={r} />
            ))
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ marginTop: 14, display: 'flex', justifyContent: 'center', gap: 8 }}>
            <button className="btn-ghost" style={{ padding: '6px 12px', fontSize: 11 }} disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Anterior</button>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', alignSelf: 'center' }}>Pág {page + 1} de {totalPages}</span>
            <button className="btn-ghost" style={{ padding: '6px 12px', fontSize: 11 }} disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Próxima →</button>
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
        .status-replied { background:rgba(96,165,250,0.18); color:var(--primary); border:1px solid rgba(96,165,250,0.3); }
        .pulse-dot { width:8px; height:8px; border-radius:50%; background:var(--success); box-shadow:0 0 8px var(--success); animation:pulse-anim 2s infinite; display:inline-block; }
        @keyframes pulse-anim { 0%,100%{opacity:1} 50%{opacity:0.4} }
        .progress-track { width:100%; background:rgba(96,165,250,0.12); border-radius:999px; overflow:hidden; }
        .progress-fill { height:100%; background:var(--gradient-primary); border-radius:999px; box-shadow:0 0 8px rgba(96,165,250,0.4); transition:width 0.3s ease; }
        .btn-primary { background:var(--gradient-primary); color:white; border:none; border-radius:10px; padding:10px 16px; font-weight:600; font-size:13px; cursor:pointer; box-shadow:0 4px 14px rgba(37,99,235,0.3); display:inline-flex; align-items:center; gap:8px; }
        .btn-primary:hover { transform:translateY(-1px); }
        .btn-primary:disabled { opacity:0.5; cursor:not-allowed; }
        .btn-ghost { background:rgba(15,23,42,0.6); color:var(--text-main); border:1px solid var(--panel-border); border-radius:10px; padding:10px 16px; font-weight:500; font-size:13px; cursor:pointer; display:inline-flex; align-items:center; gap:8px; }
        .btn-ghost:hover { border-color:var(--primary); background:rgba(59,130,246,0.08); }
        .btn-ghost:disabled { opacity:0.5; cursor:not-allowed; }
        .recipient-row:hover { background:rgba(59,130,246,0.04); }
      `}</style>
    </div>
  );
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '—';
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return `há ${diff}s`;
  if (diff < 3600) return `há ${Math.floor(diff / 60)}min`;
  return `há ${Math.floor(diff / 3600)}h`;
}

function RecipientRow({ recipient }: { recipient: CampaignRecipient }) {
  const statusIconMap: Record<string, React.ReactNode> = {
    sent: <span style={{ color: 'var(--success)', fontSize: 16 }}>✓</span>,
    failed: <span style={{ color: 'var(--danger)', fontSize: 16 }}>✗</span>,
    replied: <span style={{ color: 'var(--primary)', fontSize: 16 }}>↩</span>,
    queued: <span style={{ color: '#64748b', fontSize: 16 }}>⏳</span>,
    running: <span style={{ color: 'var(--warning)', fontSize: 14 }}>⌛</span>,
  };

  return (
    <div
      className="recipient-row"
      style={{
        display: 'grid',
        gridTemplateColumns: '30px 2fr 1.5fr 100px 80px',
        gap: 12,
        padding: '10px 16px',
        borderBottom: '1px solid var(--panel-border)',
        alignItems: 'center',
        fontSize: 12,
        transition: 'background 0.1s',
      }}
    >
      {statusIconMap[recipient.status] ?? statusIconMap.queued}
      <div>
        <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>{recipient.name ?? '—'}</div>
        <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#64748b' }}>{recipient.phone}</span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {recipient.text_sent
          ? `"${recipient.text_sent.slice(0, 40)}..." `
          : recipient.fail_reason
          ? <span style={{ color: 'var(--danger)' }}>{recipient.fail_reason}</span>
          : <span style={{ fontStyle: 'italic', color: '#64748b' }}>aguardando</span>
        }
        {recipient.variant_index != null && (
          <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--warning)' }}> v{recipient.variant_index}</span>
        )}
      </div>
      <span className={`status-pill status-${recipient.status === 'sent' ? 'done' : recipient.status === 'failed' ? 'failed' : recipient.status === 'replied' ? 'replied' : recipient.status === 'queued' ? 'queued' : 'running'}`}>
        {recipient.status}
      </span>
      <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#64748b', textAlign: 'right' }}>
        {timeAgo(recipient.sent_at ?? recipient.updated_at)}
      </span>
    </div>
  );
}
