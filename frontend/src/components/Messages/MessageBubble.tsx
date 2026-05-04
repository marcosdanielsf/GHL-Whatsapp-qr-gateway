import type { MessageHistory } from '../../types/gateway';
import { useLanguage } from '../../context/LanguageContext';

interface MessageBubbleProps {
  message: MessageHistory;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const { language } = useLanguage();
  const isOutbound = message.type === 'outbound';

  const time = new Date(message.timestamp).toLocaleTimeString(
    language === 'es' ? 'es-PE' : language === 'pt' ? 'pt-BR' : 'en-US',
    { hour: '2-digit', minute: '2-digit' },
  );

  return (
    <div className={`chat-bubble-row ${isOutbound ? 'outbound' : 'inbound'}`}>
      <div className={`chat-bubble ${isOutbound ? 'outbound' : 'inbound'}`}>
        <div className="chat-bubble-text">{message.text || ' '}</div>
        <div className="chat-bubble-meta">
          <span className="chat-bubble-time">{time}</span>
          {isOutbound && message.status && (
            <span className={`chat-bubble-status status-${message.status}`}>
              {message.status === 'sent' || message.status === 'received'
                ? '✓✓'
                : message.status === 'queued'
                ? '⏱'
                : message.status === 'failed'
                ? '!'
                : ''}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
