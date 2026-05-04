import { supabase } from '../lib/supabase';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

async function agentRequest<T>(path: string, options?: RequestInit): Promise<T> {
  let { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    const { data: refreshed } = await supabase.auth.refreshSession();
    session = refreshed.session;
  }
  const token = session?.access_token;

  const isFormData = options?.body instanceof FormData;

  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      'ngrok-skip-browser-warning': 'true',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers || {}),
    },
    ...options,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || data.message || 'Erro desconhecido');
  }
  return data as T;
}

// ── Types ──────────────────────────────────────────────────────────────

export interface Agent {
  id: string;
  name: string;
  status: 'active' | 'inactive' | 'paused';
  instance_id: string;
  provider: 'openai' | 'anthropic' | 'google' | 'groq' | 'grok' | 'openrouter';
  model: string;
  system_prompt: string;
  temperature: number;
  max_tokens: number;
  context_window_msgs: number;
  summarize_after_msgs: number;
  followup_enabled: boolean;
  followup_hours: number;
  followup_max_times: number;
  followup_message: string;
  timezone: string;
  out_of_hours_message: string;
  rag_enabled: boolean;
  rag_top_k: number;
  created_at: string;
  updated_at: string;
  // computed by backend
  active_conversations?: number;
  msgs_today?: number;
  response_rate?: number;
  tokens_today?: number;
}

export interface AgentDocument {
  id: string;
  agent_id: string;
  file_name: string;
  file_size_bytes: number;
  mime_type: string;
  status: 'processing' | 'ready' | 'error' | 'outdated';
  chunk_count: number | null;
  created_at: string;
  error_message?: string;
}

export interface DocumentChunkPreview {
  chunk_index: number;
  content: string;
}

export interface AgentTool {
  id: string;
  agent_id: string;
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  webhook_url: string;
  timeout_seconds: number;
  is_enabled: boolean;
  consecutive_failures: number;
  circuit_open: boolean;
  last_failure_at: string | null;
  created_at: string;
  // computed
  call_count?: number;
  success_rate?: number;
}

export interface BusinessHourRow {
  id?: string;
  day_of_week: number; // 0=Sun, 1=Mon ... 6=Sat
  is_closed: boolean;
  open_time: string | null;  // "HH:MM"
  close_time: string | null; // "HH:MM"
}

export interface AgentConversation {
  id: string;
  agent_id: string;
  contact_phone: string;
  status: 'active' | 'closed' | 'taken_over';
  message_count: number;
  last_user_msg_at: string | null;
  last_agent_msg_at: string | null;
  followup_count: number;
  created_at: string;
  // computed preview
  last_message_preview?: string;
  tokens_used?: number;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  tokens_in?: number;
  tokens_out?: number;
  tools_called?: string[];
  rag_hits?: number;
}

export interface ConversationDetail extends AgentConversation {
  messages: ConversationMessage[];
  total_tokens_in: number;
  total_tokens_out: number;
  total_tools_called: number;
  total_rag_hits: number;
}

export interface PlaygroundResponse {
  response: string;
  rag_hits: Array<{
    document_name: string;
    chunk_content_preview: string;
    similarity: number;
  }>;
  tools_called: Array<{
    tool_name: string;
    args: Record<string, unknown>;
    result: string;
    duration_ms: number;
  }>;
  tokens: { input: number; output: number };
  latency_ms: number;
}

export interface CreateAgentPayload {
  name: string;
  instance_id: string;
  provider: Agent['provider'];
  model: string;
  system_prompt: string;
  temperature: number;
  max_tokens: number;
  context_window_msgs: number;
  summarize_after_msgs: number;
  followup_enabled: boolean;
  followup_hours: number;
  followup_max_times: number;
  followup_message: string;
  timezone: string;
  out_of_hours_message: string;
  rag_enabled: boolean;
  rag_top_k: number;
}

export interface CreateToolPayload {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  webhook_url: string;
  webhook_secret?: string;
  timeout_seconds: number;
}

// ── API functions ──────────────────────────────────────────────────────

export const agentApi = {
  // Agents
  listAgents(): Promise<{ agents: Agent[] }> {
    return agentRequest('/api/agents');
  },

  getAgent(id: string): Promise<{ agent: Agent }> {
    return agentRequest(`/api/agents/${id}`);
  },

  createAgent(payload: CreateAgentPayload): Promise<{ agent: Agent }> {
    return agentRequest('/api/agents', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateAgent(id: string, payload: Partial<CreateAgentPayload>): Promise<{ agent: Agent }> {
    return agentRequest(`/api/agents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  deleteAgent(id: string): Promise<{ ok: boolean }> {
    return agentRequest(`/api/agents/${id}`, { method: 'DELETE' });
  },

  activateAgent(id: string): Promise<{ ok: boolean }> {
    return agentRequest(`/api/agents/${id}/activate`, { method: 'POST' });
  },

  pauseAgent(id: string): Promise<{ ok: boolean }> {
    return agentRequest(`/api/agents/${id}/pause`, { method: 'POST' });
  },

  // Playground
  playground(
    id: string,
    message: string,
    contact_phone = '+playground',
  ): Promise<PlaygroundResponse> {
    return agentRequest(`/api/agents/${id}/playground`, {
      method: 'POST',
      body: JSON.stringify({ message, contact_phone }),
    });
  },

  // Documents
  listDocuments(agentId: string): Promise<{ documents: AgentDocument[] }> {
    return agentRequest(`/api/agents/${agentId}/documents`);
  },

  uploadDocument(agentId: string, file: File): Promise<{ document: AgentDocument }> {
    const form = new FormData();
    form.append('file', file);
    return agentRequest(`/api/agents/${agentId}/documents`, {
      method: 'POST',
      body: form,
    });
  },

  deleteDocument(agentId: string, docId: string): Promise<{ ok: boolean }> {
    return agentRequest(`/api/agents/${agentId}/documents/${docId}`, {
      method: 'DELETE',
    });
  },

  getDocumentChunks(
    agentId: string,
    docId: string,
  ): Promise<{ chunks: DocumentChunkPreview[] }> {
    return agentRequest(`/api/agents/${agentId}/documents/${docId}/chunks`);
  },

  // Tools
  listTools(agentId: string): Promise<{ tools: AgentTool[] }> {
    return agentRequest(`/api/agents/${agentId}/tools`);
  },

  createTool(agentId: string, payload: CreateToolPayload): Promise<{ tool: AgentTool }> {
    return agentRequest(`/api/agents/${agentId}/tools`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateTool(
    agentId: string,
    toolId: string,
    payload: Partial<CreateToolPayload & { is_enabled: boolean }>,
  ): Promise<{ tool: AgentTool }> {
    return agentRequest(`/api/agents/${agentId}/tools/${toolId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  deleteTool(agentId: string, toolId: string): Promise<{ ok: boolean }> {
    return agentRequest(`/api/agents/${agentId}/tools/${toolId}`, {
      method: 'DELETE',
    });
  },

  resetCircuitBreaker(agentId: string, toolId: string): Promise<{ ok: boolean }> {
    return agentRequest(`/api/agents/${agentId}/tools/${toolId}/reset-breaker`, {
      method: 'POST',
    });
  },

  // Business hours
  getBusinessHours(agentId: string): Promise<{ hours: BusinessHourRow[] }> {
    return agentRequest(`/api/agents/${agentId}/business-hours`);
  },

  updateBusinessHours(
    agentId: string,
    hours: BusinessHourRow[],
  ): Promise<{ hours: BusinessHourRow[] }> {
    return agentRequest(`/api/agents/${agentId}/business-hours`, {
      method: 'PUT',
      body: JSON.stringify({ hours }),
    });
  },

  // Conversations
  listConversations(
    agentId: string,
    params?: { status?: string; limit?: number },
  ): Promise<{ conversations: AgentConversation[] }> {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.limit) qs.set('limit', String(params.limit));
    return agentRequest(`/api/agents/${agentId}/conversations?${qs.toString()}`);
  },

  getConversation(
    agentId: string,
    convId: string,
  ): Promise<{ conversation: ConversationDetail }> {
    return agentRequest(`/api/agents/${agentId}/conversations/${convId}`);
  },

  takeover(agentId: string, convId: string): Promise<{ ok: boolean }> {
    return agentRequest(`/api/agents/${agentId}/conversations/${convId}/takeover`, {
      method: 'POST',
    });
  },

  /** SSE stream — returns unsubscribe fn */
  getConversationStream(
    agentId: string,
    convId: string,
    onUpdate: (msg: ConversationMessage) => void,
  ): () => void {
    const url = `${API_BASE_URL}/api/agents/${agentId}/conversations/${convId}/stream`;
    const es = new EventSource(url);
    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as ConversationMessage;
        onUpdate(msg);
      } catch {
        // ignore malformed
      }
    };
    return () => es.close();
  },
};
