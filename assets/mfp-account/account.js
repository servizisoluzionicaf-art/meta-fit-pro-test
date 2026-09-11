const $ = id => document.getElementById(id);
const say = message => { $('account-status').textContent = message; };
const callback = new URL('account.html', location.href).href;
let documents = [], opened = new Set(), busy = false;
const message = error => error.message || 'Non riesco a completare la richiesta. Riprova.';
function authError(error) {
  if (!error) return;
  const copy = { invalid_credentials: 'Email o password non corrette.', email_not_confirmed: 'Conferma prima la tua email.',
    over_email_send_rate_limit: 'Attendi qualche minuto prima di richiedere una nuova email.', weak_password: 'Scegli una password più lunga e difficile da indovinare.' };
  throw new Error(copy[error.code] || 'Richiesta non completata. Verifica i dati e riprova tra poco.');
}
async function action(button, work) {
  if (busy) return;
  busy = true; if (button) button.disabled = true;
  try { await work(); } catch (error) { say(message(error)); }
  finally { busy = false; if (button) button.disabled = false; }
}
function openDocument(document) {
  $('document-title').textContent = document.title;
  $('document-version').textContent = 'Versione ' + document.version;
  $('document-body').textContent = document.body;
  opened.add(document.id);
  $('document-dialog').showModal();
  documentForCheckbox(document.id)?.removeAttribute('disabled');
  if (document.kind === 'privacy') $('register-submit').disabled = false;
}
const documentForCheckbox = id => [...$('consent-list').querySelectorAll('input')].find(input => input.value === id);
$('close-document').addEventListener('click', () => $('document-dialog').close());
function renderConsents() {
  $('consent-list').replaceChildren();
  const labels = { terms: 'Accetto i Termini e condizioni.', privacy: 'Ho preso visione dell’informativa privacy.', profile: 'Acconsento al trattamento descritto nel documento per il profilo.' };
  for (const document of documents) {
    const row = window.document.createElement('div'); row.className = 'consent-row';
    const button = window.document.createElement('button'); button.type = 'button'; button.textContent = 'Leggi · ' + document.title;
    button.addEventListener('click', () => openDocument(document));
    const label = window.document.createElement('label'), input = window.document.createElement('input');
    input.type = 'checkbox'; input.value = document.id; input.required = true; input.disabled = !opened.has(document.id);
    input.addEventListener('change', () => { $('save-consents').disabled = ![...$('consent-list').querySelectorAll('input')].every(i => i.checked); });
    label.append(input, window.document.createTextNode(labels[document.kind])); row.append(button, label); $('consent-list').append(row);
  }
}
async function render() {
  const { data } = await MFP.auth.getSession();
  const loggedIn = !!data.session;
  $('auth-panel').hidden = loggedIn;
  $('member-panel').hidden = !loggedIn;
  if (loggedIn && new URLSearchParams(location.search).has('recovery')) {
    $('member-panel').hidden = true; $('recovery-form').hidden = false;
    say('Scegli una nuova password per il tuo account.'); return;
  }
  if (!loggedIn) { say('Accedi oppure crea il tuo account.'); return; }
  if (MFP.problem || !MFP.account) { say(MFP.problem || 'Verifica dell’account in corso. Ricarica tra qualche istante.'); return; }
  const state = MFP.read();
  $('welcome').textContent = 'Ciao ' + MFP.account.firstName + '.';
  $('membership').textContent = state.paid ? 'Il tuo abbonamento è attivo.' : 'Completa l’attivazione per accedere alle stanze.';
  $('consent-panel').hidden = state.consented;
  $('continue-account').hidden = !state.consented;
  $('continue-account').href = state.paid ? 'home2.html' : 'home3.html';
  $('continue-account').textContent = state.paid ? 'TORNA ALLE STANZE →' : 'CONTINUA AL PAGAMENTO →';
  $('manage-billing').hidden = !state.canManage;
  if (!state.consented) renderConsents();
  say('Email confermata.');
}
await MFP.ready;
if (!MFP.real || !MFP.auth) {
  say('Le registrazioni non sono ancora aperte. Puoi continuare a visitare Meta Fit Pro dalla Home 2.');
} else {
  try {
    const legal = await MFP.api('documents');
    if (!legal.ready) throw new Error('Le nuove attivazioni non sono ancora disponibili.');
    documents = legal.documents;
    await render();
  } catch (error) { say(message(error)); }
}
for (const mode of ['login', 'register']) $('show-' + mode).addEventListener('click', () => {
  $('login-form').hidden = mode !== 'login'; $('register-form').hidden = mode !== 'register';
  $('show-login').setAttribute('aria-pressed', String(mode === 'login'));
  $('show-register').setAttribute('aria-pressed', String(mode === 'register'));
});
$('register-privacy').addEventListener('click', () => {
  const privacy = documents.find(d => d.kind === 'privacy'); if (privacy) openDocument(privacy);
});
$('register-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!documents.some(d => d.kind === 'privacy' && opened.has(d.id))) return;
  action($('register-submit'), async () => {
    const fields = new FormData(event.currentTarget);
    const password = fields.get('password');
    const { error } = await MFP.auth.signUp({ email: fields.get('email').trim(), password,
      options: { emailRedirectTo: callback, data: { first_name: fields.get('first_name').trim(), last_name: fields.get('last_name').trim(), phone: fields.get('phone').trim() } } });
    authError(error); $('register-form').elements.password.value = '';
    say('Controlla la tua email: se la registrazione può essere completata, riceverai il link di conferma. Aprilo nello stesso browser usato qui.');
  });
});
$('login-form').addEventListener('submit', event => {
  event.preventDefault(); const fields = new FormData(event.currentTarget);
  action(event.submitter, async () => {
    const { error } = await MFP.auth.signInWithPassword({ email: fields.get('email').trim(), password: fields.get('password') });
    authError(error); $('login-form').elements.password.value = ''; await MFP.refresh(); await render();
  });
});
function loginEmail() {
  const email = $('login-form').elements.email;
  if (!email.reportValidity()) return null;
  return email.value.trim();
}
$('forgot-password').addEventListener('click', event => {
  const email = loginEmail(); if (!email) return;
  action(event.currentTarget, async () => {
    const { error } = await MFP.auth.resetPasswordForEmail(email, { redirectTo: callback + '?recovery=1' });
    authError(error); say('Se l’indirizzo è associato a un account, riceverai un’email per reimpostare la password.');
  });
});
$('resend-email').addEventListener('click', event => {
  const email = loginEmail(); if (!email) return;
  action(event.currentTarget, async () => {
    const { error } = await MFP.auth.resend({ type: 'signup', email, options: { emailRedirectTo: callback } });
    authError(error); say('Se è necessaria una conferma, riceverai una nuova email.');
  });
});
$('recovery-form').addEventListener('submit', event => {
  event.preventDefault(); const password = event.currentTarget.elements.password.value;
  action(event.submitter, async () => {
    const { error } = await MFP.auth.updateUser({ password }); authError(error);
    $('recovery-form').reset(); $('recovery-form').hidden = true; history.replaceState(null, '', 'account.html');
    await MFP.refresh(); await render(); say('Password aggiornata.');
  });
});
$('consent-form').addEventListener('submit', event => {
  event.preventDefault();
  const inputs = [...$('consent-list').querySelectorAll('input')];
  if (inputs.length !== 3 || !inputs.every(i => i.checked && opened.has(i.value))) return;
  action(event.submitter, async () => {
    await MFP.api('consents', { documentIds: inputs.map(i => i.value) }); await MFP.refresh();
    if (MFP.problem) throw new Error(MFP.problem);
    location.assign(MFP.read().paid ? 'home2.html' : 'home3.html');
  });
});
$('manage-billing').addEventListener('click', event => action(event.currentTarget, async () => {
  const { url } = await MFP.api('portal', {}); location.assign(url);
}));
$('sign-out').addEventListener('click', event => action(event.currentTarget, () => MFP.signOut()));
