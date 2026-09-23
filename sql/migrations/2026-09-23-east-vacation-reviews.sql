-- ============================================================================
-- Silvis Call Schedule - migration 2026-09-23: east_vacation_reviews (Prompt 15 part 2)
-- The review step for the East vacations part 1 mirrors from Davenport (east_feed payload
-- data.vacations: the person's Davenport time_off ranges, kind vacation, matched by roster
-- code). Nothing is mirrored blindly: each range is unreviewed (no row), 'away' (also off at
-- Silvis) or 'home' (available at Silvis - no East call, no OR block). rules.js reads the rows
-- with the cached ranges (ctx.eastVacations) and derives the vacation / eastClear days; it
-- never writes time_off rows, so a change of mind is one row and leaves no orphans.
--
-- Idempotent and self-contained: create-if-not-exists the table and its index, enable RLS,
-- drop/create the four policies. Apply live with the Supabase CLI (absolute path):
--   supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-09-23-east-vacation-reviews.sql
-- Prove it with sql/probes/east-vacation-reviews-probe.sql before and after (it rolls itself
-- back) and scripts/verify-rls.sh section 9. The definitions below are byte-identical to the
-- ones in sql/schema.sql (test/schema.test.js pins that).
--
-- Report-first (guide section 4.3): this adds a table and four policies to the live project and
-- touches no existing table, row or policy. Blast radius: none for existing data; the new table
-- is EMPTY until a review is saved from Setup -> East feed / the person's Time off view.
-- ============================================================================

-- ---------- East vacation reviews (Prompt 15 part 2, 2026-09-23; sql/migrations/2026-09-23-east-vacation-reviews.sql)
-- One row per REVIEWED Davenport vacation range of a surgeon with an East code (the ranges
-- themselves live in the east_feed payload, data.vacations, and are never copied here): the
-- person's decision for that exact range - 'away' (also off at Silvis) or 'home' (available
-- at Silvis; no East call, no OR block). No row = unreviewed = treated like away by rules.js
-- (a derived vacation; never a time_off row). A range Davenport changes or removes no longer
-- matches its row (exact start/end), so the review resets and the app deletes the stale row.
-- "end" is a reserved word: quoted here, plain start/end over PostgREST ({ "start", "end" }
-- in JSON, ?start=eq.&end=eq. in the query string), the same shape as the feed payload.
-- Authenticated-read only (no anon policy): a decision says where a surgeon is on a given
-- day, so it stays off the anon-readable list like user_profiles. Writes: own rows or the
-- scheduler/admin. Dates only - never a note or a reason.
create table if not exists public.east_vacation_reviews (
  id          uuid primary key default gen_random_uuid(),
  person_id   text not null,
  "start"     date not null,
  "end"       date not null,
  decision    text not null check (decision in ('away', 'home')),
  decided_at  timestamptz not null default now(),
  decided_by  text,
  check ("end" >= "start"),
  unique (person_id, "start", "end")
);
create index if not exists east_vacation_reviews_person_idx on public.east_vacation_reviews(person_id, "start");

alter table public.east_vacation_reviews   enable row level security;

-- east_vacation_reviews: authenticated read (NO anon policy - an anon read is a silent 200 + [],
-- which verify-rls.sh section 9 checks against the probe's fixture rows), writes own rows or scheduler
drop policy if exists east_vacation_reviews_read on public.east_vacation_reviews;
create policy east_vacation_reviews_read on public.east_vacation_reviews for select to authenticated using (true);
drop policy if exists east_vacation_reviews_self_insert on public.east_vacation_reviews;
create policy east_vacation_reviews_self_insert on public.east_vacation_reviews for insert to authenticated
  with check (person_id = public.silvis_person_id() or public.silvis_is_sched());
drop policy if exists east_vacation_reviews_self_update on public.east_vacation_reviews;
create policy east_vacation_reviews_self_update on public.east_vacation_reviews for update to authenticated
  using (person_id = public.silvis_person_id() or public.silvis_is_sched())
  with check (person_id = public.silvis_person_id() or public.silvis_is_sched());
drop policy if exists east_vacation_reviews_self_delete on public.east_vacation_reviews;
create policy east_vacation_reviews_self_delete on public.east_vacation_reviews for delete to authenticated
  using (person_id = public.silvis_person_id() or public.silvis_is_sched());
