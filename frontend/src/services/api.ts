import type {
  InstancesResponse,
  LogoutResponse,
  QRResponse,
  QueueStats,
  SendMessagePayload,
  SendResponse,
  StatusResponse,
} from '../types/gateway';

import { supabase } from '../lib/supabase';

// Usar rutas relativas cuando no hay VITE_API_BASE_URL configurado
// Esto permite que funcione tanto en localhost como en ngrok
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': 'true',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...(options?.headers || {}),
    },
    ...options,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
       // Optional: Trigger logout or redirect
       console.error("Unauthorized request");
    }
    throw new Error(data.error || data.message || 'Error desconocido en el Gateway');
  }
  // Permitir success: false para endpoints de check (como qr-check)
  if (data.success === false && !path.includes('/qr-check')) {
    throw new Error(data.error || data.message || 'Error desconocido en el Gateway');
  }
  return data as T;
}

async function requestOptional<T>(path: string, options?: RequestInit): Promise<T | null> {
  try {
    return await request<T>(path, options);
  } catch {
    return null;
  }
}

export const api = {
  getAvailableInstances: (): Promise<{
    success: boolean;
    available: string[];
    total: number;
    used: number;
  }> => {
    return request('/api/wa/instances/available');
  },
  getInstances: (): Promise<InstancesResponse> => {
    return request('/api/wa/instances');
  },
  createInstance(instanceId: string, phoneAlias?: string, forceNew?: boolean): Promise<{
    success: boolean;
    instanceId: string;
    phoneAlias?: string;
    status: string;
    message: string;
  }> {
    return request('/api/wa/instances', {
      method: 'POST',
      body: JSON.stringify({ instanceId, phoneAlias, forceNew }),
    });
  },
  generateQr(instanceId: string): Promise<QRResponse> {
    return request(`/api/wa/qr/${instanceId}`);
  },
  async checkQr(instanceId: string): Promise<QRResponse | null> {
    const response = await fetch(`${API_BASE_URL}/api/wa/qr-check/${instanceId}`, {
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    const data = await response.json().catch(() => ({}));
    
    // Si success es false, significa que no hay QR aún (no es un error)
    if (!response.ok || (data.success === false && !data.qr)) {
      return null;
    }
    
    return data as QRResponse;
  },
  getStatus(instanceId: string): Promise<StatusResponse> {
    return request(`/api/wa/status/${instanceId}`);
  },
  logoutInstance(instanceId: string): Promise<LogoutResponse> {
    return request(`/api/wa/logout/${instanceId}`, { method: 'POST' });
  },
  clearInstance(instanceId: string): Promise<LogoutResponse> {
    return request(`/api/wa/clear/${instanceId}`, { method: 'POST' });
  },
  async listInstances(): Promise<{
    instances: InstancesResponse['instances'];
    queueStats: QueueStats | null;
  }> {
    const [instancesResponse, queueStats] = await Promise.all([
      request<InstancesResponse>('/api/wa/instances'),
      requestOptional<{ success: boolean; stats: QueueStats }>('/api/send/stats'),
    ]);

    return {
      instances: instancesResponse.instances,
      queueStats: queueStats?.stats ?? null,
    };
  },
  sendMessage(payload: SendMessagePayload): Promise<SendResponse> {
    return request('/api/send', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  getMessageHistory(options?: {
    instanceId?: string;
    type?: 'inbound' | 'outbound';
    limit?: number;
    since?: number;
  }): Promise<{
    success: boolean;
    messages: Array<{
      id: string;
      instanceId: string;
      type: 'inbound' | 'outbound';
      from?: string;
      to?: string;
      text: string;
      timestamp: number;
      status: 'sent' | 'received' | 'failed' | 'queued';
    }>;
    stats: {
      total: number;
      inbound: number;
      outbound: number;
      sent: number;
      received: number;
      failed: number;
    };
    count: number;
  }> {
    const params = new URLSearchParams();
    if (options?.instanceId) params.append('instanceId', options.instanceId);
    if (options?.type) params.append('type', options.type);
    if (options?.limit) params.append('limit', options.limit.toString());
    if (options?.since) params.append('since', options.since.toString());
    
    return request(`/api/messages/history?${params.toString()}`);
  },
};


