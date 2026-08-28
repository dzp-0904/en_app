-- RLS evaluation shape.
--
-- The isolation guarantees themselves are proved by 01_tenant_isolation and
-- 02_student_visibility, which were written against the previous correlated
-- helpers and pass UNCHANGED against the array helpers. That is the regression
-- evidence that the rewrite preserved the semantics.
--
-- This file asserts the thing those files cannot see: that the policies are
-- evaluated ONCE PER STATEMENT rather than once per row. The old shape,
-- `(select app.is_class_teacher(class_id))`, referenced the candidate row, so it
-- was correlated and cost a function call plus an index lookup for every row
-- scanned. `class_id = any ((select app.my_class_ids())::uuid[])` references no
-- column, so the planner hoists it into an InitPlan.
--
-- A plan is not a contract, so these assertions look only for the InitPlan node
-- itself — not for join order, scan type or row estimates.

begin;
select plan(18);

select tests.seed_world();

-- Collects EXPLAIN output as one string. Created as the owner so the temp
-- function exists before the role switch; pg_temp routines are PUBLIC EXECUTE.
create function pg_temp.plan_of(p_sql text)
returns text
language plpgsql
as $$
declare
  r   record;
  acc text := '';
begin
  for r in execute 'explain (costs off) ' || p_sql loop
    acc := acc || r."QUERY PLAN" || E'\n';
  end loop;
  return acc;
end;
$$;

-- ===========================================================================
-- 1. No correlated helper survives anywhere in the policy set.
--
-- These six functions were the per-row predicates. They are dropped, so a
-- policy mentioning one would not even create — but a future migration could
-- reintroduce the shape, and this is where that gets caught.
-- ===========================================================================
select is(
  (select count(*) from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') || coalesce(with_check, ''))
          ~ 'is_class_teacher|is_member_teacher|is_own_member|is_class_student|is_my_teacher\(|is_my_student\(')::int,
  0,
  'no policy calls a row-correlated helper');

select cmp_ok(
  (select count(*) from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') || coalesce(with_check, '')) ~ 'my_[a-z_]*_ids\(\)')::int,
  '>=', 17,
  'the tenant policies are expressed through the argument-free array helpers');

select is(
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname like 'my\_%')::int, 5,
  'exactly five array helpers exist: class, member, student_class, teacher, student');

-- ===========================================================================
-- 2. Teacher-side plans hoist the helper into an InitPlan.
-- ===========================================================================
set local role authenticated;
select tests.login('11111111-1111-1111-1111-111111111111');

select matches(pg_temp.plan_of('select * from public.classes'),
  'InitPlan', 'classes: teacher read is hoisted');
select matches(pg_temp.plan_of('select * from public.class_members'),
  'InitPlan', 'class_members: teacher read is hoisted');
select matches(pg_temp.plan_of('select * from public.class_sessions'),
  'InitPlan', 'class_sessions: teacher read is hoisted');
select matches(pg_temp.plan_of('select * from public.session_attendance'),
  'InitPlan', 'session_attendance: teacher read is hoisted');
select matches(pg_temp.plan_of('select * from public.score_entries'),
  'InitPlan', 'score_entries: teacher read is hoisted');
select matches(pg_temp.plan_of('select * from public.lesson_logs'),
  'InitPlan', 'lesson_logs: teacher read is hoisted');
select matches(pg_temp.plan_of('select * from public.homework_assignments'),
  'InitPlan', 'homework_assignments: teacher read is hoisted');
select matches(pg_temp.plan_of('select * from public.homework_submissions'),
  'InitPlan', 'homework_submissions: teacher read is hoisted');
select matches(pg_temp.plan_of('select * from public.monthly_reports'),
  'InitPlan', 'monthly_reports: teacher read is hoisted');
select matches(pg_temp.plan_of('select * from public.tuition_records'),
  'InitPlan', 'tuition_records: teacher read is hoisted');
select matches(pg_temp.plan_of('select * from public.class_invite_codes'),
  'InitPlan', 'class_invite_codes: teacher read is hoisted');

-- ===========================================================================
-- 3. Student-side plans too. A student in two classes is the case that would
--    have paid the correlated cost twice over.
-- ===========================================================================
select tests.login('33333333-3333-3333-3333-333333333333');

select matches(pg_temp.plan_of('select * from public.classes'),
  'InitPlan', 'classes: student read is hoisted');
select matches(pg_temp.plan_of('select * from public.score_entries'),
  'InitPlan', 'score_entries: student read is hoisted');
select matches(pg_temp.plan_of('select * from public.session_attendance'),
  'InitPlan', 'session_attendance: student read is hoisted');

-- profiles is the widest predicate: self, my teachers, my students.
select matches(pg_temp.plan_of('select * from public.profiles'),
  'InitPlan', 'profiles: the three-way predicate is hoisted');

reset role;

select * from finish();
rollback;
