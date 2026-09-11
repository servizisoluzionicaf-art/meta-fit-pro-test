import { createClient } from 'npm:@supabase/supabase-js@2.102.0';
import Stripe from 'npm:stripe@22.0.0';
import { createHandler } from './handler.mjs';

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing server setting: ${name}`);
  return value;
}
const stripe = new Stripe(required('STRIPE_SECRET_KEY'), { maxNetworkRetries: 1, timeout: 15000 });
const db = createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});
const webhookSecret = required('STRIPE_WEBHOOK_SECRET');
Deno.serve(createHandler({ db, stripe, settings: {
  siteUrl: required('MFP_SITE_URL'),
  salesEnabled: Deno.env.get('MFP_SALES_ENABLED') === 'true',
  liveMode: Deno.env.get('STRIPE_LIVE_MODE') === 'true',
  priceId: required('STRIPE_PRICE_ID'),
  couponId: required('STRIPE_PROMO_COUPON_ID')
}, verifyWebhook: (body: string, signature: string) =>
  stripe.webhooks.constructEventAsync(body, signature, webhookSecret, undefined, Stripe.createSubtleCryptoProvider())
}));
