-- Accounts: trips can be backed up and synced across a signed-in user's devices.
-- Rows are private to their owner (RLS); the app talks to them through the functions below.
create table public.account_trips (
  user_id     uuid not null references auth.users(id) on delete cascade,
  trip_id     text not null,
  data        jsonb not null default '{}'::jsonb,
  version     bigint not null default 1,
  share_code  text,                -- join code if the trip is shared (visible only to its owner)
  deleted_at  timestamptz,         -- soft delete so other devices learn about it
  updated_at  timestamptz not null default now(),
  primary key (user_id, trip_id)
);
alter table public.account_trips enable row level security;
revoke all on public.account_trips from anon, authenticated;
create policy account_trips_owner on public.account_trips
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- shared trips can now belong to an account (so any of the owner's devices can stop sharing)
alter table public.shared_trips add column owner_id uuid references auth.users(id) on delete set null;

create or replace function public.share_create(p_code text, p_owner text, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_code !~ '^[A-Z2-9]{16}$' then raise exception 'bad code'; end if;
  if length(coalesce(p_owner, '')) < 16 then raise exception 'bad owner secret'; end if;
  if octet_length(p_data::text) > 1500000 then raise exception 'trip too large'; end if;
  insert into shared_trips (code_hash, owner_hash, owner_id, data)
    values (_sha(p_code), _sha(p_owner), (select auth.uid()), p_data);
  return jsonb_build_object('version', 1);
exception when unique_violation then raise exception 'code in use';
end $$;

create or replace function public.share_delete(p_code text, p_owner text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
begin
  delete from shared_trips
   where code_hash = _sha(p_code)
     and ((p_owner is not null and owner_hash = _sha(p_owner))
          or (owner_id is not null and owner_id = (select auth.uid())));
  return found;
end $$;

-- A signed-in user takes ownership of a trip they shared before signing in.
create or replace function public.share_claim(p_code text, p_owner text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
begin
  if (select auth.uid()) is null then raise exception 'not signed in'; end if;
  update shared_trips set owner_id = (select auth.uid())
   where code_hash = _sha(p_code) and owner_hash = _sha(p_owner);
  return found;
end $$;

-- The signed-in user's trips (no data): used to discover trips from other devices.
create or replace function public.acct_list()
returns table (trip_id text, version bigint, share_code text, deleted boolean)
language sql security definer set search_path = public as $$
  select trip_id, version, share_code, deleted_at is not null
    from account_trips where user_id = (select auth.uid());
$$;

create or replace function public.acct_get(p_trip text, p_have bigint default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r account_trips;
begin
  select * into r from account_trips where user_id = (select auth.uid()) and trip_id = p_trip;
  if not found then return jsonb_build_object('missing', true); end if;
  if r.deleted_at is not null then return jsonb_build_object('deleted', true); end if;
  if r.version <= coalesce(p_have, 0) then return null; end if;
  return jsonb_build_object('version', r.version, 'data', r.data, 'share_code', r.share_code);
end $$;

-- Save a merged trip (creates it if new). p_share: null = leave, '' = clear, else set.
create or replace function public.acct_put(p_trip text, p_base bigint, p_data jsonb, p_share text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r account_trips; uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in'; end if;
  if octet_length(p_data::text) > 1500000 then raise exception 'trip too large'; end if;
  select * into r from account_trips where user_id = uid and trip_id = p_trip for update;
  if not found then
    insert into account_trips (user_id, trip_id, data, share_code)
      values (uid, p_trip, p_data, nullif(p_share, ''));
    return jsonb_build_object('version', 1);
  end if;
  if r.deleted_at is not null then return jsonb_build_object('deleted', true); end if;
  if r.version <> p_base then
    return jsonb_build_object('conflict', true, 'version', r.version, 'data', r.data, 'share_code', r.share_code);
  end if;
  update account_trips
     set data = p_data, version = r.version + 1, updated_at = now(),
         share_code = case when p_share is null then share_code else nullif(p_share, '') end
   where user_id = uid and trip_id = p_trip;
  return jsonb_build_object('version', r.version + 1);
end $$;

create or replace function public.acct_delete(p_trip text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if (select auth.uid()) is null then raise exception 'not signed in'; end if;
  update account_trips set deleted_at = now(), data = '{}'::jsonb, share_code = null, version = version + 1, updated_at = now()
   where user_id = (select auth.uid()) and trip_id = p_trip;
  return found;
end $$;

-- Delete the signed-in user's account and everything tied to it.
create or replace function public.delete_my_account()
returns boolean language plpgsql security definer set search_path = public, auth as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in'; end if;
  delete from shared_trips where owner_id = uid;
  delete from auth.users where id = uid;   -- cascades to account_trips
  return true;
end $$;

-- Only signed-in users may call the account functions; the share functions stay open to the app.
revoke execute on function public.acct_list(), public.acct_get(text, bigint), public.acct_put(text, bigint, jsonb, text),
  public.acct_delete(text), public.delete_my_account(), public.share_claim(text, text) from public, anon;
grant execute on function public.acct_list(), public.acct_get(text, bigint), public.acct_put(text, bigint, jsonb, text),
  public.acct_delete(text), public.delete_my_account(), public.share_claim(text, text) to authenticated;
revoke execute on function public.share_create(text, text, jsonb), public.share_delete(text, text) from public;
grant execute on function public.share_create(text, text, jsonb), public.share_delete(text, text) to anon, authenticated;
