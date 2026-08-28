-- Student visibility.
--
-- The trap this file exists to catch: writing the class_members policy as
-- "rows in a class you belong to" instead of "rows that are you". Both let a
-- student see their own record, so both pass a naive test — but the first also
-- hands every classmate's bands, attendance and tuition rate to every student
-- in the class.

begin;
select plan(30);

select tests.seed_world();

set local role authenticated;
select tests.login('33333333-3333-3333-3333-333333333333');  -- Student X (C1 and C2)

-- --------------------------------------------------------------------------
-- Identity scope, not class scope
-- --------------------------------------------------------------------------
select is(
  (select count(*) from public.class_members)::int, 2,
  'student X sees exactly their own two membership rows');

select is(
  (select count(*) from public.class_members
    where student_id <> '33333333-3333-3333-3333-333333333333')::int, 0,
  'student X sees no membership row belonging to anyone else');

select is(
  (select count(*) from public.class_members
    where id = 'b2000000-0000-0000-0000-000000000002')::int, 0,
  'student X cannot see a classmate''s class_members row in the same class');

select bag_eq(
  $$ select id from public.class_members $$,
  $$ values ('b1000000-0000-0000-0000-000000000001'::uuid),
            ('b3000000-0000-0000-0000-000000000003'::uuid) $$,
  'student X sees their own record in BOTH classes they belong to');

select is(
  (select count(*) from public.classes)::int, 2,
  'student X sees both classes they belong to');

-- Self plus the teacher of the classes they joined. A classmate is neither.
select is(
  (select count(*) from public.profiles)::int, 2,
  'student X sees only their own profile and their teacher''s');

select is(
  (select count(*) from public.profiles
    where id = '44444444-4444-4444-4444-444444444444')::int, 0,
  'student X cannot read a classmate''s profile');

-- --------------------------------------------------------------------------
-- Surfaces with no student policy at all return zero rows
-- --------------------------------------------------------------------------
select is((select count(*) from public.class_invite_codes)::int, 0,
  'student X cannot read invite codes for their own class');

select is((select count(*) from public.monthly_reports)::int, 0,
  'student X cannot read monthly reports in phase 1');

select is((select count(*) from public.tuition_records)::int, 0,
  'student X cannot read tuition records');

select is((select count(*) from public.mistake_tags)::int, 0,
  'student X cannot read the mistake tag vocabulary');

-- --------------------------------------------------------------------------
-- Own child records, across every class
-- --------------------------------------------------------------------------
select is((select count(*) from public.score_entries)::int, 4,
  'student X sees their own score history from both classes');

select is(
  (select count(*) from public.score_entries
    where class_member_id = 'b2000000-0000-0000-0000-000000000002')::int, 0,
  'student X cannot see a classmate''s scores');

select is((select count(*) from public.session_attendance)::int, 7,
  'student X sees only their own attendance marks');

select is((select count(*) from public.homework_submissions)::int, 1,
  'student X sees only their own homework submissions');

select is((select count(*) from public.lesson_logs)::int, 1,
  'student X sees only their own lesson logs');

-- Sessions are class-scoped, not member-scoped: the timetable is shared.
select is((select count(*) from public.class_sessions)::int, 8,
  'student X sees the timetable of the classes they belong to');

-- --------------------------------------------------------------------------
-- Students hold no write verb on membership or grading
-- --------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.class_members (class_id, student_id, join_status, joined_at)
     values ('c3000000-0000-0000-0000-000000000003',
             '33333333-3333-3333-3333-333333333333', 'joined', now()) $$,
  '42501', null,
  'student X cannot insert themselves into a class directly');

select throws_ok(
  $$ insert into public.score_entries
       (class_member_id, class_id, recorded_on, overall, created_by)
     values ('b1000000-0000-0000-0000-000000000001',
             'c1000000-0000-0000-0000-000000000001',
             current_date, 9.0, '33333333-3333-3333-3333-333333333333') $$,
  '42501', null,
  'student X cannot award themselves a band score');

-- TRUNCATE is not subject to row level security. Supabase's default GRANT ALL
-- hands it to `authenticated`, which would let any logged-in student empty a
-- table they cannot read one row of. Step 12 takes it back.
select throws_ok(
  $$ truncate public.class_members $$, '42501', null,
  'student X cannot TRUNCATE past RLS');

select throws_ok(
  $$ truncate public.score_entries $$, '42501', null,
  'student X cannot TRUNCATE the score history');

-- Students hold no UPDATE or DELETE policy anywhere, so these statements are
-- not errors — they simply match no rows. Issue them for real, then inspect
-- the targets as postgres: the property under test is that nothing moved.
update public.class_members set target_band = 9.0
 where id = 'b1000000-0000-0000-0000-000000000001';

update public.class_members set target_band = 9.0
 where id = 'b2000000-0000-0000-0000-000000000002';

delete from public.class_members
 where id = 'b1000000-0000-0000-0000-000000000001';

update public.homework_submissions
   set status = 'graded', submitted_at = now(), score = 10, graded_at = now()
 where class_member_id = 'b1000000-0000-0000-0000-000000000001';

reset role;

select is(
  (select target_band::numeric from public.class_members
    where id = 'b1000000-0000-0000-0000-000000000001'), 7.0::numeric,
  'student X cannot update even their OWN membership row');

select is(
  (select target_band::numeric from public.class_members
    where id = 'b2000000-0000-0000-0000-000000000002'), 6.5::numeric,
  'student X cannot update a classmate''s membership row');

select is(
  (select count(*) from public.class_members
    where id = 'b1000000-0000-0000-0000-000000000001')::int, 1,
  'student X cannot delete their own membership row');

select is(
  (select score from public.homework_submissions
    where class_member_id = 'b1000000-0000-0000-0000-000000000001'), null::numeric,
  'student X cannot grade their own homework by direct UPDATE');

set local role authenticated;

-- --------------------------------------------------------------------------
-- A removed student keeps their own history but loses the class
-- --------------------------------------------------------------------------
select tests.login('88888888-8888-8888-8888-888888888888');  -- removed from C1

select is((select count(*) from public.class_members)::int, 1,
  'a removed student can still see their own membership record');

select is((select count(*) from public.classes)::int, 0,
  'a removed student can no longer see the class');

select is((select count(*) from public.class_sessions)::int, 0,
  'a removed student can no longer see the timetable');

-- --------------------------------------------------------------------------
-- A user with no membership sees nothing but themselves
-- --------------------------------------------------------------------------
select tests.login('77777777-7777-7777-7777-777777777777');  -- outsider

select is(
  (select count(*) from public.class_members)::int
  + (select count(*) from public.classes)::int
  + (select count(*) from public.class_sessions)::int
  + (select count(*) from public.score_entries)::int, 0,
  'a student with no membership reads nothing from any class table');

select is((select count(*) from public.profiles)::int, 1,
  'a student with no membership sees only their own profile');

reset role;
select * from finish();
rollback;
