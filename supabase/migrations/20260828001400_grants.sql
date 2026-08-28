-- EduTrack Phase 1 — Step 12: table and column grants
--
-- RLS is the primary control. These GRANTs are the second layer: if a policy
-- were ever dropped or mis-written, a missing privilege still denies the
-- statement. Two independent mistakes would be needed to leak a row.
--
-- Supabase's shipped defaults are `GRANT ALL` to anon and authenticated on
-- every new table and function in `public`. GRANT ALL is wider than the four
-- DML verbs, and one of the extras matters a great deal: TRUNCATE is NOT
-- subject to row level security. A role holding it can empty a table it cannot
-- read a single row of. So this file starts by taking everything back.

-- ===========================================================================
-- anon holds no table privileges anywhere.
--
-- Every policy in step 9 is scoped `to authenticated`, so anon already reads
-- nothing — but leaving the privilege in place means the protection rests on a
-- single mechanism. Strip it.
--
-- NOTE: routines are deliberately NOT revoked here. The two public RPCs were
-- granted to anon in step 11 and a blanket routine revoke would undo them.
-- ===========================================================================
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;

-- Future objects created by the migration owner inherit the same posture.
--
-- The FUNCTIONS line is the one that matters most. Supabase's default
-- privileges grant EXECUTE on every new function in `public` to anon
-- EXPLICITLY, and an explicit grant survives `revoke ... from public`. Without
-- this line, every RPC added later starts life callable by anonymous users
-- unless whoever writes it remembers to name anon in the revoke.
--
-- FOR ROLE postgres is explicit rather than implied. Without it the change
-- binds to whichever role happened to run the migration, which is invisible in
-- the file and silently wrong if that ever differs. `postgres` is the role
-- `supabase db push` and the SQL editor both use.
alter default privileges for role postgres in schema public
  revoke all     on tables    from anon;
alter default privileges for role postgres in schema public
  revoke all     on sequences from anon;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon;

-- anon keeps USAGE on the schema itself: without it the two public RPCs are
-- unreachable. USAGE alone exposes no data.
grant usage on schema public to anon;

-- ===========================================================================
-- authenticated: the four DML verbs and nothing else.
--
-- Dropping TRUNCATE is the point. REFERENCES and TRIGGER go too — neither is
-- reachable without CREATE on the schema, but a privilege nobody can justify
-- is a privilege that should not be held.
-- ===========================================================================
revoke all on all tables in schema public from authenticated;

alter default privileges for role postgres in schema public
  revoke truncate, references, trigger on tables from authenticated;

grant select, insert, update, delete on public.classes              to authenticated;
grant select, insert, update, delete on public.class_invite_codes   to authenticated;
grant select, insert, update, delete on public.class_members        to authenticated;
grant select, insert, update, delete on public.class_sessions       to authenticated;
grant select, insert, update, delete on public.session_attendance   to authenticated;
grant select, insert, update, delete on public.lesson_logs          to authenticated;
grant select, insert, update, delete on public.mistake_tags         to authenticated;
grant select, insert, update, delete on public.homework_assignments to authenticated;
grant select, insert, update, delete on public.homework_submissions to authenticated;
grant select, insert, update, delete on public.monthly_reports      to authenticated;
grant select, insert, update, delete on public.tuition_records      to authenticated;

-- ===========================================================================
-- score_entries: no UPDATE. The band history is append-only.
--
-- app.enforce_score_entry_append_only refuses the statement as well; this is
-- the privilege half of the same rule, so a dropped trigger does not silently
-- make the history editable. DELETE stays, both as the correction path and
-- because ON DELETE CASCADE from class_members and classes needs it.
-- ===========================================================================
grant select, insert, delete on public.score_entries to authenticated;

-- ===========================================================================
-- profiles: a user may edit their own display fields and nothing else.
--
-- `role` is additionally protected by app.enforce_profile_role_immutable, and
-- `email` is kept in step with auth.users by app.handle_user_email_sync. This
-- column grant is what stops the attempt from reaching those triggers at all.
--
-- Column grants work here precisely because the restriction is UNIFORM:
-- teachers and students share the `authenticated` Postgres role, so a column
-- grant can never say "teachers may, students may not". Anywhere the two roles
-- must diverge, the rule lives in a definer RPC instead.
--
-- Rows are created solely by app.handle_new_user and removed solely by the
-- cascade from auth.users, so there is no INSERT or DELETE grant at all.
-- ===========================================================================
grant select                             on public.profiles to authenticated;
grant update (full_name, teaching_type)  on public.profiles to authenticated;

-- ===========================================================================
-- Views. security_invoker = on means the caller's own RLS applies to the
-- underlying tables, so SELECT here grants nothing extra.
-- ===========================================================================
grant select on public.v_member_session_attendance to authenticated;
grant select on public.v_member_attendance_summary to authenticated;
grant select on public.v_member_performance_status to authenticated;
grant select on public.v_member_current_band       to authenticated;
