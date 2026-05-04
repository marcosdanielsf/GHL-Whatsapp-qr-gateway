/**
 * In-memory tracker of WhatsApp message IDs sent by the Nexus API.
 *
 * Used to distinguish outbound messages originated by the platform
 * (POST /api/send, agent IA, campaigns) from messages typed by the
 * client directly in the native WhatsApp app on the same chip.
 *
 * Baileys emits both kinds in `messages.upsert` with `key.fromMe: true`.
 * If `wasSentByApi(key.id)` returns false for a fromMe event, the human
 * answered via native app — trigger auto-takeover of the AI conversation.
 *
 * TTL is 5 minutes: enough window for Baileys to emit the upsert event
 * after sendMessage resolves; entries expire to keep memory bounded.
 */

const TTL_MS = 5 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 1000;

const sentIds = new Map<string, number>();

let sweepTimer: NodeJS.Timeout | null = null;

function ensureSweep(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    const cutoff = Date.now() - TTL_MS;
    for (const [id, ts] of sentIds) {
      if (ts < cutoff) sentIds.delete(id);
    }
  }, SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();
}

export function markSent(messageId: string | null | undefined): void {
  if (!messageId) return;
  ensureSweep();
  sentIds.set(messageId, Date.now());
}

export function wasSentByApi(messageId: string | null | undefined): boolean {
  if (!messageId) return false;
  const ts = sentIds.get(messageId);
  if (!ts) return false;
  if (Date.now() - ts > TTL_MS) {
    sentIds.delete(messageId);
    return false;
  }
  return true;
}

export function _trackerSize(): number {
  return sentIds.size;
}
