-- Recipe references become text keys, not foreign keys into a server library.
--
-- `recipe_interactions.recipe_id` was `uuid references recipes (id)`. That could
-- never have worked, and it is worth writing down why before the sync worker is
-- built on top of it.
--
-- On the device a recipe's id is derived from its title — `seed:shakshuka-light`
-- — deliberately, so that re-seeding is idempotent across app launches and
-- across builds: the same dish keeps the same id, and a recipe someone saved
-- still points at it after the library is updated. On the server, `recipes.id`
-- is a generated uuid. So the id the device holds is not a uuid, cannot be cast
-- to one, and would fail the foreign key even if it could.
--
-- The fix is to stop pretending the server owns the library. It does not: the
-- 496 recipes ship inside the app bundle and are seeded into device SQLite at
-- first launch, and nothing in the app has ever read `recipes` over the network.
-- What has to survive a lost phone is not the recipe — that comes back with the
-- app — but the fact that *this person* saved it, cooked it, or put it on a
-- shopping list.
--
-- So the reference is stored as the device's own stable key, with no foreign
-- key. That is a deliberate loosening: it means the server will happily store a
-- reference to a recipe that a future library no longer contains, which is
-- exactly the behaviour wanted. A dropped recipe should cost someone a dead
-- bookmark, not a failed sync of their entire diary.
--
-- The `recipes` table itself is left in place. It is still where a
-- server-published library would live if one is ever wanted, and dropping it
-- would take `recipe_ingredients` and `recipe_steps` with it for no gain.

alter table recipe_interactions
  drop constraint if exists recipe_interactions_recipe_id_fkey;

alter table recipe_interactions
  alter column recipe_id type text using recipe_id::text;

-- The index is now over text rather than uuid; recreate it so the operator
-- class matches the column.
drop index if exists recipe_interactions_user_idx;
create index if not exists recipe_interactions_user_idx
  on recipe_interactions (user_id, recipe_id);
