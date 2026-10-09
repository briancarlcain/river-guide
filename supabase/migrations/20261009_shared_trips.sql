-- Crew sync for River Guide (applied to the river-guide-sync Supabase project).
-- One row per shared trip. The join code is never stored, only its hash, and the
-- table is closed to direct access: the app can only call the functions below.
create extension if not exists pgcrypto with schema extensions;

create table public.shared_trips (
  code_hash   text primary key,
  owner_hash  text not null,
  data        jsonb not null,
  version     bigint not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.shared_trips enable row level security;
revoke all on public.shared_trips from anon, authenticated;

create or replace function public._sha(t text) returns text
language sql immutable set search_path = extensions, public as
$$ select encode(extensions.digest(t, 'sha256'), 'hex') $$;

-- Start sharing a trip. p_owner is a secret kept on the creator's device; it is
-- required to stop sharing (delete the server copy).
create or replace function public.share_create(p_code text, p_owner text, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_code !~ '^[A-Z2-9]{16}$' then raise exception 'bad code'; end if;
  if length(coalesce(p_owner, '')) < 16 then raise exception 'bad owner secret'; end if;
  if octet_length(p_data::text) > 1500000 then raise exception 'trip too large'; end if;
  insert into shared_trips (code_hash, owner_hash, data) values (_sha(p_code), _sha(p_owner), p_data);
  return jsonb_build_object('version', 1);
exception when unique_violation then raise exception 'code in use';
end $$;

-- Fetch the trip if the server has a version newer than p_have; null otherwise.
create or replace function public.share_get(p_code text, p_have bigint default 0)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare r shared_trips;
begin
  select * into r from shared_trips where code_hash = _sha(p_code);
  if not found then return jsonb_build_object('missing', true); end if;
  if r.version <= coalesce(p_have, 0) then return null; end if;
  return jsonb_build_object('version', r.version, 'data', r.data, 'updated_at', r.updated_at);
end $$;

-- Save a merged trip. Succeeds only if p_base is the current version; otherwise
-- returns the newer copy so the client can merge again and retry.
create or replace function public.share_put(p_code text, p_base bigint, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare r shared_trips;
begin
  if octet_length(p_data::text) > 1500000 then raise exception 'trip too large'; end if;
  select * into r from shared_trips where code_hash = _sha(p_code) for update;
  if not found then return jsonb_build_object('missing', true); end if;
  if r.version <> p_base then
    return jsonb_build_object('conflict', true, 'version', r.version, 'data', r.data);
  end if;
  update shared_trips set data = p_data, version = r.version + 1, updated_at = now() where code_hash = r.code_hash;
  return jsonb_build_object('version', r.version + 1);
end $$;

-- Stop sharing: removes the server copy. Only the creating device can do this.
create or replace function public.share_delete(p_code text, p_owner text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
begin
  delete from shared_trips where code_hash = _sha(p_code) and owner_hash = _sha(p_owner);
  return found;
end $$;

revoke execute on function public.share_create(text, text, jsonb), public.share_get(text, bigint),
  public.share_put(text, bigint, jsonb), public.share_delete(text, text), public._sha(text) from public;
grant execute on function public.share_create(text, text, jsonb), public.share_get(text, bigint),
  public.share_put(text, bigint, jsonb), public.share_delete(text, text) to anon, authenticated;
