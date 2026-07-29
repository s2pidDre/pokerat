-- Pokerat Supabase authentication and account-approval schema.
-- Run this entire file once in Supabase Dashboard -> SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  display_name text not null,
  email text not null,
  account_status text not null default 'pending' check (account_status in ('pending', 'active', 'rejected', 'suspended')),
  is_admin boolean not null default false,
  must_change_password boolean not null default false,
  status_note text not null default '',
  approved_at timestamptz,
  approved_by uuid references public.profiles(id) on delete set null,
  rejected_at timestamptz,
  rejected_by uuid references public.profiles(id) on delete set null,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format check (username ~ '^[a-z0-9_]{3,20}$'),
  constraint profiles_display_name_length check (char_length(display_name) between 3 and 24)
);

create unique index if not exists profiles_username_unique on public.profiles (lower(username));
create unique index if not exists profiles_email_unique on public.profiles (lower(email));
create index if not exists profiles_status_created_idx on public.profiles (account_status, created_at);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_username text;
  requested_display_name text;
begin
  requested_username := lower(trim(coalesce(new.raw_user_meta_data ->> 'username', '')));
  requested_username := regexp_replace(requested_username, '[^a-z0-9_]', '', 'g');
  requested_display_name := trim(coalesce(new.raw_user_meta_data ->> 'display_name', requested_username));

  if requested_username !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'Username must use 3-20 lowercase letters, numbers, or underscores.';
  end if;

  insert into public.profiles (
    id, username, display_name, email, account_status, is_admin, created_at, updated_at
  ) values (
    new.id,
    requested_username,
    left(coalesce(nullif(requested_display_name, ''), requested_username), 24),
    lower(coalesce(new.email, '')),
    'pending',
    false,
    now(),
    now()
  );

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.sync_auth_user_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles
      set email = lower(coalesce(new.email, '')), updated_at = now()
      where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
after update of email on auth.users
for each row execute function public.sync_auth_user_email();

create or replace function public.is_active_admin(check_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = check_user and is_admin = true and account_status = 'active'
  );
$$;

create or replace function public.has_active_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where is_admin = true and account_status = 'active'
  );
$$;

create or replace function public.bootstrap_first_admin()
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.profiles;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  perform pg_advisory_xact_lock(hashtext('pokerat-first-admin'));

  if public.has_active_admin() then
    raise exception 'An administrator already exists.';
  end if;

  update public.profiles
    set account_status = 'active',
        is_admin = true,
        approved_at = now(),
        approved_by = id,
        rejected_at = null,
        rejected_by = null,
        status_note = '',
        updated_at = now()
    where id = auth.uid()
    returning * into result;

  if result.id is null then
    raise exception 'Profile not found.';
  end if;

  return result;
end;
$$;

create or replace function public.update_own_profile(p_display_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  p_display_name := trim(regexp_replace(coalesce(p_display_name, ''), '\s+', ' ', 'g'));
  if char_length(p_display_name) < 3 or char_length(p_display_name) > 24 then
    raise exception 'Display name must contain 3-24 characters.';
  end if;
  update public.profiles set display_name = p_display_name, updated_at = now() where id = auth.uid();
end;
$$;

create or replace function public.complete_password_change()
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles set must_change_password = false, updated_at = now() where id = auth.uid();
$$;

create or replace function public.touch_last_login()
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles set last_login_at = now(), updated_at = now() where id = auth.uid();
$$;

alter table public.profiles enable row level security;

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
revoke all on function public.set_updated_at() from public;
revoke all on function public.handle_new_auth_user() from public;
revoke all on function public.sync_auth_user_email() from public;
revoke all on function public.is_active_admin(uuid) from public;
revoke all on function public.has_active_admin() from public;
revoke all on function public.bootstrap_first_admin() from public;
revoke all on function public.update_own_profile(text) from public;
revoke all on function public.complete_password_change() from public;
revoke all on function public.touch_last_login() from public;
grant execute on function public.is_active_admin(uuid) to authenticated;
grant execute on function public.has_active_admin() to anon, authenticated;
grant execute on function public.bootstrap_first_admin() to authenticated;
grant execute on function public.update_own_profile(text) to authenticated;
grant execute on function public.complete_password_change() to authenticated;
grant execute on function public.touch_last_login() to authenticated;

-- A user may read their own profile. An active administrator may read every profile.
drop policy if exists profiles_select_own_or_admin on public.profiles;
create policy profiles_select_own_or_admin
on public.profiles
for select
to authenticated
using (id = auth.uid() or public.is_active_admin());

-- Profile creation, status changes and deletion happen only through Auth triggers or protected functions.

-- Add profiles to Supabase Realtime exactly once.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
end $$;
