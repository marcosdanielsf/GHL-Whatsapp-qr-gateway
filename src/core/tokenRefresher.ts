/**
 * Token Refresher - Automatic GHL OAuth Token Refresh
 *
 * This module periodically checks for tokens that are about to expire
 * and refreshes them proactively to avoid authentication failures.
 */

import { getSupabaseClient } from '../infra/supabaseClient';
import { ghlService } from '../services/ghl.service';
import { logger } from '../utils/logger';

// Refresh interval: every 30 minutes
const REFRESH_INTERVAL_MS = 30 * 60 * 1000;

// Threshold: refresh if expiring within 1 hour
const EXPIRY_THRESHOLD_MS = 60 * 60 * 1000;

let refreshInterval: NodeJS.Timeout | null = null;

/**
 * Check and refresh tokens that are about to expire
 */
async function checkAndRefreshTokens(): Promise<void> {
  logger.info('Checking for expiring GHL tokens...', { event: 'token.refresh.check' });

  try {
    const supabase = getSupabaseClient();

    // Calculate the threshold time
    const thresholdTime = new Date(Date.now() + EXPIRY_THRESHOLD_MS).toISOString();

    // Find integrations with tokens expiring soon
    const { data: integrations, error } = await supabase
      .from('ghl_wa_integrations')
      .select('*')
      .lt('token_expires_at', thresholdTime)
      .eq('is_active', true);

    if (error) {
      logger.error('Error fetching integrations for token refresh', { error: error.message });
      return;
    }

    if (!integrations || integrations.length === 0) {
      logger.debug('No tokens need refreshing', { event: 'token.refresh.none' });
      return;
    }

    logger.info(`Found ${integrations.length} tokens to refresh`, {
      event: 'token.refresh.found',
      count: integrations.length,
    });

    // Refresh each token
    for (const integration of integrations) {
      try {
        await ghlService.refreshAccessToken(integration);
        logger.info('Token refreshed successfully', {
          event: 'token.refresh.success',
          integrationId: integration.id,
          locationId: integration.location_id,
        });
      } catch (refreshError: any) {
        logger.error('Failed to refresh token', {
          event: 'token.refresh.failed',
          integrationId: integration.id,
          locationId: integration.location_id,
          error: refreshError.message,
        });

        // If refresh token is invalid, mark integration as inactive
        if (
          refreshError.message.includes('invalid_grant') ||
          refreshError.message.includes('refresh_token')
        ) {
          await supabase
            .from('ghl_wa_integrations')
            .update({ is_active: false })
            .eq('id', integration.id);

          logger.warn('Integration marked as inactive due to invalid refresh token', {
            event: 'token.refresh.deactivated',
            integrationId: integration.id,
          });
        }
      }

      // Small delay between refreshes to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } catch (error: any) {
    logger.error('Error in token refresh cycle', {
      event: 'token.refresh.error',
      error: error.message,
    });
  }
}

/**
 * Start the automatic token refresh scheduler
 */
export function startTokenRefresher(): void {
  if (refreshInterval) {
    console.log('⚠️ Token refresher already running');
    return;
  }

  console.log('🔄 Starting GHL token refresher (interval: 30 min)');
  logger.info('Starting token refresher', {
    event: 'token.refresh.started',
    interval: REFRESH_INTERVAL_MS,
    threshold: EXPIRY_THRESHOLD_MS,
  });

  // Run immediately on start
  checkAndRefreshTokens();

  // Then run periodically
  refreshInterval = setInterval(checkAndRefreshTokens, REFRESH_INTERVAL_MS);
}

/**
 * Stop the automatic token refresh scheduler
 */
export function stopTokenRefresher(): void {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
    console.log('🛑 Token refresher stopped');
    logger.info('Token refresher stopped', { event: 'token.refresh.stopped' });
  }
}

/**
 * Manually trigger a token refresh check
 */
export async function triggerTokenRefresh(): Promise<void> {
  await checkAndRefreshTokens();
}
