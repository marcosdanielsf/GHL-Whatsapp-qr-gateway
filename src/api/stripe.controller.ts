import { Router, Request, Response } from 'express';
import { createCheckoutSession, createPortalSession } from '../services/stripe';
import { getSupabaseClient } from '../infra/supabaseClient';
import { logger } from '../utils/logger';

export const stripeRouter = Router();

// Middleware to get tenantId from authenticated user
// Assuming auth middleware puts user in req.user or similar, but here we'll fetch from Supabase auth header
const requireAuth = async (req: Request, res: Response, next: Function) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }

  const token = authHeader.replace('Bearer ', '');
  const supabase = getSupabaseClient();

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) throw new Error('Invalid token');

    // Get tenant_id for user
    const { data: userData, error: userError } = await supabase
      .from('ghl_wa_users')
      .select('tenant_id')
      .eq('id', user.id)
      .single();

    if (userError || !userData) throw new Error('User not associated with a tenant');

    (req as any).user = user;
    (req as any).tenantId = userData.tenant_id;
    next();
  } catch (error: any) {
    logger.error('Auth error in stripe controller', error);
    res.status(401).json({ error: 'Unauthorized' });
  }
};

stripeRouter.post('/checkout', requireAuth, async (req: Request, res: Response) => {
  try {
    const { priceId } = req.body;
    const tenantId = (req as any).tenantId;
    const user = (req as any).user;

    if (!priceId) {
      return res.status(400).json({ error: 'Missing priceId' });
    }

    // Map friendly names to IDs from env
    let actualPriceId = priceId;
    if (priceId === 'pro') actualPriceId = process.env.STRIPE_PRICE_ID_PRO;
    if (priceId === 'enterprise') actualPriceId = process.env.STRIPE_PRICE_ID_ENTERPRISE;

    if (!actualPriceId) {
        logger.error('Invalid priceId or missing env var', { priceId });
        return res.status(400).json({ error: 'Invalid plan selected' });
    }

    // Get tenant info to see if they already have a customerId
    const supabase = getSupabaseClient();
    const { data: tenant } = await supabase
      .from('ghl_wa_tenants')
      .select('stripe_customer_id')
      .eq('id', tenantId)
      .single();

    const customerId = tenant?.stripe_customer_id;
    
    // Construct return URLs based on origin
    const origin = req.headers.origin || 'http://localhost:5173';
    const successUrl = `${origin}/settings?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${origin}/settings`;

    const session = await createCheckoutSession(
      actualPriceId,
      customerId,
      tenantId,
      successUrl,
      cancelUrl
    );

    res.json({ url: session.url });
  } catch (error: any) {
    logger.error('Error creating checkout session', error);
    res.status(500).json({ error: error.message });
  }
});

stripeRouter.post('/portal', requireAuth, async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    
    const supabase = getSupabaseClient();
    const { data: tenant } = await supabase
      .from('ghl_wa_tenants')
      .select('stripe_customer_id')
      .eq('id', tenantId)
      .single();

    if (!tenant?.stripe_customer_id) {
      return res.status(400).json({ error: 'No Stripe customer found for this tenant' });
    }

    const origin = req.headers.origin || 'http://localhost:5173';
    const returnUrl = `${origin}/settings`;

    const session = await createPortalSession(
      tenant.stripe_customer_id,
      returnUrl
    );

    res.json({ url: session.url });
  } catch (error: any) {
    logger.error('Error creating portal session', error);
    res.status(500).json({ error: error.message });
  }
});
