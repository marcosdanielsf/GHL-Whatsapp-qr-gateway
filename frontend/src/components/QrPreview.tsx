import { QRCodeCanvas } from 'qrcode.react';
import type { ConnectionStatus } from '../types/gateway';
import { Icons } from './icons';
import { useLanguage } from '../context/LanguageContext';

interface QrPreviewProps {
  qr?: string;
  status: ConnectionStatus | 'sin_datos';
  message?: string;
  isLoading?: boolean;
}

export function QrPreview({ qr, status, message, isLoading }: QrPreviewProps) {
  const { t } = useLanguage();
  const showPlaceholder = !qr;

  const getStatusIcon = (status: ConnectionStatus | 'sin_datos') => {
    switch (status) {
      case 'ONLINE': return <Icons.Connected />;
      case 'RECONNECTING': return <Icons.Connecting />;
      case 'OFFLINE':
      case 'sin_datos':
        return <Icons.Disconnected />;
      default: return <Icons.Info />;
    }
  };

  return (
    <div className="fade-in">
      <div className="qr-wrapper">
        {isLoading && (
          <div className="pulse">
            <div className="loading" style={{ width: '40px', height: '40px', margin: '0 auto' }}></div>
            <p>{t('generatingQr')}</p>
          </div>
        )}

        {showPlaceholder && !isLoading && (
          <p className="qr-message">
            <Icons.Info className="icon-lg" />
            {t('qrPlaceholder')}
          </p>
        )}

        {!showPlaceholder && qr && (
          <div className="qr-container">
            <QRCodeCanvas value={qr} size={280} />
            
            {message && (
              <p className="qr-hint">{message}</p>
            )}
            <span className={`status-badge status-${status} status-badge-small`}>
              {getStatusIcon(status)}
              {status}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
