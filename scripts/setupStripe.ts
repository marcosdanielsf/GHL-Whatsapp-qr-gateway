
import dotenv from 'dotenv';
import Stripe from 'stripe';
import path from 'path';

// Load env vars
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2025-01-27.acacia' as any,
});

async function main() {
  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('❌ No STRIPE_SECRET_KEY found in .env');
    process.exit(1);
  }

  console.log('🚀 Connecting to Stripe...');

  try {
    // 1. Create PRO Product & Price
    console.log('Creating "Plano Pro"...');
    const proProduct = await stripe.products.create({
      name: 'Plano Pro (Gateway WhatsApp)',
      description: 'Acesso completo ao Gateway WhatsApp para 1 instância.',
    });

    const proPrice = await stripe.prices.create({
      product: proProduct.id,
      unit_amount: 14700, // R$ 147,00
      currency: 'brl',
      recurring: { interval: 'month' },
    });
    console.log(`✅ Created "Plano Pro": ${proPrice.id}`);

    // 2. Create ENTERPRISE Product & Price
    console.log('Creating "Plano Enterprise"...');
    const entProduct = await stripe.products.create({
      name: 'Plano Enterprise (Gateway WhatsApp)',
      description: 'Acesso para múltiplas instâncias e suporte prioritário.',
    });

    const entPrice = await stripe.prices.create({
      product: entProduct.id,
      unit_amount: 49700, // R$ 497,00
      currency: 'brl',
      recurring: { interval: 'month' },
    });
    console.log(`✅ Created "Plano Enterprise": ${entPrice.id}`);

    // Output for capturing
    console.log('--- RESULT ---');
    console.log(`PRO_ID=${proPrice.id}`);
    console.log(`ENT_ID=${entPrice.id}`);

  } catch (error: any) {
    console.error('❌ Error creating products:', error.message);
  }
}

main();
