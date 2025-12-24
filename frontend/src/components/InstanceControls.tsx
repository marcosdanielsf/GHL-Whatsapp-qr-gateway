import { useEffect, useState } from 'react';
import type { ConnectionStatus } from '../types/gateway';
import { Icons } from './icons';
import { useLanguage } from '../context/LanguageContext';
import { api } from '../services/api';
import { toast } from 'react-toastify';

interface InstanceControlsProps {
  instanceId: string;
  status: ConnectionStatus | 'sin_datos';
  isProcessing: boolean;
  instances: any[];
  onInstanceChange: (value: string) => void;
  onGenerateQr: () => void;
}

export function InstanceControls({
  isProcessing,
  instances,
  onInstanceChange,
  onGenerateQr,
}: InstanceControlsProps) {
  const { t } = useLanguage();
  const [instanceName, setInstanceName] = useState('');
  const [planLimit, setPlanLimit] = useState<number>(1);
  const [currentUsage, setCurrentUsage] = useState<number>(0);
  const [availableIds, setAvailableIds] = useState<string[]>([]);

  // Cargar instancias disponibles al montar el componente y cuando cambien las instancias
  useEffect(() => {
    const fetchPlanUsage = async () => {
      try {
        const response = await api.getAvailableInstances();
        if (response.success) {
          // En la respuesta del backend:
          // total = max_instances permitidas por el plan
          // used = instancias actuales
          setPlanLimit(response.total || 1);
          setCurrentUsage(response.used || 0);
          setAvailableIds(response.available || []);
        }
      } catch (error) {
        console.error('Error fetching plan usage:', error);
      }
    };

    fetchPlanUsage();
  }, [instances]);

  const handleCreate = async () => {
    if (!instanceName) {
      toast.error(t('selectInstanceError'));
      return;
    }

    const newId = instanceName;
    onInstanceChange(newId);
    
    // Pequeño delay para que el estado se actualice antes de llamar a generar QR
    setTimeout(() => {
      onGenerateQr();
    }, 100);
  };

  const isLimitReached = currentUsage >= planLimit;
  const usagePercentage = Math.min((currentUsage / planLimit) * 100, 100);

  return (
    <div className="controls-container">
      {/* Plan Usage Indicator */}
      <div className="plan-usage-card" style={{ 
        marginBottom: '1.5rem', 
        padding: '1rem', 
        background: 'var(--bg-secondary)', 
        borderRadius: '0.5rem',
        border: '1px solid var(--border-color)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', alignItems: 'center' }}>
          <span style={{ fontSize: '0.875rem', fontWeight: '500', color: 'var(--text-secondary)' }}>
            {t('instancesLimit')}
          </span>
          <span style={{ fontSize: '0.875rem', fontWeight: '600' }}>
            {currentUsage} / {planLimit}
          </span>
        </div>
        <div className="progress-bar" style={{ 
          height: '6px', 
          width: '100%', 
          background: 'var(--border-color)', 
          borderRadius: '3px',
          overflow: 'hidden'
        }}>
          <div style={{ 
            height: '100%', 
            width: `${usagePercentage}%`, 
            background: isLimitReached ? 'var(--danger)' : 'var(--primary)',
            transition: 'width 0.3s ease'
          }} />
        </div>
        {isLimitReached && (
          <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <Icons.Info className="icon-xs" />
            {t('limitReached')}
          </div>
        )}
      </div>

      <div className="control-fields">
        <div className="control-field-group">
          <label className="field-label">
            <Icons.Plus className="label-icon" />
            <div className="label-content">
              <span className="label-title">{t('createInstance')}</span>
              <span className="label-subtitle">{t('instanceNameSubtitle')}</span>
            </div>
          </label>
          <div className="input-with-icon">
            <Icons.Users className="input-icon" />
            <select
              value={instanceName}
              onChange={(e) => setInstanceName(e.target.value)}
              className="instance-input"
              disabled={isLimitReached || isProcessing}
            >
              <option value="">{t('selectInstancePlaceholder')}</option>
              {availableIds.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="actions-grid">
        <button
          className="action-btn primary"
          onClick={handleCreate}
          disabled={isProcessing || isLimitReached || !instanceName.trim()}
          title={isLimitReached ? t('limitReached') : ''}
        >
          <Icons.QrCode className="btn-icon" />
          <span>{t('generateQr')}</span>
          {isProcessing && <div className="btn-loading"></div>}
        </button>
      </div>
    </div>
  );
}
