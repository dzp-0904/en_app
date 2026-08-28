-- Teacher tenant isolation.
--
-- classes.teacher_id is the tenancy root: every policy in the schema resolves
-- back to it. These assertions are the proof that it holds for reads AND
-- writes — a USING clause that hides rows but a missing WITH CHECK that lets
-- them be written would still be a breach.

begin;
select plan(24);

select tests.seed_world();

set local role authenticated;
select tests.login('11111111-1111-1111-1111-111111111111');  -- Teacher A

-- --------------------------------------------------------------------------
-- Reads stop at the tenancy boundary
-- --------------------------------------------------------------------------
select is(
  (select count(*) from public.classes)::int, 2,
  'teacher A sees exactly their own two classes');

select is(
  (select count(*) from public.classes
    where id = 'c3000000-0000-0000-0000-000000000003')::int, 0,
  'teacher A cannot see teacher B''s class');

select is(
  (select count(*) from public.class_members)::int, 5,
  'teacher A sees the five members across their own two classes');

select is(
  (select count(*) from public.class_members
    where class_id = 'c3000000-0000-0000-0000-000000000003')::int, 0,
  'teacher A cannot see teacher B''s students');

-- Self, plus the three distinct students on their own rosters.
select is(
  (select count(*) from public.profiles)::int, 4,
  'teacher A sees only their own profile and their own roster');

select is(
  (select count(*) from public.profiles
    where id = '99999999-9999-9999-9999-999999999999')::int, 0,
  'teacher A cannot read the profile of teacher B''s student');

select is(
  (select count(*) from public.profiles
    where id = '22222222-2222-2222-2222-222222222222')::int, 0,
  'teacher A cannot read teacher B''s own profile');

select is(
  (select count(*) from public.score_entries)::int, 6,
  'teacher A sees only their own students'' score history');

select is(
  (select count(*) from public.score_entries
    where class_member_id = 'b4000000-0000-0000-0000-000000000004')::int, 0,
  'teacher A cannot read scores belonging to teacher B''s student');

select is(
  (select count(*) from public.class_sessions)::int, 8,
  'teacher A sees only their own class sessions');

select is(
  (select count(*) from public.monthly_reports)::int, 2,
  'teacher A sees only their own monthly reports');

select is(
  (select count(*) from public.tuition_records)::int, 2,
  'teacher A sees only their own tuition ledger');

select is(
  (select count(*) from public.class_invite_codes)::int, 4,
  'teacher A sees only their own invite codes');

select is(
  (select count(*) from public.class_invite_codes where code = 'BRAVO23456')::int, 0,
  'teacher A cannot read teacher B''s invite code');

-- --------------------------------------------------------------------------
-- Writes stop at the same boundary
--
-- An UPDATE or DELETE whose USING clause excludes every row is NOT an error —
-- it silently matches nothing. So these statements are issued for real and the
-- target row is then inspected as postgres: the assertion is that teacher B's
-- data is untouched, which is the property that actually matters.
-- --------------------------------------------------------------------------
update public.classes set name = 'hijacked'
 where id = 'c3000000-0000-0000-0000-000000000003';

delete from public.classes
 where id = 'c3000000-0000-0000-0000-000000000003';

reset role;

select is(
  (select name from public.classes
    where id = 'c3000000-0000-0000-0000-000000000003'),
  'General English',
  'teacher A''s UPDATE leaves teacher B''s class untouched');

select is(
  (select count(*) from public.classes
    where id = 'c3000000-0000-0000-0000-000000000003')::int, 1,
  'teacher A''s DELETE leaves teacher B''s class in place');

set local role authenticated;

select throws_ok(
  $$ insert into public.class_sessions (class_id, starts_at, ends_at)
     values ('c3000000-0000-0000-0000-000000000003',
             now() + interval '1 day', now() + interval '1 day 2 hours') $$,
  '42501', null,
  'teacher A cannot schedule a session in teacher B''s class');

select throws_ok(
  $$ insert into public.score_entries
       (class_member_id, class_id, recorded_on, overall, created_by)
     values ('b4000000-0000-0000-0000-000000000004',
             'c3000000-0000-0000-0000-000000000003',
             current_date, 8.0, '11111111-1111-1111-1111-111111111111') $$,
  '42501', null,
  'teacher A cannot record a score for teacher B''s student');

-- Not even for their own tenant: TRUNCATE bypasses RLS entirely, so no
-- application role holds it.
select throws_ok(
  $$ truncate public.class_members $$, '42501', null,
  'not even a teacher can TRUNCATE past RLS');

-- --------------------------------------------------------------------------
-- The boundary is symmetric
-- --------------------------------------------------------------------------
select tests.login('22222222-2222-2222-2222-222222222222');  -- Teacher B

select is((select count(*) from public.classes)::int, 1,
  'teacher B sees exactly their own class');

select is((select count(*) from public.class_members)::int, 1,
  'teacher B sees exactly their own roster');

select is((select count(*) from public.monthly_reports
            where class_id <> 'c3000000-0000-0000-0000-000000000003')::int, 0,
  'teacher B sees none of teacher A''s reports');

select is((select count(*) from public.profiles)::int, 2,
  'teacher B sees only their own profile and their own student');

-- --------------------------------------------------------------------------
-- Self-promotion
--
-- Without app.is_teacher() in the WITH CHECK, a student could insert a class
-- naming themselves as teacher_id and acquire a whole tenant.
-- --------------------------------------------------------------------------
select tests.login('33333333-3333-3333-3333-333333333333');  -- Student X

select throws_ok(
  $$ insert into public.classes (teacher_id, name, course_type, start_date)
     values ('33333333-3333-3333-3333-333333333333',
             'My own class', 'ielts', current_date) $$,
  '42501', null,
  'a student cannot self-promote by inserting a class they own');

reset role;
select * from finish();
rollback;
