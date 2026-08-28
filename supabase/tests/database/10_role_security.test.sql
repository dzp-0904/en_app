-- Role security, privilege surface, and the remaining hardening rules.
--
-- The question this file answers: can a self-registered user become a teacher?
-- Four independent layers say no, and each is asserted separately, because a
-- single-layer defence is one careless migration away from being no defence.
--
--   1. app.handle_new_user hard-codes 'student' and never reads a role out of
--      client metadata.
--   2. profiles.role carries no UPDATE column grant for authenticated.
--   3. app.enforce_profile_role_immutable refuses the change even from a role
--      that holds the grant.
--   4. app.provision_teacher — the one path that raises the trigger's flag —
--      is EXECUTE-able by service_role only, in a schema PostgREST does not
--      expose.

begin;
select plan(45);

select tests.seed_world();

-- ===========================================================================
-- 1. Public signup produces a student, whatever the browser claims.
-- ===========================================================================

-- Exactly what supabase.auth.signUp({ options: { data: {...} } }) writes.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'aaaaaaaa-0000-0000-0000-00000000000a',
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'liar@edutrack.test',
  extensions.crypt('password123', extensions.gen_salt('bf')),
  now(),
  jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
  jsonb_build_object('role', 'teacher', 'user_role', 'teacher', 'is_admin', true,
                     'teaching_type', 'ielts', 'full_name', 'Liar'),
  now(), now()
);

select is(
  (select role::text from public.profiles
    where id = 'aaaaaaaa-0000-0000-0000-00000000000a'),
  'student',
  'signup metadata claiming role=teacher still produces a student');

select is(
  (select teaching_type from public.profiles
    where id = 'aaaaaaaa-0000-0000-0000-00000000000a'),
  null,
  'teaching_type from metadata is ignored too');

select is(
  (select full_name from public.profiles
    where id = 'aaaaaaaa-0000-0000-0000-00000000000a'),
  'Liar',
  'full_name IS taken from metadata — it is display text and carries no privilege');

set local role authenticated;
select tests.login('aaaaaaaa-0000-0000-0000-00000000000a');
select ok(not (select app.is_teacher()), 'the new account is not a teacher');
select is(
  (select count(*) from public.classes)::int, 0,
  'and sees no classes');
reset role;

-- ===========================================================================
-- 2. No client path from student to teacher.
-- ===========================================================================

-- Layer 2: the column grant.
select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'role', 'update'),
  'authenticated holds no UPDATE privilege on profiles.role');
select ok(
  has_column_privilege('authenticated', 'public.profiles', 'full_name', 'update'),
  'authenticated may still update its own display name');
select ok(
  not has_table_privilege('authenticated', 'public.profiles', 'insert'),
  'authenticated cannot INSERT a profile at all');
select ok(
  not has_table_privilege('authenticated', 'public.profiles', 'delete'),
  'authenticated cannot DELETE a profile at all');

set local role authenticated;
select tests.login('33333333-3333-3333-3333-333333333333');

select throws_ok(
  $$ update public.profiles set role = 'teacher'
      where id = '33333333-3333-3333-3333-333333333333' $$,
  '42501', null,
  'a student updating their own role is refused by the column grant');

-- The trigger's escape hatch is a GUC, so prove that setting it by hand buys
-- nothing: the privilege check happens first and does not consult it.
select set_config('app.allow_role_change', 'on', true);
select throws_ok(
  $$ update public.profiles set role = 'teacher'
      where id = '33333333-3333-3333-3333-333333333333' $$,
  '42501', null,
  'raising app.allow_role_change by hand does not help — the grant still refuses');
select set_config('app.allow_role_change', '', true);

-- A student cannot create a class and become a teacher by implication.
select throws_ok(
  $$ insert into public.classes (teacher_id, name, course_type, start_date)
     values ('33333333-3333-3333-3333-333333333333', 'Self promotion',
             'ielts', current_date) $$,
  '42501', null,
  'a student cannot insert a class owned by themselves');

reset role;

-- Layer 3: the trigger, tested from a role that DOES hold the grant.
select throws_ok(
  $$ update public.profiles set role = 'teacher'
      where id = '33333333-3333-3333-3333-333333333333' $$,
  '23514', null,
  'even the table owner cannot change a role without the flag');

select is(
  (select role::text from public.profiles
    where id = '33333333-3333-3333-3333-333333333333'),
  'student',
  'the role is unchanged after every attempt');

-- Layer 4: the privileged path is service_role only.
select ok(
  not has_function_privilege('authenticated', 'app.provision_teacher(uuid, text)', 'execute'),
  'authenticated cannot execute app.provision_teacher');
select ok(
  not has_function_privilege('anon', 'app.provision_teacher(uuid, text)', 'execute'),
  'anon cannot execute app.provision_teacher');
select ok(
  has_function_privilege('service_role', 'app.provision_teacher(uuid, text)', 'execute'),
  'service_role can execute app.provision_teacher');
select ok(
  not has_function_privilege('authenticated', 'app.set_account_active(uuid, boolean)', 'execute'),
  'authenticated cannot execute app.set_account_active');
select ok(
  not has_function_privilege('anon', 'app.set_account_active(uuid, boolean)', 'execute'),
  'anon cannot execute app.set_account_active');

-- app is not an exposed schema, so nothing in it is reachable over PostgREST
-- even when EXECUTE exists. Belt and braces: no client role holds USAGE either.
select ok(not has_schema_privilege('anon', 'app', 'usage'),
  'anon holds no USAGE on schema app');

-- And provision_teacher lowers its own flag on the way out, so a second
-- statement in the same transaction does not inherit a disarmed trigger.
select lives_ok(
  $$ select app.provision_teacher('aaaaaaaa-0000-0000-0000-00000000000a', 'ielts') $$,
  'the privileged path does promote a student');
select is(
  (select role::text from public.profiles
    where id = 'aaaaaaaa-0000-0000-0000-00000000000a'),
  'teacher',
  'the promotion landed');
select isnt(
  coalesce(current_setting('app.allow_role_change', true), ''), 'on',
  'app.allow_role_change is lowered again before the function returns');

-- Which means the very next role change in the same transaction is refused.
select throws_ok(
  $$ update public.profiles set role = 'teacher'
      where id = '44444444-4444-4444-4444-444444444444' $$,
  '23514', null,
  'the immutability trigger is re-armed immediately after a promotion');

-- ===========================================================================
-- 3. The local test harness is not an attack surface.
--
-- tests.login writes request.jwt.claims and tests.create_user mints confirmed
-- auth.users rows. Anonymous must not reach either, and no client role may
-- reach create_user.
-- ===========================================================================
select ok(not has_schema_privilege('anon', 'tests', 'usage'),
  'anon holds no USAGE on schema tests');
select ok(not has_function_privilege('anon', 'tests.login(uuid)', 'execute'),
  'anon cannot execute tests.login');
select ok(not has_function_privilege('anon', 'tests.create_user(uuid, text, text, text, boolean)', 'execute'),
  'anon cannot execute tests.create_user');
select ok(not has_function_privilege('authenticated', 'tests.create_user(uuid, text, text, text, boolean)', 'execute'),
  'authenticated cannot execute tests.create_user — no client role can mint an auth user');
select ok(not has_function_privilege('authenticated', 'tests.seed_world()', 'execute'),
  'authenticated cannot execute tests.seed_world');
select ok(has_function_privilege('authenticated', 'tests.login(uuid)', 'execute'),
  'authenticated CAN execute tests.login — the test files need it');

-- ===========================================================================
-- 4. Invite codes.
-- ===========================================================================
select ok(
  not has_function_privilege('anon', 'public.generate_invite_code(integer)', 'execute'),
  'anon cannot execute generate_invite_code — minting a code is a teacher action');
select ok(
  has_function_privilege('authenticated', 'public.generate_invite_code(integer)', 'execute'),
  'authenticated can execute generate_invite_code');

select is(length(public.generate_invite_code()), 10,
  'the default length is 10 characters');
select is(length(public.generate_invite_code(16)), 16,
  'a longer length is honoured');
select throws_ok(
  $$ select public.generate_invite_code(9) $$, '22023', null,
  'fewer than 10 characters is refused');

select matches(public.generate_invite_code(24), '^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{24}$',
  'output uses only the unambiguous alphabet — no 0/O, 1/I/L or U');

select is(
  (select count(distinct public.generate_invite_code(12))
     from generate_series(1, 200))::int, 200,
  '200 generated codes are all distinct');

select throws_ok(
  $$ insert into public.class_invite_codes (class_id, code)
     values ('c1000000-0000-0000-0000-000000000001', 'SHORT1234') $$,
  '23514', null,
  'a nine-character code is refused by the table constraint too');

-- ===========================================================================
-- 5. score_entries is append-only, at both layers.
-- ===========================================================================
select ok(
  not has_table_privilege('authenticated', 'public.score_entries', 'update'),
  'authenticated holds no UPDATE privilege on score_entries');
select ok(
  has_table_privilege('authenticated', 'public.score_entries', 'delete'),
  'DELETE stays — it is the correction path and the cascade needs it');

select throws_ok(
  $$ update public.score_entries set overall = 9.0
      where class_member_id = 'b1000000-0000-0000-0000-000000000001' $$,
  '23514', null,
  'the trigger refuses an UPDATE even from the table owner');

-- ===========================================================================
-- 6. Tuition cannot invoice a negative amount.
-- ===========================================================================
select throws_ok(
  $$ insert into public.tuition_records
       (class_member_id, class_id, period_month, sessions_billed,
        rate_per_session, discount_amount)
     values ('b3000000-0000-0000-0000-000000000003',
             'c2000000-0000-0000-0000-000000000002',
             date_trunc('month', now())::date, 4, 250000, 5000000) $$,
  '23514', null,
  'a discount larger than the billed total is refused');

select lives_ok(
  $$ insert into public.tuition_records
       (class_member_id, class_id, period_month, sessions_billed,
        rate_per_session, discount_amount)
     values ('b3000000-0000-0000-0000-000000000003',
             'c2000000-0000-0000-0000-000000000002',
             date_trunc('month', now())::date, 4, 250000, 1000000) $$,
  'a discount up to the billed total is fine');

-- ===========================================================================
-- 7. Removed helpers stay removed. app.is_member_teacher was unreferenced
--    dead code with a definer's privileges.
-- ===========================================================================
select is(
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'is_member_teacher')::int, 0,
  'app.is_member_teacher no longer exists');

select is(
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and p.prosecdef
      and not has_function_privilege('anon', p.oid, 'execute'))::int,
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.prosecdef)::int,
  'no SECURITY DEFINER function in schema app is executable by anon');

select * from finish();
rollback;
