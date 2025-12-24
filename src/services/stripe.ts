import Stripe from 'stripe';
import { logger } from '../utils/logger';

if (!process.env.STRIPE_SECRET_KEY) {
  logger.warn('STRIPE_SECRET_KEY is missing. Stripe integration will not work.');
}

// Prevent startup crash by using a placeholder if key is missing
const apiKey = process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder';

export const stripe = new Stripe(apiKey, {
  apiVersion: '2023-10-16' as any, // Force version to avoid TS errors with mismatching library versions
  typescript: true,
});

/**
 * Creates a Stripe Checkout Session for a subscription
 */
export async function createCheckoutSession(
  priceId: string,
  customerId: string | undefined,
  tenantId: string,
  successUrl: string,
  cancelUrl: string
) {
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      customer: customerId, // If existing customer, pass ID to avoid duplicates
      client_reference_id: tenantId, // Critical: helps us link the payment to the tenant
      subscription_data: {
        trial_period_days: 7,
        metadata: {
          tenantId: tenantId,
        },
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
      allow_promotion_codes: true,
    });

    return session;
  } catch (error: any) {
    logger.error('Error creating checkout session', {
      error: error.message,
      tenantId,
      priceId,
    });
    throw error;
  }
}

/**
 * Creates a Portal Session for customer to manage subscription
 */
export async function createPortalSession(customerId: string, returnUrl: string) {
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });

    return session;
  } catch (error: any) {
    logger.error('Error creating portal session', {
      error: error.message,
      customerId,
    });
    throw error;
  }
}
