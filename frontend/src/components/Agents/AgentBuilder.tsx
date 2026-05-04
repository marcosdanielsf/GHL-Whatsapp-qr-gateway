import { useState } from 'react';
import { agentApi, type CreateAgentPayload, type Agent } from '../../services/agentApi';
import { Icons } from '../icons';

interface AgentBuilderProps {
  agent?: Agent;     // se passado = modo edição
  onClose: () => void;
  onSaved: (agent: Agent) => void;
}

type Step = 1 | 2 | 3 | 4 | 5 | 6;

const PROVIDERS = [
  { value: 'openai',     label: 'OpenAI',     models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'] },
  { value: 'anthropic',  label: 'Anthropic',  models: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'] },
  { value: 'google',     label: 'Google',     models: ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'] },
  { value: 'groq',       label: 'Groq',       models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'] },
  { value: 'grok',       label: 'Grok (xAI)', models: ['grok-2-1212', 'grok-beta'] },
  { value: 'openrouter', label: 'OpenRouter',  models: ['openai/gpt-4o-mini', 'anthropic/claude-3.5-sonnet', 'google/gemini-2.0-flash-exp:free'] },
] as const;

const TIMEZONES = [
  'America/Sao_Paulo', 'America/Manaus', 'America/Fortaleza', 'America/Belem',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'Europe/London', 'Europe/Madrid', 'UTC',
];

const STEP_TITLES: Record<Step, string> = {
  1: 'Identidade',
  2: 'Modelo IA',
  3: 'Prompt do Sistema',
  4: 'Configurações',
  5: 'Funcionalidades',
  6: 'Horários',
};

const defaultPayload: CreateAgentPayload = {
  name: '',
  instance_id: '',
  provider: 'openai',
  model: 'gpt-4o-mini',
  system_prompt: '',
  temperature: 0.7,
  max_tokens: 1024,
  context_window_msgs: 20,
  summarize_after_msgs: 40,
  followup_enabled: false,
  followup_hours: 24,
  followup_max_times: 2,
  followup_message: 'Olá! Ainda está por aqui? Posso ajudar?',
  timezone: 'America/Sao_Paulo',
  out_of_hours_message: 'Olá! Nosso atendimento está fechado agora. Voltaremos em breve!',
  rag_enabled: false,
  rag_top_k: 5,
};

function stepFromAgent(agent: Agent): CreateAgentPayload {
  return {
    name: agent.name,
    instance_id: agent.instance_id,
    provider: agent.provider,
    model: agent.model,
    system_prompt: agent.system_prompt,
    temperature: agent.temperature,
    max_tokens: agent.max_tokens,
    context_window_msgs: agent.context_window_msgs,
    summarize_after_msgs: agent.summarize_after_msgs,
    followup_enabled: agent.followup_enabled,
    followup_hours: agent.followup_hours,
    followup_max_times: agent.followup_max_times,
    followup_message: agent.followup_message,
    timezone: agent.timezone,
    out_of_hours_message: agent.out_of_hours_message,
    rag_enabled: agent.rag_enabled,
    rag_top_k: agent.rag_top_k,
  };
}

// ── Shared input style ──────────────────────────────────────────────────
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

// ── Toggle ──────────────────────────────────────────────────────────────
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      style={{
        width: 44, height: 24, borderRadius: 999,
        background: checked ? 'var(--gradient-primary)' : 'rgba(148,163,184,0.2)',
        border: 'none', cursor: 'pointer', padding: 0, position: 'relative',
        transition: 'background 0.2s',
        flexShrink: 0,
      }}
    >
      <span style={{
        position: 'absolute', top: 3, left: checked ? 23 : 3,
        width: 18, height: 18, borderRadius: '50%', background: 'white',
        transition: 'left 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
      }} />
    </button>
  );
}

export function AgentBuilder({ agent, onClose, onSaved }: AgentBuilderProps) {
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<CreateAgentPayload>(
    agent ? stepFromAgent(agent) : defaultPayload,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof CreateAgentPayload>(key: K, value: CreateAgentPayload[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const currentProvider = PROVIDERS.find(p => p.value === form.provider) ?? PROVIDERS[0];

  const handleSave = async (goPlayground = false) => {
    setSaving(true);
    setError(null);
    try {
      let saved: Agent;
      if (agent) {
        const res = await agentApi.updateAgent(agent.id, form);
        saved = res.agent;
      } else {
        const res = await agentApi.createAgent(form);
        saved = res.agent;
      }
      onSaved(saved);
      if (!goPlayground) onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(5,11,22,0.95)',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Top bar */}
      <div style={{
        padding: '16px 24px',
        borderBottom: '1px solid var(--panel-border)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        background: 'var(--panel)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Icons.Sparkles style={{ width: 20, height: 20, color: 'var(--primary)' }} />
          <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-main)' }}>
            {agent ? `Editar: ${agent.name}` : 'Novo Agente IA'}
          </span>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 22 }}>×</button>
      </div>

      {/* Step tabs */}
      <div style={{ padding: '12px 24px', borderBottom: '1px solid var(--panel-border)', display: 'flex', gap: 4, overflowX: 'auto' }}>
        {([1, 2, 3, 4, 5, 6] as Step[]).map((s) => (
          <button
            key={s}
            onClick={() => setStep(s)}
            style={{
              padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
              cursor: 'pointer', whiteSpace: 'nowrap',
              background: step === s ? 'var(--gradient-primary)' : 'rgba(15,23,42,0.6)',
              border: step === s ? 'none' : '1px solid var(--panel-border)',
              color: step === s ? 'white' : 'var(--text-muted)',
            }}
          >
            {s}. {STEP_TITLES[s]}
          </button>
        ))}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        <div style={{ maxWidth: 640, margin: '0 auto' }}>

          {/* ── Step 1 ── */}
          {step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div>
                <label style={labelStyle}>Nome do Agente *</label>
                <input
                  style={inputStyle}
                  placeholder="Ex: Assistente da Marina"
                  value={form.name}
                  onChange={e => set('name', e.target.value)}
                />
              </div>
              <div>
                <label style={labelStyle}>Instância WhatsApp (chip) *</label>
                <input
                  style={inputStyle}
                  placeholder="Ex: wa-01"
                  value={form.instance_id}
                  onChange={e => set('instance_id', e.target.value)}
                />
                <p style={{ fontSize: 11, color: 'var(--text-dim,#64748b)', marginTop: 4 }}>
                  ID da instância que este agente irá monitorar
                </p>
              </div>
            </div>
          )}

          {/* ── Step 2 ── */}
          {step === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div>
                <label style={labelStyle}>Provider</label>
                <select
                  style={inputStyle}
                  value={form.provider}
                  onChange={e => {
                    const provider = e.target.value as CreateAgentPayload['provider'];
                    const models = PROVIDERS.find(p => p.value === provider)?.models ?? [];
                    set('provider', provider);
                    set('model', models[0] ?? '');
                  }}
                >
                  {PROVIDERS.map(p => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Modelo</label>
                <select
                  style={inputStyle}
                  value={form.model}
                  onChange={e => set('model', e.target.value)}
                >
                  {currentProvider.models.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-dim,#64748b)', padding: '10px 14px', background: 'rgba(96,165,250,0.06)', borderRadius: 8, border: '1px solid rgba(96,165,250,0.15)' }}>
                A chave da API do provider deve estar configurada em Configurações → Chave OpenAI (BYO). A cobrança de tokens é feita diretamente na sua conta do provider.
              </p>
            </div>
          )}

          {/* ── Step 3 ── */}
          {step === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <label style={{ ...labelStyle, margin: 0 }}>Prompt do Sistema *</label>
                  <span style={{ fontSize: 11, fontFamily: 'monospace', color: form.system_prompt.length > 9000 ? 'var(--danger)' : 'var(--text-dim,#64748b)' }}>
                    {form.system_prompt.length} / 10000
                  </span>
                </div>
                <textarea
                  style={{ ...inputStyle, height: 300, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }}
                  placeholder="Você é um assistente da [empresa]. Responda sempre em português, de forma amigável e objetiva..."
                  value={form.system_prompt}
                  maxLength={10000}
                  onChange={e => set('system_prompt', e.target.value)}
                />
              </div>
            </div>
          )}

          {/* ── Step 4 ── */}
          {step === 4 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <label style={{ ...labelStyle, margin: 0 }}>Temperatura: {form.temperature.toFixed(2)}</label>
                  <span style={{ fontSize: 11, color: 'var(--text-dim,#64748b)' }}>
                    {form.temperature <= 0.3 ? 'Determinístico' : form.temperature >= 1.4 ? 'Criativo' : 'Equilibrado'}
                  </span>
                </div>
                <input
                  type="range" min={0} max={2} step={0.05}
                  value={form.temperature}
                  onChange={e => set('temperature', parseFloat(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--primary)' }}
                />
              </div>
              <div>
                <label style={labelStyle}>Max Tokens</label>
                <input
                  type="number" min={64} max={8192}
                  style={inputStyle}
                  value={form.max_tokens}
                  onChange={e => set('max_tokens', parseInt(e.target.value))}
                />
              </div>
              <div>
                <label style={labelStyle}>Histórico de Mensagens (janela)</label>
                <input
                  type="number" min={5} max={50}
                  style={inputStyle}
                  value={form.context_window_msgs}
                  onChange={e => set('context_window_msgs', parseInt(e.target.value))}
                />
                <p style={{ fontSize: 11, color: 'var(--text-dim,#64748b)', marginTop: 4 }}>Quantas mensagens manter no contexto do LLM</p>
              </div>
              <div>
                <label style={labelStyle}>Sumarizar após N mensagens</label>
                <input
                  type="number" min={10} max={200}
                  style={inputStyle}
                  value={form.summarize_after_msgs}
                  onChange={e => set('summarize_after_msgs', parseInt(e.target.value))}
                />
              </div>
            </div>
          )}

          {/* ── Step 5 ── */}
          {step === 5 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {[
                { key: 'rag_enabled' as const, label: 'RAG — Base de Conhecimento', desc: 'Agente consulta documentos antes de responder' },
                { key: 'followup_enabled' as const, label: 'Follow-up Automático', desc: 'Envia nudge se cliente não responder' },
              ].map(({ key, label, desc }) => (
                <div key={key} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '14px 16px', background: 'rgba(15,23,42,0.6)',
                  border: `1px solid ${form[key] ? 'rgba(96,165,250,0.3)' : 'var(--panel-border)'}`,
                  borderRadius: 12,
                }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-main)', marginBottom: 2 }}>{label}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{desc}</div>
                  </div>
                  <Toggle checked={form[key]} onChange={(v) => set(key, v)} />
                </div>
              ))}

              {form.followup_enabled && (
                <div style={{ padding: 16, background: 'rgba(15,23,42,0.4)', borderRadius: 10, border: '1px solid var(--panel-border)', display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <label style={{ ...labelStyle, margin: 0 }}>Horas sem resposta: {form.followup_hours}h</label>
                    </div>
                    <input
                      type="range" min={1} max={72} step={0.5}
                      value={form.followup_hours}
                      onChange={e => set('followup_hours', parseFloat(e.target.value))}
                      style={{ width: '100%', accentColor: 'var(--primary)' }}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Máx. tentativas</label>
                    <input type="number" min={1} max={5} style={inputStyle} value={form.followup_max_times} onChange={e => set('followup_max_times', parseInt(e.target.value))} />
                  </div>
                  <div>
                    <label style={labelStyle}>Mensagem de follow-up</label>
                    <textarea
                      style={{ ...inputStyle, height: 80, resize: 'vertical' }}
                      value={form.followup_message}
                      onChange={e => set('followup_message', e.target.value)}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Step 6 ── */}
          {step === 6 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div>
                <label style={labelStyle}>Timezone</label>
                <select style={inputStyle} value={form.timezone} onChange={e => set('timezone', e.target.value)}>
                  {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Mensagem fora do horário</label>
                <textarea
                  style={{ ...inputStyle, height: 90, resize: 'vertical' }}
                  value={form.out_of_hours_message}
                  onChange={e => set('out_of_hours_message', e.target.value)}
                />
                <p style={{ fontSize: 11, color: 'var(--text-dim,#64748b)', marginTop: 4 }}>
                  Enviada quando o cliente escreve fora do horário de atendimento. Configure os horários em "Horários" após salvar o agente.
                </p>
              </div>
            </div>
          )}

          {error && (
            <div style={{ marginTop: 16, padding: '10px 14px', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 8, color: 'var(--danger)', fontSize: 13 }}>
              {error}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div style={{
        padding: '16px 24px',
        borderTop: '1px solid var(--panel-border)',
        background: 'var(--panel)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {step > 1 && (
            <button className="ag-btn-ghost" onClick={() => setStep((step - 1) as Step)}>← Anterior</button>
          )}
          {step < 6 && (
            <button className="ag-btn-ghost" onClick={() => setStep((step + 1) as Step)}>Próximo →</button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="ag-btn-ghost" onClick={() => handleSave(false)} disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar Rascunho'}
          </button>
          <button className="ag-btn-primary" onClick={() => handleSave(true)} disabled={saving}>
            <Icons.Sparkles style={{ width: 14, height: 14 }} />
            {saving ? 'Salvando...' : 'Salvar e Testar no Playground'}
          </button>
        </div>
      </div>

      <style>{`
        .ag-btn-primary { background:var(--gradient-primary); color:white; border:none; border-radius:10px; padding:10px 16px; font-weight:600; font-size:13px; cursor:pointer; box-shadow:0 4px 14px rgba(37,99,235,0.3); display:inline-flex; align-items:center; gap:8px; transition:transform 0.15s; }
        .ag-btn-primary:hover { transform:translateY(-1px); }
        .ag-btn-primary:disabled { opacity:0.5; cursor:not-allowed; transform:none; }
        .ag-btn-ghost { background:rgba(15,23,42,0.6); color:var(--text-main); border:1px solid var(--panel-border); border-radius:10px; padding:10px 16px; font-weight:500; font-size:13px; cursor:pointer; display:inline-flex; align-items:center; gap:8px; transition:all 0.15s; }
        .ag-btn-ghost:hover { border-color:var(--primary); background:rgba(59,130,246,0.08); }
        select option { background:#0f172a; color:white; }
      `}</style>
    </div>
  );
}
