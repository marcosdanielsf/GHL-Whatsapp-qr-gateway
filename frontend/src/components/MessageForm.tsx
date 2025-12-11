import { useState } from 'react';
import type { SendMessagePayload } from '../types/gateway';
import { Icons } from './icons';

interface MessageFormProps {
  instanceId: string;
  disabled?: boolean;
  isConnected: boolean;
  onSubmit: (payload: SendMessagePayload) => Promise<boolean>;
  onInstanceChange?: (value: string) => void;
}

const DEFAULT_MESSAGE =
  'Hola 👋 Somos el equipo de soporte de GHL. Cuéntanos cómo podemos ayudarte.';

export function MessageForm({
  instanceId,
  disabled,
  isConnected,
  onSubmit,
  onInstanceChange,
}: MessageFormProps) {
    const [to, setTo] = useState('');
    const [type, setType] = useState<'text' | 'image'>('text');
    const [text, setText] = useState(DEFAULT_MESSAGE);
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
        setText(DEFAULT_MESSAGE);
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
                  <span className="label-title">ID de Instancia</span>
                  <span className="label-subtitle">Identificador de la instancia WhatsApp</span>
                </div>
              </label>
              <div className="form-field-with-icon">
                <Icons.Users className="field-icon" />
                <input
                  type="text"
                  value={instanceId}
                  onChange={(e) => onInstanceChange?.(e.target.value)}
                  placeholder="wa-01"
                  className="form-input"
                />
              </div>
            </div>
            
            <div className="form-field-group">
              <label className="field-label">
                <Icons.Phone className="label-icon" />
                <div className="label-content">
                  <span className="label-title">Número Destino</span>
                  <span className="label-subtitle">Formato internacional: +51999999999</span>
                </div>
              </label>
              <div className="form-field-with-icon">
                <Icons.Phone className="field-icon" />
                <input
                  type="tel"
                  required
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="+51999999999"
                  className="form-input"
                />
              </div>
            </div>
          </div>
  
          <div className="message-type-selector">
            <label className="field-label">
              <Icons.Settings className="label-icon" />
              <div className="label-content">
                <span className="label-title">Tipo de Mensaje</span>
                <span className="label-subtitle">Selecciona el tipo de contenido a enviar</span>
              </div>
            </label>
            <div className="type-buttons">
              <button
                type="button"
                className={`type-btn ${type === 'text' ? 'active' : ''}`}
                onClick={() => setType('text')}
              >
                <Icons.Message className="type-icon" />
                <span>Texto</span>
              </button>
              <button
                type="button"
                className={`type-btn ${type === 'image' ? 'active' : ''}`}
                onClick={() => setType('image')}
              >
                <Icons.Image className="type-icon" />
                <span>Imagen</span>
              </button>
            </div>
          </div>
  
          {type === 'text' ? (
            <div className="message-field">
              <label className="field-label">
                <Icons.Message className="label-icon" />
                <div className="label-content">
                  <span className="label-title">Contenido del Mensaje</span>
                  <span className="label-subtitle">Escribe el texto que deseas enviar al destinatario</span>
                </div>
              </label>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Escribe el mensaje que deseas enviar..."
                className="message-textarea"
              />
            </div>
          ) : (
            <div className="media-field">
              <label className="field-label">
                <Icons.Image className="label-icon" />
                <div className="label-content">
                  <span className="label-title">URL de la Imagen</span>
                  <span className="label-subtitle">Ingresa la URL pública de la imagen a enviar</span>
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
              <span>Encolar Mensaje</span>
              {disabled && <div className="btn-loading"></div>}
            </button>
            
            <div className="form-hint">
              <Icons.Info className="hint-icon" />
              <span>
                {!isConnected
                  ? 'Conecta la instancia para poder enviar mensajes.'
                  : type === 'text'
                  ? 'Delay automático de 3-4 segundos entre textos.'
                  : 'Las imágenes se envían con delay de 6-9 segundos.'}
              </span>
            </div>
          </div>
        </div>
      </form>
    );
  }