-- Foods logged by tapping a ranked suggestion on Ideas.
--
-- Kept distinct from 'copy' deliberately: log_method exists to measure how long
-- each logging path takes, and folding suggestion taps into copy-day would hide
-- the fastest path in the app behind the numbers for a different one.
--
-- Idempotent so it is safe against a database where 0001 has already run and
-- against a fresh one. Postgres 12+ permits ADD VALUE inside a transaction as
-- long as the value is not used in the same transaction, which it is not here.

alter type log_method_t add value if not exists 'suggestion';
