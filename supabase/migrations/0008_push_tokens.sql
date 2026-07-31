-- Push tokens: where to reach a device, and nothing else.
--
-- This is the only table in the schema that is *not* diary data, and it is the
-- only one that must never be restored onto a new phone. A push token is minted
-- by APNs for one installation of one app on one device; carrying it across a
-- restore would address notifications at a handset the person no longer has.
-- So there is no `deleted_at`, no `synced_at`, and nothing here goes through
-- `sync_outbox` — the device writes its token directly and that is the whole
-- lifecycle.
--
-- What is *sent* is decided in `packages/core/src/reminders.ts` and, for billing
-- events, by the RevenueCat webhook. This table only answers "where".
--
-- Everything derived from the diary — targets, remaining macros, weigh-in day —
-- is scheduled locally on the device instead, because the goal engine lives in
-- `@daylish/core` and runs there. A server-side copy of that maths would be a
-- second implementation that eventually disagrees with the first, and a push
-- claiming a target the app does not show is the worst bug this app could ship.

create table if not exists push_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles (id) on delete cascade,
  -- The Expo push token, e.g. 'ExponentPushToken[xxxxxxxx]'. Opaque to us.
  token         text not null check (length(trim(token)) > 0),
  platform      text not null check (platform in ('ios', 'android')),
  -- For the You tab's device list, so someone can recognise which phone this is.
  device_name   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- Bumped every time the app confirms the token still belongs to this account.
  -- A token nobody has refreshed in months is almost certainly a dead handset.
  last_seen_at  timestamptz not null default now(),

  -- ---------------------------------------------------------------------
  -- Unique on the token ALONE, deliberately — not on (user_id, token).
  -- ---------------------------------------------------------------------
  -- A token identifies a device installation, not a person. If someone signs
  -- out and a second account signs in on the same handset, APNs hands back the
  -- same token, and a (user_id, token) key would happily store it against both
  -- accounts. The first user's billing and security notifications would then be
  -- delivered to a phone that someone else is holding.
  --
  -- Keyed this way, the registration upsert *moves* the token to whoever signed
  -- in last, which is the only correct answer: the phone belongs to one account
  -- at a time, exactly like the rest of the app's single-active-device model.
  unique (token)
);

create index if not exists push_tokens_user_idx on push_tokens (user_id);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
--
-- Same model as every other personal table. The sender runs with the service
-- role and bypasses these; a signed-in client can only ever see and revoke the
-- tokens belonging to its own account.

alter table push_tokens enable row level security;

create policy "own push tokens: read"   on push_tokens for select using (auth.uid() = user_id);
create policy "own push tokens: insert" on push_tokens for insert with check (auth.uid() = user_id);
create policy "own push tokens: update" on push_tokens for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own push tokens: delete" on push_tokens for delete using (auth.uid() = user_id);

-- Grants, matching 0002, 0004 and 0007: authenticated only, never anon.
grant select, insert, update, delete on push_tokens to authenticated;
revoke all on push_tokens from anon;
