import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Flag to check if Supabase is properly configured
export const isSupabaseConfigured = !!(supabaseUrl && supabaseAnonKey);

// Create a real or placeholder Supabase client
let supabaseClient: SupabaseClient;

if (isSupabaseConfigured) {
    supabaseClient = createClient(supabaseUrl!, supabaseAnonKey!);
} else {
    // Create a placeholder client that will allow the app to load
    // but operations will fail gracefully
    console.warn('Supabase environment variables are not configured. Running in demo mode only.');
    supabaseClient = createClient(
        'https://placeholder.supabase.co',
        'placeholder-key'
    );
}

export const supabase = supabaseClient;

// Types for our database
export interface Tenant {
    id: string;
    name: string;
    slug: string;
    subscription_status: 'trial' | 'active' | 'canceled' | 'past_due';
    subscription_plan: 'starter' | 'professional' | 'enterprise';
    max_instances: number;
    trial_ends_at: string | null;
    created_at: string;
}

export interface User {
    id: string;
    tenant_id: string;
    email: string;
    role: 'owner' | 'admin' | 'member';
    created_at: string;
}
