import { supabase } from '../lib/supabase';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

async function campaignRequest<T>(path: string, options?: RequestInit): Promise<T> {
  let { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    const { data: refreshed } = await supabase.auth.refreshSession();
    session = refreshed.session;
  }
  const token = session?.access_token;

  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
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

export interface Campaign {
  id: string;
  name: string;
  status: 'draft' | 'scheduled' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  instance_id: string;
  base_message: string;
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  replied_count: number;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  delay_min_seconds: number;
  delay_max_seconds: number;
  batch_size: number;
  audience_source: string;
}

export interface CampaignRecipient {
  id: string;
  campaign_id: string;
  phone: string;
  name: string | null;
  status: 'queued' | 'sent' | 'failed' | 'replied' | 'skipped' | 'opted_out';
  variant_id: string | null;
  variant_index: number | null;
  sent_at: string | null;
  failed_at: string | null;
  fail_reason: string | null;
  text_sent?: string;
  updated_at: string;
}

export interface CreateCampaignPayload {
  name: string;
  instance_id: string;
  base_message: string;
  variants: string[];
  audience_source: 'csv' | 'ghl_tag' | 'manual';
  recipients: Array<{ phone: string; name?: string }>;
  send_immediately: boolean;
  scheduled_at?: string;
  delay_min_seconds: number;
  delay_max_seconds: number;
  batch_size: number;
  batch_delay_min_seconds: number;
  batch_delay_max_seconds: number;
}

export const campaignApi = {
  listCampaigns(status?: string, limit = 20): Promise<{ campaigns: Campaign[] }> {
    const params = new URLSearchParams();
    if (status) params.append('status', status);
    params.append('limit', String(limit));
    return campaignRequest(`/api/campaigns?${params.toString()}`);
  },

  getCampaign(id: string): Promise<{ campaign: Campaign; recipients: CampaignRecipient[] }> {
    return campaignRequest(`/api/campaigns/${id}`);
  },

  createCampaign(data: CreateCampaignPayload): Promise<{ campaign: Campaign }> {
    return campaignRequest('/api/campaigns', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  generateVariants(template: string): Promise<{ variants: string[]; token_cost: number }> {
    return campaignRequest('/api/campaigns/generate-variants', {
      method: 'POST',
      body: JSON.stringify({ template }),
    });
  },

  startCampaign(id: string): Promise<{ success: boolean }> {
    return campaignRequest(`/api/campaigns/${id}/start`, { method: 'POST' });
  },

  pauseCampaign(id: string): Promise<{ success: boolean }> {
    return campaignRequest(`/api/campaigns/${id}/pause`, { method: 'POST' });
  },

  resumeCampaign(id: string): Promise<{ success: boolean }> {
    return campaignRequest(`/api/campaigns/${id}/resume`, { method: 'POST' });
  },

  cancelCampaign(id: string): Promise<{ success: boolean }> {
    return campaignRequest(`/api/campaigns/${id}/cancel`, { method: 'POST' });
  },

  getAIKeyStatus(): Promise<{ provider: string; model: string; has_key: boolean }> {
    return campaignRequest('/api/settings/ai-keys');
  },

  saveAIKey(api_key: string, model?: string): Promise<{ success: boolean }> {
    return campaignRequest('/api/settings/ai-keys', {
      method: 'POST',
      body: JSON.stringify({ api_key, model }),
    });
  },

  deleteAIKey(): Promise<{ success: boolean }> {
    return campaignRequest('/api/settings/ai-keys', { method: 'DELETE' });
  },

  getCampaignStream(
    id: string,
    onUpdate: (data: Partial<Campaign> & { recipients?: CampaignRecipient[] }) => void,
    onError?: (err: Event) => void
  ): () => void {
    const getToken = async () => {
      let { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        const { data: refreshed } = await supabase.auth.refreshSession();
        session = refreshed.session;
      }
      return session?.access_token ?? '';
    };

    let es: EventSource | null = null;
    let closed = false;

    getToken().then((token) => {
      if (closed) return;
      const url = `${API_BASE_URL}/api/campaigns/${id}/stream?token=${encodeURIComponent(token)}`;
      es = new EventSource(url);
      es.onmessage = (e) => {
        try {
          const parsed = JSON.parse(e.data);
          onUpdate(parsed);
        } catch {
          // ignore parse errors
        }
      };
      es.onerror = (err) => {
        onError?.(err);
      };
    });

    return () => {
      closed = true;
      es?.close();
    };
  },
};
