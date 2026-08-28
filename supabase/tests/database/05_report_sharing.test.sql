-- Parent report sharing.
--
-- The share link is the second and last unauthenticated surface. It is a
-- bearer credential handed to a parent over Zalo or email, so the design has
-- to survive the link being forwarded, screenshotted, or logged: 256 bits of
-- entropy, only the SHA-256 stored, expiry, revocation, and a snapshot that
-- cannot change after publication.

begin;
select plan(19);

select tests.seed_world();

set local role authenticated;
select tests.login('11111111-1111-1111-1111-111111111111');  -- Teacher A

select set_config('tests.tok1',
  public.create_report_share_link('f1000000-0000-0000-0000-000000000001'), true);
select set_config('tests.tok2',
  public.create_report_share_link('f2000000-0000-0000-0000-000000000002'), true);

-- 32 random bytes, base64url, unpadded.
select is(length(current_setting('tests.tok1')), 43,
  'a share token carries 256 bits of entropy');

-- A draft has nothing frozen to show, so it cannot be shared.
insert into public.monthly_reports
  (id, class_member_id, class_id, period_month, snapshot, status, generated_by)
values
  ('f4000000-0000-0000-0000-000000000004',
   'b3000000-0000-0000-0000-000000000003',
   'c2000000-0000-0000-0000-000000000002',
   (date_trunc('month', now()) - interval '1 month')::date,
   '{"draft": true}'::jsonb, 'draft',
   '11111111-1111-1111-1111-111111111111');

select throws_ok(
  $$ select public.create_report_share_link('f4000000-0000-0000-0000-000000000004') $$,
  '42501', null,
  'a draft report cannot be shared');

select tests.login('22222222-2222-2222-2222-222222222222');  -- Teacher B

select throws_ok(
  $$ select public.create_report_share_link('f1000000-0000-0000-0000-000000000001') $$,
  '42501', null,
  'a teacher cannot mint a share link for another teacher''s report');

select throws_ok(
  $$ select public.revoke_report_share_link('f1000000-0000-0000-0000-000000000001') $$,
  '42501', null,
  'a teacher cannot revoke another teacher''s share link');

reset role;

-- --------------------------------------------------------------------------
-- Storage: hash only
-- --------------------------------------------------------------------------
select ok(
  (select share_token_hash = sha256(convert_to(current_setting('tests.tok1'), 'UTF8'))
     from public.monthly_reports
    where id = 'f1000000-0000-0000-0000-000000000001'),
  'only the SHA-256 of the token is stored');

select ok(
  (select share_token_hash <> convert_to(current_setting('tests.tok1'), 'UTF8')
     from public.monthly_reports
    where id = 'f1000000-0000-0000-0000-000000000001'),
  'the plaintext token never reaches the table');

-- --------------------------------------------------------------------------
-- One token opens exactly one report
-- --------------------------------------------------------------------------
set local role anon;

select is(
  (select snapshot ->> 'student'
     from public.get_shared_report(current_setting('tests.tok1'))),
  'Student X',
  'a valid token returns its own report');

select is(
  (select snapshot ->> 'student'
     from public.get_shared_report(current_setting('tests.tok2'))),
  'Student Y',
  'a second token returns a different report');

select is(
  (select count(*) from public.get_shared_report(current_setting('tests.tok1'))
    where snapshot ->> 'student' = 'Student Y')::int, 0,
  'one report''s token cannot expose another report');

select is(
  (select count(*) from public.get_shared_report('not-a-token'))::int, 0,
  'a malformed token returns nothing');

select is(
  (select count(*) from public.get_shared_report(
     'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'))::int, 0,
  'a well-formed but wrong token returns nothing');

reset role;

select is(
  (select share_view_count from public.monthly_reports
    where id = 'f1000000-0000-0000-0000-000000000001')::int, 2,
  'each successful open increments the view counter');

-- --------------------------------------------------------------------------
-- Revocation and rotation
-- --------------------------------------------------------------------------
set local role authenticated;
select tests.login('11111111-1111-1111-1111-111111111111');
select public.revoke_report_share_link('f1000000-0000-0000-0000-000000000001');

set local role anon;
select is(
  (select count(*) from public.get_shared_report(current_setting('tests.tok1')))::int, 0,
  'a revoked link stops working');

set local role authenticated;
select set_config('tests.tok3',
  public.create_report_share_link('f1000000-0000-0000-0000-000000000001'), true);

set local role anon;
select is(
  (select count(*) from public.get_shared_report(current_setting('tests.tok3')))::int, 1,
  're-issuing produces a working link');

select is(
  (select count(*) from public.get_shared_report(current_setting('tests.tok1')))::int, 0,
  're-issuing invalidates the previous token');

-- --------------------------------------------------------------------------
-- Expiry
-- --------------------------------------------------------------------------
reset role;
update public.monthly_reports
   set share_expires_at = now() - interval '1 day'
 where id = 'f2000000-0000-0000-0000-000000000002';

set local role anon;
select is(
  (select count(*) from public.get_shared_report(current_setting('tests.tok2')))::int, 0,
  'an expired link stops working');

-- --------------------------------------------------------------------------
-- The published snapshot is frozen
--
-- A report about August must not change when September's scores arrive — the
-- parent has already read it, and a link that silently rewrites history is a
-- credibility problem, not just a data problem.
-- --------------------------------------------------------------------------
reset role;
set local role authenticated;
select tests.login('11111111-1111-1111-1111-111111111111');

select throws_ok(
  $$ update public.monthly_reports set snapshot = '{"tampered": true}'::jsonb
      where id = 'f1000000-0000-0000-0000-000000000001' $$,
  '23514', null,
  'a published snapshot cannot be edited');

select throws_ok(
  $$ update public.monthly_reports set teacher_comment = 'rewritten'
      where id = 'f1000000-0000-0000-0000-000000000001' $$,
  '23514', null,
  'a published teacher comment cannot be edited');

select throws_ok(
  $$ update public.monthly_reports set status = 'draft', published_at = null
      where id = 'f1000000-0000-0000-0000-000000000001' $$,
  '23514', null,
  'a published report cannot return to draft');

reset role;
select * from finish();
rollback;
