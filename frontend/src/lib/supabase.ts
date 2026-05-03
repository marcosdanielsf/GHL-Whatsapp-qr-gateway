import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Types for our database
export type WebhookEvent =
    | 'message_received'
    | 'message_sent'
    | 'message_failed'
    | 'instance_connected'
    | 'instance_disconnected'
    | 'qr_generated';

export interface Tenant {
    id: string;
    name: string;
    slug: string;
    subscription_status: 'trial' | 'active' | 'canceled' | 'past_due';
    subscription_plan: 'starter' | 'professional' | 'enterprise';
    max_instances: number;
    trial_ends_at: string | null;
    created_at: string;
    webhook_url?: string | null;
    webhook_secret?: string | null;
    webhook_events?: WebhookEvent[];
}

export interface User {
    id: string;
    tenant_id: string;
    email: string;
    role: 'owner' | 'admin' | 'member';
    created_at: string;
}
