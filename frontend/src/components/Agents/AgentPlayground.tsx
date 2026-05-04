import { useState, useRef, useEffect } from 'react';
import { agentApi, type PlaygroundResponse } from '../../services/agentApi';
import { Icons } from '../icons';

interface AgentPlaygroundProps {
  agentId: string;
  agentName: string;
}

interface LocalMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  meta?: PlaygroundResponse;
}

export function AgentPlayground({ agentId, agentName }: AgentPlaygroundProps) {
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [expandedRag, setExpandedRag] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');

    const userMsg: LocalMessage = { id: `u-${Date.now()}`, role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      const res = await agentApi.playground(agentId, text);
      const assistantMsg: LocalMessage = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: res.response,
        meta: res,
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err: unknown) {
      const errMsg: LocalMessage = {
        id: `e-${Date.now()}`,
        role: 'assistant',
        content: `Erro: ${err instanceof Error ? err.message : 'Falha na chamada'}`,
      };
      setMessages(prev => [...prev, errMsg]);
    } finally {
      setLoading(false);
    }
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div style={{ display: 'flex', height: '100%', gap: 0, background: 'var(--bg,#050b16)' }}>
      {/* Left — Chat */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid var(--panel-border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: 'var(--panel)',
        }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icons.Sparkles style={{ width: 16, height: 16, color: 'var(--primary)' }} />
              Playground — {agentName}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              Teste sem enviar para cliente real · phone: +playground
            </div>
          </div>
          <button
            className="ag-btn-ghost"
            style={{ fontSize: 11, padding: '5px 10px' }}
            onClick={() => setMessages([])}
          >
            Limpar
          </button>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {messages.length === 0 && (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
              <Icons.Sparkles style={{ width: 32, height: 32, margin: '0 auto 12px', opacity: 0.3 }} />
              <p style={{ margin: 0, fontSize: 13 }}>Digite uma mensagem para testar o agente</p>
            </div>
          )}
          {messages.map(msg => (
            <div key={msg.id} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div style={{
                maxWidth: '75%',
                padding: '10px 14px',
                borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                background: msg.role === 'user'
                  ? 'var(--gradient-primary)'
                  : 'rgba(15,23,42,0.8)',
                border: msg.role === 'user' ? 'none' : '1px solid var(--panel-border)',
                color: 'var(--text-main)',
                fontSize: 13,
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}>
                {msg.content}

                {/* Metadata for assistant messages */}
                {msg.meta && (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                    {/* Latency + tokens */}
                    <div style={{ display: 'flex', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-dim,#64748b)' }}>
                        {msg.meta.latency_ms}ms
                      </span>
                      <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-dim,#64748b)' }}>
                        in:{msg.meta.tokens.input} out:{msg.meta.tokens.output}
                      </span>
                    </div>

                    {/* RAG hits */}
                    {msg.meta.rag_hits.length > 0 && (
                      <div>
                        <button
                          onClick={() => setExpandedRag(expandedRag === msg.id ? null : msg.id)}
                          style={{
                            background: 'rgba(96,165,250,0.12)',
                            border: '1px solid rgba(96,165,250,0.25)',
                            borderRadius: 6, padding: '3px 8px',
                            fontSize: 10, color: 'var(--primary)',
                            cursor: 'pointer', fontWeight: 600,
                          }}
                        >
                          {expandedRag === msg.id ? '▼' : '▶'} Agente consultou {msg.meta.rag_hits.length} chunk{msg.meta.rag_hits.length > 1 ? 's' : ''}
                        </button>
                        {expandedRag === msg.id && (
                          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {msg.meta.rag_hits.map((hit, i) => (
                              <div key={i} style={{
                                padding: '8px 10px',
                                background: 'rgba(5,11,22,0.6)',
                                borderRadius: 6,
                                border: '1px solid rgba(96,165,250,0.15)',
                              }}>
                                <div style={{ fontSize: 10, color: 'var(--primary)', fontWeight: 600, marginBottom: 4 }}>
                                  {hit.document_name} · sim {(hit.similarity * 100).toFixed(0)}%
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                                  {hit.chunk_content_preview}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Tools called */}
                    {msg.meta.tools_called.length > 0 && (
                      <div style={{ marginTop: 6 }}>
                        {msg.meta.tools_called.map((tc, i) => (
                          <div key={i} style={{
                            fontSize: 10, color: 'var(--warning)',
                            background: 'rgba(251,191,36,0.08)',
                            border: '1px solid rgba(251,191,36,0.2)',
                            borderRadius: 4, padding: '2px 6px', display: 'inline-block', marginRight: 4, marginTop: 2,
                          }}>
                            tool: {tc.tool_name} ({tc.duration_ms}ms)
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
              <div style={{
                padding: '10px 14px', borderRadius: '16px 16px 16px 4px',
                background: 'rgba(15,23,42,0.8)', border: '1px solid var(--panel-border)',
                color: 'var(--text-muted)', fontSize: 13,
              }}>
                <span style={{ animation: 'ag-blink 1s infinite' }}>Gerando resposta...</span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div style={{ padding: 16, borderTop: '1px solid var(--panel-border)', background: 'var(--panel)' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <textarea
              style={{
                flex: 1, background: 'rgba(15,23,42,0.8)', border: '1px solid var(--panel-border)',
                borderRadius: 10, padding: '10px 14px', color: 'var(--text-main)',
                fontSize: 14, resize: 'none', height: 60, outline: 'none', lineHeight: 1.5,
              }}
              placeholder="Digite uma mensagem de teste... (Enter para enviar)"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              disabled={loading}
            />
            <button
              className="ag-btn-primary"
              style={{ height: 60, padding: '0 20px' }}
              onClick={send}
              disabled={loading || !input.trim()}
            >
              <Icons.Send style={{ width: 16, height: 16 }} />
            </button>
          </div>
        </div>
      </div>

      <style>{`
        .ag-btn-primary { background:var(--gradient-primary); color:white; border:none; border-radius:10px; padding:10px 16px; font-weight:600; font-size:13px; cursor:pointer; box-shadow:0 4px 14px rgba(37,99,235,0.3); display:inline-flex; align-items:center; gap:8px; transition:transform 0.15s; }
        .ag-btn-primary:hover { transform:translateY(-1px); }
        .ag-btn-primary:disabled { opacity:0.5; cursor:not-allowed; transform:none; }
        .ag-btn-ghost { background:rgba(15,23,42,0.6); color:var(--text-main); border:1px solid var(--panel-border); border-radius:10px; padding:10px 16px; font-weight:500; font-size:13px; cursor:pointer; display:inline-flex; align-items:center; gap:8px; transition:all 0.15s; }
        .ag-btn-ghost:hover { border-color:var(--primary); background:rgba(59,130,246,0.08); }
        @keyframes ag-blink { 0%,100%{opacity:1} 50%{opacity:0.4} }
      `}</style>
    </div>
  );
}
