/**
 * GHL Service - Centralized GoHighLevel API interactions
 *
 * This service handles:
 * - Sending inbound messages to GHL Conversations API
 * - Updating message delivery status
 * - Token refresh when expired
 * - Contact lookup/creation
 */

import { getSupabaseClient } from "../infra/supabaseClient";
import { logger } from "../utils/logger";
import { getErrorMessage } from "../utils/error";
import type {
  GHLIntegration,
  GHLContact,
  GHLOutboundWebhookBody,
} from "../types";

// GHL API Base URL
const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-04-15";

// OAuth endpoints
const GHL_OAUTH_TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";

// Message status types
type MessageStatus = "delivered" | "read" | "failed";

// Local payload interfaces (not exported — internal to this service)
interface GHLCreateContactPayload {
  locationId: string;
  phone: string;
  source: string;
  firstName?: string;
  lastName?: string;
}

interface GHLConflictError {
  meta?: { contactId?: string };
}

interface GHLInboundMessagePayload {
  type: string;
  contactId: string;
  message: string;
  direction: string;
  date: string;
  conversationProviderId?: string;
}

// API Response types
interface GHLTokenRefreshResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

interface GHLContactSearchResponse {
  contacts: GHLContact[];
}

interface GHLContactCreateResponse {
  contact: GHLContact;
}

interface GHLInboundMessageResponse {
  messageId?: string;
  id?: string;
}

// Environment variables
const CLIENT_ID = process.env.GHL_CLIENT_ID;
const CLIENT_SECRET = process.env.GHL_CLIENT_SECRET;

/**
 * Get integration by location ID
 */
export async function getIntegrationByLocationId(
  locationId: string,
): Promise<GHLIntegration | null> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("ghl_wa_integrations")
    .select("*")
    .eq("location_id", locationId)
    .single();

  if (error || !data) {
    logger.warn("Integration not found for location", {
      locationId,
      error: error?.message,
    });
    return null;
  }

  return data as GHLIntegration;
}

/**
 * Get integration by tenant and instance
 */
export async function getIntegrationByTenantInstance(
  tenantId: string,
  instanceId: string,
): Promise<GHLIntegration | null> {
  const supabase = getSupabaseClient();

  // Extract raw instance name from scopedId (e.g. "tenant-wa-01" -> "wa-01")
  const rawInstanceName = instanceId.startsWith(tenantId + "-")
    ? instanceId.slice(tenantId.length + 1)
    : instanceId;

  // First, get the instance to find its integration ID (use name+tenant_id, not UUID id)
  const { data: instance, error: instanceError } = await supabase
    .from("ghl_wa_instances")
    .select("ghl_integration_id")
    .eq("name", rawInstanceName)
    .eq("tenant_id", tenantId)
    .single();

  if (instanceError || !instance?.ghl_integration_id) {
    // Fallback: try to find any integration for this tenant
    const { data: integration, error: integrationError } = await supabase
      .from("ghl_wa_integrations")
      .select("*")
      .eq("tenant_id", tenantId)
      .limit(1)
      .single();

    if (integrationError || !integration) {
      logger.warn("No integration found for tenant", { tenantId, instanceId });
      return null;
    }

    return integration as GHLIntegration;
  }

  // Get the integration by ID
  const { data: integration, error: integrationError } = await supabase
    .from("ghl_wa_integrations")
    .select("*")
    .eq("id", instance.ghl_integration_id)
    .single();

  if (integrationError || !integration) {
    logger.warn("Integration not found by ID", {
      integrationId: instance.ghl_integration_id,
    });
    return null;
  }

  return integration as GHLIntegration;
}

/**
 * Check if token is expired and refresh if needed
 */
export async function ensureValidToken(
  integration: GHLIntegration,
): Promise<string> {
  const expiresAt = new Date(integration.token_expires_at);
  const now = new Date();

  // If token expires in less than 5 minutes, refresh it
  const fiveMinutes = 5 * 60 * 1000;
  if (expiresAt.getTime() - now.getTime() < fiveMinutes) {
    logger.info("Token expiring soon, refreshing...", {
      locationId: integration.location_id,
    });
    return await refreshAccessToken(integration);
  }

  return integration.access_token;
}

/**
 * Refresh access token using refresh token
 */
export async function refreshAccessToken(
  integration: GHLIntegration,
): Promise<string> {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error("GHL_CLIENT_ID and GHL_CLIENT_SECRET must be configured");
  }

  try {
    const response = await fetch(GHL_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: integration.refresh_token,
        user_type: integration.user_type || "Location",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Token refresh failed: ${response.status} - ${errorText}`,
      );
    }

    const data = (await response.json()) as GHLTokenRefreshResponse;

    // Update tokens in database
    const supabase = getSupabaseClient();
    const { error: updateError } = await supabase
      .from("ghl_wa_integrations")
      .update({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        token_expires_at: new Date(
          Date.now() + data.expires_in * 1000,
        ).toISOString(),
      })
      .eq("id", integration.id);

    if (updateError) {
      logger.error("Failed to update tokens in database", {
        error: updateError.message,
      });
    }

    logger.info("Token refreshed successfully", {
      locationId: integration.location_id,
    });
    return data.access_token;
  } catch (error: unknown) {
    logger.error("Failed to refresh token", {
      locationId: integration.location_id,
      error: getErrorMessage(error),
    });
    throw error;
  }
}

/**
 * Search for contact by phone number in GHL
 */
export async function findContactByPhone(
  accessToken: string,
  locationId: string,
  phone: string,
): Promise<GHLContact | null> {
  try {
    // Normalize phone for search (GHL expects various formats)
    const searchPhone = phone.startsWith("+") ? phone : `+${phone}`;

    const response = await fetch(
      `${GHL_API_BASE}/contacts/search?locationId=${locationId}&query=${encodeURIComponent(searchPhone)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Version: GHL_API_VERSION,
          Accept: "application/json",
        },
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      logger.warn("Contact search failed", {
        locationId,
        phone,
        status: response.status,
        error: errorText,
      });
      return null;
    }

    const data = (await response.json()) as GHLContactSearchResponse;

    // Find contact with matching phone
    if (data.contacts && data.contacts.length > 0) {
      // Return first matching contact
      return data.contacts[0];
    }

    return null;
  } catch (error: unknown) {
    logger.error("Error searching contact", {
      locationId,
      phone,
      error: getErrorMessage(error),
    });
    return null;
  }
}

/**
 * Create a new contact in GHL
 */
export async function createContact(
  accessToken: string,
  locationId: string,
  phone: string,
  name?: string,
): Promise<GHLContact | null> {
  try {
    const contactData: GHLCreateContactPayload = {
      locationId,
      phone: phone.startsWith("+") ? phone : `+${phone}`,
      source: "WhatsApp Gateway",
    };

    // Add name if provided
    if (name) {
      const [firstName, ...lastParts] = name.split(" ");
      contactData.firstName = firstName;
      if (lastParts.length > 0) {
        contactData.lastName = lastParts.join(" ");
      }
    }

    const response = await fetch(`${GHL_API_BASE}/contacts/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Version: GHL_API_VERSION,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(contactData),
    });

    if (!response.ok) {
      const errorBody = (await response
        .json()
        .catch(() => null)) as GHLConflictError | null;
      // GHL retorna 400 com contactId quando contato já existe (duplicado)
      if (response.status === 400 && errorBody?.meta?.contactId) {
        logger.info("Contact already exists, reusing", {
          locationId,
          phone,
          contactId: errorBody.meta.contactId,
        });
        return { id: errorBody.meta.contactId, phone, locationId };
      }
      logger.error("Failed to create contact", {
        locationId,
        phone,
        status: response.status,
        error: JSON.stringify(errorBody),
      });
      return null;
    }

    const data = (await response.json()) as GHLContactCreateResponse;
    logger.info("Contact created successfully", {
      locationId,
      phone,
      contactId: data.contact?.id,
    });
    return data.contact;
  } catch (error: unknown) {
    logger.error("Error creating contact", {
      locationId,
      phone,
      error: getErrorMessage(error),
    });
    return null;
  }
}

/**
 * Get or create contact by phone
 */
export async function getOrCreateContact(
  accessToken: string,
  locationId: string,
  phone: string,
  name?: string,
): Promise<GHLContact | null> {
  // First, try to find existing contact
  let contact = await findContactByPhone(accessToken, locationId, phone);

  if (!contact) {
    // Create new contact
    contact = await createContact(accessToken, locationId, phone, name);
  }

  return contact;
}

/**
 * Send inbound message to GHL Conversations API
 * This is called when a message is received from WhatsApp
 */
export async function sendInboundMessage(
  integration: GHLIntegration,
  contactId: string,
  message: string,
  timestamp?: Date,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    // Ensure we have a valid token
    const accessToken = await ensureValidToken(integration);

    // Check if conversation provider is configured
    if (!integration.conversation_provider_id) {
      logger.warn("Conversation Provider ID not configured", {
        locationId: integration.location_id,
      });
      // Continue without it for now - some setups might not need it
    }

    const payload: GHLInboundMessagePayload = {
      type: "Custom", // Use Custom for WhatsApp via Custom Provider
      contactId,
      message,
      direction: "inbound",
      date: (timestamp || new Date()).toISOString(),
    };

    // Add conversation provider ID if available
    if (integration.conversation_provider_id) {
      payload.conversationProviderId = integration.conversation_provider_id;
    }

    const response = await fetch(
      `${GHL_API_BASE}/conversations/messages/inbound`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Version: GHL_API_VERSION,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      logger.error("Failed to send inbound message to GHL", {
        locationId: integration.location_id,
        contactId,
        status: response.status,
        error: errorText,
      });
      return { success: false, error: errorText };
    }

    const data = (await response.json()) as GHLInboundMessageResponse;

    logger.info("Inbound message sent to GHL successfully", {
      locationId: integration.location_id,
      contactId,
      messageId: data.messageId || data.id,
    });

    return {
      success: true,
      messageId: data.messageId || data.id,
    };
  } catch (error: unknown) {
    const msg = getErrorMessage(error);
    logger.error("Error sending inbound message to GHL", {
      locationId: integration.location_id,
      contactId,
      error: msg,
    });
    return { success: false, error: msg };
  }
}

/**
 * Update message delivery status in GHL
 */
export async function updateMessageStatus(
  integration: GHLIntegration,
  messageId: string,
  status: MessageStatus,
): Promise<boolean> {
  try {
    const accessToken = await ensureValidToken(integration);

    const response = await fetch(
      `${GHL_API_BASE}/conversations/messages/${messageId}/status`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Version: GHL_API_VERSION,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ status }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      logger.error("Failed to update message status", {
        messageId,
        status,
        error: errorText,
      });
      return false;
    }

    logger.info("Message status updated", { messageId, status });
    return true;
  } catch (error: unknown) {
    logger.error("Error updating message status", {
      messageId,
      status,
      error: getErrorMessage(error),
    });
    return false;
  }
}

/**
 * Handle outbound message from GHL (Custom Provider format)
 * This is called when GHL wants to send a message through our WhatsApp gateway
 */
export interface GHLOutboundMessage {
  contactId: string;
  locationId: string;
  messageId: string;
  phone: string;
  message: string;
  attachments?: Array<{
    url: string;
    type: string;
  }>;
}

/**
 * Validate and parse GHL Custom Provider outbound webhook
 */
export function parseGHLOutboundWebhook(
  body: unknown,
): GHLOutboundMessage | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;

  const str = (v: unknown): string => (v ? String(v) : "");
  const attachments = Array.isArray(b.attachments)
    ? (b.attachments as Array<{ url: string; type: string }>)
    : undefined;

  // Check for Custom Provider format
  if (b.contactId && b.locationId && b.messageId) {
    return {
      contactId: str(b.contactId),
      locationId: str(b.locationId),
      messageId: str(b.messageId),
      phone: str(b.phone || b.to),
      message: str(b.message || b.text || b.body),
      attachments,
    };
  }

  // Check for simple format (backwards compatibility)
  if (b.to && b.message) {
    return {
      contactId: str(b.contactId),
      locationId: str(b.locationId),
      messageId: str(b.messageId) || `msg_${Date.now()}`,
      phone: str(b.to),
      message: str(b.message),
      attachments,
    };
  }

  return null;
}

/**
 * Get contact by ID from GHL
 * Used to fetch the real phone number when the webhook only provides contactId
 */
export async function getContactById(
  accessToken: string,
  contactId: string,
): Promise<GHLContact | null> {
  try {
    const response = await fetch(`${GHL_API_BASE}/contacts/${contactId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Version: GHL_API_VERSION,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      logger.warn("getContactById failed", {
        contactId,
        status: response.status,
      });
      return null;
    }

    const data = (await response.json()) as { contact?: GHLContact };
    return data.contact ?? null;
  } catch (error: unknown) {
    logger.error("Error getting contact by ID", {
      contactId,
      error: getErrorMessage(error),
    });
    return null;
  }
}

export const ghlService = {
  getIntegrationByLocationId,
  getIntegrationByTenantInstance,
  ensureValidToken,
  refreshAccessToken,
  findContactByPhone,
  getContactById,
  createContact,
  getOrCreateContact,
  sendInboundMessage,
  updateMessageStatus,
  parseGHLOutboundWebhook,
};
