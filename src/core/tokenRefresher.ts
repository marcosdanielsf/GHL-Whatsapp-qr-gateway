/**
 * Token Refresher - Automatic GHL OAuth Token Refresh
 *
 * This module periodically checks for tokens that are about to expire
 * and refreshes them proactively to avoid authentication failures.
 *
 * Circuit breaker: opens after 3 consecutive 429s, waits 15min before retry.
 */

import { getSupabaseClient } from "../infra/supabaseClient";
import { ghlService } from "../services/ghl.service";
import { logger } from "../utils/logger";

// Refresh interval: every 30 minutes
const REFRESH_INTERVAL_MS = 30 * 60 * 1000;

// Threshold: refresh if expiring within 1 hour
const EXPIRY_THRESHOLD_MS = 60 * 60 * 1000;

// Circuit breaker config
const CB_FAILURE_THRESHOLD = 3; // 429s consecutivos para abrir o circuit
const CB_OPEN_DURATION_MS = 15 * 60 * 1000; // 15min de espera com circuit aberto

let refreshInterval: NodeJS.Timeout | null = null;

// Circuit breaker state
let cbConsecutive429 = 0;
let cbOpenUntil: number | null = null;

function isCircuitOpen(): boolean {
  if (cbOpenUntil === null) return false;
  if (Date.now() < cbOpenUntil) return true;
  // Circuit fechou — reset state
  cbOpenUntil = null;
  cbConsecutive429 = 0;
  logger.info("Token refresh circuit breaker: fechado após cooldown", {
    event: "token.refresh.circuit_closed",
  });
  return false;
}

function recordSuccess(): void {
  if (cbConsecutive429 > 0) {
    cbConsecutive429 = 0;
    cbOpenUntil = null;
  }
}

function record429(): void {
  cbConsecutive429++;
  logger.warn(`Token refresh 429 consecutivo #${cbConsecutive429}`, {
    event: "token.refresh.rate_limited",
    consecutive: cbConsecutive429,
    threshold: CB_FAILURE_THRESHOLD,
  });
  if (cbConsecutive429 >= CB_FAILURE_THRESHOLD) {
    cbOpenUntil = Date.now() + CB_OPEN_DURATION_MS;
    logger.error("Token refresh circuit breaker: ABERTO — aguardando 15min", {
      event: "token.refresh.circuit_open",
      openUntil: new Date(cbOpenUntil).toISOString(),
    });
  }
}

/**
 * Check and refresh tokens that are about to expire
 */
async function checkAndRefreshTokens(): Promise<void> {
  // Circuit breaker: skip se aberto
  if (isCircuitOpen()) {
    logger.warn("Token refresh pulado — circuit breaker aberto", {
      event: "token.refresh.circuit_skip",
      openUntil: new Date(cbOpenUntil!).toISOString(),
    });
    return;
  }

  logger.info("Checking for expiring GHL tokens...", {
    event: "token.refresh.check",
  });

  try {
    const supabase = getSupabaseClient();

    // Calculate the threshold time
    const thresholdTime = new Date(
      Date.now() + EXPIRY_THRESHOLD_MS,
    ).toISOString();

    // Find integrations with tokens expiring soon
    const { data: integrations, error } = await supabase
      .from("ghl_wa_integrations")
      .select("*")
      .lt("token_expires_at", thresholdTime)
      .eq("is_active", true);

    if (error) {
      logger.error("Error fetching integrations for token refresh", {
        error: error.message,
      });
      return;
    }

    if (!integrations || integrations.length === 0) {
      logger.debug("No tokens need refreshing", {
        event: "token.refresh.none",
      });
      return;
    }

    logger.info(`Found ${integrations.length} tokens to refresh`, {
      event: "token.refresh.found",
      count: integrations.length,
    });

    // Refresh each token
    for (const integration of integrations) {
      // Re-check circuit antes de cada refresh individual
      if (isCircuitOpen()) {
        logger.warn("Token refresh interrompido mid-loop — circuit aberto", {
          event: "token.refresh.circuit_skip_mid",
        });
        break;
      }

      try {
        await ghlService.refreshAccessToken(integration);
        recordSuccess();
        logger.info("Token refreshed successfully", {
          event: "token.refresh.success",
          integrationId: integration.id,
          locationId: integration.location_id,
        });
      } catch (refreshError: any) {
        const is429 =
          refreshError.message?.includes("429") ||
          refreshError.status === 429 ||
          refreshError.statusCode === 429;

        if (is429) {
          record429();
          logger.warn("Token refresh: rate limited (429)", {
            event: "token.refresh.rate_limited_skip",
            integrationId: integration.id,
          });
          // Se circuit abriu agora, interromper o loop
          if (isCircuitOpen()) break;
          continue; // pular este integration, tentar próximo após cooldown
        }

        logger.error("Failed to refresh token", {
          event: "token.refresh.failed",
          integrationId: integration.id,
          locationId: integration.location_id,
          error: refreshError.message,
        });

        // If refresh token is invalid, mark integration as inactive
        if (
          refreshError.message.includes("invalid_grant") ||
          refreshError.message.includes("refresh_token")
        ) {
          await supabase
            .from("ghl_wa_integrations")
            .update({ is_active: false })
            .eq("id", integration.id);

          logger.warn(
            "Integration marked as inactive due to invalid refresh token",
            {
              event: "token.refresh.deactivated",
              integrationId: integration.id,
            },
          );
        }
      }

      // Backoff adaptativo: mais lento se próximo do threshold
      const delay =
        cbConsecutive429 > 0 ? Math.min(cbConsecutive429 * 2000, 10000) : 1000;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  } catch (error: any) {
    logger.error("Error in token refresh cycle", {
      event: "token.refresh.error",
      error: error.message,
    });
  }
}

/**
 * Start the automatic token refresh scheduler
 */
export function startTokenRefresher(): void {
  if (refreshInterval) {
    logger.debug("Token refresher already running");
    return;
  }

  logger.info("Starting token refresher", {
    event: "token.refresh.started",
    interval: REFRESH_INTERVAL_MS,
    threshold: EXPIRY_THRESHOLD_MS,
    circuitBreaker: {
      failureThreshold: CB_FAILURE_THRESHOLD,
      openDurationMs: CB_OPEN_DURATION_MS,
    },
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
    logger.info("Token refresher stopped", { event: "token.refresh.stopped" });
  }
}

/**
 * Manually trigger a token refresh check
 */
export async function triggerTokenRefresh(): Promise<void> {
  await checkAndRefreshTokens();
}
