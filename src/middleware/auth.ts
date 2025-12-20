import { createClient } from '@supabase/supabase-js';
import { Request, Response, NextFunction } from 'express';

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

// Extended Request interface to include user info
export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email?: string;
    role?: string;
  };
  tenantId?: string;
}

export const requireAuth = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Get extended user profile with tenant_id (attach user's JWT to honor RLS)
    const authed = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: userProfile, error: profileError } = await authed
      .from('ghl_wa_users')
      .select('tenant_id, role')
      .eq('id', user.id)
      .single();

    if (profileError || !userProfile) {
      // Fallback for initial setup or if profile doesn't exist yet
      console.warn(`User profile not found for ${user.id}`);
      req.user = { id: user.id, email: user.email };
      return next();
    }

    req.user = {
      id: user.id,
      email: user.email,
      role: userProfile.role
    };
    req.tenantId = userProfile.tenant_id;

    next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    res.status(500).json({ error: 'Internal server error during authentication' });
  }
};
