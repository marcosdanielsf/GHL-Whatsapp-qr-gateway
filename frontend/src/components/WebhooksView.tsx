import { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { api } from '../services/api';
import { Icons } from './icons';
import '../styles/app.css';

interface OutboundWebhook {
  locationId?: string;
  contactId?: string;
  phone: string;
  message: string;
  timestamp: number;
  status: 'queued' | 'sent' | 'failed';
  instanceId?: string;
}

interface InboundWebhook {
  instanceId: string;
  from: string;
  text: string;
  timestamp: number;
}

type TabType = 'all' | 'wa-01' | 'wa-02' | 'wa-03';

export function WebhooksView() {
  const [activeTab, setActiveTab] = useState<TabType>('all');
  const [allOutbound, setAllOutbound] = useState<OutboundWebhook[]>([]);
  const [allInbound, setAllInbound] = useState<InboundWebhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // En una implementación real, necesitarías un endpoint para obtener webhooks
  // Por ahora, simulamos con datos del historial de mensajes
  const fetchWebhooks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Obtener mensajes recientes para simular webhooks
      const [outboundData, inboundData] = await Promise.all([
        api.getMessageHistory({
          type: 'outbound',
          limit: 50,
        }),
        api.getMessageHistory({
          type: 'inbound',
          limit: 50,
        }),
      ]);

      if (outboundData.messages && outboundData.messages.length > 0) {
        const webhooks = outboundData.messages.map(msg => ({
          phone: msg.to || '',
          message: msg.text || '',
          timestamp: msg.timestamp,
          status: (msg.status as 'queued' | 'sent' | 'failed') || 'queued',
          instanceId: msg.instanceId || 'wa-01',
        }));
        setAllOutbound(webhooks);
      } else {
        setAllOutbound([]);
      }

      if (inboundData.messages && inboundData.messages.length > 0) {
        const webhooks = inboundData.messages.map(msg => ({
          instanceId: msg.instanceId || 'wa-01',
          from: msg.from || '',
          text: msg.text || '',
          timestamp: msg.timestamp,
        }));
        setAllInbound(webhooks);
      } else {
        setAllInbound([]);
      }
    } catch (error: any) {
      const errorMessage = error.message || 'No se pudieron cargar los webhooks';
      setError(errorMessage);
      toast.error(errorMessage);
      console.error('Error fetching webhooks:', error);
      setAllOutbound([]);
      setAllInbound([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWebhooks();
    const interval = setInterval(fetchWebhooks, 5000);
    return () => clearInterval(interval);
  }, [fetchWebhooks]);

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString('es-PE', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('es-PE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  // Filtrar webhooks por instancia
  const filteredOutbound = activeTab === 'all' 
    ? allOutbound 
    : allOutbound.filter(w => w.instanceId === activeTab);
  
  const filteredInbound = activeTab === 'all'
    ? allInbound
    : allInbound.filter(w => w.instanceId === activeTab);

  const lastOutbound = filteredOutbound[0] || null;
  const lastInbound = filteredInbound[0] || null;

  const renderTabs = () => (
    <div style={{ 
      display: 'flex', 
      gap: '0.5rem', 
      marginBottom: '1rem', 
      borderBottom: '1px solid var(--border-color)',
      paddingBottom: '0.5rem',
    }}>
      {(['all', 'wa-01', 'wa-02', 'wa-03'] as TabType[]).map(tab => (
        <button
          key={tab}
          onClick={() => setActiveTab(tab)}
          style={{
            padding: '0.5rem 1rem',
            background: activeTab === tab ? 'var(--primary)' : 'transparent',
            color: activeTab === tab ? 'white' : 'var(--text-secondary)',
            border: 'none',
            borderRadius: '0.5rem',
            cursor: 'pointer',
            fontSize: '0.875rem',
            fontWeight: activeTab === tab ? '600' : '400',
            transition: 'all 0.2s',
          }}
        >
          {tab === 'all' ? 'Todas' : tab}
        </button>
      ))}
    </div>
  );

  return (
    <div className="content-grid">
      {/* Card Webhook OUTBOUND */}
      <section className="panel">
        <div className="section-heading">
          <h2>
            <Icons.Send className="icon-lg" />
            Webhook OUTBOUND
          </h2>
          <p>Último webhook recibido desde GHL hacia el Gateway</p>
        </div>

        {renderTabs()}

        {loading ? (
          <div className="loading" style={{ margin: '2rem auto' }}></div>
        ) : error ? (
          <div style={{ textAlign: 'center', padding: '2rem' }}>
            <p className="no-data" style={{ color: 'var(--danger)', marginBottom: '1rem' }}>
              {error}
            </p>
            <button
              className="btn-primary"
              onClick={fetchWebhooks}
              style={{ marginTop: '1rem' }}
            >
              <Icons.Refresh className="icon" />
              Reintentar
            </button>
          </div>
        ) : lastOutbound ? (
          <div className="webhook-info" style={{ marginTop: '1.5rem' }}>
            <p className="webhook-source">Desde GHL → Gateway ({lastOutbound.instanceId})</p>
            <div className="recipient-card">
              <Icons.Phone className="icon" />
              <span>{lastOutbound.phone || 'Desconocido'}</span>
            </div>
            <p className="webhook-message">{lastOutbound.message || '(Sin mensaje)'}</p>
            <div className="delivery-status" style={{ marginTop: '1rem' }}>
              <span
                className="status-badge-sent"
                style={{
                  fontSize: '0.75rem',
                  padding: '0.25rem 0.75rem',
                  borderRadius: '0.5rem',
                  background:
                    lastOutbound.status === 'sent'
                      ? 'rgba(16, 185, 129, 0.1)'
                      : lastOutbound.status === 'failed'
                      ? 'rgba(239, 68, 68, 0.1)'
                      : 'rgba(59, 130, 246, 0.1)',
                  color:
                    lastOutbound.status === 'sent'
                      ? '#10b981'
                      : lastOutbound.status === 'failed'
                      ? '#ef4444'
                      : '#3b82f6',
                }}
              >
                {lastOutbound.status === 'sent' ? 'Enviado' : lastOutbound.status === 'failed' ? 'Fallido' : 'En cola'}
              </span>
            </div>
            <div style={{ marginTop: '0.75rem', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
              {formatDate(lastOutbound.timestamp)} {formatTime(lastOutbound.timestamp)}
            </div>
            {filteredOutbound.length > 1 && (
              <div style={{ marginTop: '1rem', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                +{filteredOutbound.length - 1} webhooks más en esta {activeTab === 'all' ? 'categoría' : 'instancia'}
              </div>
            )}
          </div>
        ) : (
          <p className="no-data" style={{ textAlign: 'center', padding: '2rem' }}>
            No hay webhooks outbound recientes {activeTab !== 'all' && `para ${activeTab}`}
          </p>
        )}
      </section>

      {/* Card Webhook INBOUND */}
      <section className="panel">
        <div className="section-heading">
          <h2>
            <Icons.Message className="icon-lg" />
            Webhook INBOUND
          </h2>
          <p>Último webhook recibido desde WhatsApp hacia el Gateway</p>
        </div>

        {renderTabs()}

        {loading ? (
          <div className="loading" style={{ margin: '2rem auto' }}></div>
        ) : error ? (
          <div style={{ textAlign: 'center', padding: '2rem' }}>
            <p className="no-data" style={{ color: 'var(--danger)', marginBottom: '1rem' }}>
              {error}
            </p>
            <button
              className="btn-primary"
              onClick={fetchWebhooks}
              style={{ marginTop: '1rem' }}
            >
              <Icons.Refresh className="icon" />
              Reintentar
            </button>
          </div>
        ) : lastInbound ? (
          <div className="webhook-info" style={{ marginTop: '1.5rem' }}>
            <p className="inbound-source">Desde WhatsApp → Gateway ({lastInbound.instanceId})</p>
            <div className="message-card">
              <Icons.Message className="icon" />
              <span>{lastInbound.from || 'Desconocido'}</span>
            </div>
            <p className="webhook-message">{lastInbound.text || '(Sin mensaje)'}</p>
            <p className="inbound-timestamp" style={{ marginTop: '0.75rem' }}>
              {formatDate(lastInbound.timestamp)} {formatTime(lastInbound.timestamp)}
            </p>
            {filteredInbound.length > 1 && (
              <div style={{ marginTop: '1rem', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                +{filteredInbound.length - 1} webhooks más en esta {activeTab === 'all' ? 'categoría' : 'instancia'}
              </div>
            )}
          </div>
        ) : (
          <p className="no-data" style={{ textAlign: 'center', padding: '2rem' }}>
            No hay webhooks inbound recientes {activeTab !== 'all' && `para ${activeTab}`}
          </p>
        )}
      </section>
    </div>
  );
}

