-- Pokerat shared table, money, history, leaderboard and realtime schema.
-- Run this entire file after supabase/schema.sql.

create extension if not exists pgcrypto;

create table if not exists public.poker_tables (
  id uuid primary key default gen_random_uuid(),
  session_code text not null unique,
  name text not null,
  host_user_id uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'lobby' check (status in ('lobby', 'active', 'closed', 'cancelled')),
  started_at timestamptz,
  closed_at timestamptz,
  cancelled_at timestamptz,
  duration_seconds integer,
  expected_funds_cents bigint,
  counted_funds_cents bigint,
  discrepancy_cents bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint poker_tables_name_length check (char_length(trim(name)) between 1 and 60),
  constraint poker_tables_code_format check (session_code ~ '^PKR-[A-Z2-9]{4}$'),
  constraint poker_tables_duration_nonnegative check (duration_seconds is null or duration_seconds >= 0)
);

-- Pokerat allows only one lobby or active table at a time.
-- When upgrading an older test database, keep the newest open table and cancel any older duplicates.
do $$
declare
  keeper_id uuid;
begin
  select id into keeper_id
  from public.poker_tables
  where status in ('lobby', 'active')
  order by created_at desc
  limit 1;

  if keeper_id is not null then
    update public.poker_tables
    set status = 'cancelled',
        cancelled_at = coalesce(cancelled_at, now()),
        updated_at = now()
    where status in ('lobby', 'active')
      and id <> keeper_id;
  end if;
end;
$$;

create unique index if not exists poker_tables_single_open_idx
  on public.poker_tables ((1))
  where status in ('lobby', 'active');

create table if not exists public.table_members (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.poker_tables(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete restrict,
  member_role text not null default 'player' check (member_role in ('host', 'player')),
  joined_at timestamptz not null default now(),
  unique (table_id, user_id)
);

create unique index if not exists table_members_one_host_idx
  on public.table_members(table_id)
  where member_role = 'host';
create index if not exists table_members_user_idx on public.table_members(user_id, joined_at desc);

create table if not exists public.money_requests (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.poker_tables(id) on delete cascade,
  requester_id uuid not null references public.profiles(id) on delete restrict,
  request_type text not null check (request_type in ('cash_in', 'cash_out')),
  requested_amount_cents bigint not null check (requested_amount_cents > 0),
  approved_amount_cents bigint,
  note text not null default '',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  rejection_reason text not null default '',
  cancellation_reason text not null default '',
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles(id) on delete set null,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists money_requests_one_pending_kind_idx
  on public.money_requests(table_id, requester_id, request_type)
  where status = 'pending';
create index if not exists money_requests_host_queue_idx
  on public.money_requests(table_id, status, requested_at);
create index if not exists money_requests_requester_idx
  on public.money_requests(requester_id, requested_at desc);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.poker_tables(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete restrict,
  transaction_type text not null check (transaction_type in ('buy_in', 'cash_out', 'reversal', 'adjustment')),
  amount_cents bigint not null check (amount_cents > 0),
  is_reversed boolean not null default false,
  correction_reason text not null default '',
  reverses_transaction_id uuid references public.transactions(id) on delete set null,
  request_id uuid references public.money_requests(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists transactions_request_unique_idx
  on public.transactions(request_id)
  where request_id is not null and transaction_type in ('buy_in', 'cash_out');
create index if not exists transactions_table_created_idx on public.transactions(table_id, created_at desc);
create index if not exists transactions_player_idx on public.transactions(player_id, created_at desc);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  message text not null,
  type text not null default 'info' check (type in ('info', 'request', 'approved', 'rejected')),
  table_id uuid references public.poker_tables(id) on delete cascade,
  request_id uuid references public.money_requests(id) on delete set null,
  request_kind text not null default '',
  delivery text not null default '',
  action_hash text not null default '',
  result_summary jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists notifications_user_unread_idx on public.notifications(user_id, read_at, created_at desc);

create table if not exists public.session_results (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.poker_tables(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete restrict,
  cash_in_cents bigint not null default 0,
  cash_out_cents bigint not null default 0,
  net_cents bigint not null default 0,
  duration_seconds integer not null default 0,
  created_at timestamptz not null default now(),
  unique (table_id, user_id)
);

create index if not exists session_results_user_idx on public.session_results(user_id, created_at desc);
create index if not exists session_results_net_idx on public.session_results(net_cents desc);


-- Shared updated_at trigger.
drop trigger if exists poker_tables_set_updated_at on public.poker_tables;
create trigger poker_tables_set_updated_at before update on public.poker_tables
for each row execute function public.set_updated_at();
drop trigger if exists money_requests_set_updated_at on public.money_requests;
create trigger money_requests_set_updated_at before update on public.money_requests
for each row execute function public.set_updated_at();

create or replace function public.is_active_user(check_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = check_user and account_status = 'active'
  );
$$;

create or replace function public.is_table_member(check_table uuid, check_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.table_members
    where table_id = check_table and user_id = check_user
  );
$$;

create or replace function public.is_table_host(check_table uuid, check_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.poker_tables
    where id = check_table and host_user_id = check_user
  );
$$;

create or replace function public.table_funds_cents(check_table uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(
    case
      when transaction_type = 'buy_in' and not is_reversed then amount_cents
      when transaction_type = 'cash_out' and not is_reversed then -amount_cents
      else 0
    end
  ), 0)::bigint
  from public.transactions
  where table_id = check_table;
$$;

create or replace function public.require_active_user()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  if not public.is_active_user(auth.uid()) then raise exception 'Your account is not approved.'; end if;
end;
$$;

create or replace function public.add_pokerat_notification(
  p_user_id uuid,
  p_title text,
  p_message text,
  p_type text default 'info',
  p_table_id uuid default null,
  p_request_id uuid default null,
  p_request_kind text default '',
  p_delivery text default '',
  p_result_summary jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  result uuid;
begin
  insert into public.notifications (
    user_id, title, message, type, table_id, request_id, request_kind, delivery, action_hash, result_summary
  ) values (
    p_user_id,
    p_title,
    p_message,
    case when p_type in ('info', 'request', 'approved', 'rejected') then p_type else 'info' end,
    p_table_id,
    p_request_id,
    coalesce(p_request_kind, ''),
    coalesce(p_delivery, ''),
    case when p_table_id is null then '' else '#/session/' || p_table_id::text end,
    p_result_summary
  ) returning id into result;
  return result;
end;
$$;


create or replace function public.generate_pokerat_code()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  candidate text;
  i integer;
begin
  loop
    candidate := 'PKR-';
    for i in 1..4 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::integer, 1);
    end loop;
    exit when not exists (select 1 from public.poker_tables where session_code = candidate);
  end loop;
  return candidate;
end;
$$;

create or replace function public.create_poker_table(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_name text := trim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  table_row public.poker_tables;
begin
  perform public.require_active_user();
  if char_length(clean_name) < 1 or char_length(clean_name) > 60 then
    raise exception 'Table name must contain 1-60 characters.';
  end if;

  -- Serialize competing create attempts so two devices cannot open tables at the same time.
  perform pg_advisory_xact_lock(hashtext('pokerat_single_open_table'));
  if exists (select 1 from public.poker_tables where status in ('lobby', 'active')) then
    raise exception 'A table is already open. Join it or wait until it is finished.';
  end if;

  insert into public.poker_tables(session_code, name, host_user_id)
  values (public.generate_pokerat_code(), clean_name, auth.uid())
  returning * into table_row;

  insert into public.table_members(table_id, user_id, member_role)
  values (table_row.id, auth.uid(), 'host');

  return jsonb_build_object('table_id', table_row.id, 'session_code', table_row.session_code);
end;
$$;

create or replace function public.join_poker_table(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  table_row public.poker_tables;
  member_exists boolean;
  actor_name text;
begin
  perform public.require_active_user();
  select * into table_row
  from public.poker_tables
  where session_code = upper(trim(coalesce(p_code, '')))
    and status in ('lobby', 'active')
  for update;

  if table_row.id is null then raise exception 'No joinable table matches that code.'; end if;

  select exists(select 1 from public.table_members where table_id = table_row.id and user_id = auth.uid()) into member_exists;
  if not member_exists then
    insert into public.table_members(table_id, user_id, member_role)
    values (table_row.id, auth.uid(), 'player');

    select display_name into actor_name from public.profiles where id = auth.uid();
    perform public.add_pokerat_notification(
      table_row.host_user_id,
      'Player joined',
      coalesce(actor_name, 'A player') || ' joined ' || table_row.name || '.',
      'approved', table_row.id
    );
  end if;

  return jsonb_build_object('table_id', table_row.id, 'already_member', member_exists);
end;
$$;

create or replace function public.start_poker_table(p_table_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare table_row public.poker_tables;
begin
  perform public.require_active_user();
  select * into table_row from public.poker_tables where id = p_table_id for update;
  if table_row.id is null then raise exception 'Table not found.'; end if;
  if table_row.host_user_id <> auth.uid() then raise exception 'Only the host can start this table.'; end if;
  if table_row.status <> 'lobby' then raise exception 'This table is no longer waiting to start.'; end if;

  update public.poker_tables set status = 'active', started_at = now() where id = p_table_id;
  insert into public.notifications(user_id, title, message, type, table_id, action_hash)
  select user_id, 'Table started', table_row.name || ' is now playing.', 'approved', p_table_id, '#/session/' || p_table_id::text
  from public.table_members where table_id = p_table_id and user_id <> auth.uid();
end;
$$;

create or replace function public.cancel_poker_table(p_table_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  table_row public.poker_tables;
  ended_at timestamptz := now();
  seconds integer;
begin
  perform public.require_active_user();
  select * into table_row from public.poker_tables where id = p_table_id for update;
  if table_row.id is null then raise exception 'Table not found.'; end if;
  if table_row.host_user_id <> auth.uid() then raise exception 'Only the host can cancel this table.'; end if;
  if table_row.status not in ('lobby', 'active') then raise exception 'This table cannot be cancelled.'; end if;
  seconds := case when table_row.started_at is null then null else greatest(0, floor(extract(epoch from (ended_at - table_row.started_at)))::integer) end;

  update public.poker_tables
  set status = 'cancelled', cancelled_at = ended_at, duration_seconds = seconds
  where id = p_table_id;

  update public.money_requests
  set status = 'cancelled', cancellation_reason = 'Table cancelled', cancelled_at = ended_at, updated_at = ended_at
  where table_id = p_table_id and status = 'pending';

  insert into public.notifications(user_id, title, message, type, table_id, action_hash)
  select user_id, 'Table cancelled', table_row.name || ' was cancelled.', 'rejected', p_table_id, '#/session/' || p_table_id::text
  from public.table_members where table_id = p_table_id and user_id <> auth.uid();
end;
$$;

create or replace function public.submit_money_request(
  p_table_id uuid,
  p_request_type text,
  p_amount_cents bigint,
  p_note text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  table_row public.poker_tables;
  request_row public.money_requests;
  actor_name text;
begin
  perform public.require_active_user();
  if p_request_type not in ('cash_in', 'cash_out') then raise exception 'Invalid request type.'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'Amount must be greater than zero.'; end if;

  select * into table_row from public.poker_tables where id = p_table_id for update;
  if table_row.id is null then raise exception 'Table not found.'; end if;
  if table_row.status <> 'active' then raise exception 'Money requests are available only while playing.'; end if;
  if not public.is_table_member(p_table_id, auth.uid()) then raise exception 'You are no longer in this table.'; end if;
  if table_row.host_user_id = auth.uid() then raise exception 'The host records their own money directly.'; end if;
  if p_request_type = 'cash_out' and p_amount_cents > public.table_funds_cents(p_table_id) then
    raise exception 'Cash-out cannot exceed the money currently on the table.';
  end if;

  insert into public.money_requests(table_id, requester_id, request_type, requested_amount_cents, note)
  values (p_table_id, auth.uid(), p_request_type, p_amount_cents, left(trim(coalesce(p_note, '')), 250))
  returning * into request_row;

  select display_name into actor_name from public.profiles where id = auth.uid();
  perform public.add_pokerat_notification(
    table_row.host_user_id,
    case when p_request_type = 'cash_in' then 'Cash-in request' else 'Cash-out request' end,
    coalesce(actor_name, 'A player') || ' wants to ' || case when p_request_type = 'cash_in' then 'cash in ' else 'cash out ' end ||
      '₱' || to_char(p_amount_cents::numeric / 100, 'FM9999999990.00') || ' at ' || table_row.name || '.',
    'request', p_table_id, request_row.id,
    case when p_request_type = 'cash_in' then 'buyin' else 'cashout' end,
    'host_money_queue'
  );
  return request_row.id;
exception
  when unique_violation then
    raise exception 'Resolve or cancel your existing request first.';
end;
$$;

create or replace function public.review_money_request(
  p_request_id uuid,
  p_decision text,
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.money_requests;
  table_row public.poker_tables;
  transaction_id uuid;
  requester_name text;
  funds bigint;
begin
  perform public.require_active_user();
  if p_decision not in ('approve', 'reject') then raise exception 'Choose approve or reject.'; end if;

  select * into request_row from public.money_requests where id = p_request_id for update;
  if request_row.id is null then raise exception 'Request not found.'; end if;
  if request_row.status <> 'pending' then raise exception 'This request is no longer pending.'; end if;
  select * into table_row from public.poker_tables where id = request_row.table_id for update;
  if table_row.host_user_id <> auth.uid() then raise exception 'Only the host can decide this request.'; end if;
  if table_row.status <> 'active' then raise exception 'This table is no longer playing.'; end if;

  if p_decision = 'approve' then
    if not public.is_table_member(request_row.table_id, request_row.requester_id) then
      raise exception 'The requester is no longer in this table.';
    end if;
    if request_row.request_type = 'cash_out' and request_row.requested_amount_cents > public.table_funds_cents(request_row.table_id) then
      raise exception 'Cash-out cannot exceed the money currently on the table.';
    end if;

    insert into public.transactions(table_id, player_id, transaction_type, amount_cents, request_id, metadata)
    values (
      request_row.table_id,
      request_row.requester_id,
      case when request_row.request_type = 'cash_in' then 'buy_in' else 'cash_out' end,
      request_row.requested_amount_cents,
      request_row.id,
      jsonb_build_object('requested_amount_cents', request_row.requested_amount_cents)
    ) returning id into transaction_id;

    update public.money_requests
    set status = 'approved', approved_amount_cents = requested_amount_cents, decided_at = now(), decided_by = auth.uid()
    where id = request_row.id;

    perform public.add_pokerat_notification(
      request_row.requester_id,
      case when request_row.request_type = 'cash_in' then 'Cash-in approved' else 'Cash-out approved' end,
      '₱' || to_char(request_row.requested_amount_cents::numeric / 100, 'FM9999999990.00') || ' was approved for ' || table_row.name || '.',
      'approved', request_row.table_id
    );
  else
    update public.money_requests
    set status = 'rejected', rejection_reason = coalesce(nullif(trim(p_reason), ''), 'Rejected by host'),
        decided_at = now(), decided_by = auth.uid()
    where id = request_row.id;

    perform public.add_pokerat_notification(
      request_row.requester_id,
      case when request_row.request_type = 'cash_in' then 'Cash-in rejected' else 'Cash-out rejected' end,
      table_row.name || ': ' || coalesce(nullif(trim(p_reason), ''), 'Rejected by host'),
      'rejected', request_row.table_id
    );
  end if;

  update public.notifications set read_at = now()
  where user_id = auth.uid() and request_id = request_row.id and read_at is null;
  funds := public.table_funds_cents(request_row.table_id);
  return jsonb_build_object('table_id', request_row.table_id, 'table_funds_cents', funds);
end;
$$;

create or replace function public.cancel_money_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare request_row public.money_requests;
begin
  perform public.require_active_user();
  select * into request_row from public.money_requests where id = p_request_id for update;
  if request_row.id is null or request_row.requester_id <> auth.uid() then raise exception 'Request not found.'; end if;
  if request_row.status <> 'pending' then raise exception 'This request is no longer pending.'; end if;
  update public.money_requests
  set status = 'cancelled', cancellation_reason = 'Cancelled by requester', cancelled_at = now()
  where id = request_row.id;
end;
$$;

create or replace function public.record_host_money(
  p_table_id uuid,
  p_transaction_type text,
  p_amount_cents bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare table_row public.poker_tables; transaction_id uuid; funds bigint;
begin
  perform public.require_active_user();
  if p_transaction_type not in ('buy_in', 'cash_out') then raise exception 'Invalid money type.'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'Amount must be greater than zero.'; end if;
  select * into table_row from public.poker_tables where id = p_table_id for update;
  if table_row.id is null then raise exception 'Table not found.'; end if;
  if table_row.host_user_id <> auth.uid() then raise exception 'Only the host can record this directly.'; end if;
  if table_row.status <> 'active' then raise exception 'The table must be playing.'; end if;
  if p_transaction_type = 'cash_out' and p_amount_cents > public.table_funds_cents(p_table_id) then
    raise exception 'Cash-out cannot exceed the money currently on the table.';
  end if;

  insert into public.transactions(table_id, player_id, transaction_type, amount_cents, metadata)
  values (p_table_id, auth.uid(), p_transaction_type, p_amount_cents, jsonb_build_object('confirmation', 'host_self_recorded'))
  returning id into transaction_id;
  funds := public.table_funds_cents(p_table_id);
  return jsonb_build_object('transaction_id', transaction_id, 'table_funds_cents', funds);
end;
$$;

create or replace function public.close_poker_table(p_table_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  table_row public.poker_tables;
  ended_at timestamptz := now();
  seconds integer;
  funds bigint;
  member_row record;
  cash_in bigint;
  cash_out bigint;
  net bigint;
  result_payload jsonb;
begin
  perform public.require_active_user();
  select * into table_row from public.poker_tables where id = p_table_id for update;
  if table_row.id is null then raise exception 'Table not found.'; end if;
  if table_row.host_user_id <> auth.uid() then raise exception 'Only the host can end this table.'; end if;
  if table_row.status <> 'active' then raise exception 'This table is no longer playing.'; end if;
  if exists(select 1 from public.money_requests where table_id = p_table_id and status = 'pending') then
    raise exception 'Resolve all waiting requests before ending the table.';
  end if;

  seconds := greatest(0, floor(extract(epoch from (ended_at - table_row.started_at)))::integer);
  funds := public.table_funds_cents(p_table_id);
  update public.poker_tables
  set status = 'closed', closed_at = ended_at, duration_seconds = seconds,
      expected_funds_cents = funds, counted_funds_cents = funds, discrepancy_cents = 0
  where id = p_table_id;

  for member_row in select user_id from public.table_members where table_id = p_table_id loop
    select
      coalesce(sum(case when transaction_type = 'buy_in' and not is_reversed then amount_cents else 0 end), 0)::bigint,
      coalesce(sum(case when transaction_type = 'cash_out' and not is_reversed then amount_cents else 0 end), 0)::bigint
    into cash_in, cash_out
    from public.transactions
    where table_id = p_table_id and player_id = member_row.user_id;
    net := cash_out - cash_in;

    insert into public.session_results(table_id, user_id, cash_in_cents, cash_out_cents, net_cents, duration_seconds)
    values (p_table_id, member_row.user_id, cash_in, cash_out, net, seconds)
    on conflict (table_id, user_id) do update
    set cash_in_cents = excluded.cash_in_cents,
        cash_out_cents = excluded.cash_out_cents,
        net_cents = excluded.net_cents,
        duration_seconds = excluded.duration_seconds;

    result_payload := jsonb_build_object(
      'session_name', table_row.name,
      'cash_in', cash_in::numeric / 100,
      'cash_out', cash_out::numeric / 100,
      'net', net::numeric / 100,
      'duration_seconds', seconds
    );
    perform public.add_pokerat_notification(
      member_row.user_id,
      'Table finished',
      table_row.name || ': ' || case when net > 0 then 'You won ₱' || to_char(net::numeric / 100, 'FM9999999990.00') || '.'
        when net < 0 then 'You lost ₱' || to_char(abs(net)::numeric / 100, 'FM9999999990.00') || '.'
        else 'You finished even.' end,
      case when net > 0 then 'approved' when net < 0 then 'rejected' else 'info' end,
      p_table_id, null, '', 'final_result', result_payload
    );
  end loop;
  return jsonb_build_object('table_id', p_table_id, 'duration_seconds', seconds, 'table_funds_cents', funds);
end;
$$;

create or replace function public.remove_table_member(p_table_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare table_row public.poker_tables;
begin
  perform public.require_active_user();
  select * into table_row from public.poker_tables where id = p_table_id for update;
  if table_row.host_user_id <> auth.uid() then raise exception 'Only the host can remove a player.'; end if;
  if table_row.status not in ('lobby', 'active') then raise exception 'This table is finished.'; end if;
  if p_user_id = auth.uid() then raise exception 'Transfer or close the table instead.'; end if;
  if not public.is_table_member(p_table_id, p_user_id) then raise exception 'Player is no longer in this table.'; end if;

  update public.money_requests set status = 'cancelled', cancellation_reason = 'Removed by host', cancelled_at = now()
  where table_id = p_table_id and requester_id = p_user_id and status = 'pending';
  delete from public.table_members where table_id = p_table_id and user_id = p_user_id;
  perform public.add_pokerat_notification(p_user_id, 'Removed from table', 'You were removed from ' || table_row.name || '. Pending requests were cancelled.', 'rejected', null);
end;
$$;

create or replace function public.transfer_table_host(p_table_id uuid, p_next_host_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare table_row public.poker_tables; next_name text; previous_host uuid;
begin
  perform public.require_active_user();
  select * into table_row from public.poker_tables where id = p_table_id for update;
  if table_row.host_user_id <> auth.uid() then raise exception 'Only the host can transfer this table.'; end if;
  if table_row.status not in ('lobby', 'active') then raise exception 'This table is finished.'; end if;
  if p_next_host_id = auth.uid() or not public.is_table_member(p_table_id, p_next_host_id) then raise exception 'Choose another player in this table.'; end if;
  if not public.is_active_user(p_next_host_id) then raise exception 'That account is not active.'; end if;
  previous_host := table_row.host_user_id;

  update public.table_members set member_role = 'player' where table_id = p_table_id and user_id = previous_host;
  update public.table_members set member_role = 'host' where table_id = p_table_id and user_id = p_next_host_id;
  update public.poker_tables set host_user_id = p_next_host_id where id = p_table_id;
  select display_name into next_name from public.profiles where id = p_next_host_id;
  perform public.add_pokerat_notification(p_next_host_id, 'You are now the host', 'You now control ' || table_row.name || '.', 'approved', p_table_id);
end;
$$;

create or replace function public.correct_poker_transaction(
  p_transaction_id uuid,
  p_corrected_amount_cents bigint,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare tx public.transactions; table_row public.poker_tables; reversal_id uuid; replacement_id uuid; projected bigint;
begin
  perform public.require_active_user();
  select * into tx from public.transactions where id = p_transaction_id for update;
  if tx.id is null or tx.is_reversed or tx.transaction_type not in ('buy_in', 'cash_out') then raise exception 'This transaction cannot be corrected.'; end if;
  select * into table_row from public.poker_tables where id = tx.table_id for update;
  if table_row.host_user_id <> auth.uid() then raise exception 'Only the host can correct transactions.'; end if;
  if table_row.status <> 'active' then raise exception 'Transactions can be corrected only while playing.'; end if;
  if trim(coalesce(p_reason, '')) = '' then raise exception 'A correction reason is required.'; end if;
  if p_corrected_amount_cents is not null and p_corrected_amount_cents <= 0 then raise exception 'Corrected amount must be greater than zero.'; end if;
  if tx.transaction_type = 'cash_out' and p_corrected_amount_cents is not null then
    projected := public.table_funds_cents(tx.table_id) + tx.amount_cents;
    if p_corrected_amount_cents > projected then raise exception 'Corrected cash-out exceeds projected table money.'; end if;
  end if;

  update public.transactions set is_reversed = true where id = tx.id;
  insert into public.transactions(table_id, player_id, transaction_type, amount_cents, correction_reason, reverses_transaction_id, metadata)
  values (tx.table_id, tx.player_id, 'reversal', tx.amount_cents, trim(p_reason), tx.id,
    jsonb_build_object('original_type', tx.transaction_type)) returning id into reversal_id;
  if p_corrected_amount_cents is not null then
    insert into public.transactions(table_id, player_id, transaction_type, amount_cents, correction_reason, metadata)
    values (tx.table_id, tx.player_id, tx.transaction_type, p_corrected_amount_cents, 'Corrected entry: ' || trim(p_reason),
      jsonb_build_object('correction_group_id', reversal_id, 'replaces_transaction_id', tx.id))
    returning id into replacement_id;
  end if;
  return jsonb_build_object('reversal_id', reversal_id, 'replacement_id', replacement_id, 'table_funds_cents', public.table_funds_cents(tx.table_id));
end;
$$;


create or replace function public.mark_pokerat_notifications_read()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notifications set read_at = now() where user_id = auth.uid() and read_at is null;
$$;

create or replace function public.mark_pokerat_notification_read(p_notification_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notifications set read_at = now() where id = p_notification_id and user_id = auth.uid();
$$;

create or replace function public.admin_delete_poker_table(
  p_table_id uuid,
  p_confirmation text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  table_row public.poker_tables;
  expected_confirmation text;
begin
  perform public.require_active_user();
  if not public.is_active_admin() then raise exception 'Admin only.'; end if;

  select * into table_row
  from public.poker_tables
  where id = p_table_id
  for update;

  if table_row.id is null then raise exception 'Table not found.'; end if;
  if table_row.status not in ('closed', 'cancelled') then
    raise exception 'Only finished or cancelled tables can be deleted.';
  end if;

  expected_confirmation := 'DELETE ' || table_row.session_code;
  if upper(trim(coalesce(p_confirmation, ''))) <> expected_confirmation then
    raise exception 'Type % exactly to continue.', expected_confirmation;
  end if;
  delete from public.poker_tables where id = table_row.id;
end;
$$;

create or replace function public.admin_clear_activity()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.is_active_admin() then raise exception 'Admin only.'; end if;
  truncate table
    public.notifications,
    public.session_results,
    public.transactions,
    public.money_requests,
    public.table_members,
    public.poker_tables;
end;
$$;

-- One secure read function keeps the browser state simple while returning only permitted data.
create or replace function public.load_pokerat_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  admin_access boolean;
  result jsonb;
begin
  if uid is null then raise exception 'Authentication required.'; end if;
  if not public.is_active_user(uid) then raise exception 'Your account is not approved.'; end if;
  admin_access := public.is_active_admin(uid);

  with visible_tables as (
    select t.* from public.poker_tables t
    where admin_access
       or t.status in ('lobby', 'active')
       or public.is_table_member(t.id, uid)
  ),
  accessible_tables as (
    select t.id from public.poker_tables t
    where admin_access or public.is_table_member(t.id, uid)
  ),
  visible_members as (
    select m.* from public.table_members m where m.table_id in (select id from accessible_tables)
  ),
  visible_transactions as (
    select x.* from public.transactions x where x.table_id in (select id from accessible_tables)
  ),
  visible_requests as (
    select r.* from public.money_requests r
    where admin_access or r.requester_id = uid or exists (
      select 1 from visible_tables t where t.id = r.table_id and t.host_user_id = uid
    )
  ),
  profile_ids as (
    select uid as id
    union select host_user_id from visible_tables
    union select user_id from visible_members
    union select player_id from visible_transactions
    union select requester_id from visible_requests
    union select user_id from public.session_results
  )
  select jsonb_build_object(
    'users', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'display_name', p.display_name,
        'login_name', p.username,
        'email', case when admin_access or p.id = uid then p.email else '' end,
        'account_status', p.account_status,
        'is_admin', p.is_admin,
        'must_change_password', case when p.id = uid then p.must_change_password else false end,
        'created_at', p.created_at
      ) order by p.created_at)
      from public.profiles p where p.id in (select id from profile_ids)
    ), '[]'::jsonb),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'session_code', t.session_code, 'name', t.name,
        'host_user_id', t.host_user_id, 'status', t.status,
        'created_at', t.created_at, 'started_at', t.started_at,
        'closed_at', t.closed_at, 'cancelled_at', t.cancelled_at,
        'duration_seconds', t.duration_seconds,
        'expected_funds', case when t.expected_funds_cents is null then null else t.expected_funds_cents::numeric / 100 end,
        'counted_funds', case when t.counted_funds_cents is null then null else t.counted_funds_cents::numeric / 100 end,
        'discrepancy', case when t.discrepancy_cents is null then null else t.discrepancy_cents::numeric / 100 end
      ) order by t.created_at desc) from visible_tables t
    ), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'session_id', m.table_id, 'user_id', m.user_id,
        'member_role', m.member_role, 'joined_at', m.joined_at
      ) order by m.joined_at) from visible_members m
    ), '[]'::jsonb),
    'transactions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'session_id', x.table_id, 'player_id', x.player_id,
        'transaction_type', x.transaction_type, 'amount', x.amount_cents::numeric / 100,
        'is_reversed', x.is_reversed, 'correction_reason', x.correction_reason,
        'reverses_transaction_id', x.reverses_transaction_id, 'request_id', x.request_id,
        'metadata', x.metadata, 'created_at', x.created_at
      ) order by x.created_at desc) from visible_transactions x
    ), '[]'::jsonb),
    'requests', jsonb_build_object(
      'join', '[]'::jsonb,
      'buyin', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'session_id', r.table_id, 'requester_id', r.requester_id,
        'requested_amount', r.requested_amount_cents::numeric / 100,
        'approved_amount', case when r.approved_amount_cents is null then null else r.approved_amount_cents::numeric / 100 end,
        'note', r.note,
        'status', case when r.status = 'pending' then 'pending_payment_confirmation' else r.status end,
        'requested_at', r.requested_at, 'rejection_reason', r.rejection_reason,
        'cancellation_reason', r.cancellation_reason, 'cancelled_at', r.cancelled_at
      ) order by r.requested_at desc) from visible_requests r where r.request_type = 'cash_in'), '[]'::jsonb),
      'cashout', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'session_id', r.table_id, 'requester_id', r.requester_id,
        'requested_amount', r.requested_amount_cents::numeric / 100,
        'approved_amount', case when r.approved_amount_cents is null then null else r.approved_amount_cents::numeric / 100 end,
        'note', r.note,
        'status', case when r.status = 'pending' then 'pending_review' else r.status end,
        'requested_at', r.requested_at, 'rejection_reason', r.rejection_reason,
        'cancellation_reason', r.cancellation_reason, 'cancelled_at', r.cancelled_at
      ) order by r.requested_at desc) from visible_requests r where r.request_type = 'cash_out'), '[]'::jsonb)
    ),
    'notifications', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', n.id, 'user_id', n.user_id, 'title', n.title, 'message', n.message,
        'type', n.type, 'session_id', n.table_id, 'action_hash', n.action_hash,
        'request_id', n.request_id, 'request_kind', n.request_kind,
        'delivery', n.delivery, 'result_summary', n.result_summary,
        'created_at', n.created_at, 'read_at', n.read_at
      ) order by n.created_at desc)
      from public.notifications n where n.user_id = uid
    ), '[]'::jsonb),
    'sessionResults', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', sr.id, 'session_id', sr.table_id, 'user_id', sr.user_id,
        'cash_in', sr.cash_in_cents::numeric / 100,
        'cash_out', sr.cash_out_cents::numeric / 100,
        'net', sr.net_cents::numeric / 100,
        'duration_seconds', sr.duration_seconds, 'created_at', sr.created_at
      ) order by sr.created_at desc) from public.session_results sr
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

-- RLS: direct table access is read-only; all writes go through the functions above.
alter table public.poker_tables enable row level security;
alter table public.table_members enable row level security;
alter table public.money_requests enable row level security;
alter table public.transactions enable row level security;
alter table public.notifications enable row level security;
alter table public.session_results enable row level security;

revoke all on public.poker_tables, public.table_members, public.money_requests, public.transactions,
  public.notifications, public.session_results from anon, authenticated;
grant select on public.poker_tables, public.table_members, public.money_requests, public.transactions,
  public.notifications, public.session_results to authenticated;

drop policy if exists poker_tables_select_member on public.poker_tables;
create policy poker_tables_select_member on public.poker_tables for select to authenticated
using (public.is_active_user(auth.uid()));

drop policy if exists table_members_select_comember on public.table_members;
create policy table_members_select_comember on public.table_members for select to authenticated
using (public.is_active_user(auth.uid()) and (public.is_active_admin() or public.is_table_member(table_id, auth.uid())));

drop policy if exists money_requests_select_relevant on public.money_requests;
create policy money_requests_select_relevant on public.money_requests for select to authenticated
using (public.is_active_user(auth.uid()) and (public.is_active_admin() or requester_id = auth.uid() or public.is_table_host(table_id, auth.uid())));

drop policy if exists transactions_select_member on public.transactions;
create policy transactions_select_member on public.transactions for select to authenticated
using (public.is_active_user(auth.uid()) and (public.is_active_admin() or public.is_table_member(table_id, auth.uid())));

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications for select to authenticated
using (public.is_active_user(auth.uid()) and (user_id = auth.uid() or public.is_active_admin()));

drop policy if exists session_results_select_active on public.session_results;
create policy session_results_select_active on public.session_results for select to authenticated
using (public.is_active_user(auth.uid()));


-- Lock down helper functions and expose only the intended RPC surface.
revoke all on function public.is_active_user(uuid) from public;
revoke all on function public.is_table_member(uuid, uuid) from public;
revoke all on function public.is_table_host(uuid, uuid) from public;
revoke all on function public.table_funds_cents(uuid) from public;
revoke all on function public.require_active_user() from public;
revoke all on function public.add_pokerat_notification(uuid, text, text, text, uuid, uuid, text, text, jsonb) from public;
revoke all on function public.generate_pokerat_code() from public;
revoke all on function public.create_poker_table(text) from public;
revoke all on function public.join_poker_table(text) from public;
revoke all on function public.start_poker_table(uuid) from public;
revoke all on function public.cancel_poker_table(uuid) from public;
revoke all on function public.submit_money_request(uuid, text, bigint, text) from public;
revoke all on function public.review_money_request(uuid, text, text) from public;
revoke all on function public.cancel_money_request(uuid) from public;
revoke all on function public.record_host_money(uuid, text, bigint) from public;
revoke all on function public.close_poker_table(uuid) from public;
revoke all on function public.remove_table_member(uuid, uuid) from public;
revoke all on function public.transfer_table_host(uuid, uuid) from public;
revoke all on function public.correct_poker_transaction(uuid, bigint, text) from public;
revoke all on function public.mark_pokerat_notifications_read() from public;
revoke all on function public.mark_pokerat_notification_read(uuid) from public;
revoke all on function public.admin_delete_poker_table(uuid, text) from public;
revoke all on function public.admin_clear_activity() from public;
revoke all on function public.load_pokerat_state() from public;

grant execute on function public.is_active_user(uuid) to authenticated;
grant execute on function public.is_table_member(uuid, uuid) to authenticated;
grant execute on function public.is_table_host(uuid, uuid) to authenticated;

grant execute on function public.create_poker_table(text) to authenticated;
grant execute on function public.join_poker_table(text) to authenticated;
grant execute on function public.start_poker_table(uuid) to authenticated;
grant execute on function public.cancel_poker_table(uuid) to authenticated;
grant execute on function public.submit_money_request(uuid, text, bigint, text) to authenticated;
grant execute on function public.review_money_request(uuid, text, text) to authenticated;
grant execute on function public.cancel_money_request(uuid) to authenticated;
grant execute on function public.record_host_money(uuid, text, bigint) to authenticated;
grant execute on function public.close_poker_table(uuid) to authenticated;
grant execute on function public.remove_table_member(uuid, uuid) to authenticated;
grant execute on function public.transfer_table_host(uuid, uuid) to authenticated;
grant execute on function public.correct_poker_transaction(uuid, bigint, text) to authenticated;
grant execute on function public.mark_pokerat_notifications_read() to authenticated;
grant execute on function public.mark_pokerat_notification_read(uuid) to authenticated;
grant execute on function public.admin_delete_poker_table(uuid, text) to authenticated;
grant execute on function public.admin_clear_activity() to authenticated, service_role;
grant execute on function public.load_pokerat_state() to authenticated;

-- Publish the shared tables for Postgres Changes.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'poker_tables', 'table_members', 'money_requests', 'transactions',
    'notifications', 'session_results'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end $$;


-- Remove the retired report and audit systems from existing installations.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'session_reports') then
      execute 'alter publication supabase_realtime drop table public.session_reports';
    end if;
    if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'audit_logs') then
      execute 'alter publication supabase_realtime drop table public.audit_logs';
    end if;
  end if;
end $$;

drop function if exists public.submit_session_report(uuid, text, text);
drop function if exists public.review_session_report(uuid, text, text);
drop function if exists public.add_pokerat_audit(text, uuid, uuid, text, uuid, jsonb);
drop table if exists public.session_reports cascade;
drop table if exists public.audit_logs cascade;
