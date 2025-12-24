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
const REDIRECT_URI = process.env.GHL_REDIRECT_URI || 'http://localhost:8080/api/ghl/callback';

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
 * GET /api/ghl/callback
 * Handles the OAuth callback from GHL
 */
authRouter.get('/callback', async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query;

    if (!code || !state) {
      return res.status(400).send('Missing code or state parameter');
    }

    // Decode state
    const stateData = JSON.parse(Buffer.from(state as string, 'base64').toString());
    const { instanceId, tenantId, userId } = stateData;

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
        user_type: 'Location' // Assuming location level integration
      })
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('GHL Token Exchange Error:', errorText);
      return res.status(500).send(`Error exchanging token: ${errorText}`);
    }

    const tokenData = await tokenResponse.json() as GHLTokenResponse;

    // Save integration to database
    // Upsert integration record
    const svc = getSupabaseClient();
    const { data: integration, error: integrationError } = await svc
      .from('ghl_wa_integrations')
      .upsert({
        tenant_id: tenantId,
        location_id: tokenData.locationId,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        token_expires_at: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
        scope: tokenData.scope,
        user_type: tokenData.userType,
        company_id: tokenData.companyId
      }, {
        onConflict: 'tenant_id, location_id'
      })
      .select()
      .single();

    if (integrationError) {
      console.error('Error saving integration:', integrationError);
      return res.status(500).send('Error saving integration details');
    }

    // Link instance to this integration
    const { error: linkError } = await svc
      .from('ghl_wa_instances')
      .update({ 
        ghl_integration_id: integration.id 
      })
      .eq('name', instanceId) // Assuming instanceId matches name in DB or we need to query by ID
      .eq('tenant_id', tenantId);

    // If we are using file-based instances without DB sync yet, we might need to handle this differently
    // For now, let's assume we want to redirect back to the frontend
    
    // Redirect to frontend success page
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/?ghl_connected=true&instanceId=${instanceId}`);

  } catch (error: any) {
    console.error('OAuth Callback Error:', error);
    res.status(500).send(`Internal Server Error: ${error.message}`);
  }
});
