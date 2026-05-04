import { useState, useEffect, useCallback } from 'react';
import { agentApi, type BusinessHourRow } from '../../services/agentApi';

interface AgentBusinessHoursProps {
  agentId: string;
}

const DAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const DEFAULT_HOURS: BusinessHourRow[] = [
  { day_of_week: 0, is_closed: true,  open_time: null,    close_time: null },
  { day_of_week: 1, is_closed: false, open_time: '08:00', close_time: '18:00' },
  { day_of_week: 2, is_closed: false, open_time: '08:00', close_time: '18:00' },
  { day_of_week: 3, is_closed: false, open_time: '08:00', close_time: '18:00' },
  { day_of_week: 4, is_closed: false, open_time: '08:00', close_time: '18:00' },
  { day_of_week: 5, is_closed: false, open_time: '08:00', close_time: '18:00' },
  { day_of_week: 6, is_closed: true,  open_time: null,    close_time: null },
];

const inputStyle: React.CSSProperties = {
  background: 'rgba(15,23,42,0.8)',
  border: '1px solid var(--panel-border)',
  borderRadius: 8,
  padding: '7px 10px',
  color: 'var(--text-main)',
  fontSize: 13,
  outline: 'none',
};

export function AgentBusinessHours({ agentId }: AgentBusinessHoursProps) {
  const [hours, setHours] = useState<BusinessHourRow[]>(DEFAULT_HOURS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const fetchHours = useCallback(async () => {
    try {
      const res = await agentApi.getBusinessHours(agentId);
      if (res.hours && res.hours.length === 7) {
        // sort by day_of_week
        setHours([...res.hours].sort((a, b) => a.day_of_week - b.day_of_week));
      } else {
        setHours(DEFAULT_HOURS);
      }
    } catch {
      setHours(DEFAULT_HOURS);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    fetchHours();
  }, [fetchHours]);

  const updateDay = (dayIdx: number, patch: Partial<BusinessHourRow>) => {
    setHours(prev => prev.map(h =>
      h.day_of_week === dayIdx ? { ...h, ...patch } : h
    ));
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await agentApi.updateBusinessHours(agentId, hours);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch { /* silent */ }
    finally { setSaving(false); }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)' }}>Carregando horários...</div>;
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
          Configure os horários em que o agente responde. Fora deste período, a mensagem de "fora do horário" é enviada automaticamente.
        </div>

        {/* Grid */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {hours.map(h => (
            <div key={h.day_of_week} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 14px',
              background: h.is_closed ? 'rgba(15,23,42,0.3)' : 'rgba(15,23,42,0.6)',
              border: `1px solid ${h.is_closed ? 'var(--panel-border)' : 'rgba(96,165,250,0.2)'}`,
              borderRadius: 10,
              opacity: h.is_closed ? 0.6 : 1,
            }}>
              {/* Day name */}
              <div style={{ width: 36, fontWeight: 700, fontSize: 13, color: 'var(--text-main)' }}>
                {DAY_LABELS[h.day_of_week]}
              </div>

              {/* Toggle closed/open */}
              <button
                type="button"
                onClick={() => updateDay(h.day_of_week, {
                  is_closed: !h.is_closed,
                  open_time: h.is_closed ? '08:00' : null,
                  close_time: h.is_closed ? '18:00' : null,
                })}
                style={{
                  width: 40, height: 22, borderRadius: 999,
                  background: h.is_closed ? 'rgba(148,163,184,0.2)' : 'var(--gradient-primary)',
                  border: 'none', cursor: 'pointer', padding: 0, position: 'relative',
                  transition: 'background 0.2s', flexShrink: 0,
                }}
              >
                <span style={{
                  position: 'absolute', top: 3,
                  left: h.is_closed ? 3 : 19,
                  width: 16, height: 16, borderRadius: '50%', background: 'white',
                  transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                }} />
              </button>

              {/* Status label */}
              <span style={{ fontSize: 11, width: 48, color: h.is_closed ? 'var(--text-muted)' : 'var(--success)', fontWeight: 500 }}>
                {h.is_closed ? 'Fechado' : 'Aberto'}
              </span>

              {/* Time pickers */}
              {!h.is_closed && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="time"
                    style={inputStyle}
                    value={h.open_time ?? ''}
                    onChange={e => updateDay(h.day_of_week, { open_time: e.target.value })}
                  />
                  <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>até</span>
                  <input
                    type="time"
                    style={inputStyle}
                    value={h.close_time ?? ''}
                    onChange={e => updateDay(h.day_of_week, { close_time: e.target.value })}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Save */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          className="ag-btn-primary"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Salvando...' : 'Salvar Horários'}
        </button>
        {saved && (
          <span style={{ fontSize: 12, color: 'var(--success)', fontWeight: 600 }}>
            Horários salvos!
          </span>
        )}
      </div>

      <style>{`
        .ag-btn-primary { background:var(--gradient-primary); color:white; border:none; border-radius:10px; padding:10px 16px; font-weight:600; font-size:13px; cursor:pointer; box-shadow:0 4px 14px rgba(37,99,235,0.3); display:inline-flex; align-items:center; gap:8px; transition:transform 0.15s; }
        .ag-btn-primary:hover { transform:translateY(-1px); }
        .ag-btn-primary:disabled { opacity:0.5; cursor:not-allowed; transform:none; }
        input[type="time"]::-webkit-calendar-picker-indicator { filter: invert(0.7); }
      `}</style>
    </div>
  );
}
