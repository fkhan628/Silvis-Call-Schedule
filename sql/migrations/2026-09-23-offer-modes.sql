-- ============================================================================
-- Silvis Call Schedule - migration 2026-09-23: call_periods.offer_modes (Prompt 14 part 1, addendum)
-- Faraz 9/22 evening (docs/PROMPT-14-OFFER-PERIODS.md v2, part 2a): when a surgeon submits offers for a period they
-- choose the hardness - 'exhaustive' ("only these days": eligible only on an offered day, in the offered role) or
-- 'preferred' ("my preferred days; use my rules to fill gaps": offered days first with a strong bonus, a non-offered
-- day only under their ordinary rules with a strong penalty, every such placement reported). The mode is stored on
-- the period, one key per person; an absent key means 'preferred' (the default). Set from the painter (part 3a) or
-- by the scheduler. The derived per-period status (offer_status()) does not read it.
--
-- Additive and idempotent: one column with a default (the live rows - none yet - read as '{}'), one shape check,
-- one comment. Nothing else changes: no function, trigger or policy is touched. Apply live with the Supabase CLI
-- (absolute path; the workdir is a directory linked with `supabase link --project-ref bzhsroegtagqhutbnsrp`):
--   supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-09-23-offer-modes.sql
-- Prove it with sql/probes/offers-probe.sql (cases K-set / K-type / K-default; it rolls itself back) and
-- scripts/verify-rls.sh section 8. The lines below are byte-identical to the ones in sql/schema.sql
-- (test/schema.test.js pins that).
--
-- The check constrains the SHAPE only (a jsonb object): the two mode words are read by the client and rules.js, and
-- a check constraint cannot iterate the values without a helper function - kept out on purpose so a future third
-- mode is a code change, not a schema change.
-- ============================================================================

alter table public.call_periods add column if not exists offer_modes jsonb not null default '{}'::jsonb;
alter table public.call_periods drop constraint if exists call_periods_offer_modes_object;
alter table public.call_periods add constraint call_periods_offer_modes_object check (jsonb_typeof(offer_modes) = 'object');
comment on column public.call_periods.offer_modes is '{person_id: ''exhaustive'' | ''preferred''}; absent = ''preferred'' (the default, Faraz 9/22 evening); offer_status() is unchanged';
