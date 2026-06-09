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
  member_code text,
  rest_id     text not null,
  rest_name   text,
  place       text,
  date        date,
  items       jsonb not null default '[]',   -- [{name,type,price,...}]
  total       numeric not null default 0,
  placed_at   timestamptz default now(),
  unique (member_uid, rest_id)               -- one final order per member per stop
);
alter table public.orders add column if not exists member_code text;

create table if not exists public.admins (
  uid uuid primary key references auth.users(id) on delete cascade
);

create table if not exists public.member_profiles (
  uid          uuid primary key references auth.users(id) on delete cascade,
  member_code  text unique not null,
  display_name text not null,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- ---------- ADMIN HELPER ----------
-- SECURITY DEFINER so it can read admins without tripping its own RLS.
create or replace function public.is_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.admins where uid = auth.uid());
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- ---------- MEMBER PASSWORD HELPERS ----------
create or replace function public.member_code_to_email(p_code text)
returns text
language sql
immutable
set search_path = public
as $$
  with cleaned as (
    select left(
      regexp_replace(
        trim(both '.' from regexp_replace(lower(trim(coalesce(p_code, ''))), '[^a-z0-9]+', '.', 'g')),
        '\.{2,}', '.', 'g'
      ),
      48
    ) as key
  )
  select case when key = '' then null else key || '@members.example.com' end
  from cleaned;
$$;
revoke all on function public.member_code_to_email(text) from public;
grant execute on function public.member_code_to_email(text) to authenticated;

-- Backward-compatible wrapper used by older clients.
create or replace function public.member_name_to_email(p_name text)
returns text
language sql
immutable
set search_path = public
as $$
  select public.member_code_to_email(p_name);
$$;
revoke all on function public.member_name_to_email(text) from public;
grant execute on function public.member_name_to_email(text) to authenticated;

-- Organiser-only RPC: reset a member's password by member code.
create or replace function public.admin_reset_member_password(
  p_member_code text,
  p_new_password text
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text;
  v_user_id uuid;
begin
  if not public.is_admin() then
    raise exception 'not-authorized';
  end if;

  if p_new_password is null or length(p_new_password) < 6 then
    raise exception 'password-too-short';
  end if;

  v_email := public.member_code_to_email(p_member_code);
  if v_email is null then
    raise exception 'member-code-invalid';
  end if;

  select u.id into v_user_id
  from auth.users u
  where lower(u.email) = lower(v_email)
  order by u.created_at desc
  limit 1;

  if v_user_id is null then
    raise exception 'member-not-found';
  end if;

  perform auth.admin_update_user_by_id(
    v_user_id,
    jsonb_build_object('password', p_new_password)
  );
end;
$$;
revoke all on function public.admin_reset_member_password(text, text) from public;
grant execute on function public.admin_reset_member_password(text, text) to authenticated;

-- ---------- ENABLE RLS ----------
alter table public.restaurants enable row level security;
alter table public.orders      enable row level security;
alter table public.admins      enable row level security;
alter table public.member_profiles enable row level security;

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

-- ---------- MEMBER PROFILES: own row for member; all rows for admin ----------
drop policy if exists mp_select on public.member_profiles;
drop policy if exists mp_insert on public.member_profiles;
drop policy if exists mp_update on public.member_profiles;
create policy mp_select on public.member_profiles for select to authenticated using (uid = auth.uid() or public.is_admin());
create policy mp_insert on public.member_profiles for insert to authenticated with check (uid = auth.uid() or public.is_admin());
create policy mp_update on public.member_profiles for update to authenticated using (uid = auth.uid() or public.is_admin()) with check (uid = auth.uid() or public.is_admin());

-- ---------- OPTIONAL MENU SEED: LA GRAPPERIA ----------
insert into public.restaurants (
  id, name, place, date, info, food, drinks
) values (
  'spice_route_la_grapperia',
  'Spice Route Destination | La Grapperia Pizza & Bistro',
  'Spice Route Destination',
  null,
  'Menu imported from organiser list.',
  '[
    {"id":"food_smash_burger","name":"Smash Burger","price":165,"desc":"Venison Patty, Coleslaw, Cheese, Tomato, Chilli Aioli, Chips"},
    {"id":"food_chicken_parmesan","name":"Chicken Parmesan","price":175,"desc":"Chicken Fillet, Parmesan, Herbs, Napolitana Tomato Sauce, Mozzarella, Salad"},
    {"id":"food_margherita","name":"Margherita","price":145,"desc":"Fior di Latte Mozzarella, Napoletana Sauce, Fresh Basil"},
    {"id":"food_melanzane","name":"Melanzane","price":165,"desc":"Napoletana Sauce, Aubergine, Fior di Latte, Grated Mozzarella"},
    {"id":"food_bruschetta","name":"Bruschetta","price":110,"desc":"Garlic, Ripe Chopped Tomato, Fresh Basil, Olive Oil"},
    {"id":"food_brie_caramelised_onion","name":"Brie & Caramelised Onion","price":175,"desc":"Red Caramelised Onion, Brie, Pine Nuts, Olive Oil"},
    {"id":"food_farmers_salad","name":"Farmer''s Salad","price":135,"desc":"Lettuce, Onion, Tomato, Carrot, Cucumber, Feta Cheese, Ham, Boiled Egg"}
  ]'::jsonb,
  '[
    {"id":"drink_coke","name":"Coke","price":35,"desc":""},
    {"id":"drink_coke_zero","name":"Coke Zero","price":35,"desc":""},
    {"id":"drink_fanta_orange","name":"Fanta Orange","price":35,"desc":""},
    {"id":"drink_creme_soda","name":"Creme Soda","price":35,"desc":""},
    {"id":"drink_lipton_ice_tea_lemon","name":"Lipton Ice Tea Lemon","price":38,"desc":""},
    {"id":"drink_lipton_ice_tea_peach","name":"Lipton Ice Tea Peach","price":38,"desc":""},
    {"id":"drink_fitch_leedes_lemonade","name":"Fitch & Leedes Lemonade","price":30,"desc":""},
    {"id":"drink_fitch_leedes_tonic","name":"Fitch & Leedes Tonic","price":30,"desc":""},
    {"id":"drink_fitch_leedes_bitter_lemon","name":"Fitch & Leedes Bitter Lemon","price":30,"desc":""},
    {"id":"drink_fitch_leedes_club_soda","name":"Fitch & Leedes Club Soda","price":30,"desc":""},
    {"id":"drink_fitch_leedes_ginger_ale","name":"Fitch & Leedes Ginger Ale","price":30,"desc":""}
  ]'::jsonb
)
on conflict (id) do update
set
  name = excluded.name,
  place = excluded.place,
  date = excluded.date,
  info = excluded.info,
  food = excluded.food,
  drinks = excluded.drinks;

-- =====================================================================
--  AFTER running this:
--  1. Authentication → Providers → Email: enable Email sign-ins
--     and disable "Confirm email" for instant member login.
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
