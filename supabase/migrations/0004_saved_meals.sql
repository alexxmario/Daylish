-- Saved meals: a combination of foods someone eats often, logged in one tap.
--
-- Distinct from recipes on purpose. A recipe is cooked and has steps, timings
-- and yields; a saved meal is "what I have for breakfast" — two or three foods
-- at the amounts this person eats them.
--
-- Items store nutrients per 100 g plus a portion, unlike journal_entry_items
-- which stores the vector for the amount eaten. A saved meal is a template
-- rather than a record, so it keeps the food's own basis and the portion apart.

create table if not exists saved_meals (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  name         text not null check (length(trim(name)) > 0),
  meal_slot    meal_slot_t,
  use_count    integer not null default 0,
  last_used_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create index if not exists saved_meals_user_idx on saved_meals (user_id);

create table if not exists saved_meal_items (
  id            uuid primary key default gen_random_uuid(),
  saved_meal_id uuid not null references saved_meals (id) on delete cascade,
  food_item_id  uuid references food_items (id),
  display_name  text not null,
  grams         real not null check (grams > 0),
  portion_label text,
  -- Full NutrientVector, per 100 g.
  nutrients     jsonb not null,
  confidence    real not null default 1,
  source        food_source_t not null,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index if not exists saved_meal_items_meal_idx on saved_meal_items (saved_meal_id);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
--
-- Same model as the rest of the personal tables: readable and writable only by
-- the user it belongs to. Items are reached through their parent, exactly as
-- journal_entry_items are, so ownership is proved by the join rather than
-- duplicated onto the child row where it could drift.

alter table saved_meals      enable row level security;
alter table saved_meal_items enable row level security;

create policy "own saved meals: read"   on saved_meals for select using (auth.uid() = user_id);
create policy "own saved meals: insert" on saved_meals for insert with check (auth.uid() = user_id);
create policy "own saved meals: update" on saved_meals for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own saved meals: delete" on saved_meals for delete using (auth.uid() = user_id);

create policy "own saved meal items: read" on saved_meal_items for select using (
  exists (select 1 from saved_meals m where m.id = saved_meal_items.saved_meal_id and m.user_id = auth.uid())
);
create policy "own saved meal items: insert" on saved_meal_items for insert with check (
  exists (select 1 from saved_meals m where m.id = saved_meal_items.saved_meal_id and m.user_id = auth.uid())
);
create policy "own saved meal items: update" on saved_meal_items for update using (
  exists (select 1 from saved_meals m where m.id = saved_meal_items.saved_meal_id and m.user_id = auth.uid())
);
create policy "own saved meal items: delete" on saved_meal_items for delete using (
  exists (select 1 from saved_meals m where m.id = saved_meal_items.saved_meal_id and m.user_id = auth.uid())
);

-- Grants, matching 0002: authenticated only, never anon. These are new tables,
-- so the default privileges set in 0002 cover them — stated explicitly anyway,
-- because a table that is silently unreachable looks like an RLS bug.
grant select, insert, update, delete on saved_meals      to authenticated;
grant select, insert, update, delete on saved_meal_items to authenticated;
revoke all on saved_meals      from anon;
revoke all on saved_meal_items from anon;
