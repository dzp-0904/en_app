-- EduTrack Phase 1 — Step 1: extensions and schemas
--
-- pgcrypto supplies gen_random_bytes() for report share tokens.
-- Hashing uses the built-in pg_catalog.sha256(), so no extension is needed there.
--
-- citext is deliberately NOT used. Case-insensitive columns are modelled as
-- plain text normalised on write (lower() for emails, upper() for invite codes)
-- with CHECK constraints enforcing the normal form. Reason: every security
-- definer function in this schema runs with `search_path = ''`, and citext's
-- equality operators live in the extensions schema. Operator resolution IS
-- search_path dependent, so `citext = text` would fail to resolve inside those
-- functions at runtime. Normalised text has no such hazard.

create extension if not exists pgcrypto with schema extensions;

-- Private helper schema. Never exposed through PostgREST (config.toml lists
-- only `public` and `graphql_public`), so nothing in here is callable as an RPC
-- even though `authenticated` holds EXECUTE on its functions for the sake of
-- RLS policy evaluation.
create schema if not exists app;

comment on schema app is
  'Private helpers for RLS policy evaluation. Not exposed via PostgREST.';

revoke all on schema app from public;
grant usage on schema app to authenticated;
