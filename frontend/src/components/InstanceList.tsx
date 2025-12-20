import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import type { InstanceSummary, QueueStats } from '../types/gateway';
import { Icons } from './icons';
import { useLanguage } from '../context/LanguageContext';

interface InstanceListProps {
  instances: InstanceSummary[];
  isLoading?: boolean;
  queueStats?: QueueStats | null;
  queueStatsUpdatedAt?: number | null;
  onRefresh: () => void;
  onReconnectWithQr?: (instanceId: string) => void;
}

export function InstanceList({
  instances,
  queueStats,
  queueStatsUpdatedAt,
  onRefresh,
  onReconnectWithQr,
}: InstanceListProps) {
  const { t, language } = useLanguage();
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | 'ONLINE' | 'RECONNECTING' | 'OFFLINE'>('');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [reconnectingIds, setReconnectingIds] = useState<Set<string>>(new Set());
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'ONLINE':
        return <Icons.Connected />;
      case 'RECONNECTING':
        return <Icons.Connecting />;
      case 'OFFLINE':
        return <Icons.Disconnected />;
      default:
        return <Icons.Info />;
    }
  };

  const getStatusGlyphIcon = (status: '' | 'ONLINE' | 'RECONNECTING' | 'OFFLINE') => {
    switch (status) {
      case 'ONLINE':
        return <Icons.Check className="icon-sm" />;
      case 'RECONNECTING':
        return <Icons.Connecting className="icon-sm" />;
      case 'OFFLINE':
        return <Icons.Error className="icon-sm" />;
      default:
        return <Icons.Info className="icon-sm" />;
    }
  };

  const filteredInstances = useMemo(() => {
    const term = query.trim().toLowerCase();
    return instances.filter((instance) => {
      const matchesId = !term || instance.instanceId.toLowerCase().includes(term);
      const matchesStatus = !statusFilter || instance.status === statusFilter;
      return matchesId && matchesStatus;
    });
  }, [instances, query, statusFilter]);

  const handleDelete = async (instanceId: string) => {
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/wa/delete/${instanceId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        toast.success(`${t('successDeleted')}: ${instanceId}`);

        await new Promise(resolve => setTimeout(resolve, 500));

        onRefresh();
      } else {
        const error = await response.json();
        console.error('Error eliminando instancia:', error);
        toast.error(error.error || t('errorGeneric'));
      }
    } catch (error) {
      console.error('Error eliminando instancia:', error);
      toast.error(t('errorGeneric'));
    } finally {
      setIsDeleting(false);
    }
  };

  const handleReconnect = async (instanceId: string) => {
    try {
      setReconnectingIds(prev => new Set(prev).add(instanceId));

      const response = await fetch(`/api/wa/reconnect/${instanceId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (response.ok) {
        if (onReconnectWithQr) {
          onReconnectWithQr(instanceId);
          toast.success(t('reconnectSuccess'));
        } else {
          toast.success(`${t('reconnectInitiated')} ${instanceId}`);
        }

        await new Promise(resolve => setTimeout(resolve, 500));

        onRefresh();
      } else {
        toast.error(
          `${t('reconnectError')} ${instanceId}: ${data.error || t('errorGeneric')}`
        );
      }
    } catch (error) {
      console.error('Error reconectando instancia:', error);
      toast.error(
        `${t('reconnectError')} ${instanceId}`
      );
    } finally {
      setReconnectingIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(instanceId);
        return newSet;
      });
    }
  };

  const STATUS_FILTERS: Array<{ value: '' | 'ONLINE' | 'RECONNECTING' | 'OFFLINE'; label: string }> = [
    { value: '', label: t('all') },
    { value: 'ONLINE', label: t('connected') },
    { value: 'RECONNECTING', label: t('reconnecting') },
    { value: 'OFFLINE', label: t('disconnected') },
  ];

  return (
    <div className="slide-in">
      <div className="section-heading">
        <div>
          <h2>
            <Icons.Users className="icon-lg" />
            {t('connectedInstances')}
          </h2>
        </div>
        <div className="view-actions" style={{ gap: '0.75rem', flexWrap: 'wrap' }}>
          <div className="form-field" style={{ margin: 0, minWidth: '180px' }}>
            <label htmlFor="instance-search">
              <Icons.Search className="icon-sm" />
              {t('search')}
            </label>
            <input
              id="instance-search"
              type="text"
              placeholder={t('searchPlaceholder')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="form-field" style={{ margin: 0, minWidth: '220px' }} ref={menuRef}>
            <label htmlFor="status-filter">
              <Icons.Settings className="icon-sm" />
              {t('status')}
            </label>
            <div className={`select-status ${isMenuOpen ? 'open' : ''}`}>
              <button
                id="status-filter"
                type="button"
                className="select-status-trigger"
                onClick={() => setIsMenuOpen((v) => !v)}
              >
                <span className={`dot ${statusFilter || 'all'}`}></span>
                <span className="label">
                  {STATUS_FILTERS.find((o) => o.value === statusFilter)?.label || t('all')}
                </span>
                <span className={`status-glyph ${statusFilter || 'all'}`}>{getStatusGlyphIcon(statusFilter)}</span>
                <span className="chevron">▾</span>
              </button>
              {isMenuOpen && (
                <div className="select-status-menu">
                  {STATUS_FILTERS.map((option) => (
                    <button
                      key={option.value || 'all'}
                      type="button"
                      className={`select-status-option ${statusFilter === option.value ? 'active' : ''}`}
                      onClick={() => {
                        setStatusFilter(option.value as typeof statusFilter);
                        setIsMenuOpen(false);
                      }}
                    >
                      <span className={`dot ${option.value || 'all'}`}></span>
                      <span className="label">{option.label}</span>
                      <span className={`status-glyph ${option.value || 'all'}`}>
                        {getStatusGlyphIcon(option.value)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <table className="instances-table">
        <thead>
          <tr>
            <th>{t('instance')}</th>
            <th>{t('status')}</th>
            <th>{t('phone')}</th>
            <th>{t('pendingQr')}</th>
            <th style={{ width: '150px' }}>{t('actions')}</th>
          </tr>
        </thead>
        <tbody>
          {instances.length === 0 && query.trim().length === 0 && !statusFilter && (
            <tr>
              <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                <Icons.Info className="icon" />
                {t('noInstances')}
              </td>
            </tr>
          )}
          {instances.length > 0 && filteredInstances.length === 0 && (
            <tr>
              <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                <Icons.Info className="icon" />
                {t('noResults')}
              </td>
            </tr>
          )}
          {filteredInstances.map((instance) => {
            const isReconnecting = reconnectingIds.has(instance.instanceId);
            const canReconnect = instance.status === 'OFFLINE' ||
              instance.status === 'DISCONNECTED' ||
              instance.status === 'ERROR';

            return (
              <tr key={instance.instanceId}>
                <td>
                  <Icons.Users className="icon-sm" />
                  {instance.instanceId}
                </td>
                <td>
                  <span className={`status-badge status-${instance.status}`}>
                    {getStatusIcon(instance.status)}
                    {instance.status}
                  </span>
                </td>
                <td>
                  {instance.phone ? (
                    <span style={{ color: 'var(--text-primary)' }}>{instance.phone}</span>
                  ) : (
                    <span style={{ color: 'var(--text-muted)' }}>—</span>
                  )}
                </td>
                <td>{instance.hasQR ? t('yes') : t('no')}</td>
                <td className="actions-cell">
                  <button
                    className={`btn-icon-warning ${canReconnect ? 'pulse' : ''}`}
                    onClick={() => handleReconnect(instance.instanceId)}
                    title={
                      isReconnecting
                        ? t('reconnecting')
                        : `${t('reconnect')} ${instance.instanceId}`
                    }
                    disabled={isDeleting || isReconnecting}
                  >
                    {isReconnecting ? '⏳' : '🔄'}
                  </button>
                  <button
                    className="btn-icon-danger"
                    onClick={() => handleDelete(instance.instanceId)}
                    title={`${t('delete')} ${instance.instanceId}`}
                    disabled={isDeleting || isReconnecting}
                  >
                    ❌
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {queueStats ? (
        <div className="pending-summary queue-meter">
          <Icons.Info className="icon" />
          <div className="queue-meter-row">
            <div className="queue-meter-item">
              <span className="queue-label">{t('waiting')}</span>
              <strong>{queueStats.waiting + queueStats.delayed}</strong>
            </div>
            <div className="queue-meter-item">
              <span className="queue-label">{t('processing')}</span>
              <strong>{queueStats.active}</strong>
            </div>
            <div className="queue-meter-item">
              <span className="queue-label">{t('failed')}</span>
              <strong>{queueStats.failed}</strong>
            </div>
            <div className="queue-meter-item">
              <span className="queue-label">{t('sent')}</span>
              <strong>{queueStats.completed}</strong>
            </div>
            {queueStatsUpdatedAt && (
              <span className="queue-updated">
                {t('lastUpdate')}:{' '}
                {new Date(queueStatsUpdatedAt).toLocaleTimeString(language === 'es' ? 'es-PE' : language === 'pt' ? 'pt-BR' : 'en-US', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="pending-summary">
          <Icons.Info className="icon" />
          <span>{t('queueStatsError')}</span>
        </div>
      )}
    </div>
  );
}