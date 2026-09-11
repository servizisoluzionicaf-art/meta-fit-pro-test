import { acceptedCurrent, documentsReady, hasAccess, validOffer, validRoom } from './policy.mjs';

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const requireThat = (ok, status, message) => { if (!ok) throw new ApiError(status, message); };
const checked = result => { if (result.error) throw new Error('Database operation failed'); return result.data; };

export function createHandler({ db, stripe, settings, verifyWebhook, log = console.error }) {
  const site = new URL(settings.siteUrl);
  const destination = path => new URL(path, site).href;
  const json = (data, status = 200) => Response.json(data, { status, headers: {
    'Access-Control-Allow-Origin': site.origin,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store', 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff'
  }});
  const documents = async () => checked(await db.from('mfp_legal_documents').select('*').eq('active', true));
  async function customerFor(user, create = false) {
    const existing = checked(await db.from('mfp_billing_customers').select('stripe_customer_id').eq('user_id', user.id).maybeSingle());
    if (existing) return existing.stripe_customer_id;
    if (!create) return null;
    const customer = await stripe.customers.create({ email: user.email, metadata: { mfp_user_id: user.id } },
      { idempotencyKey: 'mfp-customer-' + user.id });
    checked(await db.from('mfp_billing_customers').insert({ user_id: user.id, stripe_customer_id: customer.id }));
    return customer.id;
  }
  async function subscriptions(customer) {
    if (!customer) return [];
    const list = [];
    for await (const subscription of stripe.subscriptions.list({ customer, status: 'all', limit: 100, expand: ['data.latest_invoice'] })) {
      requireThat(subscription.livemode === settings.liveMode, 503, 'Configurazione del pagamento da verificare.');
      list.push(subscription);
    }
    return list;
  }
  async function profileFor(user) {
    const profile = checked(await db.from('mfp_profiles').select('*').eq('user_id', user.id).maybeSingle());
    if (profile) return profile;
    const metadata = user.user_metadata || {};
    const clean = name => typeof metadata[name] === 'string' ? metadata[name].trim() : '';
    const value = { user_id: user.id, first_name: clean('first_name'), last_name: clean('last_name'), phone: clean('phone') };
    requireThat(value.first_name.length >= 1 && value.first_name.length <= 80 &&
      value.last_name.length >= 1 && value.last_name.length <= 80 && /^[+\d()\s.-]{6,30}$/.test(value.phone),
      422, 'Completa nome, cognome e telefono nella registrazione.');
    checked(await db.from('mfp_profiles').upsert(value, { onConflict: 'user_id', ignoreDuplicates: true }));
    return value;
  }
  async function membership(user) {
    const [customer, progress] = await Promise.all([
      customerFor(user), db.from('mfp_progress').select('completed_weeks').eq('user_id', user.id).maybeSingle()
    ]);
    const active = (await subscriptions(customer)).some(s => hasAccess(s, settings.priceId));
    return { active, completedWeeks: checked(progress)?.completed_weeks || 0, customer };
  }
  async function checkout(user) {
    const docs = await documents();
    const acceptances = checked(await db.from('mfp_acceptances').select('document_id').eq('user_id', user.id));
    requireThat(acceptedCurrent(docs, acceptances), 409, 'Apri e accetta i documenti aggiornati prima di pagare.');
    await profileFor(user);
    const guard = checked(await db.rpc('mfp_claim_checkout', { p_user: user.id }));
    requireThat(guard, 409, 'Un pagamento è già in preparazione. Attendi qualche secondo e riprova.');
    try {
      const customer = await customerFor(user, true);
      const existing = await subscriptions(customer);
      const running = existing.find(s => !['canceled', 'incomplete_expired'].includes(s.status));
      requireThat(!running, 409, 'Hai già un abbonamento o un pagamento in corso. Gestiscilo dal tuo account.');
      let attempt = guard.attempt_id;
      if (guard.session_id) {
        const session = await stripe.checkout.sessions.retrieve(guard.session_id);
        if (session.status === 'open') return { url: session.url };
        requireThat(session.status === 'expired', 409, 'Il pagamento è in verifica. Torna alla Home 2 tra qualche istante.');
        attempt = crypto.randomUUID();
        checked(await db.from('mfp_checkout_guard').update({ session_id: null, attempt_id: attempt }).eq('user_id', user.id));
      }
      const [price, coupon] = await Promise.all([
        stripe.prices.retrieve(settings.priceId), stripe.coupons.retrieve(settings.couponId)
      ]);
      requireThat(validOffer(price, coupon, settings.liveMode), 503, 'L’offerta di pagamento deve essere verificata.');
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription', customer, client_reference_id: user.id,
        line_items: [{ price: settings.priceId, quantity: 1 }],
        discounts: [{ coupon: settings.couponId }],
        payment_method_types: ['card'], locale: 'it',
        success_url: destination('home2.html?pagamento=verifica'),
        cancel_url: destination('home3.html?pagamento=annullato'),
        subscription_data: { metadata: { mfp_user_id: user.id } },
        metadata: { mfp_user_id: user.id }
      }, { idempotencyKey: 'mfp-checkout-' + attempt });
      checked(await db.from('mfp_checkout_guard').update({ session_id: session.id }).eq('user_id', user.id));
      return { url: session.url };
    } finally {
      // Una lease impedisce doppie creazioni anche da due dispositivi. In caso di
      // errore di rete la stessa attempt_id riutilizza l'idempotenza Stripe.
      checked(await db.from('mfp_checkout_guard').update({ lease_until: new Date(0).toISOString() }).eq('user_id', user.id).eq('lease_id', guard.lease_id));
    }
  }
  return async request => {
    const route = new URL(request.url).pathname.split('/').filter(Boolean).pop();
    try {
      if (route === 'webhook') {
        requireThat(request.method === 'POST', 405, 'Metodo non consentito.');
        const signature = request.headers.get('stripe-signature');
        requireThat(signature, 400, 'Firma mancante.');
        let event;
        try { event = await verifyWebhook(await request.text(), signature); }
        catch { throw new ApiError(400, 'Firma non valida.'); }
        requireThat(event.livemode === settings.liveMode, 400, 'Modalità Stripe non corrispondente.');
        // Audit idempotente senza dati di carta o payload personali. L'accesso
        // rilegge sempre Stripe: eventi duplicati/fuori ordine non concedono diritti.
        checked(await db.from('mfp_payment_events').upsert({ event_id: event.id, event_type: event.type }, { onConflict: 'event_id', ignoreDuplicates: true }));
        return json({ received: true });
      }
      const origin = request.headers.get('origin');
      requireThat(!origin || origin === site.origin, 403, 'Origine non consentita.');
      if (request.method === 'OPTIONS') return json({});
      const methods = { documents: 'GET', status: 'GET', consents: 'POST', checkout: 'POST', portal: 'POST', room: 'POST' };
      requireThat(Object.hasOwn(methods, route), 404, 'Pagina non trovata.');
      requireThat(request.method === methods[route], 405, 'Metodo non consentito.');
      if (route === 'documents') {
        const docs = await documents();
        return json({ ready: settings.salesEnabled && documentsReady(docs), documents: docs });
      }
      requireThat(settings.salesEnabled, 503, 'Le nuove attivazioni non sono ancora disponibili.');
      const bearer = /^Bearer (\S+)$/.exec(request.headers.get('authorization') || '');
      requireThat(bearer, 401, 'Accedi al tuo account.');
      const { data, error } = await db.auth.getUser(bearer[1]);
      requireThat(!error && data?.user, 401, 'Sessione scaduta. Accedi di nuovo.');
      const user = data.user;
      requireThat(user.email_confirmed_at, 403, 'Conferma la tua email prima di continuare.');
      if (route === 'status') {
        const [profile, member, docs, accepted] = await Promise.all([
          profileFor(user), membership(user), documents(),
          db.from('mfp_acceptances').select('document_id').eq('user_id', user.id)
        ]);
        return json({ user: { id: user.id, email: user.email, firstName: profile.first_name },
          paid: member.active, profile: true, completedWeeks: member.completedWeeks,
          consented: acceptedCurrent(docs, checked(accepted)), canManage: !!member.customer });
      }
      let body = {};
      if (route === 'consents' || route === 'room') {
        const raw = await request.text();
        requireThat(raw.length <= 4096, 413, 'Richiesta troppo grande.');
        try { body = JSON.parse(raw); } catch { throw new ApiError(400, 'Richiesta non valida.'); }
        requireThat(body && typeof body === 'object' && !Array.isArray(body), 400, 'Richiesta non valida.');
      }
      if (route === 'consents') {
        const ids = body.documentIds;
        requireThat(Array.isArray(ids) && ids.length === 3 && new Set(ids).size === 3 &&
          ids.every(id => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)), 400, 'Seleziona tutti i documenti.');
        const docs = await documents();
        requireThat(documentsReady(docs) && docs.every(d => ids.includes(d.id)), 409, 'I documenti sono cambiati. Riaprili e conferma.');
        checked(await db.rpc('mfp_accept_documents', { p_user: user.id, p_documents: ids }));
        return json({ accepted: true });
      }
      if (route === 'checkout') return json(await checkout(user));
      if (route === 'portal') {
        const customer = await customerFor(user);
        requireThat(customer, 404, 'Nessun abbonamento da gestire.');
        const session = await stripe.billingPortal.sessions.create({ customer, return_url: destination('account.html') });
        return json({ url: session.url });
      }
      const member = await membership(user);
      requireThat(member.active, 403, 'È necessario un abbonamento attivo.');
      requireThat(validRoom(body.roomId, member.completedWeeks), 403, 'Questa stanza non è ancora sbloccata.');
      const asset = checked(await db.from('mfp_room_assets').select('storage_path').eq('room_id', body.roomId).maybeSingle());
      let trainingUrl = null;
      if (asset) trainingUrl = checked(await db.storage.from('mfp-training').createSignedUrl(asset.storage_path, 3600)).signedUrl;
      return json({ roomId: body.roomId, authorized: true, trainingUrl });
    } catch (error) {
      if (!(error instanceof ApiError)) log('mfp-api: richiesta non completata', error?.name || 'Error');
      return json({ error: error instanceof ApiError ? error.message : 'Servizio temporaneamente non disponibile. Riprova.' }, error.status || 503);
    }
  };
}
