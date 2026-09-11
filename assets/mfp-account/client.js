import config from './config.js';

export async function initialize(MFP) {
  if (!config.enabled) return;
  MFP.real = true;
  if (!/^https:\/\/[^/]+\.supabase\.co$/.test(config.supabaseUrl) || !config.supabasePublishableKey) {
    throw new Error('Attivazioni non ancora disponibili.');
  }
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.102.0');
  const client = createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true,
      detectSessionInUrl: true, storageKey: 'mfp.account.v1' }
  });
  MFP.auth = client.auth;
  MFP.api = async (route, body) => {
    const { data, error } = await client.auth.getSession();
    if (error) throw new Error('Accedi di nuovo al tuo account.');
    const headers = { apikey: config.supabasePublishableKey };
    if (data.session) headers.Authorization = 'Bearer ' + data.session.access_token;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(config.supabaseUrl + '/functions/v1/mfp-api/' + route, {
      method: body === undefined ? 'GET' : 'POST', headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(25000), cache: 'no-store'
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Servizio non disponibile. Riprova.');
    return result;
  };
  MFP.refresh = async () => {
    MFP.serverState = MFP.fresh();
    MFP.account = null;
    MFP.problem = '';
    try {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      if (data.session) {
        const state = await MFP.api('status');
        MFP.account = state.user;
        MFP.serverState = { ...state, room: null };
        try { MFP.serverState.room = sessionStorage.getItem('mfp.room.' + state.user.id); } catch {}
      }
    } catch (error) { MFP.problem = error.message || 'Verifica dell’account non riuscita.'; }
    window.dispatchEvent(new Event('mfp-state'));
    return MFP.read();
  };
  MFP.signOut = async () => {
    const { error } = await client.auth.signOut();
    if (error) throw error;
    location.assign('home2.html');
  };
  client.auth.onAuthStateChange(event => {
    if (event === 'SIGNED_OUT') {
      MFP.serverState = MFP.fresh(); MFP.account = null;
      window.dispatchEvent(new Event('mfp-state'));
    }
  });
  window.addEventListener('pageshow', event => { if (event.persisted) MFP.refresh(); });
  await MFP.refresh();
}
