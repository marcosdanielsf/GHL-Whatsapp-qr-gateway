import { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { api } from '../services/api';
import { Icons } from './icons';
import type { QueueStats } from '../types/gateway';
import '../styles/app.css';

export function QueueStatsView() {
  const [queueStats, setQueueStats] = useState<QueueStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchQueueStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.listInstances();
      if (data.queueStats) {
        setQueueStats(data.queueStats);
      } else {
        setQueueStats(null);
        setError('No hay estadísticas disponibles');
      }
    } catch (error: any) {
      const errorMessage = error.message || 'No se pudieron cargar las estadísticas';
      setError(errorMessage);
      toast.error(errorMessage);
      console.error('Error fetching queue stats:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchQueueStats();
    const interval = setInterval(fetchQueueStats, 5000);
    return () => clearInterval(interval);
  }, [fetchQueueStats]);

  return (
    <section className="panel">
      <div className="section-heading">
        <h2>
          <Icons.ChartBar className="icon-lg" />
          Estadísticas de Cola
        </h2>
        <p>Monitoreo en tiempo real de la cola de mensajes</p>
      </div>

      {loading ? (
        <div className="loading" style={{ margin: '2rem auto' }}></div>
      ) : error ? (
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <p className="no-data" style={{ color: 'var(--danger)', marginBottom: '1rem' }}>
            {error}
          </p>
          <button
            className="btn-primary"
            onClick={fetchQueueStats}
            style={{ marginTop: '1rem' }}
          >
            <Icons.Refresh className="icon" />
            Reintentar
          </button>
        </div>
      ) : queueStats ? (
        <div className="stats-grid" style={{ marginTop: '1.5rem' }}>
          <div className="stat-card stat-card-waiting stat-anim-1">
            <div className="stat-card-header">
              <div className="stat-icon-wrapper stat-icon-waiting">
                <Icons.Clock className="stat-icon" />
              </div>
              <div className="stat-card-info">
                <span className="stat-label">Pendientes</span>
                <span className="stat-number">{queueStats.waiting || 0}</span>
              </div>
            </div>
            <div className="stat-card-footer">
              <span className="stat-badge stat-badge-waiting">En cola</span>
            </div>
          </div>

          <div className="stat-card stat-card-active stat-anim-2">
            <div className="stat-card-header">
              <div className="stat-icon-wrapper stat-icon-active">
                <Icons.Refresh className="stat-icon" />
              </div>
              <div className="stat-card-info">
                <span className="stat-label">Procesando</span>
                <span className="stat-number">{queueStats.active || 0}</span>
              </div>
            </div>
            <div className="stat-card-footer">
              <span className="stat-badge stat-badge-active">Activo</span>
            </div>
          </div>

          {queueStats.completed !== undefined && (
            <div className="stat-card stat-card-completed stat-anim-3">
              <div className="stat-card-header">
                <div className="stat-icon-wrapper stat-icon-completed">
                  <Icons.Check className="stat-icon" />
                </div>
                <div className="stat-card-info">
                  <span className="stat-label">Completados</span>
                  <span className="stat-number">{queueStats.completed || 0}</span>
                </div>
              </div>
              <div className="stat-card-footer">
                <span className="stat-badge stat-badge-completed">Finalizado</span>
              </div>
            </div>
          )}

          {queueStats.failed !== undefined && (
            <div className="stat-card stat-card-failed stat-anim-4">
              <div className="stat-card-header">
                <div className="stat-icon-wrapper stat-icon-failed">
                  <Icons.Error className="stat-icon" />
                </div>
                <div className="stat-card-info">
                  <span className="stat-label">Fallidos</span>
                  <span className="stat-number">{queueStats.failed || 0}</span>
                </div>
              </div>
              <div className="stat-card-footer">
                <span className="stat-badge stat-badge-failed">Error</span>
              </div>
            </div>
          )}

          {queueStats.delayed !== undefined && queueStats.delayed > 0 && (
            <div className="stat-card stat-card-delayed stat-anim-5">
              <div className="stat-card-header">
                <div className="stat-icon-wrapper stat-icon-delayed">
                  <Icons.Warning className="stat-icon" />
                </div>
                <div className="stat-card-info">
                  <span className="stat-label">Retrasados</span>
                  <span className="stat-number">{queueStats.delayed}</span>
                </div>
              </div>
              <div className="stat-card-footer">
                <span className="stat-badge stat-badge-delayed">En espera</span>
              </div>
            </div>
          )}

          <div className="stat-card stat-card-total stat-anim-6">
            <div className="stat-card-header">
              <div className="stat-icon-wrapper stat-icon-total">
                <Icons.ChartBar className="stat-icon" />
              </div>
              <div className="stat-card-info">
                <span className="stat-label">Total</span>
                <span className="stat-number">{queueStats.total || 0}</span>
              </div>
            </div>
            <div className="stat-card-footer">
              <span className="stat-badge stat-badge-total">General</span>
            </div>
          </div>
        </div>
      ) : (
        <p className="no-data" style={{ textAlign: 'center', padding: '2rem' }}>
          No hay estadísticas disponibles
        </p>
      )}
    </section>
  );
}

