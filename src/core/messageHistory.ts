/**
 * Sistema simple de almacenamiento en memoria para historial de mensajes
 * TODO: Migrar a Redis o base de datos para persistencia
 */

interface MessageHistoryEntry {
  id: string;
  instanceId: string;
  type: 'inbound' | 'outbound';
  from?: string;
  to?: string;
  text: string;
  timestamp: number;
  status: 'sent' | 'received' | 'failed' | 'queued';
  metadata?: any;
}

class MessageHistoryStore {
  private messages: MessageHistoryEntry[] = [];
  private maxMessages = 1000; // Limitar a 1000 mensajes en memoria

  /**
   * Agregar un mensaje al historial
   */
  add(entry: Omit<MessageHistoryEntry, 'id' | 'timestamp'> & { timestamp?: number }): void {
    const message: MessageHistoryEntry = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: entry.timestamp || Date.now(),
      ...entry,
    };

    this.messages.unshift(message); // Agregar al inicio

    // Limitar el tamaño del array
    if (this.messages.length > this.maxMessages) {
      this.messages = this.messages.slice(0, this.maxMessages);
    }
  }

  /**
   * Obtener mensajes con filtros opcionales
   */
  getMessages(options?: {
    instanceId?: string;
    type?: 'inbound' | 'outbound';
    limit?: number;
    since?: number; // timestamp
  }): MessageHistoryEntry[] {
    let filtered = [...this.messages];

    if (options?.instanceId) {
      filtered = filtered.filter((m) => m.instanceId === options.instanceId);
    }

    if (options?.type) {
      filtered = filtered.filter((m) => m.type === options.type);
    }

    if (options?.since) {
      filtered = filtered.filter((m) => m.timestamp >= options.since!);
    }

    const limit = options?.limit || 100;
    return filtered.slice(0, limit);
  }

  /**
   * Obtener estadísticas
   */
  getStats(instanceId?: string): {
    total: number;
    inbound: number;
    outbound: number;
    sent: number;
    received: number;
    failed: number;
  } {
    let filtered = [...this.messages];

    if (instanceId) {
      filtered = filtered.filter((m) => m.instanceId === instanceId);
    }

    return {
      total: filtered.length,
      inbound: filtered.filter((m) => m.type === 'inbound').length,
      outbound: filtered.filter((m) => m.type === 'outbound').length,
      sent: filtered.filter((m) => m.status === 'sent').length,
      received: filtered.filter((m) => m.status === 'received').length,
      failed: filtered.filter((m) => m.status === 'failed').length,
    };
  }

  /**
   * Limpiar mensajes antiguos (más de X horas)
   */
  cleanup(olderThanHours: number = 24): void {
    const cutoff = Date.now() - olderThanHours * 60 * 60 * 1000;
    this.messages = this.messages.filter((m) => m.timestamp >= cutoff);
  }
}

// Instancia singleton
export const messageHistory = new MessageHistoryStore();

// Limpiar mensajes antiguos cada hora
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    messageHistory.cleanup(24); // Mantener solo últimos 24 horas
  }, 60 * 60 * 1000); // Cada hora
}

