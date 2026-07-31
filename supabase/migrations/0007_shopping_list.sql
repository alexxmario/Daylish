-- The shopping list: recipes you mean to cook, and what is already in the basket.
--
-- Mirrors the device schema in `packages/db/src/schema.ts`. The list stores
-- *recipes*, not ingredients — the lines a person reads in the shop are derived
-- from these by `buildShoppingList` in `packages/core`, which scales each recipe
-- to the portions wanted and adds up whatever they share. Storing the derived
-- lines would mean re-deriving them the moment anything changed, and would let
-- the list disagree with the recipes it came from.
--
-- `recipe_id` is text and carries no foreign key, for the reason set out in
-- 0006: the recipe library lives in the app bundle, and what syncs is the fact
-- that this person wants to cook something, not the recipe itself.

create table if not exists shopping_list_recipes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles (id) on delete cascade,
  -- The device's stable recipe key, e.g. 'seed:shakshuka-light'.
  recipe_id  text not null,
  -- Portions to cook, which is not necessarily what the recipe yields.
  servings   integer not null check (servings > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists shopping_list_recipes_user_idx
  on shopping_list_recipes (user_id);

-- What has already been picked up.
--
-- Keyed by the normalised ingredient name (`shoppingItemKey` in core) rather
-- than by a line id, because lines are derived and have no identity of their
-- own: adding a fifth recipe rebuilds every line, and the garlic already in the
-- basket has to stay ticked through that.
create table if not exists shopping_list_checks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles (id) on delete cascade,
  item_key   text not null check (length(trim(item_key)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists shopping_list_checks_user_idx
  on shopping_list_checks (user_id, item_key);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
--
-- Same model as every other personal table: readable and writable only by the
-- user it belongs to. Both tables carry `user_id` directly, so ownership is a
-- column comparison rather than a join.

alter table shopping_list_recipes enable row level security;
alter table shopping_list_checks  enable row level security;

create policy "own shopping list: read"   on shopping_list_recipes for select using (auth.uid() = user_id);
create policy "own shopping list: insert" on shopping_list_recipes for insert with check (auth.uid() = user_id);
create policy "own shopping list: update" on shopping_list_recipes for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own shopping list: delete" on shopping_list_recipes for delete using (auth.uid() = user_id);

create policy "own shopping ticks: read"   on shopping_list_checks for select using (auth.uid() = user_id);
create policy "own shopping ticks: insert" on shopping_list_checks for insert with check (auth.uid() = user_id);
create policy "own shopping ticks: update" on shopping_list_checks for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own shopping ticks: delete" on shopping_list_checks for delete using (auth.uid() = user_id);

-- Grants, matching 0002 and 0004: authenticated only, never anon.
grant select, insert, update, delete on shopping_list_recipes to authenticated;
grant select, insert, update, delete on shopping_list_checks  to authenticated;
revoke all on shopping_list_recipes from anon;
revoke all on shopping_list_checks  from anon;
