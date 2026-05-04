import { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-toastify';
import { campaignApi } from '../../services/campaignApi';
import { Icons } from '../icons';

const MODELS = [
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini (recomendado)' },
  { value: 'gpt-4o', label: 'GPT-4o' },
  { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
];

export function AIKeyForm() {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [currentModel, setCurrentModel] = useState('gpt-4o-mini');
  const [apiKey, setApiKey] = useState('');
  const [selectedModel, setSelectedModel] = useState('gpt-4o-mini');
  const [showKey, setShowKey] = useState(false);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await campaignApi.getAIKeyStatus();
      setHasKey(res.has_key);
      if (res.model) setCurrentModel(res.model);
    } catch {
      // endpoint may not exist yet — silently ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim()) {
      toast.error('Insira a API key.');
      return;
    }
    setSaving(true);
    try {
      await campaignApi.saveAIKey(apiKey, selectedModel);
      setHasKey(true);
      setCurrentModel(selectedModel);
      setApiKey('');
      toast.success('Chave OpenAI salva com sucesso!');
    } catch (err: any) {
      toast.error(err.message || 'Erro ao salvar a chave.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Remover a chave OpenAI? Campanhas com variação IA deixarão de funcionar.')) return;
    try {
      await campaignApi.deleteAIKey();
      setHasKey(false);
      toast.success('Chave removida.');
    } catch (err: any) {
      toast.error(err.message || 'Erro ao remover.');
    }
  };

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

  if (loading) return null;

  return (
    <div style={{ marginTop: '2rem', padding: '1.5rem', background: 'rgba(15,23,42,0.4)', border: '1px solid var(--panel-border)', borderRadius: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <Icons.Sparkles style={{ width: 18, height: 18, color: 'var(--primary)' }} />
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text-main)' }}>Chave OpenAI (BYO)</h3>
        <span style={{ marginLeft: 'auto' }}>
          {hasKey ? (
            <span style={{ fontSize: 11, color: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Icons.Check style={{ width: 12, height: 12 }} />
              Chave configurada · {currentModel}
            </span>
          ) : (
            <span style={{ fontSize: 11, color: 'var(--warning)' }}>
              Sem chave configurada (BYO)
            </span>
          )}
        </span>
      </div>

      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 16px' }}>
        A chave é usada apenas para gerar variações de mensagem no wizard de campanhas.
        Seu custo estimado é {'<'}$0,01 por campanha.{' '}
        <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" style={{ color: 'var(--primary)' }}>
          Como criar key OpenAI →
        </a>
      </p>

      <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ position: 'relative' }}>
          <input
            type={showKey ? 'text' : 'password'}
            style={{ ...inputStyle, paddingRight: 44 }}
            placeholder="sk-proj-••••••••••••••••••••••••"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
          />
          <button
            type="button"
            onClick={() => setShowKey(p => !p)}
            style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 2 }}
          >
            {showKey ? '👁' : '🙈'}
          </button>
        </div>

        <select
          style={inputStyle}
          value={selectedModel}
          onChange={e => setSelectedModel(e.target.value)}
        >
          {MODELS.map(m => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="submit"
            className="btn-primary"
            disabled={saving}
            style={{ fontSize: 13 }}
          >
            <Icons.Save style={{ width: 14, height: 14 }} />
            {saving ? 'Salvando...' : 'Salvar Chave'}
          </button>
          {hasKey && (
            <button
              type="button"
              className="btn-ghost"
              style={{ fontSize: 13, color: 'var(--danger)', borderColor: 'rgba(248,113,113,0.3)' }}
              onClick={handleDelete}
            >
              <Icons.Trash style={{ width: 14, height: 14 }} />
              Remover
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
