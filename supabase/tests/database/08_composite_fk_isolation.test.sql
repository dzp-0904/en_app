-- Cross-class isolation at the structural level.
--
-- Every child table carries a denormalised class_id so RLS can reach the
-- tenancy root in one hop instead of joining back through class_members. A
-- denormalised key is normally a lie waiting to happen — so it is not merely
-- copied, it is CONSTRAINED: each child holds a composite FK
-- (child_id, class_id) -> parent (id, class_id), keyed off a composite UNIQUE
-- on the parent. A row whose class_id disagrees with its parent's cannot be
-- written at all.
--
-- These assertions run as postgres, with RLS bypassed, precisely to show the
-- guarantee is structural. If every policy in the database were dropped
-- tomorrow, none of these inserts would still succeed.

begin;
select plan(18);

select tests.seed_world();

-- --------------------------------------------------------------------------
-- Attendance cannot cross a class boundary in either direction
-- --------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.session_attendance
       (session_id, class_member_id, class_id, status)
     values ('d1000000-0000-0000-0000-000000000001',
             'b4000000-0000-0000-0000-000000000004',
             'c1000000-0000-0000-0000-000000000001', 'present') $$,
  '23503', null,
  'a member of another class cannot be marked at this class''s session');

select throws_ok(
  $$ insert into public.session_attendance
       (session_id, class_member_id, class_id, status)
     values ('d1000000-0000-0000-0000-000000000001',
             'b4000000-0000-0000-0000-000000000004',
             'c3000000-0000-0000-0000-000000000003', 'present') $$,
  '23503', null,
  'relabelling the class_id does not make the session belong to it');

select lives_ok(
  $$ insert into public.session_attendance
       (session_id, class_member_id, class_id, status)
     values ('d2000000-0000-0000-0000-000000000002',
             'b2000000-0000-0000-0000-000000000002',
             'c1000000-0000-0000-0000-000000000001', 'present') $$,
  'a consistent (session, member, class) triple is accepted');

-- --------------------------------------------------------------------------
-- Every other child table carries the same guarantee
-- --------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.score_entries
       (class_member_id, class_id, recorded_on, overall, created_by)
     values ('b1000000-0000-0000-0000-000000000001',
             'c3000000-0000-0000-0000-000000000003',
             current_date, 7.0, '11111111-1111-1111-1111-111111111111') $$,
  '23503', null,
  'a score entry cannot claim a class its member does not belong to');

select throws_ok(
  $$ insert into public.lesson_logs
       (class_id, class_member_id, lesson_date, skill, topic, performance, created_by)
     values ('c1000000-0000-0000-0000-000000000001',
             'b4000000-0000-0000-0000-000000000004',
             current_date, 'writing', 'x', 'good',
             '11111111-1111-1111-1111-111111111111') $$,
  '23503', null,
  'a lesson log cannot be written against another class''s member');

select throws_ok(
  $$ insert into public.lesson_logs
       (class_id, class_member_id, session_id, lesson_date, skill, topic,
        performance, created_by)
     values ('c2000000-0000-0000-0000-000000000002',
             'b3000000-0000-0000-0000-000000000003',
             'd1000000-0000-0000-0000-000000000001',
             current_date, 'writing', 'x', 'good',
             '11111111-1111-1111-1111-111111111111') $$,
  '23503', null,
  'a lesson log cannot point at a session belonging to a different class');

select throws_ok(
  $$ insert into public.homework_submissions
       (assignment_id, class_member_id, class_id, status)
     values ('e1000000-0000-0000-0000-000000000001',
             'b4000000-0000-0000-0000-000000000004',
             'c1000000-0000-0000-0000-000000000001', 'assigned') $$,
  '23503', null,
  'a submission cannot attach another class''s member to this assignment');

select throws_ok(
  $$ insert into public.homework_submissions
       (assignment_id, class_member_id, class_id, status)
     values ('e2000000-0000-0000-0000-000000000002',
             'b1000000-0000-0000-0000-000000000001',
             'c1000000-0000-0000-0000-000000000001', 'assigned') $$,
  '23503', null,
  'a submission cannot attach this class''s member to another class''s assignment');

select throws_ok(
  $$ insert into public.homework_assignments
       (class_id, session_id, title, skill, created_by)
     values ('c2000000-0000-0000-0000-000000000002',
             'd1000000-0000-0000-0000-000000000001',
             'x', 'writing', '11111111-1111-1111-1111-111111111111') $$,
  '23503', null,
  'an assignment cannot be tied to a session from a different class');

select throws_ok(
  $$ insert into public.monthly_reports
       (class_member_id, class_id, period_month, snapshot, generated_by)
     values ('b1000000-0000-0000-0000-000000000001',
             'c3000000-0000-0000-0000-000000000003',
             date_trunc('month', now())::date, '{}'::jsonb,
             '11111111-1111-1111-1111-111111111111') $$,
  '23503', null,
  'a report cannot claim a class its member does not belong to');

select throws_ok(
  $$ insert into public.tuition_records
       (class_member_id, class_id, period_month, rate_per_session)
     values ('b4000000-0000-0000-0000-000000000004',
             'c1000000-0000-0000-0000-000000000001',
             date_trunc('month', now())::date, 100000) $$,
  '23503', null,
  'a tuition record cannot be filed against the wrong class');

-- --------------------------------------------------------------------------
-- Uniqueness that keeps the model honest
-- --------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.class_sessions (class_id, starts_at, ends_at)
     select 'c1000000-0000-0000-0000-000000000001', starts_at, ends_at
       from public.class_sessions
      where id = 'd1000000-0000-0000-0000-000000000001' $$,
  '23505', null,
  'regenerating a schedule cannot duplicate a session slot');

select throws_ok(
  $$ insert into public.score_entries
       (class_member_id, class_id, recorded_on, entry_type, overall, created_by)
     values ('b1000000-0000-0000-0000-000000000001',
             'c1000000-0000-0000-0000-000000000001',
             current_date, 'baseline', 6.0,
             '11111111-1111-1111-1111-111111111111') $$,
  '23505', null,
  'a member has exactly one baseline band');

select throws_ok(
  $$ insert into public.class_members
       (class_id, student_id, join_status, joined_at)
     values ('c1000000-0000-0000-0000-000000000001',
             '33333333-3333-3333-3333-333333333333', 'joined', now()) $$,
  '23505', null,
  'a student cannot hold two membership rows in the same class');

select lives_ok(
  $$ insert into public.class_members
       (class_id, student_id, join_status, joined_at)
     values ('c3000000-0000-0000-0000-000000000003',
             '33333333-3333-3333-3333-333333333333', 'joined', now()) $$,
  'the same student CAN hold a membership row in a different class');

select throws_ok(
  $$ insert into public.monthly_reports
       (class_member_id, class_id, period_month, snapshot, generated_by)
     select class_member_id, class_id, period_month, snapshot, generated_by
       from public.monthly_reports
      where id = 'f1000000-0000-0000-0000-000000000001' $$,
  '23505', null,
  'a member has at most one report per month');

select throws_ok(
  $$ insert into public.session_attendance
       (session_id, class_member_id, class_id, status)
     values ('d1000000-0000-0000-0000-000000000001',
             'b1000000-0000-0000-0000-000000000001',
             'c1000000-0000-0000-0000-000000000001', 'absent') $$,
  '23505', null,
  'a member has at most one attendance fact per session');

-- --------------------------------------------------------------------------
-- And RLS refuses the same thing one layer up
-- --------------------------------------------------------------------------
set local role authenticated;
select tests.login('11111111-1111-1111-1111-111111111111');

select throws_ok(
  $$ insert into public.lesson_logs
       (class_id, class_member_id, lesson_date, skill, topic, performance, created_by)
     values ('c3000000-0000-0000-0000-000000000003',
             'b4000000-0000-0000-0000-000000000004',
             current_date, 'writing', 'x', 'good',
             '11111111-1111-1111-1111-111111111111') $$,
  '42501', null,
  'RLS refuses the cross-tenant write before the constraint ever sees it');

reset role;
select * from finish();
rollback;
