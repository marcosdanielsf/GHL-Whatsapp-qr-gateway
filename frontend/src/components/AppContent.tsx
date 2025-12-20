import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import '../styles/app.css';
import { InstanceControls } from './InstanceControls';
import { QrPreview } from './QrPreview';
import { InstanceList } from './InstanceList';
import { WebhooksView } from './WebhooksView';
import { SettingsView } from './SettingsView';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { WhatsAppRain } from './WhatsAppRain';
import { Icons } from './icons';
import { api } from '../services/api';
import { useLanguage } from '../context/LanguageContext';
import type {
  ConnectionStatus,
  InstanceSummary,
  QRResponse,
  QueueStats,
} from '../types/gateway';

type View = 'control' | 'instances' | 'webhooks' | 'settings';

export function AppContent() {
  const { t } = useLanguage();
  const [instanceId, setInstanceId] = useState('wa-01');
  const [status, setStatus] = useState<ConnectionStatus | 'sin_datos'>('sin_datos');
  const [qrData, setQrData] = useState<QRResponse | null>(null);
  const [instances, setInstances] = useState<InstanceSummary[]>([]);
  const [queueStats, setQueueStats] = useState<QueueStats | null>(null);
  const [queueStatsUpdatedAt, setQueueStatsUpdatedAt] = useState<number | null>(null);
  const [loadingQr, setLoadingQr] = useState(false);
  const [loadingInstances, setLoadingInstances] = useState(false);
  const [view, setView] = useState<View>('control');
  const [isDark, setIsDark] = useState(() => {
    return localStorage.getItem('theme') === 'dark';
  });
  const lastStatusRef = useRef<ConnectionStatus | 'sin_datos'>(status);

  const apiHelpers = useMemo(() => api, []);

  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    if (type === 'success') {
      toast.success(message);
    } else {
      toast.error(message);
    }
  }, []);

  const fetchInstances = useCallback(async () => {
    setLoadingInstances(true);
    try {
      const data = await apiHelpers.listInstances();
      setInstances(data.instances);
      setQueueStats(data.queueStats);
      setQueueStatsUpdatedAt(data.queueStats ? Date.now() : null);
    } catch (error: any) {
      showToast('error', error.message || t('loadInstancesError'));
    } finally {
      setLoadingInstances(false);
    }
  }, [apiHelpers, showToast, t]);

  const handleGenerateQr = useCallback(async () => {
    if (!instanceId.trim()) {
      showToast('error', t('selectInstanceError'));
      return;
    }
    
    setLoadingQr(true);
    try {
      const data = await apiHelpers.generateQr(instanceId);
      setQrData(data);
      setStatus(data.status as ConnectionStatus);
      // No mostrar notificación al generar QR
      fetchInstances();
    } catch (error: any) {
      showToast('error', error.message || t('generateQrError'));
    } finally {
      setLoadingQr(false);
    }
  }, [apiHelpers, instanceId, showToast, fetchInstances, t]);

  const handleReconnectWithQr = useCallback(async (reconnectInstanceId: string) => {
    // Cambiar a vista de control
    setView('control');
    
    // Establecer la instancia seleccionada
    setInstanceId(reconnectInstanceId);
    
    // Esperar un momento para que se actualice la UI
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Generar QR automáticamente
    setLoadingQr(true);
    try {
      const data = await apiHelpers.generateQr(reconnectInstanceId);
      setQrData(data);
      setStatus(data.status as ConnectionStatus);
      fetchInstances();
    } catch (error: any) {
      showToast('error', error.message || t('generateQrError'));
    } finally {
      setLoadingQr(false);
    }
  }, [apiHelpers, showToast, fetchInstances, t]);

  useEffect(() => {
    fetchInstances();
  }, [fetchInstances]);

  useEffect(() => {
    if (view !== 'instances') return;
    fetchInstances();
    const interval = setInterval(() => {
      fetchInstances();
    }, 15000);
    return () => clearInterval(interval);
  }, [fetchInstances, view]);

  useEffect(() => {
    lastStatusRef.current = status;
  }, [status]);

  useEffect(() => {
    const { classList } = document.body;
    if (isDark) {
      classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
    return () => classList.remove('dark');
  }, [isDark]);

  useEffect(() => {
    if (view !== 'control') return;
    if (status === 'ONLINE') return;

    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const data = await apiHelpers.getStatus(instanceId);
        if (cancelled) return;
        const normalizedStatus = data.status as ConnectionStatus;
        const previous = lastStatusRef.current;
        if (previous !== normalizedStatus) {
          lastStatusRef.current = normalizedStatus;
          if (normalizedStatus === 'ONLINE') {
            showToast('success', t('instanceConnected'));
            fetchInstances();
            // Limpiar la vista de QR para permitir generar otro inmediatamente
            setQrData(null);
            // Limpiar ID de instancia para preparar una nueva creación
            setInstanceId('');
            setStatus('sin_datos');
          }
        }
        setStatus(normalizedStatus);
      } catch (error: any) {
        console.warn('Fallo al consultar estado automático', error?.message);
      }
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [apiHelpers, fetchInstances, instanceId, showToast, status, view, t]);

  // Polling automático para obtener el QR cuando el estado es "RECONNECTING"
  useEffect(() => {
    if (view !== 'control') return;
    if (status !== 'RECONNECTING') return; // Solo polling cuando está reconectando
    if (qrData?.qr) return; // Ya tenemos QR, no necesitamos seguir consultando

    let cancelled = false;
    const qrInterval = setInterval(async () => {
      try {
        const data = await apiHelpers.checkQr(instanceId);
        if (cancelled) return;
        
        // Si hay QR disponible, actualizarlo en el frontend
        if (data && data.qr && data.success) {
          setQrData(data);
          setStatus(data.status as ConnectionStatus);
        }
      } catch {
        // Silenciar errores si no hay QR aún, es normal durante la generación
        // No mostrar errores en consola para evitar spam
      }
    }, 2000); // Consultar cada 2 segundos para obtener el QR rápidamente

    return () => {
      cancelled = true;
      clearInterval(qrInterval);
    };
  }, [apiHelpers, instanceId, status, view, qrData?.qr]);


  return (
    <div className="app-background">
      <WhatsAppRain />
      <Header
        isDark={isDark}
        onToggleDark={() => setIsDark((prev) => !prev)}
      />
      <div className="app-layout">
        <Sidebar
          currentView={view}
          onViewChange={setView}
        />
        
        <main className="app-main-content">
          {/* Vista de Control - Reorganizada en contenedores */}
          {view === 'control' && (
            <div className="dashboard-grid">
              <div className="control-section">
                <div className="section-header">
                  <Icons.Settings className="section-icon" />
                  <h2>{t('controlTitle')}</h2>
                </div>
                <InstanceControls
                  instanceId={instanceId}
                  status={status}
                  isProcessing={loadingQr}
                  instances={instances}
                  onInstanceChange={setInstanceId}
                  onGenerateQr={handleGenerateQr}
                />
              </div>

              <div className="qr-section">
                <QrPreview
                  qr={qrData?.qr}
                  status={status}
                  message={qrData?.message}
                  isLoading={loadingQr}
                />
              </div>
            </div>
          )}

          {view === 'instances' && (
            <div className="full-width-section">
              <InstanceList
                instances={instances}
                isLoading={loadingInstances}
                queueStats={queueStats}
                queueStatsUpdatedAt={queueStatsUpdatedAt}
                onRefresh={fetchInstances}
                onReconnectWithQr={handleReconnectWithQr}
              />
            </div>
          )}

          {view === 'webhooks' && (
            <div className="webhooks-grid">
              <WebhooksView />
            </div>
          )}

          {view === 'settings' && (
            <div className="full-width-section">
              <SettingsView />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

