import { useEffect, useState } from 'react';
import type { ConnectionStatus } from '../types/gateway';
import { Icons } from './icons';

interface InstanceControlsProps {
  instanceId: string;
  status: ConnectionStatus | 'sin_datos';
  isProcessing: boolean;
  instances: any[];
  onInstanceChange: (value: string) => void;
  onGenerateQr: () => void;
}

export function InstanceControls({
  instanceId,
  status,
  isProcessing,
  instances,
  onInstanceChange,
  onGenerateQr,
}: InstanceControlsProps) {
  const [availableInstances, setAvailableInstances] = useState<string[]>([]);
  const [isLoadingAvailable, setIsLoadingAvailable] = useState(false);
  
  // Cargar instancias disponibles al montar el componente y cuando cambien las instancias
  useEffect(() => {
    loadAvailableInstances();
  }, [instances]);
  
  const loadAvailableInstances = async () => {
    setIsLoadingAvailable(true);
    try {
      const response = await fetch('/api/wa/instances/available');
      const data = await response.json();
      
      if (data.success && data.available) {
        setAvailableInstances(data.available);
        
        // Si hay instancias disponibles y el campo está vacío, seleccionar la primera
        if (data.available.length > 0 && !instanceId) {
          onInstanceChange(data.available[0]);
        }
      }
    } catch (error) {
      console.error('Error cargando instancias disponibles:', error);
    } finally {
      setIsLoadingAvailable(false);
    }
  };
  
  const getStatusIcon = (status: ConnectionStatus | 'sin_datos') => {
    switch (status) {
      case 'ONLINE': 
        return <Icons.Connected className="status-icon connected" />;
      case 'RECONNECTING': 
        return <Icons.Connecting className="status-icon connecting" />;
      case 'OFFLINE':
      case 'sin_datos':
        return <Icons.Disconnected className="status-icon disconnected" />;
      default: 
        return <Icons.Info className="status-icon" />;
    }
  };

  return (
    <div className="controls-container">
      <div className="control-fields">
        <div className="control-field-group">
          <label className="field-label">
            <Icons.Users className="label-icon" />
            <div className="label-content">
              <span className="label-title">ID de Instancia</span>
              <span className="label-subtitle">Selecciona una instancia disponible (máximo 3)</span>
            </div>
          </label>
          <div className="input-with-icon">
            <Icons.Users className="input-icon" />
            {isLoadingAvailable ? (
              <select className="instance-input" disabled>
                <option>Cargando...</option>
              </select>
            ) : availableInstances.length > 0 ? (
              <select
                value={instanceId}
                onChange={(e) => onInstanceChange(e.target.value)}
                className="instance-input"
              >
                <option value="">Seleccionar instancia...</option>
                {availableInstances.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            ) : (
              <select className="instance-input" disabled>
                <option>No hay instancias disponibles (máximo 3 alcanzado)</option>
              </select>
            )}
          </div>
        </div>
        
        <div className="control-field-group">
          <label className="field-label">
            <Icons.Info className="label-icon" />
            <div className="label-content">
              <span className="label-title">Estado de Conexión</span>
              <span className="label-subtitle">Estado actual de la instancia WhatsApp</span>
            </div>
          </label>
          <div className="status-display">
            {getStatusIcon(status)}
            <span className={`status-text status-${status}`}>
              {status === 'sin_datos' ? 'Sin datos' : status}
            </span>
          </div>
        </div>
      </div>

      <div className="actions-grid">
        <button 
          className="action-btn primary" 
          onClick={onGenerateQr} 
          disabled={isProcessing}
        >
          <Icons.QrCode className="btn-icon" />
          <span>Generar QR</span>
          {isProcessing && <div className="btn-loading"></div>}
        </button>
      </div>
    </div>
  );
}