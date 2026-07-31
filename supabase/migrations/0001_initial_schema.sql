-- Daylish — initial Postgres schema.
--
-- The server mirror of the on-device SQLite schema in packages/db. Kept as
-- hand-written SQL rather than generated from Drizzle because it carries two
-- things Drizzle does not model: row-level security policies, and the
-- Postgres-specific types (uuid, timestamptz, jsonb) that make those policies
-- and the sync queries efficient.
--
-- Sync model: the device is authoritative. Every table carries updated_at and
-- deleted_at so the client can push last-write-wins updates and propagate
-- deletions that happened offline.

-- `gen_random_uuid()` is core Postgres from 13 onward, so pgcrypto is not
-- required. Supabase runs 15+.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type sex_t              as enum ('male', 'female', 'unspecified');
create type activity_level_t   as enum ('sedentary', 'light', 'moderate', 'very', 'athlete');
create type goal_kind_t        as enum ('lose', 'maintain', 'gain', 'recomp');
create type cooking_skill_t    as enum ('beginner', 'comfortable', 'confident');
create type meal_slot_t        as enum ('breakfast', 'lunch', 'dinner', 'snack');
create type food_source_t      as enum ('usda', 'off', 'user', 'ai_estimate', 'branded_manual');
create type log_method_t       as enum ('barcode', 'photo', 'voice', 'search', 'quick_add', 'copy', 'recipe');
create type difficulty_t       as enum ('easy', 'medium', 'hard');
create type fasting_protocol_t as enum ('16:8', '18:6', '20:4', 'omad', '5:2', 'custom');
create type review_state_t     as enum ('ai_generated', 'human_reviewed', 'flagged');

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------

-- Extends auth.users rather than replacing it. The id IS the Supabase auth id,
-- which is what makes every RLS policy below a simple `auth.uid() = user_id`.
create table profiles (
  id                   uuid primary key references auth.users (id) on delete cascade,
  display_name         text,
  sex                  sex_t not null default 'unspecified',
  birth_date           date,
  height_cm            real,
  activity_level       activity_level_t not null default 'moderate',
  cooking_skill        cooking_skill_t not null default 'comfortable',
  allergens            jsonb not null default '[]'::jsonb,
  disliked_ingredients jsonb not null default '[]'::jsonb,
  equipment            jsonb not null default '[]'::jsonb,
  weekly_budget_minor  integer,
  currency             text not null default 'EUR',
  max_prep_minutes     integer not null default 45,
  detailed_nutrition   boolean not null default false,
  timezone             text not null default 'UTC',
  onboarded_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz
);

-- Append-only history of targets. Never updated in place, so "what was my
-- target in March and why did it change" is always answerable.
create table user_goals (
  id                          uuid primary key default gen_random_uuid(),
  user_id                     uuid not null references profiles (id) on delete cascade,
  effective_from              date not null,
  goal                        goal_kind_t not null,
  diet_style                  text not null default 'balanced',
  rate_kg_per_week            real not null default 0,
  energy_kcal                 real not null,
  protein_g                   real not null,
  carbs_g                     real not null,
  fat_g                       real not null,
  fiber_g                     real not null,
  estimated_expenditure_kcal  real,
  estimate_confidence         text,
  reason                      text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  deleted_at                  timestamptz
);

create index user_goals_user_from_idx on user_goals (user_id, effective_from desc);

-- ---------------------------------------------------------------------------
-- Food database (shared, not per-user)
-- ---------------------------------------------------------------------------

create table food_items (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  brand          text,
  barcode        text,
  source         food_source_t not null,
  source_ref     text,
  confidence     real not null default 1 check (confidence between 0 and 1),
  verified       boolean not null default false,
  user_submitted boolean not null default false,
  -- Who submitted it, so a user can always see and edit their own entries even
  -- before moderation clears them.
  submitted_by   uuid references profiles (id) on delete set null,
  moderation     review_state_t not null default 'ai_generated',
  nutrients      jsonb not null,
  energy_kcal    real,
  protein_g      real,
  carbs_g        real,
  fat_g          real,
  fiber_g        real,
  sugar_g        real,
  sat_fat_g      real,
  sodium_mg      real,
  allergens      jsonb not null default '[]'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

-- Barcodes are the scanner's hot path. Partial index skips soft-deleted rows.
create unique index food_items_barcode_idx
  on food_items (barcode)
  where barcode is not null and deleted_at is null;

-- Trigram index so autocomplete can do fuzzy name matching without a full scan.
create extension if not exists "pg_trgm";
create index food_items_name_trgm_idx on food_items using gin (name gin_trgm_ops);

create table food_portions (
  id           uuid primary key default gen_random_uuid(),
  food_item_id uuid not null references food_items (id) on delete cascade,
  label        text not null,
  grams        real not null check (grams > 0),
  is_default   boolean not null default false
);

create index food_portions_food_idx on food_portions (food_item_id);

-- ---------------------------------------------------------------------------
-- Journal
-- ---------------------------------------------------------------------------

create table journal_entries (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles (id) on delete cascade,
  logged_at  timestamptz not null,
  -- The user's own calendar day. Stored, not derived: a meal at 00:30 in Berlin
  -- belongs to the Berlin day regardless of where the query runs from.
  local_date date not null,
  meal_slot  meal_slot_t not null,
  log_method log_method_t not null,
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index journal_entries_user_date_idx
  on journal_entries (user_id, local_date desc)
  where deleted_at is null;

create table journal_entry_items (
  id            uuid primary key default gen_random_uuid(),
  entry_id      uuid not null references journal_entries (id) on delete cascade,
  food_item_id  uuid references food_items (id) on delete set null,
  recipe_id     uuid,
  display_name  text not null,
  grams         real not null check (grams >= 0),
  portion_label text,
  portion_count real,
  -- Frozen at log time. Correcting a food_items row later must never rewrite
  -- what somebody ate last March.
  nutrients     jsonb not null,
  energy_kcal   real,
  protein_g     real,
  carbs_g       real,
  fat_g         real,
  fiber_g       real,
  sugar_g       real,
  sat_fat_g     real,
  sodium_mg     real,
  confidence    real not null default 1 check (confidence between 0 and 1),
  source        food_source_t not null,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index journal_entry_items_entry_idx on journal_entry_items (entry_id);

create table water_logs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles (id) on delete cascade,
  logged_at    timestamptz not null,
  local_date   date not null,
  millilitres  real not null check (millilitres > 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create index water_logs_user_date_idx on water_logs (user_id, local_date desc);

create table weight_entries (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references profiles (id) on delete cascade,
  local_date       date not null,
  weight_kg        real not null check (weight_kg > 0),
  source           text not null default 'manual',
  body_fat_percent real,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  unique (user_id, local_date)
);

create table mood_entries (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles (id) on delete cascade,
  entry_id   uuid references journal_entries (id) on delete cascade,
  logged_at  timestamptz not null,
  local_date date not null,
  mood       text,
  energy     smallint check (energy between 1 and 5),
  hunger     smallint check (hunger between 1 and 5),
  digestion  smallint check (digestion between 1 and 5),
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table fasting_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles (id) on delete cascade,
  protocol     fasting_protocol_t not null,
  started_at   timestamptz not null,
  ended_at     timestamptz,
  target_hours real not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

-- ---------------------------------------------------------------------------
-- Recipes (shared library)
-- ---------------------------------------------------------------------------

create table recipes (
  id                  uuid primary key default gen_random_uuid(),
  title               text not null,
  summary             text not null,
  cuisine             text not null,
  meal_slots          jsonb not null,
  servings            integer not null check (servings > 0),
  prep_minutes        integer not null default 0,
  cook_minutes        integer not null default 0,
  difficulty          difficulty_t not null,
  equipment           jsonb not null default '[]'::jsonb,
  diet_styles         jsonb not null default '[]'::jsonb,
  -- Derived from resolved ingredients by the pipeline, never from the model.
  allergens           jsonb not null default '[]'::jsonb,
  nutrients           jsonb not null,
  energy_kcal         real,
  protein_g           real,
  carbs_g             real,
  fat_g               real,
  fiber_g             real,
  storage_notes       text,
  fridge_days         integer not null default 0,
  freezer_months      integer not null default 0,
  prep_score          integer not null default 0,
  estimated_cost_minor integer,
  review_state        review_state_t not null default 'ai_generated',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);

create index recipes_cuisine_idx    on recipes (cuisine);
create index recipes_prep_score_idx on recipes (prep_score desc);
create index recipes_diet_gin_idx   on recipes using gin (diet_styles);
create index recipes_allergen_gin_idx on recipes using gin (allergens);

create table recipe_ingredients (
  id               uuid primary key default gen_random_uuid(),
  recipe_id        uuid not null references recipes (id) on delete cascade,
  food_item_id     uuid references food_items (id) on delete set null,
  -- The USDA entry this resolved to. Kept for audit: every published macro
  -- should be traceable back to a specific lab record.
  fdc_id           integer,
  name             text not null,
  grams            real not null check (grams > 0),
  display_quantity text not null,
  preparation      text,
  optional         boolean not null default false,
  sort_order       integer not null default 0
);

create index recipe_ingredients_recipe_idx on recipe_ingredients (recipe_id);

create table recipe_steps (
  id               uuid primary key default gen_random_uuid(),
  recipe_id        uuid not null references recipes (id) on delete cascade,
  step_order       integer not null,
  instruction      text not null,
  duration_minutes integer,
  is_passive       boolean not null default false,
  unique (recipe_id, step_order)
);

create table recipe_interactions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles (id) on delete cascade,
  recipe_id   uuid not null references recipes (id) on delete cascade,
  kind        text not null,
  occurred_at timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index recipe_interactions_user_idx on recipe_interactions (user_id, recipe_id);

-- ---------------------------------------------------------------------------
-- Pantry & planning
-- ---------------------------------------------------------------------------

create table pantry_items (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references profiles (id) on delete cascade,
  food_item_id   uuid references food_items (id) on delete set null,
  name           text not null,
  quantity_grams real,
  added_at       timestamptz not null default now(),
  expires_on     date,
  location       text not null default 'pantry',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

create index pantry_items_user_idx on pantry_items (user_id) where deleted_at is null;

create table meal_plans (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles (id) on delete cascade,
  week_start_date date not null,
  generated_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  unique (user_id, week_start_date)
);

create table meal_plan_slots (
  id                   uuid primary key default gen_random_uuid(),
  plan_id              uuid not null references meal_plans (id) on delete cascade,
  local_date           date not null,
  meal_slot            meal_slot_t not null,
  recipe_id            uuid references recipes (id) on delete set null,
  servings             real not null default 1,
  locked               boolean not null default false,
  leftover_of_slot_id  uuid references meal_plan_slots (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz
);

create index meal_plan_slots_plan_idx on meal_plan_slots (plan_id, local_date);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'user_goals', 'food_items', 'journal_entries', 'journal_entry_items',
    'water_logs', 'weight_entries', 'mood_entries', 'fasting_sessions', 'recipes',
    'recipe_interactions', 'pantry_items', 'meal_plans', 'meal_plan_slots'
  ]
  loop
    execute format(
      'create trigger %I_touch before update on %I for each row execute function touch_updated_at()',
      t, t
    );
  end loop;
end;
$$;
