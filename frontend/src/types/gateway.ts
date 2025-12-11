export type ConnectionStatus = 'ONLINE' | 'OFFLINE' | 'RECONNECTING';

export interface QRResponse {
  success: boolean;
  instanceId: string;
  status: ConnectionStatus | string;
  qr?: string;
  message?: string;
  error?: string;
}

export interface StatusResponse {
  success: boolean;
  instanceId: string;
  status: ConnectionStatus | string;
  connectedNumber?: string;
}

export interface InstanceSummary {
  instanceId: string;
  status: ConnectionStatus | string;
  phone: string | null;
  lastConnectedAt: string | null;
  lastError: string | null;
  phoneAlias?: string;
  hasQR?: boolean;
}

export interface InstancesResponse {
  success: boolean;
  instances: InstanceSummary[];
}

export interface LogoutResponse {
  success: boolean;
  message: string;
}

export interface ClearResponse {
  success: boolean;
  message: string;
}

export type SendMessagePayload =
  | {
      instanceId: string;
      to: string;
      type: 'text';
      message: string;
      mediaUrl?: never;
    }
  | {
      instanceId: string;
      to: string;
      type: 'image';
      mediaUrl: string;
      message?: never;
    };

export interface SendResponse {
  success: boolean;
  message: string;
  instanceId: string;
  type: 'text' | 'image';
  jobId: string;
  status: string;
}

export interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  total: number;
}

export interface MessageHistory {
  id: string;
  instanceId?: string;
  from?: string;
  to?: string;
  text?: string;
  type: 'inbound' | 'outbound';
  timestamp: number;
  status?: 'sent' | 'received' | 'failed' | 'queued';
}

export interface OutboundMessage {
  locationId?: string;
  contactId?: string;
  phone: string;
  message: string;
  timestamp: number;
  status: 'queued' | 'sent' | 'failed';
}

export interface InboundMessage {
  instanceId: string;
  from: string;
  text: string;
  timestamp: number;
}

