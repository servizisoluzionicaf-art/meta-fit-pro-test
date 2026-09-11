# Account, pagamento e accesso alle stanze

Questa integrazione aggiunge account con email verificata, documenti versionati, pagamento Stripe e controllo dell’abbonamento sul server. È preparata per il sito statico già pubblicato su GitHub Pages: non richiede di ricostruire la grafica o spostare il sito.

**Stato: implementazione da configurare e collaudare con gli account del progetto. Non è un servizio di pagamento già attivo.** La configurazione pubblica ha `enabled: false` e il server richiede `MFP_SALES_ENABLED=true`. Nessuna credenziale è inclusa.

## Cosa cambia

- Registrazione con nome, cognome, email, telefono e password; conferma email, accesso, nuova email di conferma, recupero password e uscita.
- Documenti aperti singolarmente e caselle inizialmente vuote. Il database registra ID della versione e data di accettazione. L’apertura nel browser non viene presentata come prova dell’effettiva lettura.
- Home 3 conserva il suo HTML approvato, incluse immagini e CSS dei coach. Solo in modalità attiva lo script sostituisce i campi dimostrativi con il passaggio al Checkout protetto di Stripe. Il sito non raccoglie né salva numeri di carta o CVV.
- Stripe applica il prezzo mensile da 19,99 € e uno sconto da 5 € al mese per tre mesi: 14,99 € al mese inizialmente, poi 19,99 €. Valuta, periodicità, sconto e ambiente test/produzione sono verificati sul server. Il prezzo configurato deve essere comprensivo di imposte per non cambiare l’importo esposto.
- Dopo il pagamento si torna alla Home 2; la Home 4 seleziona la stanza e rimanda alla Home 2, che apre automaticamente la porta e mantiene l’animazione approvata.
- Cinque stanze iniziali; una nuova stanza ogni due settimane di programma completate. Non è un conteggio dei giorni trascorsi dall’iscrizione. Nessuno smartwatch è incluso.
- Gestione abbonamento e fatture tramite il portale Stripe del cliente autenticato.

## Cosa manca prima dell’attivazione pubblica

1. Un progetto Supabase intestato al progetto, con Auth, Postgres e Edge Functions. È il servizio scelto per questa implementazione; non era già collegato al sito.
2. Account Stripe, prezzo, coupon, portale cliente e webhook configurati prima in modalità test.
3. I testi definitivi di Termini, Privacy e trattamento dei dati del profilo. Gli HTML esistenti `termini-condizioni.html` e `privacy.html` sono bozze dichiarate. La bozza dei Termini contiene ancora un vecchio riferimento al regalo smartwatch: deve essere eliminato nella revisione definitiva, in accordo con la decisione di Max. Non sono stati inventati o approvati nuovi testi.
4. Invio email di produzione (SMTP e dominio mittente), recapiti dell’attività, rinnovi, cancellazioni, imposte e configurazione commerciale effettiva.
5. I video e i programmi riservati. Le stanze HTML attuali sono ambientazioni pubbliche dimostrative; un controllo JavaScript non può renderle private. La migrazione prepara un bucket privato separato per gli allenamenti, senza copiarvi contenuti o inventare programmi.
6. Il servizio che certifica le settimane di programma effettivamente completate. Il browser non può aggiornarle e al momento partono da zero. Non è ancora implementato l’intero percorso test fitness → piano → registrazione degli allenamenti.

## Configurazione del backend

Creare il progetto Supabase, configurare la verifica email obbligatoria, una password minima di 12 caratteri e SMTP. Mantenere chiuse le nuove iscrizioni finché l’informativa e il servizio non sono pronti. Configurare limiti di invio e protezione antiabuso in Supabase Auth.

Nel progetto Supabase impostare il Site URL e le redirect consentite esatte:

```text
https://servizisoluzionicaf-art.github.io/meta-fit-pro-test/account.html
https://servizisoluzionicaf-art.github.io/meta-fit-pro-test/account.html?recovery=1
```

L’autenticazione usa PKCE: il link di conferma va aperto nello stesso browser usato per la richiesta. In fase di collaudo verificare anche i link di recupero password e le email inviate su cellulare.

Dalla copia di questo repository, con la CLI ufficiale Supabase autenticata al proprio account:

```sh
supabase link --project-ref IL_PROGETTO
supabase db push
supabase secrets set --env-file /percorso/privato/mfp.env
supabase functions deploy mfp-api --no-verify-jwt
```

Il file privato parte dal modello `supabase/functions/.env.example`. Non inserirlo nel repository. `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` vengono forniti dall’ambiente delle Edge Functions. Il JWT viene verificato con `auth.getUser()` in ogni route riservata; la verifica JWT del gateway è disattivata soltanto perché la stessa funzione riceve anche il webhook Stripe, verificato con la sua firma.

Registrare in Stripe il webhook:

```text
https://IL_PROGETTO.supabase.co/functions/v1/mfp-api/webhook
```

Sottoscrivere almeno `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`. Copiare il signing secret soltanto nei secrets Supabase.

Abilitare il portale cliente Stripe con gestione del metodo di pagamento, fatture e cancellazione secondo le condizioni definitive. Creare il prezzo in EUR da 1999 centesimi, ricorrente ogni mese, con imposte incluse, e il coupon da 500 centesimi, durata ripetuta di tre mesi. La contabilizzazione delle imposte e l’ammissibilità alla promozione in caso di riattivazione vanno concordate nella configurazione commerciale: questa versione applica il coupon ad ogni nuovo abbonamento, senza modificarne il prezzo dal browser.

## Documenti e allenamenti

Nella tabella `mfp_legal_documents` inserire una versione approvata per ciascuna categoria `terms`, `privacy`, `profile`, con `title`, `version`, `body` (testo completo), `approved_at` e `active=true`. Non attivare le bozze presenti nel repository. Le accettazioni usano le versioni nel database; prima del lancio aggiornare anche gli HTML pubblici con gli stessi testi definitivi.

È ammessa una sola versione attiva per categoria. Il testo di una versione già accettata non può essere modificato: inserire una nuova versione e disattivare la precedente. I consensi sono ricontrollati prima di creare il pagamento.

Per un allenamento riservato, caricare il file nel bucket **privato** `mfp-training` e aggiungere in `mfp_room_assets` la corrispondenza tra `room_id` (es. `MFP-RM-001`) e `storage_path`. L’endpoint `/room` verifica prima abbonamento e settimane, poi genera un URL firmato valido un’ora. Questo URL consente la visione temporanea a chi lo possiede; non va pubblicato né memorizzato permanentemente. Un’eventuale revoca dell’abbonamento non revoca un URL già emesso prima della sua scadenza.

Il video viene inserito nella stanza solo quando è presente una corrispondenza privata. In mancanza, rimane l’ambientazione esistente. Non vendere questo stato come un catalogo completo di allenamenti.

## Collegamento al sito e collaudo

In `assets/mfp-account/config.js` inserire esclusivamente URL Supabase e chiave **pubblica/publishable**. Mai chiavi Stripe, SMTP o `service_role`. Il file può essere pubblico. Il ramo di integrazione parte con `enabled: false`, quindi conserva la prova esistente.

Prima dell’attivazione in produzione, su una copia di staging impostare `enabled: true`, `MFP_SALES_ENABLED=true`, chiavi Stripe test e `STRIPE_LIVE_MODE=false`, con le corrispondenti destinazioni di staging configurate nel backend e in Auth. Il frontend deve essere servito via HTTPS, non aperto come `file://`, perché carica moduli JavaScript e gestisce i ritorni dall’autenticazione.

Il frontend usa il client Supabase fissato alla versione `2.102.0` tramite esm.sh; se il caricamento fallisce, l’integrazione si ferma senza trasformare un account reale in una prova. Le dipendenze della funzione sono fissate nel file `index.ts`.

Controlli automatizzati eseguibili senza credenziali:

```sh
node --test tests/billing.test.mjs
node --check assets/mfp-approved/home2.js
node --check assets/mfp-approved/home3.js
node --check assets/mfp-approved/home4.js
node --check assets/mfp-account/account.js
node --check assets/mfp-account/client.js
```

I 12 test del codice sono passati con servizi simulati. La migrazione è stata inoltre eseguita su Postgres locale tramite PGlite: verificati isolamento tra due utenti, blocco delle scritture e delle RPC dal browser, versioni dei documenti, lease del pagamento e bucket privato. Questo non equivale a un pagamento reale o a un collaudo del progetto Supabase. Prima del lancio verificare con gli account configurati: registrazione e conferma email, recupero password, isolamento dei dati tra due utenti, consensi aggiornati, pagamento test riuscito/rifiutato/annullato, doppio clic da due schede, rinnovo fallito, cancellazione, portale cliente, webhook firmati, stanza premio a 1/2 settimane, video privati e navigazione su cellulare. Applicare la migrazione anche a un database di test per verificarne permessi e vincoli effettivi.

Solo dopo il collaudo passare alle chiavi di produzione, prezzo/coupon di produzione e `STRIPE_LIVE_MODE=true`. Poi unire il ramo e abilitare la configurazione pubblica. I due flag frontend/server servono al rilascio; non sono l’autorizzazione alle stanze.

## Come viene verificato l’accesso

L’URL di ritorno dal pagamento e `sessionStorage` non concedono abbonamenti. Il server legge le sottoscrizioni Stripe del cliente associato all’utente verificato e richiede stato `active`, prezzo atteso, fattura pagata e periodo non scaduto. Il progresso arriva dal database e non accetta numeri inviati dal browser.

Il webhook registra soltanto ID e tipo dell’evento, senza payload personali. Gli eventi duplicati o fuori ordine non modificano i diritti: la verifica rilegge lo stato corrente da Stripe. In caso di indisponibilità di Stripe l’accesso non viene concesso in base a una copia locale.

La creazione del pagamento usa una lease per utente e un ID di tentativo persistente. Un secondo clic riutilizza una sessione aperta; un abbonamento già esistente rimanda alla sua gestione. Le URL di ritorno e gli importi sono scelti sul server. Le tabelle di pagamenti, progressi e accettazioni non sono scrivibili dal browser; i profili e le accettazioni sono leggibili soltanto dal proprietario tramite RLS.

## Riferimenti ufficiali

- [Supabase: autenticazione con password e verifica email](https://supabase.com/docs/guides/auth/passwords)
- [Supabase: protezione delle Edge Functions](https://supabase.com/docs/guides/functions/auth)
- [Supabase: webhook Stripe e verifica della firma](https://supabase.com/docs/guides/functions/examples/stripe-webhooks)
- [Stripe: creazione di Checkout Session](https://docs.stripe.com/api/checkout/sessions/create)
- [Stripe: coupon e durata dello sconto](https://docs.stripe.com/api/coupons/create)
