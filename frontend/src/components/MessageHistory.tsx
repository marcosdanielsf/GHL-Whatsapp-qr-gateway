import { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { api } from '../services/api';
import { Icons } from './icons';
import type { MessageHistory } from '../types/gateway';
import '../styles/app.css';

type MessageTab = 'all' | 'inbound' | 'outbound';

export function MessageHistoryView() {
  const [messageHistory, setMessageHistory] = useState<MessageHistory[]>([]);
  const [messageTab, setMessageTab] = useState<MessageTab>('all');
  const [messageSearch, setMessageSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMessageHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // No filtrar por instanceId para mostrar todos los mensajes
      const data = await api.getMessageHistory({
        type: messageTab === 'all' ? undefined : messageTab,
        limit: 100,
      });
      setMessageHistory(data.messages || []);
    } catch (error: any) {
      const errorMessage = error.message || 'No se pudo cargar el historial de mensajes';
      setError(errorMessage);
      toast.error(errorMessage);
      console.error('Error fetching message history:', error);
      setMessageHistory([]);
    } finally {
      setLoading(false);
    }
  }, [messageTab]);

  useEffect(() => {
    fetchMessageHistory();
    const interval = setInterval(fetchMessageHistory, 10000);
    return () => clearInterval(interval);
  }, [fetchMessageHistory]);

  const filteredMessages = messageHistory.filter((msg) => {
    // El filtro por tipo ya se hace en el backend, pero mantenemos el filtro por búsqueda
    if (messageSearch) {
      const searchLower = messageSearch.toLowerCase();
      return (
        msg.text?.toLowerCase().includes(searchLower) ||
        msg.from?.toLowerCase().includes(searchLower) ||
        msg.to?.toLowerCase().includes(searchLower)
      );
    }
    return true;
  });

  const formatTime = (timestamp: number) => {
    // El timestamp viene en milisegundos desde el backend
    return new Date(timestamp).toLocaleTimeString('es-PE', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const formatDate = (timestamp: number) => {
    // El timestamp viene en milisegundos desde el backend
    return new Date(timestamp).toLocaleDateString('es-PE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  return (
    <section className="panel">
      <div className="section-heading">
        <h2>
          <Icons.History className="icon-lg" />
          Historial de Mensajes
        </h2>
      </div>

      <div className="messages-controls">
        <div className="messages-tabs">
          <button
            className={`message-tab ${messageTab === 'all' ? 'active' : ''}`}
            onClick={() => setMessageTab('all')}
          >
            <Icons.ChartBar className="tab-icon" />
            <span>Todos</span>
          </button>
          <button
            className={`message-tab ${messageTab === 'inbound' ? 'active' : ''}`}
            onClick={() => setMessageTab('inbound')}
          >
            <Icons.Message className="tab-icon" />
            <span>Entrantes</span>
          </button>
          <button
            className={`message-tab ${messageTab === 'outbound' ? 'active' : ''}`}
            onClick={() => setMessageTab('outbound')}
          >
            <Icons.Send className="tab-icon" />
            <span>Salientes</span>
          </button>
        </div>

        <div className="search-box-wrapper">
          <Icons.Search className="search-icon" />
          <input
            type="text"
            className="search-input"
            placeholder="Buscar por número, texto..."
            value={messageSearch}
            onChange={(e) => setMessageSearch(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <div className="loading-container">
          <div className="loading"></div>
          <p>Cargando mensajes...</p>
        </div>
      ) : error ? (
        <div className="error-container">
          <Icons.Error className="error-icon" />
          <p className="error-message">{error}</p>
          <button className="btn-primary" onClick={fetchMessageHistory}>
            <Icons.Refresh className="icon" />
            Reintentar
          </button>
        </div>
      ) : (
        <div className="messages-list-container">
          {filteredMessages.length > 0 ? (
            <div className="messages-list">
              {filteredMessages.map((msg, index) => (
                <div key={msg.id} className="message-card" style={{ animationDelay: `${index * 0.05}s` }}>
                  <div className={`message-icon-wrapper ${msg.type === 'inbound' ? 'inbound' : 'outbound'}`}>
                    {msg.type === 'inbound' ? (
                      <Icons.Message className="message-icon" />
                    ) : (
                      <Icons.Send className="message-icon" />
                    )}
                  </div>
                  
                  <div className="message-content">
                    <div className="message-header">
                      <div className="message-contact">
                        <Icons.Phone className="contact-icon" />
                        <span className="contact-number">
                          {msg.type === 'inbound' ? (msg.from || 'Desconocido') : (msg.to || 'Desconocido')}
                        </span>
                      </div>
                      {msg.status && (
                        <span className={`message-status-badge status-${msg.status}`}>
                          {msg.status === 'sent' ? 'Enviado' : 
                           msg.status === 'received' ? 'Recibido' : 
                           msg.status === 'failed' ? 'Fallido' : 
                           'En cola'}
                        </span>
                      )}
                    </div>
                    
                    <div className="message-text">
                      {msg.text || '(Sin texto)'}
                    </div>
                    
                    <div className="message-footer">
                      <div className="message-time">
                        <Icons.Clock className="time-icon" />
                        <span>{formatDate(msg.timestamp)} {formatTime(msg.timestamp)}</span>
                      </div>
                      {msg.instanceId && (
                        <div className="message-instance">
                          <Icons.Users className="instance-icon" />
                          <span>{msg.instanceId}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <Icons.Message className="empty-icon" />
              <p className="empty-message">
                {messageSearch ? 'No se encontraron mensajes con ese criterio' : 'No hay mensajes para mostrar'}
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

