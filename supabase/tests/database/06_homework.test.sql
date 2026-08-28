-- Homework: fan-out, state invariants, grading limits, and the student's one
-- permitted verb.
--
-- The invariant constraint is exhaustive over homework_status on purpose. A
-- CHECK constraint PASSES on NULL, so a CASE with a missing branch would
-- silently stop enforcing anything for that status rather than failing loudly.
--
-- The constraint assertions run as postgres so a failure is unambiguously the
-- constraint and not a policy.

begin;
select plan(22);

select tests.seed_world();

-- --------------------------------------------------------------------------
-- Fan-out: "not yet done" is a row, not an absence
-- --------------------------------------------------------------------------
select is(
  (select count(*) from public.homework_submissions
    where assignment_id = 'e1000000-0000-0000-0000-000000000001')::int, 2,
  'creating an assignment fans out one submission per active member');

select is(
  (select count(*) from public.homework_submissions
    where class_member_id = 'b6000000-0000-0000-0000-000000000006')::int, 0,
  'a removed member gets no submission row');

select is(
  (select count(*) from public.homework_submissions
    where class_member_id = 'b5000000-0000-0000-0000-000000000005')::int, 0,
  'an unclaimed invitation gets no submission row');

-- --------------------------------------------------------------------------
-- State invariants
-- --------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.homework_submissions
       (assignment_id, class_member_id, class_id, status, submitted_at)
     values ('e1000000-0000-0000-0000-000000000001',
             'b5000000-0000-0000-0000-000000000005',
             'c1000000-0000-0000-0000-000000000001', 'assigned', now()) $$,
  '23514', null,
  'assigned cannot carry a submitted_at');

select throws_ok(
  $$ insert into public.homework_submissions
       (assignment_id, class_member_id, class_id, status, score)
     values ('e1000000-0000-0000-0000-000000000001',
             'b5000000-0000-0000-0000-000000000005',
             'c1000000-0000-0000-0000-000000000001', 'assigned', 5) $$,
  '23514', null,
  'assigned cannot carry a score');

select throws_ok(
  $$ insert into public.homework_submissions
       (assignment_id, class_member_id, class_id, status)
     values ('e1000000-0000-0000-0000-000000000001',
             'b5000000-0000-0000-0000-000000000005',
             'c1000000-0000-0000-0000-000000000001', 'submitted') $$,
  '23514', null,
  'submitted requires a submitted_at');

select throws_ok(
  $$ insert into public.homework_submissions
       (assignment_id, class_member_id, class_id, status, submitted_at, score)
     values ('e1000000-0000-0000-0000-000000000001',
             'b5000000-0000-0000-0000-000000000005',
             'c1000000-0000-0000-0000-000000000001', 'submitted', now(), 5) $$,
  '23514', null,
  'submitted cannot carry a score');

select throws_ok(
  $$ insert into public.homework_submissions
       (assignment_id, class_member_id, class_id, status, submitted_at, score)
     values ('e1000000-0000-0000-0000-000000000001',
             'b5000000-0000-0000-0000-000000000005',
             'c1000000-0000-0000-0000-000000000001', 'graded', now(), 5) $$,
  '23514', null,
  'graded requires a graded_at');

select throws_ok(
  $$ insert into public.homework_submissions
       (assignment_id, class_member_id, class_id, status, submitted_at, graded_at)
     values ('e1000000-0000-0000-0000-000000000001',
             'b5000000-0000-0000-0000-000000000005',
             'c1000000-0000-0000-0000-000000000001', 'graded', now(), now()) $$,
  '23514', null,
  'graded requires a score');

select throws_ok(
  $$ insert into public.homework_submissions
       (assignment_id, class_member_id, class_id, status, submitted_at)
     values ('e1000000-0000-0000-0000-000000000001',
             'b5000000-0000-0000-0000-000000000005',
             'c1000000-0000-0000-0000-000000000001', 'missed', now()) $$,
  '23514', null,
  'missed cannot carry a submitted_at');

select lives_ok(
  $$ insert into public.homework_submissions
       (assignment_id, class_member_id, class_id, status,
        submitted_at, score, graded_at)
     values ('e1000000-0000-0000-0000-000000000001',
             'b5000000-0000-0000-0000-000000000005',
             'c1000000-0000-0000-0000-000000000001', 'graded',
             now(), 7, now()) $$,
  'a fully consistent graded row is accepted');

-- --------------------------------------------------------------------------
-- Score bounds. max_score lives on the assignment, so this is a cross-table
-- comparison and cannot be a CHECK constraint.
-- --------------------------------------------------------------------------
select throws_ok(
  $$ update public.homework_submissions
        set status = 'graded', submitted_at = now(), score = 11, graded_at = now()
      where class_member_id = 'b2000000-0000-0000-0000-000000000002' $$,
  '23514', null,
  'a score above the assignment maximum is rejected');

select throws_ok(
  $$ update public.homework_submissions
        set status = 'graded', submitted_at = now(), score = -1, graded_at = now()
      where class_member_id = 'b2000000-0000-0000-0000-000000000002' $$,
  '23514', null,
  'a negative score is rejected');

select lives_ok(
  $$ update public.homework_submissions
        set status = 'graded', submitted_at = now(), score = 10, graded_at = now()
      where class_member_id = 'b2000000-0000-0000-0000-000000000002' $$,
  'a score equal to the assignment maximum is accepted');

-- --------------------------------------------------------------------------
-- submit_homework: the student's only verb
--
-- It exists because Supabase maps teachers and students to the same
-- `authenticated` Postgres role, so no column GRANT can hand a student UPDATE
-- on `status` while withholding UPDATE on `score`.
-- --------------------------------------------------------------------------
set local role authenticated;

select tests.logout();
select throws_ok(
  $$ select public.submit_homework('e1000000-0000-0000-0000-000000000001') $$,
  '28000', null,
  'submitting requires a session');

select tests.login('33333333-3333-3333-3333-333333333333');  -- Student X

select is(
  (select status from public.submit_homework(
     'e1000000-0000-0000-0000-000000000001'))::text,
  'submitted',
  'a student can mark their own homework submitted');

select ok(
  (select submitted_at is not null from public.submit_homework(
     'e1000000-0000-0000-0000-000000000001')),
  'submitting twice is idempotent rather than an error');

select throws_ok(
  $$ select public.submit_homework('e2000000-0000-0000-0000-000000000002') $$,
  '42501', null,
  'a student cannot submit against an assignment in a class they are not in');

select tests.login('77777777-7777-7777-7777-777777777777');  -- outsider
select throws_ok(
  $$ select public.submit_homework('e1000000-0000-0000-0000-000000000001') $$,
  '42501', null,
  'a non-member cannot submit at all');

-- --------------------------------------------------------------------------
-- Grading stays with the teacher
-- --------------------------------------------------------------------------
select tests.login('11111111-1111-1111-1111-111111111111');  -- Teacher A

select lives_ok(
  $$ update public.homework_submissions
        set status = 'graded', score = 8, graded_at = now(),
            teacher_feedback = 'Good structure.'
      where class_member_id = 'b1000000-0000-0000-0000-000000000001' $$,
  'the teacher can grade a submitted piece of homework');

select tests.login('33333333-3333-3333-3333-333333333333');  -- Student X again
select throws_ok(
  $$ select public.submit_homework('e1000000-0000-0000-0000-000000000001') $$,
  '42501', null,
  'a student cannot re-submit homework that has already been graded');

select tests.login('22222222-2222-2222-2222-222222222222');  -- Teacher B
update public.homework_submissions set score = 1
 where class_member_id = 'b1000000-0000-0000-0000-000000000001';

reset role;
select is(
  (select score from public.homework_submissions
    where class_member_id = 'b1000000-0000-0000-0000-000000000001'), 8::numeric,
  'a teacher cannot regrade another teacher''s student');

reset role;
select * from finish();
rollback;
