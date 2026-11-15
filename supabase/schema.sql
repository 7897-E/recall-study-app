-- Recall — database schema for the static (GitHub Pages) build.
--
-- Run this once in the Supabase SQL editor. The browser talks to these tables
-- directly with the publishable key, so every table is protected by row level
-- security and every policy is scoped to auth.uid(). Cards and boards belong
-- to a deck or to the signed-in user, never to a client-supplied id.

-- Profiles: one row per account, created the first time the app loads.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  seeded_at bigint,
  created_at bigint not null
);

create table if not exists public.decks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null,
  description text,
  hue integer not null default 250,
  last_studied_at bigint,
  created_at bigint not null,
  updated_at bigint not null
);
create index if not exists decks_owner on public.decks (owner_id, updated_at desc);

create table if not exists public.cards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  deck_id uuid not null references public.decks (id) on delete cascade,
  term text not null,
  definition text not null,
  image_key text,
  position integer not null default 0,
  created_at bigint not null
);
create index if not exists cards_deck on public.cards (owner_id, deck_id, position);

create table if not exists public.card_progress (
  card_id uuid primary key references public.cards (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  deck_id uuid not null references public.decks (id) on delete cascade,
  correct integer not null default 0,
  incorrect integer not null default 0,
  streak integer not null default 0,
  mastery integer not null default 0,
  next_due bigint,
  last_seen bigint
);
create index if not exists progress_deck on public.card_progress (owner_id, deck_id);

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  deck_id uuid not null references public.decks (id) on delete cascade,
  mode text not null,
  score integer not null,
  total integer not null,
  duration_ms integer not null default 0,
  created_at bigint not null
);
create index if not exists sessions_owner on public.sessions (owner_id, created_at desc);

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null default '',
  body text not null default '',
  kind text not null default 'note',
  tags jsonb not null default '[]'::jsonb,
  pinned boolean not null default false,
  deck_id uuid references public.decks (id) on delete set null,
  created_at bigint not null,
  updated_at bigint not null
);
create index if not exists notes_owner on public.notes (owner_id, pinned desc, updated_at desc);

create table if not exists public.boards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null default 'Untitled board',
  doc jsonb not null,
  thumb text,
  element_count integer not null default 0,
  created_at bigint not null,
  updated_at bigint not null
);
create index if not exists boards_owner on public.boards (owner_id, updated_at desc);

-- Row level security: every row is readable and writable only by its owner.
alter table public.profiles enable row level security;
alter table public.decks enable row level security;
alter table public.cards enable row level security;
alter table public.card_progress enable row level security;
alter table public.sessions enable row level security;
alter table public.notes enable row level security;
alter table public.boards enable row level security;

drop policy if exists "profiles are private" on public.profiles;
create policy "profiles are private" on public.profiles
  for all to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "own decks" on public.decks;
create policy "own decks" on public.decks
  for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "own cards" on public.cards;
create policy "own cards" on public.cards
  for all to authenticated
  using (owner_id = auth.uid() and exists (select 1 from public.decks d where d.id = deck_id and d.owner_id = auth.uid()))
  with check (owner_id = auth.uid() and exists (select 1 from public.decks d where d.id = deck_id and d.owner_id = auth.uid()));

drop policy if exists "own card progress" on public.card_progress;
create policy "own card progress" on public.card_progress
  for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "own sessions" on public.sessions;
create policy "own sessions" on public.sessions
  for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "own notes" on public.notes;
create policy "own notes" on public.notes
  for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "own boards" on public.boards;
create policy "own boards" on public.boards
  for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Grants. New Supabase projects no longer expose new tables to the Data API by
-- default, so grant the signed-in role exactly what the app needs.
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.decks to authenticated;
grant select, insert, update, delete on public.cards to authenticated;
grant select, insert, update, delete on public.card_progress to authenticated;
grant select, insert, update, delete on public.sessions to authenticated;
grant select, insert, update, delete on public.notes to authenticated;
grant select, insert, update, delete on public.boards to authenticated;

-- Card images live in a private bucket; each user can only touch files under a
-- folder named after their own user id.
insert into storage.buckets (id, name, public)
values ('card-images', 'card-images', false)
on conflict (id) do nothing;

drop policy if exists "card images are readable by their owner" on storage.objects;
create policy "card images are readable by their owner" on storage.objects
  for select to authenticated
  using (bucket_id = 'card-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "card images are uploadable by their owner" on storage.objects;
create policy "card images are uploadable by their owner" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'card-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "card images are replaceable by their owner" on storage.objects;
create policy "card images are replaceable by their owner" on storage.objects
  for update to authenticated
  using (bucket_id = 'card-images' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'card-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "card images are deletable by their owner" on storage.objects;
create policy "card images are deletable by their owner" on storage.objects
  for delete to authenticated
  using (bucket_id = 'card-images' and (storage.foldername(name))[1] = auth.uid()::text);
