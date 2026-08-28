-- EduTrack Phase 1 — Step 7: RLS helper functions and privileged identity ops
--
-- Every one is SECURITY DEFINER, STABLE (or VOLATILE where it writes),
-- search_path = ''.
--
-- Why SECURITY DEFINER: a policy on class_members that read classes directly
-- would require the student to hold SELECT on classes, and policies that
-- reference each other's tables can recurse. A definer function short-circuits
-- both and costs one index lookup.
--
-- WHY THE SET-RETURNING FORM
--
-- The obvious shape is a per-row predicate, `app.is_class_teacher(class_id)`,
-- wrapped as `(select app.is_class_teacher(class_id))`. That wrapping does NOT
-- buy the InitPlan it looks like it does: the subquery references the
-- candidate row's own column, so it is CORRELATED and PostgreSQL must
-- re-evaluate it once per row scanned. On a teacher's roster query that is one
-- function call and one index lookup per member, per statement.
--
-- The helpers below take NO arguments. `class_id = any ((select
-- app.my_class_ids()))` is uncorrelated, so the planner hoists it into a real
-- InitPlan, evaluates it exactly once, and the per-row cost collapses to an
-- array membership test.
--
-- The security semantics are identical by construction: each array function
-- returns precisely the set its scalar predecessor tested membership of.

-- ---------------------------------------------------------------------------
-- Scalar predicates. Only two survive: both are called from RPC bodies, where
-- there is no per-row loop and the array form would buy nothing.
-- ---------------------------------------------------------------------------

-- Is the caller an active teacher at all? Used to stop a student inserting a
-- class with teacher_id = their own uid and thereby self-promoting.
create or replace function app.is_teacher()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = (select auth.uid())
       and p.role = 'teacher'
       and p.deactivated_at is null
  );
$$;

-- Does the caller own this class? Called by create_report_share_link and
-- revoke_report_share_link.
create or replace function app.is_class_teacher(p_class_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
      from public.classes c
      join public.profiles p on p.id = c.teacher_id
     where c.id = p_class_id
       and c.teacher_id = (select auth.uid())
       and p.deactivated_at is null
  );
$$;

-- ---------------------------------------------------------------------------
-- Set-returning helpers. These are what the policies use.
-- ---------------------------------------------------------------------------

-- Classes the caller owns. Empty for students, and empty for a deactivated
-- teacher — which is what makes deactivation actually revoke access rather
-- than merely flag the row.
create or replace function app.my_class_ids()
returns uuid[]
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(array_agg(c.id), '{}'::uuid[])
    from public.classes c
    join public.profiles p on p.id = c.teacher_id
   where c.teacher_id = (select auth.uid())
     and p.deactivated_at is null;
$$;

-- The caller's own class_members rows, across every class they belong to.
--
-- Identity-scoped, never class-scoped. This is the single most important
-- predicate in the schema: a class-scoped version would expose every
-- classmate's bands to every student in the class.
--
-- Deliberately unfiltered by removed_at: a removed student keeps read access
-- to their own history.
create or replace function app.my_member_ids()
returns uuid[]
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(array_agg(m.id), '{}'::uuid[])
    from public.class_members m
   where m.student_id = (select auth.uid());
$$;

-- Classes the caller is an ACTIVE student of. Multi-class safe. A removed or
-- departed member is excluded, which is what closes the class timetable to
-- someone who has left.
create or replace function app.my_student_class_ids()
returns uuid[]
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(array_agg(m.class_id), '{}'::uuid[])
    from public.class_members m
   where m.student_id = (select auth.uid())
     and m.join_status = 'joined'
     and m.removed_at is null;
$$;

-- Profiles that teach a class the caller has joined. A multi-class student
-- legitimately has several teachers.
create or replace function app.my_teacher_ids()
returns uuid[]
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(array_agg(distinct c.teacher_id), '{}'::uuid[])
    from public.class_members m
    join public.classes c on c.id = m.class_id
   where m.student_id = (select auth.uid())
     and m.join_status = 'joined'
     and m.removed_at is null;
$$;

-- Profiles enrolled in a class the caller owns. Lets a teacher read the names
-- and emails of their own roster, and nobody else's.
create or replace function app.my_student_ids()
returns uuid[]
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(array_agg(distinct m.student_id), '{}'::uuid[])
    from public.class_members m
    join public.classes c on c.id = m.class_id
    join public.profiles p on p.id = c.teacher_id
   where c.teacher_id = (select auth.uid())
     and p.deactivated_at is null
     and m.student_id is not null;
$$;

-- ---------------------------------------------------------------------------
-- Privileged identity operations. service_role only.
--
-- These are the ONLY paths that change a role or an account's active state.
-- Neither is reachable from a browser: they live in `app`, which is not
-- exposed through PostgREST, and EXECUTE is revoked from anon and
-- authenticated below.
-- ---------------------------------------------------------------------------

-- Promote a student profile to teacher. Raises the app.allow_role_change flag
-- for the duration of the UPDATE so app.enforce_profile_role_immutable lets
-- this one statement through, then lowers it again.
--
-- The explicit lower is load-bearing. set_config(..., is_local => true) is
-- scoped to the TRANSACTION, not to the function's GUC nest level — the SET
-- clause on this function does not claw it back on exit. Leaving it raised
-- would disarm the immutability trigger for every later statement in the same
-- transaction. On an error path the flag needs no cleanup: the aborting
-- (sub)transaction reverts it.
create or replace function app.provision_teacher(
  p_user_id       uuid,
  p_teaching_type text default null
)
returns void
language plpgsql
security definer
volatile
set search_path = ''
as $$
begin
  perform pg_catalog.set_config('app.allow_role_change', 'on', true);

  update public.profiles p
     set role          = 'teacher',
         teaching_type = p_teaching_type
   where p.id = p_user_id;

  perform pg_catalog.set_config('app.allow_role_change', 'off', true);

  if not found then
    raise exception 'no profile for user %', p_user_id using errcode = 'no_data_found';
  end if;
end;
$$;

-- Deactivate or restore an account. Deactivation is how a teacher is
-- offboarded: the row and every record they created stay exactly where they
-- are, and app.my_class_ids() stops returning their classes, so their access
-- ends without their students' history moving.
--
-- Reassigning a class to another teacher is OUT OF SCOPE for Phase 1. A
-- deactivated teacher's classes remain owned by them and unreachable by any
-- other teacher until an ownership-transfer flow exists.
create or replace function app.set_account_active(
  p_user_id uuid,
  p_active  boolean
)
returns void
language plpgsql
security definer
volatile
set search_path = ''
as $$
begin
  update public.profiles p
     set deactivated_at = case when p_active then null else now() end
   where p.id = p_user_id;

  if not found then
    raise exception 'no profile for user %', p_user_id using errcode = 'no_data_found';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants.
--
-- Policy evaluation happens as the querying role, so `authenticated` needs
-- EXECUTE on the predicates. `anon` deliberately gets nothing: it holds zero
-- policies, so no policy expression is ever evaluated for it.
--
-- The two privileged functions are named in the revoke and granted to
-- service_role alone. A blanket revoke first, so anything added to this schema
-- later starts closed.
-- ---------------------------------------------------------------------------
revoke all on all functions in schema app from public, anon, authenticated;

grant execute on function app.is_teacher()             to authenticated;
grant execute on function app.is_class_teacher(uuid)   to authenticated;
grant execute on function app.my_class_ids()           to authenticated;
grant execute on function app.my_member_ids()          to authenticated;
grant execute on function app.my_student_class_ids()   to authenticated;
grant execute on function app.my_teacher_ids()         to authenticated;
grant execute on function app.my_student_ids()         to authenticated;

grant execute on function app.provision_teacher(uuid, text)  to service_role;
grant execute on function app.set_account_active(uuid, boolean) to service_role;
