import { useState } from 'react';
import { useConversations } from '../hooks/useConversations';
import { ConversationList } from './Messages/ConversationList';
import { ChatView } from './Messages/ChatView';
import { Icons } from './icons';
import { useLanguage } from '../context/LanguageContext';
import '../styles/app.css';

export function MessageHistoryView() {
  const { t } = useLanguage();
  const { conversations, messagesFor, loading, error, refresh } =
    useConversations();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Auto-select the most recent conversation when the list first loads.
  // Derived from props/state instead of useEffect+setState to avoid cascading renders.
  const effectiveKey = selectedKey ?? conversations[0]?.chatKey ?? null;
  const selected =
    conversations.find((c) => c.chatKey === effectiveKey) ?? null;
  const selectedMessages = effectiveKey ? messagesFor(effectiveKey) : [];

  return (
    <section className="panel chat-panel">
      <div className="section-heading">
        <h2>
          <Icons.History className="icon-lg" />
          {t('messageHistoryTitle')}
        </h2>
      </div>

      {loading && conversations.length === 0 ? (
        <div className="loading-container">
          <div className="loading"></div>
          <p>{t('loadingMessages')}</p>
        </div>
      ) : error ? (
        <div className="error-container">
          <Icons.Error className="error-icon" />
          <p className="error-message">{error}</p>
          <button className="btn-primary" onClick={refresh}>
            <Icons.Refresh className="icon" />
            {t('retry')}
          </button>
        </div>
      ) : (
        <div className="chat-layout">
          <ConversationList
            conversations={conversations}
            selectedKey={effectiveKey}
            onSelect={setSelectedKey}
          />
          <ChatView
            conversation={selected}
            messages={selectedMessages}
            onSent={refresh}
          />
        </div>
      )}
    </section>
  );
}
