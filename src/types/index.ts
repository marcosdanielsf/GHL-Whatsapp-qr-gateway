/**
 * Shared TypeScript interfaces for GHL-Whatsapp-qr-gateway
 *
 * P2 Fix: centralizar tipos para eliminar `any` em caminhos críticos.
 */

// ─────────────────────────────────────────────
// Supabase DB rows (snake_case — retornados via RPC/select)
// ─────────────────────────────────────────────

/** Linha retornada pela RPC fetch_pending_jobs (snake_case) */
export interface MessageJobDB {
  id: number;
  instance_id: string;
  type: "text" | "image" | "audio";
  to_number: string;
  content: string;
  attempts: number;
  max_attempts: number;
}

/** Linha da tabela ghl_wa_message_history */
export interface MessageHistoryRow {
  id: number | string;
  instance_id: string;
  type: "inbound" | "outbound";
  from_number: string;
  to_number: string;
  content: string;
  status: "sent" | "received" | "failed" | "queued";
  timestamp: string;
  metadata: Record<string, unknown> | null;
}

// ─────────────────────────────────────────────
// GHL API types (camelCase — retornados pela API GHL)
// ─────────────────────────────────────────────

/** Registro de integração GHL (tabela ghl_wa_integrations) */
export interface GHLIntegration {
  id: string;
  tenant_id: string;
  location_id: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: string;
  scope: string;
  user_type: string;
  company_id: string;
  conversation_provider_id?: string;
  is_active?: boolean;
}

/** Contato GHL retornado pela API */
export interface GHLContact {
  id: string;
  locationId: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  tags?: string[];
}

/** Payload de webhook do GHL Custom Conversation Provider (outbound) */
export interface GHLOutboundWebhookBody {
  contactId: string;
  locationId: string;
  messageId: string;
  phone: string;
  message: string;
  attachments?: Array<{ url: string; type: string }>;
  // Campos adicionais opcionais presentes em alguns formatos
  instanceId?: string;
  type?: "text" | "image" | "audio";
  to?: string;
  mediaUrl?: string;
}

// ─────────────────────────────────────────────
// API Response types
// ─────────────────────────────────────────────

/** Resposta de erro padrão da API */
export interface ApiErrorResponse {
  success: false;
  error: string;
  message?: string;
}

/** Resposta de sucesso padrão da API */
export interface ApiSuccessResponse<T = Record<string, unknown>> {
  success: true;
  data?: T;
  message?: string;
}

/** Resposta genérica da API */
export type ApiResponse<T = Record<string, unknown>> =
  | ApiSuccessResponse<T>
  | ApiErrorResponse;
