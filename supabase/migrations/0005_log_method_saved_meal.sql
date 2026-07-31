-- Foods logged by tapping a saved meal.
--
-- Separate from 'copy' and 'suggestion' for the same reason those are separate
-- from each other: log_method exists to measure how long each logging path
-- takes, and this is expected to be the fastest one in the app. Folding it into
-- another value would hide exactly the number the feature was built to move.
--
-- Idempotent, and in its own file rather than appended to 0004: Postgres will
-- not let a value added to an enum be used in the same transaction, and
-- migration files run one transaction each.

alter type log_method_t add value if not exists 'saved_meal';
