import { Router, Request, Response } from 'express';
import { stripe } from '../../services/stripe';
import { getSupabaseClient } from '../../infra/supabaseClient';
import { logger } from '../../utils/logger';
import Stripe from 'stripe';

export const stripeWebhookRouter = Router();

// This router expects RAW body, so we will mount it before express.json() in index.ts
// or we can use express.raw({ type: 'application/json' }) here if we mount it specifically.
// For safety, we'll assume the body is already available or handled in the main app.
// Ideally, in index.ts: app.use('/api/webhooks/stripe', express.raw({ type: 'application/json' }), stripeWebhookRouter);

stripeWebhookRouter.post('/', async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event: Stripe.Event;

  try {
    if (!sig || !endpointSecret) {
      throw new Error('Missing Stripe signature or webhook secret');
    }
    // req.body must be a Buffer here
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err: any) {
    logger.error(`Webhook Error: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  try {
    const supabase = getSupabaseClient();

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const tenantId = session.client_reference_id;
        const customerId = session.customer as string;
        const subscriptionId = session.subscription as string;

        if (tenantId && customerId) {
          logger.info(`Checkout completed for tenant ${tenantId}`);
          
          // Update tenant with Stripe IDs and active status
          const { error } = await supabase
            .from('ghl_wa_tenants')
            .update({
              stripe_customer_id: customerId,
              stripe_subscription_id: subscriptionId,
              subscription_status: 'active',
              // We could infer plan from priceId inside line_items if needed,
              // but usually we set it based on the product purchased.
              // For now, let's assume "pro" or updated via another mechanism/metadata
            })
            .eq('id', tenantId);

          if (error) throw error;
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        const status = subscription.status; // active, past_due, canceled, etc.
        
        logger.info(`Subscription updated for customer ${customerId}: ${status}`);

        // Update tenant status based on Stripe status
        // We need to find the tenant by stripe_customer_id
        const { error } = await supabase
          .from('ghl_wa_tenants')
          .update({
            subscription_status: status,
          })
          .eq('stripe_customer_id', customerId);
          
        if (error) throw error;
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        logger.info(`Subscription deleted for customer ${customerId}`);

        const { error } = await supabase
          .from('ghl_wa_tenants')
          .update({
            subscription_status: 'canceled',
          })
          .eq('stripe_customer_id', customerId);

        if (error) throw error;
        break;
      }

      default:
        logger.info(`Unhandled event type ${event.type}`);
    }

    res.json({ received: true });
  } catch (err: any) {
    logger.error('Error processing webhook event', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});
