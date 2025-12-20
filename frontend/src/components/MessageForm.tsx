import { useState } from 'react';
import type { SendMessagePayload } from '../types/gateway';
import { Icons } from './icons';
import { useLanguage } from '../context/LanguageContext';

interface MessageFormProps {
  instanceId: string;
  disabled?: boolean;
  isConnected: boolean;
  onSubmit: (payload: SendMessagePayload) => Promise<boolean>;
  onInstanceChange?: (value: string) => void;
}

export function MessageForm({
  instanceId,
  disabled,
  isConnected,
  onSubmit,
  onInstanceChange,
}: MessageFormProps) {
  const { t } = useLanguage();
  const [to, setTo] = useState('');
  const [type, setType] = useState<'text' | 'image'>('text');
  const [text, setText] = useState(t('defaultMessage'));
  const [mediaUrl, setMediaUrl] = useState('https://picsum.photos/512/512');

  

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isConnected || disabled) return;
    if (!to.trim()) return;
    if (type === 'text' && !text.trim()) return;
    if (type === 'image' && !mediaUrl.trim()) return;

    const payload: SendMessagePayload =
      type === 'text'
        ? {
            instanceId,
            to,
            type: 'text',
            message: text,
          }
        : {
            instanceId,
            to,
            type: 'image',
            mediaUrl,
          };

    const sent = await onSubmit(payload);
    if (sent) {
      setTo('');
      setText(t('defaultMessage'));
      setMediaUrl('https://picsum.photos/512/512');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="message-form-container">
      <div className="form-section">
        <div className="form-row">
          <div className="form-field-group">
            <label className="field-label">
              <Icons.Users className="label-icon" />
              <div className="label-content">
                <span className="label-title">{t('instanceIdLabel')}</span>
                <span className="label-subtitle">{t('instanceIdDescription')}</span>
              </div>
            </label>
            <div className="form-field-with-icon">
              <Icons.Users className="field-icon" />
              <input
                type="text"
                value={instanceId}
                onChange={(e) => onInstanceChange?.(e.target.value)}
                placeholder={t('instanceIdPlaceholder')}
                className="form-input"
              />
            </div>
          </div>
          
          <div className="form-field-group">
            <label className="field-label">
              <Icons.Phone className="label-icon" />
              <div className="label-content">
                <span className="label-title">{t('destinationNumber')}</span>
                <span className="label-subtitle">{t('destinationNumberDescription')}</span>
              </div>
            </label>
            <div className="form-field-with-icon">
              <Icons.Phone className="field-icon" />
              <input
                type="tel"
                required
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder={t('destinationNumberDescription')}
                className="form-input"
              />
            </div>
          </div>
        </div>

        <div className="message-type-selector">
          <label className="field-label">
            <Icons.Settings className="label-icon" />
            <div className="label-content">
              <span className="label-title">{t('messageType')}</span>
              <span className="label-subtitle">{t('messageTypeDescription')}</span>
            </div>
          </label>
          <div className="type-buttons">
            <button
              type="button"
              className={`type-btn ${type === 'text' ? 'active' : ''}`}
              onClick={() => setType('text')}
            >
              <Icons.Message className="type-icon" />
              <span>{t('text')}</span>
            </button>
            <button
              type="button"
              className={`type-btn ${type === 'image' ? 'active' : ''}`}
              onClick={() => setType('image')}
            >
              <Icons.Image className="type-icon" />
              <span>{t('image')}</span>
            </button>
          </div>
        </div>

        {type === 'text' ? (
          <div className="message-field">
            <label className="field-label">
              <Icons.Message className="label-icon" />
              <div className="label-content">
                <span className="label-title">{t('messageContent')}</span>
                <span className="label-subtitle">{t('messageContentDescription')}</span>
              </div>
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('messagePlaceholder')}
              className="message-textarea"
            />
          </div>
        ) : (
          <div className="media-field">
            <label className="field-label">
              <Icons.Image className="label-icon" />
              <div className="label-content">
                <span className="label-title">{t('imageUrl')}</span>
                <span className="label-subtitle">{t('imageUrlDescription')}</span>
              </div>
            </label>
            <div className="form-field-with-icon">
              <Icons.Image className="field-icon" />
              <input
                type="url"
                value={mediaUrl}
                onChange={(e) => setMediaUrl(e.target.value)}
                placeholder="https://..."
                className="form-input"
              />
            </div>
          </div>
        )}

        <div className="form-actions">
          <button 
            type="submit" 
            className="submit-btn" 
            disabled={disabled || !isConnected}
          >
            <Icons.Send className="btn-icon" />
            <span>{t('queueMessage')}</span>
            {disabled && <div className="btn-loading"></div>}
          </button>
          
          <div className="form-hint">
            <Icons.Info className="hint-icon" />
            <span>
              {!isConnected
                ? t('connectToSendMessage')
                : type === 'text'
                ? t('textDelayHint')
                : t('imageDelayHint')}
            </span>
          </div>
        </div>
      </div>
    </form>
  );
  }
