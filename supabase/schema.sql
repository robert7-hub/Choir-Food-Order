-- =====================================================================
--  CHOIR TOUR MEALS — database schema + Row Level Security
--  Run this whole file once in Supabase → SQL Editor → New query → Run.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- TABLES ----------
create table if not exists public.restaurants (
  id          text primary key,
  name        text not null,
  place       text,
  date        date,
  info        text,
  food        jsonb not null default '[]',   -- [{id,name,price,desc}]
  drinks      jsonb not null default '[]',
  created_at  timestamptz default now()
);

create table if not exists public.orders (
  id          uuid primary key default gen_random_uuid(),
  member_uid  uuid not null references auth.users(id) on delete cascade,
  member_name text not null,
  rest_id     text not null,
  rest_name   text,
  place       text,
  date        date,
  items       jsonb not null default '[]',   -- [{name,type,price,...}]
  total       numeric not null default 0,
  placed_at   timestamptz default now(),
  unique (member_uid, rest_id)               -- one final order per member per stop
);

create table if not exists public.admins (
  uid uuid primary key references auth.users(id) on delete cascade
);

-- ---------- ADMIN HELPER ----------
-- SECURITY DEFINER so it can read admins without tripping its own RLS.
create or replace function public.is_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.admins where uid = auth.uid());
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- ---------- ENABLE RLS ----------
alter table public.restaurants enable row level security;
alter table public.orders      enable row level security;
alter table public.admins      enable row level security;

-- ---------- RESTAURANTS: anyone signed in reads; only admin writes ----------
drop policy if exists r_select    on public.restaurants;
drop policy if exists r_admin_ins on public.restaurants;
drop policy if exists r_admin_upd on public.restaurants;
drop policy if exists r_admin_del on public.restaurants;
create policy r_select    on public.restaurants for select to authenticated using (true);
create policy r_admin_ins on public.restaurants for insert to authenticated with check (public.is_admin());
create policy r_admin_upd on public.restaurants for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy r_admin_del on public.restaurants for delete to authenticated using (public.is_admin());

-- ---------- ORDERS: own create/read; admin reads all; NO edits/deletes ----------
drop policy if exists o_insert on public.orders;
drop policy if exists o_select on public.orders;
create policy o_insert on public.orders for insert to authenticated with check (member_uid = auth.uid());
create policy o_select on public.orders for select to authenticated using (member_uid = auth.uid() or public.is_admin());
-- (intentionally no UPDATE or DELETE policy => orders are final/immutable)

-- ---------- ADMINS: a user may read their own row ----------
drop policy if exists a_select on public.admins;
create policy a_select on public.admins for select to authenticated using (uid = auth.uid() or public.is_admin());
-- (no client insert/update/delete — you add organisers from the dashboard)

-- =====================================================================
--  AFTER running this:
--  1. Authentication → Providers → enable "Anonymous sign-ins".
--  2. Authentication → Users → Add user → your organiser email + password
--     (tick "Auto confirm").
--     For username-style login in the app, use username@example.com and
--     sign in with just "username".
--  3. This file seeds your organiser UID safely (no error if rerun):
insert into public.admins (uid)
select id from auth.users
where id = 'd64b9330-4df7-4497-826b-96d2052d2afa'
on conflict (uid) do nothing;

--  4. Verify the row exists:
select * from public.admins where uid = 'd64b9330-4df7-4497-826b-96d2052d2afa';
-- =====================================================================
