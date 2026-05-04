import { useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { api } from '../../services/api';
import type { Conversation, MessageHistory, SendMessagePayload } from '../../types/gateway';
import { Icons } from '../icons';
import { useLanguage } from '../../context/LanguageContext';
import { MessageBubble } from './MessageBubble';

interface ChatViewProps {
  conversation: Conversation | null;
  messages: MessageHistory[];
  onSent: () => void;
}

function jidToPhone(jid: string): string {
  if (jid.endsWith('@g.us')) return jid;
  return jid.split('@')[0];
}

function jidIsGroup(jid: string): boolean {
  return jid.endsWith('@g.us');
}

export function ChatView({ conversation, messages, onSent }: ChatViewProps) {
  const { t: _t } = useLanguage();
  // i18n hook reservado pra futuro (chaves chat ainda não no dicionário)
  void _t;
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [pausing, setPausing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDraft('');
  }, [conversation?.chatKey]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length, conversation?.chatKey]);

  if (!conversation) {
    return (
      <section className="chat-view chat-view-empty">
        <Icons.Message />
        <p>Selecione uma conversa para ver o histórico</p>
      </section>
    );
  }

  const isGroup = jidIsGroup(conversation.chatKey);
  const phone = jidToPhone(conversation.chatKey);
  const instanceId = conversation.instanceId;

  const tryTakeover = async (
    source: 'manual_button' | 'inline_send',
  ): Promise<boolean> => {
    if (!instanceId) return false;
    try {
      const result = await api.takeoverByContact({
        instanceId,
        contactPhone: phone,
        source,
      });
      return result.ok;
    } catch (err: any) {
      // 404 = sem agente IA associado, silencioso
      if (err?.message?.includes('404')) return false;
      // outros erros não bloqueiam o envio
      console.warn('[chat-view] takeover failed', err);
      return false;
    }
  };

  const handleAssumir = async () => {
    if (!instanceId) {
      toast.warn('Conversa sem chip associado');
      return;
    }
    setPausing(true);
    const ok = await tryTakeover('manual_button');
    setPausing(false);
    if (ok) {
      toast.success('Agente IA pausado nesta conversa');
    } else {
      toast.info('Esta conversa não tem agente IA ativo (nada a pausar)');
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim() || sending || !instanceId) return;
    setSending(true);
    try {
      // Pra grupos `phone` é o JID completo (`<id>@g.us`); pra privadas é o número.
      // Backend (sendTextMessage linha 1672) aceita ambos via sock.sendMessage.
      const to = isGroup ? conversation.chatKey : phone;
      const payload: SendMessagePayload = {
        instanceId,
        to,
        type: 'text',
        message: draft,
      };
      await api.sendMessage(payload);
      // Se houver agente IA ativo nesta conversa, pausa implicitamente
      tryTakeover('inline_send').catch(() => undefined);
      setDraft('');
      onSent();
    } catch (err: any) {
      toast.error(err.message || 'Erro ao enviar mensagem');
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="chat-view">
      <header className="chat-view-header">
        <div className={`chat-view-avatar ${isGroup ? 'group' : 'private'}`}>
          {isGroup ? <Icons.Users /> : <Icons.Phone />}
        </div>
        <div className="chat-view-header-info">
          <h3>{phone}</h3>
          <span className="chat-view-instance">
            {instanceId || '—'} · {messages.length} mensagens
          </span>
        </div>
        <div className="chat-view-actions">
          <button
            type="button"
            className="chat-view-takeover-btn"
            onClick={handleAssumir}
            disabled={pausing || !instanceId}
            title="Pausar IA nesta conversa"
          >
            <Icons.Settings />
            <span>{pausing ? '...' : 'Assumir'}</span>
          </button>
        </div>
      </header>

      <div className="chat-view-messages" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="chat-view-no-messages">Sem mensagens</div>
        ) : (
          messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)
        )}
      </div>

      <form className="chat-view-composer" onSubmit={handleSend}>
        <input
          type="text"
          placeholder="Digite uma mensagem"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={sending}
        />
        <button
          type="submit"
          disabled={!draft.trim() || sending || !instanceId}
        >
          <Icons.Send />
        </button>
      </form>
    </section>
  );
}
