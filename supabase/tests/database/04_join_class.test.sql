-- Invitation claiming and class joining.
--
-- join_class_with_code is the ONLY write path into class_members for a
-- student. The control that matters is that the caller's email is read from
-- auth.users inside the function and is never a parameter — so a user can
-- never present someone else's address to inherit their roster row.
--
-- Role is switched back to postgres for verification reads: the assertions are
-- about what the RPC wrote, not about what the caller can see.

begin;
select plan(26);

select tests.seed_world();

set local role authenticated;

-- --------------------------------------------------------------------------
-- Refusals. None of these change any state.
-- --------------------------------------------------------------------------
select tests.logout();
select throws_ok(
  $$ select public.join_class_with_code('ALPHA23456') $$, '28000', null,
  'joining requires a session');

select tests.login('11111111-1111-1111-1111-111111111111');  -- a teacher
select throws_ok(
  $$ select public.join_class_with_code('ALPHA23456') $$, '42501', null,
  'a teacher cannot join their own class as a student');

select tests.login('55555555-5555-5555-5555-555555555555');  -- unconfirmed email
select throws_ok(
  $$ select public.join_class_with_code('ALPHA23456') $$, '42501', null,
  'an unconfirmed email address cannot claim a class place');

select tests.login('77777777-7777-7777-7777-777777777777');  -- outsider, confirmed

-- Unknown, expired, revoked and exhausted all raise the SAME error, so probing
-- cannot distinguish "wrong code" from "real code, closed".
select throws_ok(
  $$ select public.join_class_with_code('NOSUCHCODE') $$, '22023', null,
  'an unknown code is refused');
select throws_ok(
  $$ select public.join_class_with_code('EXPIRE2345') $$, '22023', null,
  'an expired code is refused');
select throws_ok(
  $$ select public.join_class_with_code('REVOKE2345') $$, '22023', null,
  'a revoked code is refused');
select throws_ok(
  $$ select public.join_class_with_code('MAXOUT2345') $$, '22023', null,
  'a code that has reached max_uses is refused');

-- The preview is STABLE and write-free: probing must not burn a class's uses.
select lives_ok(
  $$ select * from public.get_class_invite_preview('ALPHA23456') $$,
  'preview succeeds for a live code');

reset role;
select is(
  (select use_count from public.class_invite_codes where code = 'ALPHA23456')::int, 0,
  'previewing a code does not consume a use');

-- --------------------------------------------------------------------------
-- Claiming an invitation addressed to your verified address
-- --------------------------------------------------------------------------
set local role authenticated;
select tests.login('66666666-6666-6666-6666-666666666666');  -- invitee@edutrack.test

select is(
  (select class_name from public.join_class_with_code('alpha23456')),
  'IELTS Intensive',
  'the code is matched case-insensitively and returns the class');

reset role;

select is(
  (select student_id from public.class_members
    where id = 'b5000000-0000-0000-0000-000000000005'),
  '66666666-6666-6666-6666-666666666666'::uuid,
  'the pending invitation is claimed by the matching verified address');

select ok(
  (select join_status = 'joined' and joined_at is not null
     from public.class_members
    where id = 'b5000000-0000-0000-0000-000000000005'),
  'claiming sets join_status = joined and stamps joined_at');

select is(
  (select count(*) from public.class_members
    where class_id = 'c1000000-0000-0000-0000-000000000001')::int, 4,
  'claiming reuses the invitation row instead of creating a duplicate');

select is(
  (select count(*) from public.homework_submissions
    where class_member_id = 'b5000000-0000-0000-0000-000000000005')::int, 1,
  'joining backfills submissions for assignments already open');

select is(
  (select use_count from public.class_invite_codes where code = 'ALPHA23456')::int, 1,
  'claiming consumes exactly one use of the code');

-- --------------------------------------------------------------------------
-- Someone else's invitation is not up for grabs
-- --------------------------------------------------------------------------
set local role authenticated;
select tests.login('77777777-7777-7777-7777-777777777777');  -- outsider@edutrack.test
select lives_ok(
  $$ select public.join_class_with_code('ALPHA23456') $$,
  'a student with no invitation may still join by code');

reset role;

select is(
  (select count(*) from public.class_members
    where class_id = 'c1000000-0000-0000-0000-000000000001')::int, 5,
  'joining without an invitation creates a new membership row');

select is(
  (select student_id from public.class_members
    where id = 'b5000000-0000-0000-0000-000000000005'),
  '66666666-6666-6666-6666-666666666666'::uuid,
  'another user joining does NOT take over an invitation addressed elsewhere');

select ok(
  (select invited_email is null from public.class_members
    where class_id = 'c1000000-0000-0000-0000-000000000001'
      and student_id = '77777777-7777-7777-7777-777777777777'),
  'a join-by-code row carries no invited_email, so it cannot collide with a pending invitation');

-- --------------------------------------------------------------------------
-- Idempotence
-- --------------------------------------------------------------------------
set local role authenticated;
select lives_ok(
  $$ select public.join_class_with_code('ALPHA23456') $$,
  'joining a class twice is not an error');

reset role;

select is(
  (select count(*) from public.class_members
    where class_id = 'c1000000-0000-0000-0000-000000000001')::int, 5,
  'a second join creates no second membership row');

select is(
  (select use_count from public.class_invite_codes where code = 'ALPHA23456')::int, 2,
  'a repeat join by an existing member does not consume another use');

-- --------------------------------------------------------------------------
-- Re-joining after removal reactivates rather than restarting
-- --------------------------------------------------------------------------
set local role authenticated;
select tests.login('88888888-8888-8888-8888-888888888888');  -- removed from C1
select lives_ok(
  $$ select public.join_class_with_code('ALPHA23456') $$,
  'a removed student can re-join with the code');

reset role;

select ok(
  (select removed_at is null
      and joined_at < now() - interval '35 days'
     from public.class_members
    where id = 'b6000000-0000-0000-0000-000000000006'),
  'reactivation clears removed_at but preserves the original joined_at');

-- --------------------------------------------------------------------------
-- Many classes, including across teachers
-- --------------------------------------------------------------------------
set local role authenticated;
select tests.login('33333333-3333-3333-3333-333333333333');  -- already in C1 and C2
select lives_ok(
  $$ select public.join_class_with_code('BRAVO23456') $$,
  'a student may join a third class, owned by a different teacher');

reset role;

select bag_eq(
  $$ select class_id from public.class_members
      where student_id = '33333333-3333-3333-3333-333333333333' $$,
  $$ values ('c1000000-0000-0000-0000-000000000001'::uuid),
            ('c2000000-0000-0000-0000-000000000002'::uuid),
            ('c3000000-0000-0000-0000-000000000003'::uuid) $$,
  'the student now holds one membership row per class, in three classes');

select * from finish();
rollback;
