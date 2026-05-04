import { useMemo, useState } from 'react';
import type { Conversation } from '../../types/gateway';
import { Icons } from '../icons';
import { useLanguage } from '../../context/LanguageContext';

interface ConversationListProps {
  conversations: Conversation[];
  selectedKey: string | null;
  onSelect: (chatKey: string) => void;
}

function formatPhone(jid: string): string {
  if (jid.endsWith('@g.us')) return jid;
  const phone = jid.split('@')[0];
  return phone.startsWith('+') ? phone : `+${phone}`;
}

function formatRelative(timestamp: number, language: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (sameDay) {
    return date.toLocaleTimeString(
      language === 'es' ? 'es-PE' : language === 'pt' ? 'pt-BR' : 'en-US',
      { hour: '2-digit', minute: '2-digit' },
    );
  }
  return date.toLocaleDateString(
    language === 'es' ? 'es-PE' : language === 'pt' ? 'pt-BR' : 'en-US',
    { day: '2-digit', month: '2-digit' },
  );
}

export function ConversationList({
  conversations,
  selectedKey,
  onSelect,
}: ConversationListProps) {
  const { t, language } = useLanguage();
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return conversations;
    const lower = search.toLowerCase();
    return conversations.filter(
      (c) =>
        c.chatKey.toLowerCase().includes(lower) ||
        c.lastMessage.text?.toLowerCase().includes(lower),
    );
  }, [conversations, search]);

  return (
    <aside className="chat-conversation-list">
      <div className="chat-list-search">
        <Icons.Search className="chat-list-search-icon" />
        <input
          type="text"
          placeholder={t('searchMessagePlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="chat-list-empty">
          <Icons.Message />
          <span>{t('noMessages')}</span>
        </div>
      ) : (
        <ul className="chat-list">
          {filtered.map((conv) => {
            const active = conv.chatKey === selectedKey;
            const preview = conv.lastMessage.text || '';
            const isGroup = conv.chatType === 'group';
            return (
              <li
                key={conv.chatKey}
                className={`chat-list-item ${active ? 'active' : ''}`}
                onClick={() => onSelect(conv.chatKey)}
              >
                <div className={`chat-list-avatar ${isGroup ? 'group' : 'private'}`}>
                  {isGroup ? <Icons.Users /> : <Icons.Phone />}
                </div>
                <div className="chat-list-body">
                  <div className="chat-list-row">
                    <span className="chat-list-title">{formatPhone(conv.chatKey)}</span>
                    <span className="chat-list-time">
                      {formatRelative(conv.lastTimestamp, language)}
                    </span>
                  </div>
                  <div className="chat-list-row">
                    <span className="chat-list-preview">
                      {conv.lastMessage.type === 'outbound' && (
                        <span className="chat-list-preview-prefix">✓ </span>
                      )}
                      {preview}
                    </span>
                    {conv.totalMessages > 1 && (
                      <span className="chat-list-count">{conv.totalMessages}</span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
