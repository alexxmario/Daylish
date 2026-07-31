-- Row-level security.
--
-- The shape of the model:
--
--   * Personal data (journal, weight, mood, pantry, plans, goals) is readable
--     and writable ONLY by the user it belongs to. There is no "share with a
--     friend" path in this migration; social features will add explicit grants
--     rather than loosening these.
--
--   * The food and recipe libraries are shared reads. Any signed-in user can
--     read them, because a barcode lookup is useless if it is per-user. Writes
--     are restricted: users may add foods, but only their own unverified
--     submissions, and they can never mark something verified.
--
--   * Progress photos are absent by design. They never leave the device, so
--     there is no table here to secure.
--
-- RLS is enabled on every table. A table with RLS on and no policy denies
-- everything, which is the correct failure mode.

alter table profiles            enable row level security;
alter table user_goals          enable row level security;
alter table food_items          enable row level security;
alter table food_portions       enable row level security;
alter table journal_entries     enable row level security;
alter table journal_entry_items enable row level security;
alter table water_logs          enable row level security;
alter table weight_entries      enable row level security;
alter table mood_entries        enable row level security;
alter table fasting_sessions    enable row level security;
alter table recipes             enable row level security;
alter table recipe_ingredients  enable row level security;
alter table recipe_steps        enable row level security;
alter table recipe_interactions enable row level security;
alter table pantry_items        enable row level security;
alter table meal_plans          enable row level security;
alter table meal_plan_slots     enable row level security;

-- ---------------------------------------------------------------------------
-- Profile
-- ---------------------------------------------------------------------------

create policy "own profile: read"   on profiles for select using (auth.uid() = id);
create policy "own profile: insert" on profiles for insert with check (auth.uid() = id);
create policy "own profile: update" on profiles for update using (auth.uid() = id) with check (auth.uid() = id);
create policy "own profile: delete" on profiles for delete using (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- Per-user tables with a direct user_id
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'user_goals', 'journal_entries', 'water_logs', 'weight_entries',
    'mood_entries', 'fasting_sessions', 'recipe_interactions',
    'pantry_items', 'meal_plans'
  ]
  loop
    execute format($f$
      create policy "own rows: read"   on %1$I for select using (auth.uid() = user_id);
      create policy "own rows: insert" on %1$I for insert with check (auth.uid() = user_id);
      create policy "own rows: update" on %1$I for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
      create policy "own rows: delete" on %1$I for delete using (auth.uid() = user_id);
    $f$, t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Child tables — ownership is inherited through the parent
-- ---------------------------------------------------------------------------

-- journal_entry_items has no user_id of its own; ownership comes from the entry.
create policy "own entry items: read" on journal_entry_items for select
  using (exists (
    select 1 from journal_entries e
    where e.id = journal_entry_items.entry_id and e.user_id = auth.uid()
  ));

create policy "own entry items: insert" on journal_entry_items for insert
  with check (exists (
    select 1 from journal_entries e
    where e.id = journal_entry_items.entry_id and e.user_id = auth.uid()
  ));

create policy "own entry items: update" on journal_entry_items for update
  using (exists (
    select 1 from journal_entries e
    where e.id = journal_entry_items.entry_id and e.user_id = auth.uid()
  ));

create policy "own entry items: delete" on journal_entry_items for delete
  using (exists (
    select 1 from journal_entries e
    where e.id = journal_entry_items.entry_id and e.user_id = auth.uid()
  ));

create policy "own plan slots: read" on meal_plan_slots for select
  using (exists (
    select 1 from meal_plans p
    where p.id = meal_plan_slots.plan_id and p.user_id = auth.uid()
  ));

create policy "own plan slots: write" on meal_plan_slots for all
  using (exists (
    select 1 from meal_plans p
    where p.id = meal_plan_slots.plan_id and p.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from meal_plans p
    where p.id = meal_plan_slots.plan_id and p.user_id = auth.uid()
  ));

-- ---------------------------------------------------------------------------
-- Shared libraries
-- ---------------------------------------------------------------------------

-- Anyone signed in can read the food database. A barcode scan has to resolve
-- against everyone's contributions or the feature is pointless.
create policy "food: read" on food_items for select
  to authenticated
  using (deleted_at is null);

create policy "food portions: read" on food_portions for select
  to authenticated
  using (true);

-- Users may contribute foods, but only as their own unverified submissions.
-- The `verified` and `moderation` columns are deliberately pinned here: a user
-- must not be able to self-certify an entry that everyone else will then trust.
create policy "food: submit" on food_items for insert
  to authenticated
  with check (
    submitted_by = auth.uid()
    and user_submitted = true
    and verified = false
    and moderation = 'ai_generated'
  );

create policy "food: edit own submission" on food_items for update
  to authenticated
  using (submitted_by = auth.uid() and user_submitted = true)
  with check (
    submitted_by = auth.uid()
    and user_submitted = true
    and verified = false
  );

-- Recipes are read-only to clients. They are written by the pipeline using the
-- service role, which bypasses RLS.
create policy "recipes: read" on recipes for select
  to authenticated
  using (deleted_at is null);

create policy "recipe ingredients: read" on recipe_ingredients for select
  to authenticated using (true);

create policy "recipe steps: read" on recipe_steps for select
  to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
--
-- RLS and GRANT are two separate gates and both must be open: GRANT decides
-- whether a role may touch the table at all, RLS decides which rows it sees.
-- A table with perfect policies and no GRANT returns "permission denied".
--
-- Supabase normally arranges these through default privileges, but stating them
-- here keeps the migration self-contained — it applies to a bare Postgres the
-- same way it applies to a Supabase project, which is what makes it testable.

grant usage on schema public to authenticated, anon;

grant select, insert, update, delete on all tables in schema public to authenticated;

-- Anonymous users get nothing. Daylish works fully offline before sign-in, so
-- there is no reason for the anon role to reach the database at all.
revoke all on all tables in schema public from anon;

-- Sequences would matter for bigserial keys; all our ids are client-generated
-- uuids, so there is nothing to grant.

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
