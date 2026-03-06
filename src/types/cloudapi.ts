/**
 * Types for Meta WhatsApp Cloud API integration
 */

// ─────────────────────────────────────────────
// Webhook payload (incoming from Meta)
// ─────────────────────────────────────────────

export interface MetaWebhookPayload {
  object: "whatsapp_business_account";
  entry: MetaWebhookEntry[];
}

export interface MetaWebhookEntry {
  id: string; // WABA ID
  changes: MetaWebhookChange[];
}

export interface MetaWebhookChange {
  value: MetaWebhookValue;
  field: "messages";
}

export interface MetaWebhookValue {
  messaging_product: "whatsapp";
  metadata: {
    display_phone_number: string;
    phone_number_id: string;
  };
  contacts?: MetaWebhookContact[];
  messages?: MetaWebhookMessage[];
  statuses?: MetaWebhookStatus[];
}

export interface MetaWebhookContact {
  profile: { name: string };
  wa_id: string;
}

export interface MetaWebhookMessage {
  from: string;
  id: string; // wamid.xxx
  timestamp: string;
  type:
    | "text"
    | "image"
    | "document"
    | "audio"
    | "video"
    | "location"
    | "contacts"
    | "interactive"
    | "button"
    | "reaction";
  text?: { body: string };
  image?: { id: string; mime_type: string; sha256: string; caption?: string };
  document?: {
    id: string;
    mime_type: string;
    sha256: string;
    filename?: string;
    caption?: string;
  };
  audio?: { id: string; mime_type: string };
  video?: { id: string; mime_type: string; caption?: string };
  location?: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  };
  button?: { text: string; payload: string };
  interactive?: {
    type: string;
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string };
  };
  context?: { from: string; id: string }; // reply context
}

export interface MetaWebhookStatus {
  id: string;
  status: "sent" | "delivered" | "read" | "failed";
  timestamp: string;
  recipient_id: string;
  conversation?: {
    id: string;
    origin: { type: string }; // service, marketing, utility, authentication
    expiration_timestamp?: string;
  };
  pricing?: {
    billable: boolean;
    pricing_model: string;
    category: string;
  };
  errors?: Array<{ code: number; title: string; message: string }>;
}

// ─────────────────────────────────────────────
// Send message (outgoing to Meta)
// ─────────────────────────────────────────────

export interface CloudAPISendTextRequest {
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to: string;
  type: "text";
  text: { preview_url?: boolean; body: string };
}

export interface CloudAPISendTemplateRequest {
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to: string;
  type: "template";
  template: {
    name: string;
    language: { code: string };
    components?: CloudAPITemplateComponent[];
  };
}

export interface CloudAPITemplateComponent {
  type: "header" | "body" | "button";
  parameters: CloudAPITemplateParameter[];
  sub_type?: "quick_reply" | "url";
  index?: number;
}

export interface CloudAPITemplateParameter {
  type: "text" | "image" | "document" | "video";
  text?: string;
  image?: { link: string };
  document?: { link: string; filename: string };
}

export interface CloudAPISendImageRequest {
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to: string;
  type: "image";
  image: { link: string; caption?: string };
}

export type CloudAPISendRequest =
  | CloudAPISendTextRequest
  | CloudAPISendTemplateRequest
  | CloudAPISendImageRequest;

export interface CloudAPISendResponse {
  messaging_product: "whatsapp";
  contacts: Array<{ input: string; wa_id: string }>;
  messages: Array<{ id: string }>;
}

// ─────────────────────────────────────────────
// Routing table (Supabase)
// ─────────────────────────────────────────────

export interface WhatsAppRouting {
  id: string;
  location_id: string;
  phone_number: string;
  phone_number_id: string | null;
  waba_id: string | null;
  display_name: string | null;
  access_token: string | null;
  n8n_webhook_url: string | null;
  is_cloud_api: boolean;
  is_active: boolean;
  meta_verify_token: string | null;
  meta_app_secret: string | null;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
}
