import { useState, useRef } from 'react';
import { toast } from 'react-toastify';
import { campaignApi, type CreateCampaignPayload } from '../../services/campaignApi';
import { Icons } from '../icons';
import { api } from '../../services/api';

interface CampaignWizardProps {
  onClose: () => void;
  onCreated: (id: string) => void;
}

interface WizardState {
  // Step 1
  instanceId: string;
  audienceSource: 'csv' | 'manual';
  csvText: string;
  recipients: Array<{ phone: string; name?: string }>;
  // Step 2
  template: string;
  campaignName: string;
  // Step 3
  variants: string[];
  tokenCost: number;
  variantsEdited: boolean[];
  // Step 4
  sendImmediately: boolean;
  scheduledAt: string;
  delayMin: number;
  delayMax: number;
  batchSize: number;
  batchDelayMin: number;
  batchDelayMax: number;
}

const INITIAL_STATE: WizardState = {
  instanceId: '',
  audienceSource: 'csv',
  csvText: '',
  recipients: [],
  template: '',
  campaignName: '',
  variants: [],
  tokenCost: 0,
  variantsEdited: [false, false, false, false, false],
  sendImmediately: true,
  scheduledAt: '',
  delayMin: 10,
  delayMax: 20,
  batchSize: 20,
  batchDelayMin: 60,
  batchDelayMax: 300,
};

const STEPS = ['Audiência', 'Template', 'Variações IA', 'Agendamento', 'Revisão'];

function StepIndicator({ current }: { current: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 32, padding: '0 24px' }}>
      {STEPS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', flex: i < STEPS.length - 1 ? 1 : undefined }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <div style={{
                width: 32, height: 32, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 700, flexShrink: 0,
                ...(done ? { background: 'var(--gradient-success,linear-gradient(135deg,#34d399,#059669))', color: 'white', border: '2px solid var(--success)' }
                  : active ? { background: 'var(--gradient-primary)', color: 'white', border: '2px solid var(--primary)', boxShadow: '0 0 16px rgba(96,165,250,0.5)' }
                  : { background: 'var(--panel)', color: '#64748b', border: '2px solid var(--panel-border)' }),
              }}>
                {done ? <Icons.Check style={{ width: 14, height: 14 }} /> : i + 1}
              </div>
              <span style={{ fontSize: 10, fontWeight: active ? 700 : 500, color: active ? 'var(--primary)' : done ? 'var(--text-muted)' : '#64748b' }}>
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div style={{
                flex: 1, height: 2, margin: '0 8px', marginBottom: 18,
                background: done ? 'var(--success)' : 'var(--panel-border)',
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function Step1({ state, setState, instances }: {
  state: WizardState;
  setState: (s: Partial<WizardState>) => void;
  instances: Array<{ instanceId: string; instanceName?: string }>;
}) {
  const parseCSV = (text: string) => {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    return lines.map(line => {
      const parts = line.split(',');
      return { phone: parts[0]?.trim() ?? '', name: parts[1]?.trim() };
    }).filter(r => r.phone.length >= 8);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <label style={labelStyle}>Instância (chip WhatsApp)</label>
        <select
          style={inputStyle}
          value={state.instanceId}
          onChange={e => setState({ instanceId: e.target.value })}
        >
          <option value="">Selecionar chip...</option>
          {instances.map(inst => (
            <option key={inst.instanceId} value={inst.instanceId}>
              {inst.instanceName || inst.instanceId}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label style={labelStyle}>Fonte da Audiência</label>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['csv', 'manual'] as const).map(src => (
            <button
              key={src}
              type="button"
              className={state.audienceSource === src ? 'btn-primary' : 'btn-ghost'}
              style={{ fontSize: 12, padding: '6px 14px' }}
              onClick={() => setState({ audienceSource: src })}
            >
              {src === 'csv' ? 'Upload CSV' : 'Manual'}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label style={labelStyle}>
          {state.audienceSource === 'csv'
            ? 'Cola os números (CSV: telefone,nome — um por linha)'
            : 'Destinatários (telefone,nome — um por linha)'}
        </label>
        <textarea
          style={{ ...inputStyle, height: 160, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
          placeholder={'+5511999990001,Ana Silva\n+5511999990002,Bruno Costa'}
          value={state.csvText}
          onChange={e => {
            const text = e.target.value;
            setState({ csvText: text, recipients: parseCSV(text) });
          }}
        />
        {state.recipients.length > 0 && (
          <p style={{ fontSize: 11, color: 'var(--success)', margin: '4px 0 0', fontFamily: 'monospace' }}>
            {state.recipients.length} destinatários válidos
          </p>
        )}
      </div>
    </div>
  );
}

function Step2({ state, setState }: { state: WizardState; setState: (s: Partial<WizardState>) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <label style={labelStyle}>Nome da Campanha</label>
        <input
          type="text"
          style={inputStyle}
          placeholder="Ex: Reativação Q2 · Lead frio"
          value={state.campaignName}
          onChange={e => setState({ campaignName: e.target.value })}
        />
      </div>
      <div>
        <label style={labelStyle}>Mensagem Base (template)</label>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 6px' }}>
          Use {'{nome}'}, {'{valor}'} etc. para personalização. A IA vai gerar 5 variações desta mensagem.
        </p>
        <textarea
          style={{ ...inputStyle, height: 160, resize: 'vertical' }}
          placeholder="Oi {nome}, aqui é o Marcos da MOTTIVME. Vi que você participou do nosso onboarding em janeiro. Posso te ligar 15 min essa semana?"
          value={state.template}
          onChange={e => setState({ template: e.target.value })}
          maxLength={1000}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace', marginTop: 4 }}>
          {state.template.length}/1000 chars
        </div>
      </div>
    </div>
  );
}

function Step3({ state, setState, generating, onGenerate }: {
  state: WizardState;
  setState: (s: Partial<WizardState>) => void;
  generating: boolean;
  onGenerate: () => void;
}) {
  const updateVariant = (i: number, value: string) => {
    const newVariants = [...state.variants];
    newVariants[i] = value;
    const newEdited = [...state.variantsEdited];
    newEdited[i] = true;
    setState({ variants: newVariants, variantsEdited: newEdited });
  };

  if (generating) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0' }}>
        <div style={{ width: 48, height: 48, border: '3px solid var(--panel-border)', borderTopColor: 'var(--primary)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
        <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Gerando variações com OpenAI...</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (state.variants.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 0' }}>
        <p style={{ color: 'var(--text-muted)', marginBottom: 16, fontSize: 13 }}>
          Clique em "Gerar Variações" para criar 5 versões da mensagem com IA anti-ban.
        </p>
        <button className="btn-primary" onClick={onGenerate}>
          <Icons.Sparkles style={{ width: 16, height: 16 }} />
          Gerar Variações
        </button>
      </div>
    );
  }

  const pct = Math.round(100 / state.variants.length);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
        <div>
          <h4 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 4px', color: 'var(--text-main)' }}>Variações da mensagem (anti-ban)</h4>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
            Cada destinatário recebe 1 variação aleatória. Você pode editar antes de disparar.
          </p>
        </div>
        {state.tokenCost > 0 && (
          <div style={{ padding: '8px 14px', background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.3)', borderRadius: 10, whiteSpace: 'nowrap' }}>
            <div style={{ fontSize: 11, color: 'var(--success)', fontWeight: 600 }}>{state.variants.length} variações geradas</div>
            <div style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)' }}>custo ~${state.tokenCost.toFixed(4)}</div>
          </div>
        )}
      </div>

      {/* Original */}
      <div style={{ background: 'rgba(59,130,246,0.06)', border: '1px solid var(--panel-border)', borderLeft: '3px solid var(--primary)', borderRadius: 12, padding: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Mensagem original (template)</span>
          <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#64748b' }}>{state.template.length} chars</span>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-main)', margin: 0, lineHeight: 1.6 }}>{state.template}</p>
      </div>

      <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
        <Icons.Sparkles style={{ width: 14, height: 14, color: 'var(--primary)' }} />
        Variações geradas · clique pra editar antes de disparar
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {state.variants.map((v, i) => {
          const edited = state.variantsEdited[i];
          return (
            <div
              key={i}
              style={{
                background: 'rgba(15,23,42,0.7)',
                border: `1px solid ${edited ? 'var(--warning)' : 'var(--panel-border)'}`,
                borderLeft: `3px solid ${edited ? 'var(--warning)' : 'var(--panel-border)'}`,
                borderRadius: 12,
                padding: 14,
                gridColumn: i === 4 ? '1 / -1' : undefined,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: edited ? 'var(--warning)' : 'var(--text-muted)' }}>
                  {edited ? '✎ ' : ''}Variação {i + 1} · {pct}% destinatários
                </span>
                <button
                  className="btn-ghost"
                  style={{ padding: '3px 8px', fontSize: 10 }}
                  onClick={() => {
                    const newVariants = [...state.variants];
                    const newEdited = [...state.variantsEdited];
                    newVariants[i] = '';
                    newEdited[i] = false;
                    setState({ variants: newVariants, variantsEdited: newEdited });
                    onGenerate();
                  }}
                >
                  <Icons.Refresh style={{ width: 10, height: 10 }} />
                  Regerar
                </button>
              </div>
              <textarea
                style={{ ...inputStyle, fontSize: 12, height: 90, resize: 'vertical', background: 'transparent', border: 'none', padding: 0, lineHeight: 1.55 }}
                value={v}
                onChange={e => updateVariant(i, e.target.value)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Step4({ state, setState }: { state: WizardState; setState: (s: Partial<WizardState>) => void }) {
  const totalSecs = state.recipients.length * ((state.delayMin + state.delayMax) / 2);
  const etaMin = Math.round(totalSecs / 60);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <label style={labelStyle}>Quando disparar?</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className={state.sendImmediately ? 'btn-primary' : 'btn-ghost'}
            style={{ fontSize: 12, padding: '8px 16px' }}
            onClick={() => setState({ sendImmediately: true })}
          >
            Disparar agora
          </button>
          <button
            type="button"
            className={!state.sendImmediately ? 'btn-primary' : 'btn-ghost'}
            style={{ fontSize: 12, padding: '8px 16px' }}
            onClick={() => setState({ sendImmediately: false })}
          >
            Agendar
          </button>
        </div>
      </div>

      {!state.sendImmediately && (
        <div>
          <label style={labelStyle}>Data e hora do disparo</label>
          <input
            type="datetime-local"
            style={inputStyle}
            value={state.scheduledAt}
            onChange={e => setState({ scheduledAt: e.target.value })}
          />
        </div>
      )}

      <div>
        <label style={labelStyle}>Delay entre mensagens: {state.delayMin}s – {state.delayMax}s</label>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', minWidth: 30 }}>5s</span>
          <input type="range" min={5} max={30} value={state.delayMin}
            onChange={e => setState({ delayMin: Number(e.target.value) })}
            style={{ flex: 1 }} />
          <input type="range" min={5} max={30} value={state.delayMax}
            onChange={e => setState({ delayMax: Number(e.target.value) })}
            style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: 'var(--text-muted)', minWidth: 30 }}>30s</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <label style={labelStyle}>Tamanho do lote</label>
          <input type="number" style={inputStyle} min={5} max={100} value={state.batchSize}
            onChange={e => setState({ batchSize: Number(e.target.value) })} />
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 0' }}>Msgs antes de pausa longa</p>
        </div>
        <div>
          <label style={labelStyle}>Pausa entre lotes: {Math.round(state.batchDelayMin / 60)}–{Math.round(state.batchDelayMax / 60)} min</label>
          <input type="range" min={60} max={600} step={30} value={state.batchDelayMin}
            onChange={e => setState({ batchDelayMin: Number(e.target.value) })}
            style={{ width: '100%' }} />
        </div>
      </div>

      {state.recipients.length > 0 && (
        <div style={{ padding: '12px 16px', background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.2)', borderRadius: 10, fontSize: 12 }}>
          Estimativa: ~{state.recipients.length} mensagens em ~{etaMin} minutos
        </div>
      )}
    </div>
  );
}

function Step5({ state, onFire, onSchedule, firing }: {
  state: WizardState;
  onFire: () => void;
  onSchedule: () => void;
  firing: boolean;
}) {
  const [confirmed, setConfirmed] = useState(false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <h4 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--text-main)' }}>Resumo da Campanha</h4>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {[
          { label: 'Nome', value: state.campaignName || '—' },
          { label: 'Chip', value: state.instanceId || '—' },
          { label: 'Destinatários', value: String(state.recipients.length) },
          { label: 'Variações', value: String(state.variants.length) },
          { label: 'Disparo', value: state.sendImmediately ? 'Imediato' : (state.scheduledAt ? new Date(state.scheduledAt).toLocaleString('pt-BR') : '—') },
          { label: 'Delay', value: `${state.delayMin}–${state.delayMax}s` },
        ].map(({ label, value }) => (
          <div key={label} style={{ padding: '12px 14px', background: 'rgba(15,23,42,0.6)', border: '1px solid var(--panel-border)', borderRadius: 10 }}>
            <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 13, fontWeight: 600, fontFamily: 'monospace', color: 'var(--text-main)' }}>{value}</div>
          </div>
        ))}
      </div>

      {state.variants.length > 0 && (
        <div style={{ padding: 14, background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.2)', borderRadius: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--primary)', marginBottom: 6, fontWeight: 700 }}>Prévia (variação 1)</div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>{state.variants[0]}</p>
        </div>
      )}

      <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13 }}>
        <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
        Confirmo que tenho permissão para enviar mensagens para estes contatos.
      </label>

      <div style={{ display: 'flex', gap: 10 }}>
        <button
          className="btn-primary"
          disabled={!confirmed || firing}
          onClick={state.sendImmediately ? onFire : onSchedule}
          style={{ flex: 1, justifyContent: 'center' }}
        >
          {firing ? 'Disparando...' : state.sendImmediately ? 'Disparar Campanha' : 'Agendar Campanha'}
        </button>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: 'rgba(15,23,42,0.6)',
  border: '1px solid var(--panel-border)',
  color: 'var(--text-main)',
  borderRadius: 10,
  padding: '10px 14px',
  width: '100%',
  fontSize: 13,
  fontFamily: 'inherit',
  outline: 'none',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: 6,
  fontWeight: 600,
  fontSize: 13,
  color: 'var(--text-main)',
};

export function CampaignWizard({ onClose, onCreated }: CampaignWizardProps) {
  const [step, setStep] = useState(0);
  const [state, setStateRaw] = useState<WizardState>(INITIAL_STATE);
  const [instances, setInstances] = useState<Array<{ instanceId: string; instanceName?: string }>>([]);
  const [generating, setGenerating] = useState(false);
  const [firing, setFiring] = useState(false);

  const setState = (partial: Partial<WizardState>) => {
    setStateRaw(prev => ({ ...prev, ...partial }));
  };

  const generatedRef = useRef(false);

  // Load instances on mount
  useState(() => {
    api.getInstances().then(res => {
      if (res.success) setInstances(res.instances as any);
    }).catch(console.error);
  });

  const handleGenerate = async () => {
    if (!state.template.trim()) {
      toast.error('Escreva a mensagem base antes de gerar variações.');
      return;
    }
    setGenerating(true);
    generatedRef.current = true;
    try {
      const res = await campaignApi.generateVariants(state.template);
      setState({ variants: res.variants, tokenCost: res.token_cost, variantsEdited: new Array(res.variants.length).fill(false) });
    } catch (err: any) {
      toast.error(err.message || 'Erro ao gerar variações. Verifique sua chave OpenAI em Configurações.');
    } finally {
      setGenerating(false);
    }
  };

  const canAdvance = () => {
    if (step === 0) return state.instanceId && state.recipients.length > 0;
    if (step === 1) return state.campaignName.trim() && state.template.trim().length >= 10;
    if (step === 2) return state.variants.length >= 2;
    if (step === 3) return state.sendImmediately || state.scheduledAt;
    return true;
  };

  const handleNext = async () => {
    if (step === 1 && step + 1 === 2 && state.variants.length === 0) {
      setStep(2);
      await handleGenerate();
      return;
    }
    setStep(s => Math.min(s + 1, 4));
  };

  const handleLaunch = async (sendNow: boolean) => {
    setFiring(true);
    try {
      const payload: CreateCampaignPayload = {
        name: state.campaignName,
        instance_id: state.instanceId,
        base_message: state.template,
        variants: state.variants,
        audience_source: state.audienceSource,
        recipients: state.recipients,
        send_immediately: sendNow,
        scheduled_at: sendNow ? undefined : state.scheduledAt,
        delay_min_seconds: state.delayMin,
        delay_max_seconds: state.delayMax,
        batch_size: state.batchSize,
        batch_delay_min_seconds: state.batchDelayMin,
        batch_delay_max_seconds: state.batchDelayMax,
      };

      const res = await campaignApi.createCampaign(payload);
      const id = res.campaign.id;

      if (sendNow) {
        await campaignApi.startCampaign(id);
      }

      toast.success('Campanha criada com sucesso!');
      onCreated(id);
    } catch (err: any) {
      toast.error(err.message || 'Erro ao criar campanha.');
    } finally {
      setFiring(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}>
      <div style={{
        background: 'var(--panel)',
        border: '1px solid var(--panel-border)',
        borderRadius: 20,
        boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
        width: '100%',
        maxWidth: 780,
        maxHeight: '90vh',
        overflow: 'auto',
        padding: 32,
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: 'var(--text-main)', background: 'var(--gradient-primary)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Nova Campanha
          </h2>
          <button className="btn-ghost" style={{ padding: '6px 10px' }} onClick={onClose}>
            ✕
          </button>
        </div>

        <StepIndicator current={step} />

        {/* Steps */}
        <div style={{ minHeight: 300 }}>
          {step === 0 && <Step1 state={state} setState={setState} instances={instances} />}
          {step === 1 && <Step2 state={state} setState={setState} />}
          {step === 2 && (
            <Step3
              state={state}
              setState={setState}
              generating={generating}
              onGenerate={handleGenerate}
            />
          )}
          {step === 3 && <Step4 state={state} setState={setState} />}
          {step === 4 && (
            <Step5
              state={state}
              onFire={() => handleLaunch(true)}
              onSchedule={() => handleLaunch(false)}
              firing={firing}
            />
          )}
        </div>

        {/* Footer */}
        <div style={{
          marginTop: 28,
          paddingTop: 20,
          borderTop: '1px solid var(--panel-border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <button className="btn-ghost" onClick={() => step === 0 ? onClose() : setStep(s => s - 1)}>
            ← {step === 0 ? 'Cancelar' : 'Voltar'}
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Step {step + 1} de {STEPS.length}</span>
            {step < 4 && (
              <button
                className="btn-primary"
                disabled={!canAdvance()}
                onClick={handleNext}
              >
                Continuar →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
