-- Nessuna bozza legale viene attivata da questa migrazione.
create table public.mfp_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null check (length(first_name) between 1 and 80),
  last_name text not null check (length(last_name) between 1 and 80),
  phone text not null check (length(phone) between 6 and 30),
  created_at timestamptz not null default now()
);
create table public.mfp_legal_documents (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('terms','privacy','profile')),
  version text not null,
  title text not null,
  body text not null,
  approved_at timestamptz,
  active boolean not null default false,
  unique (kind, version),
  check (not active or (approved_at is not null and length(trim(body)) > 0))
);
create unique index mfp_one_current_document on public.mfp_legal_documents(kind) where active;
create table public.mfp_acceptances (
  user_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null references public.mfp_legal_documents(id),
  accepted_at timestamptz not null default now(),
  primary key (user_id, document_id)
);
create table public.mfp_billing_customers (
  user_id uuid primary key references auth.users(id) on delete restrict,
  stripe_customer_id text not null unique,
  created_at timestamptz not null default now()
);
create table public.mfp_checkout_guard (
  user_id uuid primary key references auth.users(id) on delete cascade,
  attempt_id uuid not null default gen_random_uuid(),
  lease_until timestamptz not null default '-infinity',
  lease_id uuid not null default gen_random_uuid(),
  session_id text
);
create table public.mfp_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  completed_weeks integer not null default 0 check (completed_weeks between 0 and 104),
  updated_at timestamptz not null default now()
);
create table public.mfp_payment_events (
  event_id text primary key,
  event_type text not null,
  received_at timestamptz not null default now()
);
create table public.mfp_room_assets (
  room_id text primary key check (room_id ~ '^MFP-RM-00[1-9]$|^MFP-RM-01[0-2]$'),
  storage_path text not null
);

alter table public.mfp_profiles enable row level security;
alter table public.mfp_legal_documents enable row level security;
alter table public.mfp_acceptances enable row level security;
alter table public.mfp_billing_customers enable row level security;
alter table public.mfp_checkout_guard enable row level security;
alter table public.mfp_progress enable row level security;
alter table public.mfp_payment_events enable row level security;
alter table public.mfp_room_assets enable row level security;
-- Tutte le scritture applicative passano dalla Edge Function. Nessun browser può
-- impostare pagamento, progressi, mappatura Stripe o accettazioni per conto terzi.
revoke all on public.mfp_profiles, public.mfp_legal_documents, public.mfp_acceptances,
  public.mfp_billing_customers, public.mfp_checkout_guard, public.mfp_progress,
  public.mfp_payment_events, public.mfp_room_assets from anon, authenticated;
grant select on public.mfp_profiles, public.mfp_acceptances, public.mfp_progress to authenticated;
grant all on public.mfp_profiles, public.mfp_legal_documents, public.mfp_acceptances,
  public.mfp_billing_customers, public.mfp_checkout_guard, public.mfp_progress,
  public.mfp_payment_events, public.mfp_room_assets to service_role;
create policy own_profile on public.mfp_profiles for select to authenticated using (user_id = (select auth.uid()));
create policy own_acceptances on public.mfp_acceptances for select to authenticated using (user_id = (select auth.uid()));
create policy own_progress on public.mfp_progress for select to authenticated using (user_id = (select auth.uid()));

create function public.mfp_accept_documents(p_user uuid, p_documents uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare current_ids uuid[];
begin
  select array_agg(id order by id) into current_ids from public.mfp_legal_documents
    where active and approved_at is not null;
  if coalesce(cardinality(current_ids), 0) <> 3 or
     (select array_agg(x order by x) from unnest(p_documents) x) is distinct from current_ids then
    raise exception 'Documenti non disponibili o versione cambiata';
  end if;
  insert into public.mfp_acceptances(user_id, document_id)
    select p_user, unnest(current_ids) on conflict do nothing;
end;
$$;
create function public.mfp_claim_checkout(p_user uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result public.mfp_checkout_guard;
begin
  insert into public.mfp_checkout_guard(user_id) values (p_user) on conflict do nothing;
  update public.mfp_checkout_guard set lease_until = now() + interval '5 minutes', lease_id = gen_random_uuid()
    where user_id = p_user and lease_until < now() returning * into result;
  if not found then return null; end if;
  return to_jsonb(result);
end;
$$;
revoke all on function public.mfp_accept_documents(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.mfp_claim_checkout(uuid) from public, anon, authenticated;
grant execute on function public.mfp_accept_documents(uuid, uuid[]) to service_role;
grant execute on function public.mfp_claim_checkout(uuid) to service_role;

-- Le versioni già accettate restano leggibili senza cambiarne il testo.
create function public.mfp_keep_accepted_document()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.body, new.title, new.version, new.kind) is distinct from
     (old.body, old.title, old.version, old.kind) and
     exists (select 1 from public.mfp_acceptances where document_id = old.id) then
    raise exception 'Creare una nuova versione del documento già accettato';
  end if;
  return new;
end;
$$;
create trigger mfp_legal_version_guard before update on public.mfp_legal_documents
  for each row execute function public.mfp_keep_accepted_document();

-- Il bucket contiene solo i futuri video riservati, mai copie pubbliche degli stessi.
insert into storage.buckets(id, name, public) values ('mfp-training', 'mfp-training', false)
  on conflict (id) do nothing;
