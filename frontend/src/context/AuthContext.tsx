import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import type { Tenant, User } from '../lib/supabase';

interface AuthContextType {
    user: SupabaseUser | null;
    tenant: Tenant | null;
    userProfile: User | null;
    loading: boolean;
    signUp: (email: string, password: string, tenantName: string) => Promise<void>;
    signIn: (email: string, password: string) => Promise<void>;
    signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<SupabaseUser | null>(null);
    const [tenant, setTenant] = useState<Tenant | null>(null);
    const [userProfile, setUserProfile] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Check active session
        supabase.auth.getSession().then(({ data: { session } }) => {
            setUser(session?.user ?? null);
            if (session?.user) {
                loadUserData(session.user.id);
            } else {
                setLoading(false);
            }
        });

        // Listen for auth changes
        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, session) => {
            setUser(session?.user ?? null);
            if (session?.user) {
                loadUserData(session.user.id);
            } else {
                setTenant(null);
                setUserProfile(null);
                setLoading(false);
            }
        });

        return () => subscription.unsubscribe();
    }, []);

    const loadUserData = async (userId: string) => {
        try {
            // Get user profile
            const { data: profile } = await supabase
                .from('ghl_wa_users')
                .select('*')
                .eq('id', userId)
                .single();

            if (profile) {
                setUserProfile(profile);

                // Get tenant
                const { data: tenantData } = await supabase
                    .from('ghl_wa_tenants')
                    .select('*')
                    .eq('id', profile.tenant_id)
                    .single();

                setTenant(tenantData);
            }
        } catch (error) {
            console.error('Error loading user data:', error);
        } finally {
            setLoading(false);
        }
    };

    const signUp = async (email: string, password: string, tenantName: string) => {
        const { data: authData, error: authError } = await supabase.auth.signUp({
            email,
            password,
        });

        if (authError) throw authError;
        if (!authData.user) throw new Error('No user returned from signup');

        // Create tenant and user profile via RPC
        const slug = tenantName.toLowerCase().replace(/[^a-z0-9]+/g, '-');

        const { error: rpcError } = await supabase.rpc('create_tenant_with_user', {
            p_tenant_name: tenantName,
            p_tenant_slug: slug,
            p_user_email: email,
            p_user_id: authData.user.id,
        });

        if (rpcError) throw rpcError;
    };

    const signIn = async (email: string, password: string) => {
        // Mock login for preview mode
        if (email === 'demo@example.com' && password === 'demo123') {
            const mockUser: any = {
                id: 'mock-user-id',
                email: 'demo@example.com',
                aud: 'authenticated',
                created_at: new Date().toISOString(),
            };
            setUser(mockUser);
            setUserProfile({
                id: 'mock-user-id',
                email: 'demo@example.com',
                tenant_id: 'mock-tenant-id',
                role: 'owner',
                created_at: new Date().toISOString()
            });
            setTenant({
                id: 'mock-tenant-id',
                name: 'Demo Company',
                slug: 'demo-company',
                subscription_status: 'active',
                subscription_plan: 'enterprise',
                max_instances: 5,
                trial_ends_at: null,
                created_at: new Date().toISOString()
            });
            return;
        }

        const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });

        if (error) throw error;
    };

    const signOut = async () => {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
    };

    return (
        <AuthContext.Provider
            value={{
                user,
                tenant,
                userProfile,
                loading,
                signUp,
                signIn,
                signOut,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
