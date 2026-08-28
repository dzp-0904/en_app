-- Anonymous access.
--
-- Two independent mechanisms deny anon: every policy is scoped
-- `to authenticated` (so anon matches none and would read zero rows), and step
-- 12 revoked its table privileges outright (so the statement never reaches
-- policy evaluation). These assertions check the second — a hard privilege
-- error, not an empty result — because that is the layer that survives a
-- policy being dropped by mistake.
--
-- The entire intended anon surface is two functions.

begin;
select plan(27);

select tests.seed_world();

-- Issued while still `postgres`: auth.uid() reads request.jwt.claims, and
-- create_report_share_link is SECURITY DEFINER, so no role switch is needed to
-- act as the teacher here. The token is parked in a GUC because pg_prove is
-- not psql and cannot use \gset.
select tests.login('11111111-1111-1111-1111-111111111111');
select set_config('tests.share_token',
  public.create_report_share_link('f1000000-0000-0000-0000-000000000001'), true);
select tests.logout();

set local role anon;

-- --------------------------------------------------------------------------
-- Every application table is unreachable
-- --------------------------------------------------------------------------
select throws_ok('select * from public.profiles',              '42501', null,
  'anon cannot read profiles');
select throws_ok('select * from public.classes',               '42501', null,
  'anon cannot read classes');
select throws_ok('select * from public.class_invite_codes',    '42501', null,
  'anon cannot read class_invite_codes');
select throws_ok('select * from public.class_members',         '42501', null,
  'anon cannot read class_members');
select throws_ok('select * from public.class_sessions',        '42501', null,
  'anon cannot read class_sessions');
select throws_ok('select * from public.session_attendance',    '42501', null,
  'anon cannot read session_attendance');
select throws_ok('select * from public.score_entries',         '42501', null,
  'anon cannot read score_entries');
select throws_ok('select * from public.lesson_logs',           '42501', null,
  'anon cannot read lesson_logs');
select throws_ok('select * from public.mistake_tags',          '42501', null,
  'anon cannot read mistake_tags');
select throws_ok('select * from public.homework_assignments',  '42501', null,
  'anon cannot read homework_assignments');
select throws_ok('select * from public.homework_submissions',  '42501', null,
  'anon cannot read homework_submissions');
select throws_ok('select * from public.monthly_reports',       '42501', null,
  'anon cannot read monthly_reports');
select throws_ok('select * from public.tuition_records',       '42501', null,
  'anon cannot read tuition_records');

-- --------------------------------------------------------------------------
-- Views are not a side door
-- --------------------------------------------------------------------------
select throws_ok('select * from public.v_member_session_attendance', '42501', null,
  'anon cannot read v_member_session_attendance');
select throws_ok('select * from public.v_member_attendance_summary', '42501', null,
  'anon cannot read v_member_attendance_summary');
select throws_ok('select * from public.v_member_performance_status', '42501', null,
  'anon cannot read v_member_performance_status');
select throws_ok('select * from public.v_member_current_band',       '42501', null,
  'anon cannot read v_member_current_band');

-- --------------------------------------------------------------------------
-- The two surfaces that ARE public
-- --------------------------------------------------------------------------
select lives_ok(
  $$ select * from public.get_class_invite_preview('ALPHA23456') $$,
  'anon may call get_class_invite_preview');

select is(
  (select count(*) from public.get_class_invite_preview('ALPHA23456'))::int, 1,
  'anon gets the invite preview for a live code');

select is(
  (select count(*) from public.get_shared_report(
     current_setting('tests.share_token')))::int, 1,
  'anon gets the shared report for a valid token');

select is(
  (select count(*) from public.get_class_invite_preview('NOSUCHCODE'))::int, 0,
  'anon gets zero rows for an unknown code');

-- The preview returns no identifiers at all — no class_id, no teacher_id, no
-- member ids — so a guessed code yields nothing usable as a key anywhere else.
select throws_ok(
  $$ select class_id from public.get_class_invite_preview('ALPHA23456') $$,
  '42703', null,
  'the invite preview exposes no class_id to key off');

-- --------------------------------------------------------------------------
-- Everything else that is a function is still closed
-- --------------------------------------------------------------------------
select throws_ok(
  $$ select public.join_class_with_code('ALPHA23456') $$, '42501', null,
  'anon cannot call join_class_with_code');

select throws_ok(
  $$ select public.submit_homework('e1000000-0000-0000-0000-000000000001') $$,
  '42501', null,
  'anon cannot call submit_homework');

select throws_ok(
  $$ select public.create_report_share_link('f1000000-0000-0000-0000-000000000001') $$,
  '42501', null,
  'anon cannot mint a report share link');

select throws_ok(
  $$ select public.revoke_report_share_link('f1000000-0000-0000-0000-000000000001') $$,
  '42501', null,
  'anon cannot revoke a report share link');

select throws_ok(
  $$ select app.is_teacher() $$, '42501', null,
  'anon cannot reach the private app schema');

reset role;
select * from finish();
rollback;
