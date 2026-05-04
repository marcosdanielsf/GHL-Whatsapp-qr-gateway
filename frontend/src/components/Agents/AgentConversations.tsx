import { useState, useEffect, useCallback, useRef } from 'react';
import { agentApi, type AgentConversation, type ConversationDetail, type ConversationMessage } from '../../services/agentApi';
import { Icons } from '../icons';

interface AgentConversationsProps {
  agentId: string;
}

function ConvStatusPill({ status }: { status: AgentConversation['status'] }) {
  const map = {
    active:     { label: 'Ativa',       bg: 'rgba(96,165,250,0.18)',   color: 'var(--primary)', border: 'rgba(96,165,250,0.3)',    pulse: true },
    idle:       { label: 'Inativa',     bg: 'rgba(148,163,184,0.1)',   color: 'var(--text-muted)', border: 'rgba(148,163,184,0.3)', pulse: false },
    closed:     { label: 'Encerrada',   bg: 'rgba(52,211,153,0.1)',    color: 'var(--success)', border: 'rgba(52,211,153,0.25)',   pulse: false },
    taken_over: { label: 'Humano',      bg: 'rgba(251,191,36,0.15)',   color: 'var(--warning)', border: 'rgba(251,191,36,0.3)',   pulse: false },
  };
  const s = map[status as keyof typeof map] ?? map.closed;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 999,
      textTransform: 'uppercase', letterSpacing: '0.05em',
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
    }}>
      {s.pulse && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--primary)', animation: 'ag-pulse 2s infinite', display: 'inline-block' }} />}
      {s.label}
    </span>
  );
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'agora';
  if (m < 60) return `${m}m atrás`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h atrás`;
  return `${Math.floor(h / 24)}d atrás`;
}

interface ChatPanelProps {
  agentId: string;
  conversation: AgentConversation;
  onTakeover: () => void;
}

function ChatPanel({ agentId, conversation, onTakeover }: ChatPanelProps) {
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [taking, setTaking] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  const fetchDetail = useCallback(async () => {
    try {
      const res = await agentApi.getConversation(agentId, conversation.id);
      setDetail(res.conversation);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [agentId, conversation.id]);

  useEffect(() => {
    fetchDetail();
    // SSE stream for new messages
    unsubRef.current = agentApi.getConversationStream(agentId, conversation.id, (msg: ConversationMessage) => {
      setDetail(prev => {
        if (!prev) return prev;
        return { ...prev, messages: [...prev.messages, msg] };
      });
    });
    return () => { unsubRef.current?.(); };
  }, [agentId, conversation.id, fetchDetail]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [detail?.messages]);

  const handleTakeover = async () => {
    setTaking(true);
    try {
      await agentApi.takeover(agentId, conversation.id);
      onTakeover();
    } catch { /* silent */ }
    finally { setTaking(false); }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Panel header */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--panel-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-main)', fontFamily: 'monospace' }}>
            {conversation.contact_phone}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            {conversation.message_count} msgs · {timeAgo(conversation.last_user_msg_at)}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <ConvStatusPill status={conversation.status} />
          {conversation.status === 'active' && (
            <button
              className="ag-btn-ghost"
              style={{ fontSize: 11, padding: '5px 10px', color: 'var(--warning)', borderColor: 'rgba(251,191,36,0.3)' }}
              onClick={handleTakeover}
              disabled={taking}
            >
              {taking ? 'Assumindo...' : 'Takeover'}
            </button>
          )}
        </div>
      </div>

      {/* Metrics */}
      {detail && (
        <div style={{ display: 'flex', gap: 8, padding: '10px 16px', borderBottom: '1px solid var(--panel-border)' }}>
          {[
            { label: 'Tokens In',  value: detail.total_tokens_in.toLocaleString() },
            { label: 'Tokens Out', value: detail.total_tokens_out.toLocaleString() },
            { label: 'Tools',      value: detail.total_tools_called },
            { label: 'RAG Hits',   value: detail.total_rag_hits },
          ].map(m => (
            <div key={m.label} style={{ textAlign: 'center', flex: 1 }}>
              <div style={{ fontSize: 9, color: 'var(--text-dim,#64748b)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>{m.label}</div>
              <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13, color: 'var(--text-main)' }}>{m.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)' }}>Carregando...</div>
        ) : detail?.messages.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)' }}>Nenhuma mensagem</div>
        ) : detail?.messages.map((msg, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-start' : 'flex-end' }}>
            <div style={{
              maxWidth: '75%',
              padding: '8px 12px',
              borderRadius: msg.role === 'user' ? '12px 12px 12px 4px' : '12px 12px 4px 12px',
              background: msg.role === 'user'
                ? 'rgba(15,23,42,0.8)'
                : 'var(--gradient-primary)',
              border: msg.role === 'user' ? '1px solid var(--panel-border)' : 'none',
              color: 'var(--text-main)',
              fontSize: 12,
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}>
              {msg.content}
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', marginTop: 4, fontFamily: 'monospace' }}>
                {new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

export function AgentConversations({ agentId }: AgentConversationsProps) {
  const [conversations, setConversations] = useState<AgentConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<AgentConversation | null>(null);

  const fetchConversations = useCallback(async () => {
    try {
      const res = await agentApi.listConversations(agentId, { limit: 50 });
      setConversations(res.conversations ?? []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [agentId]);

  useEffect(() => {
    fetchConversations();
    const interval = setInterval(fetchConversations, 10000);
    return () => clearInterval(interval);
  }, [fetchConversations]);

  const handleTakeover = () => {
    fetchConversations();
    if (selected) {
      setSelected(prev => prev ? { ...prev, status: 'taken_over' } : null);
    }
  };

  return (
    <div style={{ display: 'flex', gap: 0, height: 560 }}>
      {/* Left list */}
      <div style={{
        width: 280, flexShrink: 0, borderRight: '1px solid var(--panel-border)',
        overflowY: 'auto',
      }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)' }}>Carregando...</div>
        ) : conversations.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--text-muted)' }}>
            <p style={{ margin: 0, fontSize: 12 }}>Nenhuma conversa ainda.</p>
          </div>
        ) : conversations.map(conv => (
          <button
            key={conv.id}
            onClick={() => setSelected(conv)}
            style={{
              width: '100%', textAlign: 'left',
              padding: '12px 14px',
              background: selected?.id === conv.id ? 'rgba(96,165,250,0.1)' : 'transparent',
              border: 'none',
              borderBottom: '1px solid rgba(148,163,184,0.08)',
              cursor: 'pointer',
              borderLeft: selected?.id === conv.id ? '3px solid var(--primary)' : '3px solid transparent',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
              <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600, color: 'var(--text-main)' }}>
                {conv.contact_phone}
              </span>
              <ConvStatusPill status={conv.status} />
            </div>
            {conv.last_message_preview && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 4 }}>
                {conv.last_message_preview}
              </div>
            )}
            <div style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-dim,#64748b)' }}>
              {timeAgo(conv.last_user_msg_at)} · {conv.message_count} msgs
            </div>
          </button>
        ))}
      </div>

      {/* Right panel */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        {selected ? (
          <ChatPanel
            agentId={agentId}
            conversation={selected}
            onTakeover={handleTakeover}
          />
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
            <div style={{ textAlign: 'center' }}>
              <Icons.Message style={{ width: 32, height: 32, margin: '0 auto 12px', opacity: 0.3 }} />
              <p style={{ margin: 0, fontSize: 13 }}>Selecione uma conversa</p>
            </div>
          </div>
        )}
      </div>

      <style>{`
        .ag-btn-ghost { background:rgba(15,23,42,0.6); color:var(--text-main); border:1px solid var(--panel-border); border-radius:8px; padding:8px 12px; font-weight:500; font-size:12px; cursor:pointer; display:inline-flex; align-items:center; gap:6px; transition:all 0.15s; }
        .ag-btn-ghost:hover { border-color:var(--primary); background:rgba(59,130,246,0.08); }
        @keyframes ag-pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
      `}</style>
    </div>
  );
}
