import test from 'node:test';
import assert from 'node:assert/strict';
import { hasAccess, validOffer, validRoom, documentsReady, acceptedCurrent } from '../supabase/functions/mfp-api/policy.mjs';
import { createHandler } from '../supabase/functions/mfp-api/handler.mjs';

const user = { id: 'user-1', email: 'member@example.test', email_confirmed_at: '2026-09-11', user_metadata: {} };
const subscription = () => ({ livemode: false, status: 'active', items: { data: [{ price: { id: 'price_mfp' }, quantity: 1, current_period_end: 9999999999 }] }, latest_invoice: { status: 'paid' } });
const legal = ['terms', 'privacy', 'profile'].map((kind, i) => ({ id: `00000000-0000-4000-8000-00000000000${i}`, kind, version: 'v1', active: true, approved_at: '2026-09-11', body: 'Approved example used only in automated tests.' }));
const settings = { siteUrl: 'https://example.test/meta-fit-pro/', salesEnabled: true, liveMode: false, priceId: 'price_mfp', couponId: 'coupon_mfp' };
const price = { active: true, livemode: false, currency: 'eur', unit_amount: 1999, type: 'recurring', recurring: { interval: 'month', interval_count: 1 }, tax_behavior: 'inclusive', product: 'prod_mfp' };
const coupon = { valid: true, livemode: false, amount_off: 500, currency: 'eur', duration: 'repeating', duration_in_months: 3 };

function fixture(overrides = {}) {
  const rows = { mfp_legal_documents: legal, mfp_acceptances: legal.map(d => ({ user_id: user.id, document_id: d.id })),
    mfp_profiles: [{ user_id: user.id, first_name: 'Test', last_name: 'Member', phone: '+3900000000' }],
    mfp_billing_customers: [{ user_id: user.id, stripe_customer_id: 'cus_mfp' }],
    mfp_progress: [{ user_id: user.id, completed_weeks: 0 }], mfp_room_assets: [], mfp_payment_events: [],
    mfp_checkout_guard: [{ user_id: user.id, attempt_id: 'attempt-1', lease_id: 'lease-1', session_id: null }], ...overrides.rows };
  const calls = { auth: 0, signed: 0, checkout: [], portal: [] };
  let guardBusy = false;
  const db = {
    auth: { getUser: async token => { calls.auth++; return token === 'valid-token' ? { data: { user: overrides.user || user }, error: null } : { data: {}, error: {} }; } },
    from(table) {
      const filters = []; let mode = 'read', payload, single = false;
      const query = {
        select() { return this; }, eq(key, value) { filters.push([key, value]); return this; },
        maybeSingle() { single = true; return this; },
        update(value) { mode = 'update'; payload = value; return this; },
        upsert(value) { mode = 'upsert'; payload = value; return this; },
        insert(value) { mode = 'insert'; payload = value; return this; },
        then(resolve, reject) {
          const matches = (rows[table] || []).filter(row => filters.every(([k, v]) => row[k] === v));
          if (mode === 'update') { matches.forEach(row => Object.assign(row, payload)); if (payload.lease_until) guardBusy = false; }
          if (mode === 'insert') rows[table].push(payload);
          if (mode === 'upsert' && !rows[table].some(row => row.event_id === payload.event_id)) rows[table].push(payload);
          return Promise.resolve({ data: single ? matches[0] || null : matches, error: null }).then(resolve, reject);
        }
      }; return query;
    },
    rpc: async name => {
      if (name === 'mfp_claim_checkout') { if (guardBusy) return { data: null }; guardBusy = true; return { data: { ...rows.mfp_checkout_guard[0] } }; }
      return { data: null };
    },
    storage: { from: () => ({ createSignedUrl: async () => { calls.signed++; return { data: { signedUrl: 'https://private.example.test/signed' } }; } }) }
  };
  const stripe = {
    subscriptions: { list: () => overrides.subscriptions || [] },
    prices: { retrieve: async () => price }, coupons: { retrieve: async () => coupon },
    checkout: { sessions: {
      retrieve: async () => ({ id: 'cs_mfp', status: 'open', url: 'https://checkout.stripe.com/test' }),
      create: async (body, options) => { calls.checkout.push({ body, options }); return { id: 'cs_mfp', url: 'https://checkout.stripe.com/test' }; }
    } },
    billingPortal: { sessions: { create: async body => { calls.portal.push(body); return { url: 'https://billing.stripe.com/test' }; } } }
  };
  const handler = createHandler({ db, stripe, settings: { ...settings, ...overrides.settings },
    verifyWebhook: overrides.verifyWebhook || (async () => { throw new Error('bad signature'); }), log: () => {} });
  const request = (route, { method, token = 'valid-token', body, origin = 'https://example.test', signature } = {}) => handler(new Request('https://project.supabase.co/functions/v1/mfp-api/' + route, {
    method: method || (body === undefined ? 'GET' : 'POST'), headers: { origin, ...(token ? { authorization: 'Bearer ' + token } : {}), ...(signature ? { 'stripe-signature': signature } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  }));
  return { request, calls, rows };
}

test('accesso solo con prezzo corretto, fattura pagata e periodo attivo', () => {
  assert.equal(hasAccess(subscription(), 'price_mfp'), true);
  for (const status of ['trialing', 'incomplete', 'past_due', 'unpaid', 'canceled', 'paused']) assert.equal(hasAccess({ ...subscription(), status }, 'price_mfp'), false);
  assert.equal(hasAccess({ ...subscription(), latest_invoice: { status: 'open' } }, 'price_mfp'), false);
  assert.equal(hasAccess(subscription(), 'price_other'), false);
  assert.equal(hasAccess(subscription(), 'price_mfp', 9999999999), false);
});
test('premio dopo due settimane completate; stanza e progressi validati', () => {
  assert.equal(validRoom('MFP-RM-005', 0), true);
  assert.equal(validRoom('MFP-RM-006', 1), false);
  assert.equal(validRoom('MFP-RM-006', 2), true);
  assert.equal(validRoom('MFP-RM-012', 13), false);
  assert.equal(validRoom('MFP-RM-012', 14), true);
  for (const room of ['MFP-RM-000', 'MFP-RM-013', '../home3', 'MFP-RM-6']) assert.equal(validRoom(room, 100), false);
  assert.equal(validRoom('MFP-RM-006', '2'), false);
});
test('offerta 14,99 per tre mesi e 19,99 successivi, stessa valuta e ambiente', () => {
  assert.equal(validOffer(price, coupon, false), true);
  assert.equal(validOffer(price, coupon, true), false);
  assert.equal(validOffer({ ...price, tax_behavior: 'exclusive' }, coupon, false), false);
  assert.equal(validOffer(price, { ...coupon, duration_in_months: 4 }, false), false);
  assert.equal(validOffer(price, { ...coupon, applies_to: { products: ['another'] } }, false), false);
});
test('bozze e accettazioni di versioni precedenti non abilitano pagamento', () => {
  assert.equal(documentsReady(legal), true);
  assert.equal(documentsReady(legal.slice(1)), false);
  assert.equal(documentsReady(legal.map(d => ({ ...d, approved_at: null }))), false);
  assert.equal(acceptedCurrent(legal, legal.map(d => ({ document_id: d.id }))), true);
  assert.equal(acceptedCurrent(legal, [{ document_id: 'old-version' }]), false);
});
test('token assente, falso o email non verificata: accesso negato', async () => {
  assert.equal((await fixture().request('status', { token: null })).status, 401);
  assert.equal((await fixture().request('status', { token: 'fake' })).status, 401);
  assert.equal((await fixture({ user: { ...user, email_confirmed_at: null } }).request('status')).status, 403);
});
test('configurazione spenta e origine esterna bloccate prima di usare Auth', async () => {
  const f = fixture({ settings: { salesEnabled: false } });
  assert.equal((await f.request('checkout', { body: {} })).status, 503);
  assert.equal(f.calls.auth, 0);
  assert.equal((await fixture().request('status', { origin: 'https://other.test' })).status, 403);
});
test('booleani inviati dal browser non concedono stanze né URL riservati', async () => {
  const f = fixture();
  const response = await f.request('room', { body: { roomId: 'MFP-RM-001', paid: true, completedWeeks: 104, user_id: 'other' } });
  assert.equal(response.status, 403); assert.equal(f.calls.signed, 0);
});
test('stanza premio richiede progressi del server anche con pagamento valido', async () => {
  const f = fixture({ subscriptions: [subscription()], rows: { mfp_room_assets: [{ room_id: 'MFP-RM-006', storage_path: 'room6.mp4' }] } });
  assert.equal((await f.request('room', { body: { roomId: 'MFP-RM-006', completedWeeks: 14 } })).status, 403);
  f.rows.mfp_progress[0].completed_weeks = 2;
  const response = await f.request('room', { body: { roomId: 'MFP-RM-006' } });
  assert.equal(response.status, 200); assert.equal(f.calls.signed, 1);
});
test('checkout usa prezzo e destinazioni server, mai quelli del browser', async () => {
  const f = fixture();
  const response = await f.request('checkout', { body: { priceId: 'free', customer: 'victim', success_url: 'https://evil.test' } });
  assert.equal(response.status, 200);
  const { body, options } = f.calls.checkout[0];
  assert.equal(body.customer, 'cus_mfp'); assert.equal(body.line_items[0].price, 'price_mfp');
  assert.equal(body.success_url, 'https://example.test/meta-fit-pro/home2.html?pagamento=verifica');
  assert.equal(body.discounts[0].coupon, 'coupon_mfp'); assert.equal(options.idempotencyKey, 'mfp-checkout-attempt-1');
  await f.request('checkout', { body: {} });
  assert.equal(f.calls.checkout.length, 1, 'Il secondo clic riutilizza la sessione Stripe aperta');
});
test('checkout con vecchi consensi o abbonamento esistente non crea doppio addebito', async () => {
  const noConsent = fixture({ rows: { mfp_acceptances: [] } });
  assert.equal((await noConsent.request('checkout', { body: {} })).status, 409);
  assert.equal(noConsent.calls.checkout.length, 0);
  const active = fixture({ subscriptions: [subscription()] });
  assert.equal((await active.request('checkout', { body: {} })).status, 409);
  assert.equal(active.calls.checkout.length, 0);
});
test('webhook falso respinto; eventi validi duplicati non creano diritti', async () => {
  assert.equal((await fixture().request('webhook', { body: {}, signature: 'invalid' })).status, 400);
  const f = fixture({ verifyWebhook: async () => ({ id: 'evt_1', type: 'invoice.paid', livemode: false }) });
  for (let i = 0; i < 2; i++) assert.equal((await f.request('webhook', { body: {}, signature: 'fixture' })).status, 200);
  assert.equal(f.rows.mfp_payment_events.length, 1);
  assert.equal((await f.request('room', { body: { roomId: 'MFP-RM-001' } })).status, 403);
});
test('portale abbonamento usa soltanto il cliente associato all’account', async () => {
  const f = fixture(); await f.request('portal', { body: { customer: 'cus_victim' } });
  assert.equal(f.calls.portal[0].customer, 'cus_mfp');
});
