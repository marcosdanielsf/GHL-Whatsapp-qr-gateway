import { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-toastify';
import { campaignApi } from '../../services/campaignApi';
import { Icons } from '../icons';

type Provider = 'openai' | 'anthropic' | 'google' | 'groq';

interface ProviderConfig {
  id: Provider;
  label: string;
  placeholder: string;
  docsUrl: string;
  defaultModel: string;
  models: Array<{ value: string; label: string }>;
}

const PROVIDERS: ProviderConfig[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    placeholder: 'sk-proj-••••••••••••••••••••••••',
    docsUrl: 'https://platform.openai.com/api-keys',
    defaultModel: 'gpt-4o-mini',
    models: [
      { value: 'gpt-4o-mini', label: 'GPT-4o Mini (recomendado)' },
      { value: 'gpt-4o', label: 'GPT-4o' },
      { value: 'gpt-4.1', label: 'GPT-4.1' },
      { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
    ],
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    placeholder: 'sk-ant-api03-••••••••••••••••••••••',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    defaultModel: 'claude-haiku-4-5-20251001',
    models: [
      { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (rápido)' },
      { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
      { value: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
    ],
  },
  {
    id: 'google',
    label: 'Google AI',
    placeholder: 'AIza••••••••••••••••••••••••••••',
    docsUrl: 'https://aistudio.google.com/app/apikey',
    defaultModel: 'gemini-2.5-flash',
    models: [
      { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (recomendado)' },
      { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
      { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
    ],
  },
  {
    id: 'groq',
    label: 'Groq',
    placeholder: 'gsk_••••••••••••••••••••••••••••',
    docsUrl: 'https://console.groq.com/keys',
    defaultModel: 'llama-3.1-70b-versatile',
    models: [
      { value: 'llama-3.1-70b-versatile', label: 'Llama 3.1 70B Versatile' },
      { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant' },
      { value: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B' },
    ],
  },
];

interface ProviderState {
  hasKey: boolean;
  currentModel: string | null;
  apiKey: string;
  selectedModel: string;
  showKey: boolean;
  saving: boolean;
}

function initialState(provider: ProviderConfig): ProviderState {
  return {
    hasKey: false,
    currentModel: null,
    apiKey: '',
    selectedModel: provider.defaultModel,
    showKey: false,
    saving: false,
  };
}

export function AIKeyForm() {
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Provider>('openai');
  const [states, setStates] = useState<Record<Provider, ProviderState>>(() => ({
    openai: initialState(PROVIDERS[0]),
    anthropic: initialState(PROVIDERS[1]),
    google: initialState(PROVIDERS[2]),
    groq: initialState(PROVIDERS[3]),
  }));

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const res = await campaignApi.listAIKeys();
      setStates((prev) => {
        const next = { ...prev };
        for (const cfg of PROVIDERS) {
          const row = res.keys.find((k) => k.provider === cfg.id);
          next[cfg.id] = {
            ...next[cfg.id],
            hasKey: !!row?.has_key,
            currentModel: row?.model ?? null,
            selectedModel: row?.model ?? cfg.defaultModel,
          };
        }
        return next;
      });
    } catch {
      // silently ignore — endpoint pode não estar pronto
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const updateState = (provider: Provider, patch: Partial<ProviderState>) => {
    setStates((prev) => ({ ...prev, [provider]: { ...prev[provider], ...patch } }));
  };

  const handleSave = async (cfg: ProviderConfig, e: React.FormEvent) => {
    e.preventDefault();
    const state = states[cfg.id];
    if (!state.apiKey.trim()) {
      toast.error('Insira a API key.');
      return;
    }
    updateState(cfg.id, { saving: true });
    try {
      await campaignApi.saveAIKey(cfg.id, state.apiKey, state.selectedModel);
      updateState(cfg.id, {
        hasKey: true,
        currentModel: state.selectedModel,
        apiKey: '',
        saving: false,
      });
      toast.success(`Chave ${cfg.label} salva com sucesso!`);
    } catch (err: any) {
      updateState(cfg.id, { saving: false });
      toast.error(err.message || `Erro ao salvar chave ${cfg.label}.`);
    }
  };

  const handleDelete = async (cfg: ProviderConfig) => {
    if (!window.confirm(`Remover a chave ${cfg.label}? Recursos que usam esse provider deixarão de funcionar.`)) return;
    try {
      await campaignApi.deleteAIKey(cfg.id);
      updateState(cfg.id, { hasKey: false, currentModel: null });
      toast.success(`Chave ${cfg.label} removida.`);
    } catch (err: any) {
      toast.error(err.message || 'Erro ao remover.');
    }
  };

  if (loading) return null;

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

  const tabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: '10px 12px',
    background: active ? 'rgba(0, 168, 132, 0.18)' : 'transparent',
    border: 'none',
    borderBottom: active ? '2px solid #00a884' : '2px solid transparent',
    color: active ? 'var(--text-main)' : 'var(--text-muted)',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 120ms ease',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  });

  return (
    <div style={{ marginTop: '2rem', padding: '1.5rem', background: 'rgba(15,23,42,0.4)', border: '1px solid var(--panel-border)', borderRadius: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <Icons.Sparkles style={{ width: 18, height: 18, color: 'var(--primary)' }} />
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text-main)' }}>Chaves de IA (BYO)</h3>
      </div>

      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 16px' }}>
        Configure 1 ou mais providers. Cada agente IA escolhe o provider preferido na tela do agente. As chaves são criptografadas no banco com pgp_sym_encrypt.
      </p>

      <div style={{ display: 'flex', borderBottom: '1px solid var(--panel-border)', marginBottom: 16 }}>
        {PROVIDERS.map((cfg) => {
          const s = states[cfg.id];
          return (
            <button
              key={cfg.id}
              type="button"
              style={tabStyle(activeTab === cfg.id)}
              onClick={() => setActiveTab(cfg.id)}
            >
              <span>{cfg.label}</span>
              {s.hasKey && (
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: 'var(--success, #00a884)',
                  }}
                  title="Chave configurada"
                />
              )}
            </button>
          );
        })}
      </div>

      {PROVIDERS.map((cfg) => {
        if (cfg.id !== activeTab) return null;
        const state = states[cfg.id];
        return (
          <div key={cfg.id}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              {state.hasKey ? (
                <span style={{ fontSize: 11, color: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Icons.Check style={{ width: 12, height: 12 }} />
                  Chave configurada · {state.currentModel}
                </span>
              ) : (
                <span style={{ fontSize: 11, color: 'var(--warning)' }}>
                  Sem chave configurada
                </span>
              )}
              <a
                href={cfg.docsUrl}
                target="_blank"
                rel="noreferrer"
                style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--primary)' }}
              >
                Como criar key {cfg.label} →
              </a>
            </div>

            <form onSubmit={(e) => handleSave(cfg, e)} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ position: 'relative' }}>
                <input
                  type={state.showKey ? 'text' : 'password'}
                  style={{ ...inputStyle, paddingRight: 44 }}
                  placeholder={cfg.placeholder}
                  value={state.apiKey}
                  onChange={(e) => updateState(cfg.id, { apiKey: e.target.value })}
                />
                <button
                  type="button"
                  onClick={() => updateState(cfg.id, { showKey: !state.showKey })}
                  style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 2 }}
                >
                  {state.showKey ? '👁' : '🙈'}
                </button>
              </div>

              <select
                style={inputStyle}
                value={state.selectedModel}
                onChange={(e) => updateState(cfg.id, { selectedModel: e.target.value })}
              >
                {cfg.models.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={state.saving}
                  style={{ fontSize: 13 }}
                >
                  <Icons.Save style={{ width: 14, height: 14 }} />
                  {state.saving ? 'Salvando...' : `Salvar ${cfg.label}`}
                </button>
                {state.hasKey && (
                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ fontSize: 13, color: 'var(--danger)', borderColor: 'rgba(248,113,113,0.3)' }}
                    onClick={() => handleDelete(cfg)}
                  >
                    <Icons.Trash style={{ width: 14, height: 14 }} />
                    Remover
                  </button>
                )}
              </div>
            </form>
          </div>
        );
      })}
    </div>
  );
}
