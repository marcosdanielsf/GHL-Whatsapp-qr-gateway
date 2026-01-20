import { Router, Request, Response } from 'express';
import { getSupabaseClient } from '../infra/supabaseClient';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';

export const authRouter = Router();

// GHL Token Response Interface
interface GHLTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  userType: string;
  locationId: string;
  companyId: string;
}

// GHL OAuth Configuration
const CLIENT_ID = process.env.GHL_CLIENT_ID;
const CLIENT_SECRET = process.env.GHL_CLIENT_SECRET;
// The redirect URI should match what's configured in GHL Marketplace
// Note: Railway URL with "ghl" is blocked by GHL, using socialfy.me domain
const REDIRECT_URI = process.env.GHL_REDIRECT_URI || 'https://app.socialfy.me/api/ghl/callback';

// Conversation Provider ID from GHL Marketplace
const CONVERSATION_PROVIDER_ID = process.env.GHL_CONVERSATION_PROVIDER_ID;

/**
 * GET /api/ghl/auth
 * Initiates the GHL OAuth flow
 * Query Params:
 * - instanceId: ID of the WhatsApp instance to link
 * - connectionType: 'first' (Location) or 'second' (Reuse)
 */
authRouter.get('/auth', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { instanceId, connectionType = 'first' } = req.query;
    const tenantId = req.tenantId;

    if (!CLIENT_ID) {
      return res.status(500).json({ error: 'GHL Client ID not configured' });
    }

    if (!instanceId || typeof instanceId !== 'string') {
      return res.status(400).json({ error: 'instanceId is required' });
    }

    // State to pass through OAuth flow for security and context
    const state = Buffer.from(JSON.stringify({
      instanceId,
      tenantId,
      userId: req.user?.id,
      connectionType
    })).toString('base64');

    // Scopes required for the integration
    const scopes = [
      'conversations.readonly',
      'conversations.write',
      'conversations/message.readonly',
      'conversations/message.write',
      'contacts.readonly',
      'contacts.write',
      'users.readonly',
      'locations.readonly'
    ].join(' ');

    // Construct GHL Authorization URL
    // Use marketplace.leadconnectorhq.com for standard OAuth
    const authUrl = `https://marketplace.leadconnectorhq.com/oauth/chooselocation?response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&client_id=${CLIENT_ID}&scope=${encodeURIComponent(scopes)}&state=${state}`;

    res.json({ url: authUrl });
  } catch (error: any) {
    console.error('Error generating GHL auth URL:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/ghl/callback (and /api/oauth/callback)
 * Handles the OAuth callback from GHL
 * Note: state is optional when installing via GHL Marketplace directly
 */
authRouter.get('/callback', async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query;

    console.log('OAuth callback received:', { code: code ? 'present' : 'missing', state: state ? 'present' : 'missing' });

    if (!code) {
      return res.status(400).send('Missing code parameter');
    }

    // Decode state if present (optional for Marketplace installs)
    let instanceId: string | undefined;
    let tenantId: string | undefined;
    let userId: string | undefined;

    if (state) {
      try {
        const stateData = JSON.parse(Buffer.from(state as string, 'base64').toString());
        instanceId = stateData.instanceId;
        tenantId = stateData.tenantId;
        userId = stateData.userId;
      } catch (e) {
        console.warn('Failed to decode state, continuing without it');
      }
    }

    // Exchange code for tokens
    const tokenResponse = await fetch('https://services.leadconnectorhq.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: new URLSearchParams({
        client_id: CLIENT_ID!,
        client_secret: CLIENT_SECRET!,
        grant_type: 'authorization_code',
        code: code as string,
        redirect_uri: REDIRECT_URI,
        user_type: 'Location'
      })
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('GHL Token Exchange Error:', errorText);
      return res.status(500).send(`Error exchanging token: ${errorText}`);
    }

    const tokenData = await tokenResponse.json() as GHLTokenResponse;
    console.log('Token exchange successful:', { locationId: tokenData.locationId, companyId: tokenData.companyId });

    // For Marketplace installs without state, tenant_id will be null
    // The integration will be found by location_id instead
    const effectiveTenantId = tenantId || null;

    // Save integration to database
    const svc = getSupabaseClient();
    const { data: integration, error: integrationError } = await svc
      .from('ghl_wa_integrations')
      .upsert({
        tenant_id: effectiveTenantId,
        location_id: tokenData.locationId,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        token_expires_at: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
        scope: tokenData.scope,
        user_type: tokenData.userType,
        company_id: tokenData.companyId,
        conversation_provider_id: CONVERSATION_PROVIDER_ID,
        is_active: true
      }, {
        onConflict: 'location_id'
      })
      .select()
      .single();

    if (integrationError) {
      console.error('Error saving integration:', integrationError);
      return res.status(500).send(`Error saving integration: ${integrationError.message}`);
    }

    console.log('Integration saved:', { integrationId: integration.id, locationId: tokenData.locationId });

    // Link instance to this integration (only if instanceId was provided)
    if (instanceId && tenantId) {
      const { error: linkError } = await svc
        .from('ghl_wa_instances')
        .update({ ghl_integration_id: integration.id })
        .eq('name', instanceId)
        .eq('tenant_id', tenantId);

      if (linkError) {
        console.warn('Could not link instance:', linkError.message);
      }
    }

    // Redirect to frontend success page or show success message
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

    if (instanceId) {
      res.redirect(`${frontendUrl}/?ghl_connected=true&instanceId=${instanceId}`);
    } else {
      // For Marketplace installs without state, show success page
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>GHL Integration Success</title>
          <style>
            body { font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
            .container { text-align: center; background: white; padding: 40px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            .success { color: #22c55e; font-size: 48px; }
            h1 { color: #333; }
            p { color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="success">✓</div>
            <h1>Integration Successful!</h1>
            <p>Your GoHighLevel location <strong>${tokenData.locationId}</strong> is now connected.</p>
            <p>You can close this window.</p>
          </div>
        </body>
        </html>
      `);
    }

  } catch (error: any) {
    console.error('OAuth Callback Error:', error);
    res.status(500).send(`Internal Server Error: ${error.message}`);
  }
});
