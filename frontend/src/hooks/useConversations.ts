import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../services/api';
import type { Conversation, MessageHistory } from '../types/gateway';

const POLLING_MS = 5000;
const HISTORY_LIMIT = 500;

function chatKeyOf(msg: MessageHistory): string | null {
  if (msg.type === 'inbound') return msg.from ?? null;
  return msg.to ?? null;
}

function chatTypeOf(key: string): 'private' | 'group' {
  return key.endsWith('@g.us') ? 'group' : 'private';
}

function groupByChat(messages: MessageHistory[]): Conversation[] {
  const buckets = new Map<string, MessageHistory[]>();

  for (const msg of messages) {
    const key = chatKeyOf(msg);
    if (!key) continue;
    const arr = buckets.get(key) ?? [];
    arr.push(msg);
    buckets.set(key, arr);
  }

  const conversations: Conversation[] = [];
  for (const [key, msgs] of buckets) {
    msgs.sort((a, b) => a.timestamp - b.timestamp);
    const last = msgs[msgs.length - 1];
    conversations.push({
      chatKey: key,
      chatType: chatTypeOf(key),
      instanceId: last.instanceId,
      lastMessage: last,
      lastTimestamp: last.timestamp,
      totalMessages: msgs.length,
      unreadCount: 0,
    });
  }

  conversations.sort((a, b) => b.lastTimestamp - a.lastTimestamp);
  return conversations;
}

export function useConversations() {
  const [messages, setMessages] = useState<MessageHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetchAll = useCallback(async () => {
    try {
      const data = await api.getMessageHistory({ limit: HISTORY_LIMIT });
      if (!mountedRef.current) return;
      setMessages(data.messages || []);
      setError(null);
    } catch (err: any) {
      if (!mountedRef.current) return;
      setError(err.message || 'Erro ao carregar conversas');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchAll();
    const interval = setInterval(fetchAll, POLLING_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [fetchAll]);

  const conversations = useMemo(() => groupByChat(messages), [messages]);

  const messagesFor = useCallback(
    (chatKey: string): MessageHistory[] => {
      return messages
        .filter((m) => chatKeyOf(m) === chatKey)
        .sort((a, b) => a.timestamp - b.timestamp);
    },
    [messages],
  );

  return { conversations, messagesFor, loading, error, refresh: fetchAll };
}
