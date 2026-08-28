-- Deletion semantics.
--
-- The suite that existed before this file never deleted a class_sessions,
-- profiles or auth.users row, which is exactly why two blockers survived it.
-- Every ON DELETE path that touches educational history is exercised here.
--
-- The governing rule: EduTrack exists to preserve a teacher's record of a
-- student's progress. Removing a session, a member or an identity must never
-- remove the history it generated.
--
-- Sections are wrapped in savepoints so each one starts from the pristine
-- fixture instead of inheriting the previous section's deletions. pgTAP's
-- counters live in a sequence, which a rollback does not rewind.

begin;
select plan(66);

select tests.seed_world();

-- ===========================================================================
-- 1. Deleting a class_session with a lesson log attached.
--
-- lesson_logs_session_fk is composite (session_id, class_id). A bare
-- ON DELETE SET NULL would null class_id too — and class_id is NOT NULL, so
-- the delete would fail with 23502. The (session_id) column list is what makes
-- this work.
-- ===========================================================================
savepoint sec1;

select is(
  (select count(*) from public.lesson_logs
    where session_id = 'd1000000-0000-0000-0000-000000000001')::int, 1,
  'precondition: session SS1 has one lesson log');

select lives_ok(
  $$ delete from public.class_sessions
      where id = 'd1000000-0000-0000-0000-000000000001' $$,
  'deleting a session that has a lesson log succeeds');

select is(
  (select count(*) from public.class_sessions
    where id = 'd1000000-0000-0000-0000-000000000001')::int, 0,
  'the session row is gone');

select is(
  (select count(*) from public.lesson_logs
    where class_member_id = 'b1000000-0000-0000-0000-000000000001')::int, 1,
  'the lesson log survives the session it was written against');

select is(
  (select session_id from public.lesson_logs
    where class_member_id = 'b1000000-0000-0000-0000-000000000001'),
  null,
  'lesson_logs.session_id is nulled');

select is(
  (select class_id from public.lesson_logs
    where class_member_id = 'b1000000-0000-0000-0000-000000000001'),
  'c1000000-0000-0000-0000-000000000001'::uuid,
  'lesson_logs.class_id is preserved — tenancy is not collateral damage');

-- Attendance is the one child that SHOULD go: a register entry for a session
-- that no longer exists is not history, it is a dangling fact.
select is(
  (select count(*) from public.session_attendance
    where session_id = 'd1000000-0000-0000-0000-000000000001')::int, 0,
  'attendance rows for the deleted session cascade away');

rollback to savepoint sec1;

-- ===========================================================================
-- 2. Deleting a class_session with a homework assignment attached.
-- ===========================================================================
savepoint sec2;

insert into public.homework_assignments
  (id, class_id, session_id, title, skill, assigned_on, due_date, max_score, created_by)
values
  ('e9000000-0000-0000-0000-000000000009',
   'c1000000-0000-0000-0000-000000000001',
   'd2000000-0000-0000-0000-000000000002',
   'Set from session 2', 'writing',
   (now() - interval '25 days')::date, (now() - interval '18 days')::date,
   10, '11111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ delete from public.class_sessions
      where id = 'd2000000-0000-0000-0000-000000000002' $$,
  'deleting a session that has a homework assignment succeeds');

select is(
  (select count(*) from public.homework_assignments
    where id = 'e9000000-0000-0000-0000-000000000009')::int, 1,
  'the assignment survives the session it was set in');

select is(
  (select session_id from public.homework_assignments
    where id = 'e9000000-0000-0000-0000-000000000009'),
  null,
  'homework_assignments.session_id is nulled');

select is(
  (select class_id from public.homework_assignments
    where id = 'e9000000-0000-0000-0000-000000000009'),
  'c1000000-0000-0000-0000-000000000001'::uuid,
  'homework_assignments.class_id is preserved');

select is(
  (select count(*) from public.homework_submissions
    where assignment_id = 'e9000000-0000-0000-0000-000000000009')::int, 2,
  'the fanned-out submissions are untouched by the session delete');

rollback to savepoint sec2;

-- ===========================================================================
-- 3. Deleting a student identity.
--
-- The auth user goes. The educational record stays, anonymised.
-- ===========================================================================
savepoint sec3;

select is(
  (select count(*) from public.class_members
    where student_id = '33333333-3333-3333-3333-333333333333')::int, 2,
  'precondition: Student X holds two memberships');

select lives_ok(
  $$ delete from auth.users where id = '33333333-3333-3333-3333-333333333333' $$,
  'deleting a student auth identity succeeds');

select is(
  (select count(*) from public.profiles
    where id = '33333333-3333-3333-3333-333333333333')::int, 0,
  'the profile row cascades away with the auth user');

select is(
  (select count(*) from public.class_members
    where id in ('b1000000-0000-0000-0000-000000000001',
                 'b3000000-0000-0000-0000-000000000003'))::int, 2,
  'both memberships survive — the teacher keeps the class history');

select is(
  (select count(*) from public.class_members
    where id in ('b1000000-0000-0000-0000-000000000001',
                 'b3000000-0000-0000-0000-000000000003')
      and join_status = 'departed')::int, 2,
  'the surviving memberships are tombstoned as departed');

select is(
  (select count(*) from public.class_members
    where id in ('b1000000-0000-0000-0000-000000000001',
                 'b3000000-0000-0000-0000-000000000003')
      and student_id is null
      and invited_email is null
      and invited_name is null)::int, 2,
  'every direct identifier on the membership is cleared');

select is(
  (select count(*) from public.class_members
    where id in ('b1000000-0000-0000-0000-000000000001',
                 'b3000000-0000-0000-0000-000000000003')
      and joined_at is not null
      and removed_at is not null)::int, 2,
  'joined_at and removed_at are preserved, so the attendance window still holds');

-- Every child record. These are the rows the product is for.
select is(
  (select count(*) from public.score_entries
    where class_member_id = 'b1000000-0000-0000-0000-000000000001')::int, 3,
  'score history is preserved');

select is(
  (select count(*) from public.lesson_logs
    where class_member_id = 'b1000000-0000-0000-0000-000000000001')::int, 1,
  'lesson logs are preserved');

select is(
  (select count(*) from public.session_attendance
    where class_member_id = 'b1000000-0000-0000-0000-000000000001')::int, 7,
  'attendance is preserved');

select is(
  (select count(*) from public.homework_submissions
    where class_member_id = 'b1000000-0000-0000-0000-000000000001')::int, 1,
  'homework submissions are preserved');

select is(
  (select count(*) from public.tuition_records
    where class_member_id = 'b1000000-0000-0000-0000-000000000001')::int, 1,
  'tuition records are preserved');

select is(
  (select count(*) from public.monthly_reports
    where class_member_id = 'b1000000-0000-0000-0000-000000000001')::int, 1,
  'monthly reports are preserved');

select is(
  (select snapshot ->> 'student' from public.monthly_reports
    where id = 'f1000000-0000-0000-0000-000000000001'),
  'Student X',
  'the published snapshot is still frozen — immutability outranks anonymisation');

-- The snapshot still names the student, so the parent-facing door must close.
select ok(
  (select share_revoked_at is not null or share_token_hash is null
     from public.monthly_reports
    where id = 'f1000000-0000-0000-0000-000000000001'),
  'no live share link survives the deletion');

-- Nothing anywhere points at a profile that no longer exists.
select is(
  (select count(*) from public.class_members m
    where m.student_id is not null
      and not exists (select 1 from public.profiles p where p.id = m.student_id))::int, 0,
  'no orphaned class_members.student_id');

select is(
  (select count(*) from public.session_attendance a
    where a.recorded_by is not null
      and not exists (select 1 from public.profiles p where p.id = a.recorded_by))::int, 0,
  'no orphaned session_attendance.recorded_by');

rollback to savepoint sec3;

-- ===========================================================================
-- 4. A departed membership is still a valid row.
--
-- The CHECK constraints have to admit the tombstone, and refuse anything that
-- is not one. If class_members_join_status_invariant were wrong, section 3
-- would have failed with 23514 rather than reaching its assertions — but test
-- the boundaries directly too.
-- ===========================================================================
savepoint sec4;

select throws_ok(
  $$ update public.class_members
        set join_status = 'departed'
      where id = 'b1000000-0000-0000-0000-000000000001' $$,
  '23514', null,
  'a departed row still carrying a student_id is refused');

select throws_ok(
  $$ update public.class_members
        set join_status = 'departed', student_id = null, invited_name = null,
            removed_at = now()
      where id = 'b1000000-0000-0000-0000-000000000001' $$,
  '23514', null,
  'a departed row still carrying an invited_email is refused');

select lives_ok(
  $$ update public.class_members
        set join_status = 'departed', student_id = null, invited_email = null,
            invited_name = null, removed_at = now()
      where id = 'b1000000-0000-0000-0000-000000000001' $$,
  'a fully cleared departed row is accepted');

rollback to savepoint sec4;

-- ===========================================================================
-- 5. Deleting a teacher identity is refused.
--
-- A teacher owns classes and Phase 1 has no ownership transfer, so the delete
-- would either orphan or destroy an entire tenant's records.
-- ===========================================================================
savepoint sec5;

select throws_ok(
  $$ delete from auth.users where id = '11111111-1111-1111-1111-111111111111' $$,
  '23001', null,
  'deleting a teacher who owns classes is refused');

select is(
  (select count(*) from public.classes
    where teacher_id = '11111111-1111-1111-1111-111111111111')::int, 2,
  'the refused delete left both classes standing');

select is(
  (select count(*) from public.profiles
    where id = '11111111-1111-1111-1111-111111111111')::int, 1,
  'the teacher profile is still there');

rollback to savepoint sec5;

-- ===========================================================================
-- 6. Teacher offboarding is deactivation, and it ends access without moving
--    a single educational record.
-- ===========================================================================
savepoint sec6;

select lives_ok(
  $$ select app.set_account_active('11111111-1111-1111-1111-111111111111', false) $$,
  'a teacher can be deactivated');

select ok(
  (select deactivated_at is not null from public.profiles
    where id = '11111111-1111-1111-1111-111111111111'),
  'deactivated_at is stamped');

select is(
  (select count(*) from public.classes
    where teacher_id = '11111111-1111-1111-1111-111111111111')::int, 2,
  'deactivation deletes no classes');

select is(
  (select count(*) from public.score_entries
    where class_id = 'c1000000-0000-0000-0000-000000000001')::int, 5,
  'deactivation deletes no scores');

-- Access, however, is gone: the helpers filter on deactivated_at.
set local role authenticated;
select tests.login('11111111-1111-1111-1111-111111111111');

select is(
  (select count(*) from public.classes)::int, 0,
  'a deactivated teacher can no longer read their own classes');

select is(
  (select count(*) from public.class_members)::int, 0,
  'a deactivated teacher can no longer read their rosters');

select ok(
  not (select app.is_teacher()),
  'a deactivated teacher no longer counts as a teacher');

reset role;

select lives_ok(
  $$ select app.set_account_active('11111111-1111-1111-1111-111111111111', true) $$,
  'the account can be restored');

set local role authenticated;
select tests.login('11111111-1111-1111-1111-111111111111');
select is(
  (select count(*) from public.classes)::int, 2,
  'restoring the account restores access to exactly the same classes');
reset role;

rollback to savepoint sec6;

-- ===========================================================================
-- 7. Deleting a class takes its own subtree and nothing else.
-- ===========================================================================
savepoint sec7;

select lives_ok(
  $$ delete from public.classes
      where id = 'c1000000-0000-0000-0000-000000000001' $$,
  'deleting a class with a full subtree of child data succeeds');

select is(
  (select count(*) from public.class_members
    where class_id = 'c1000000-0000-0000-0000-000000000001')::int, 0,
  'members cascade');

select is(
  (select count(*) from public.score_entries
    where class_id = 'c1000000-0000-0000-0000-000000000001')::int, 0,
  'scores cascade');

select is(
  (select count(*) from public.monthly_reports
    where class_id = 'c1000000-0000-0000-0000-000000000001')::int, 0,
  'reports cascade — the BEFORE DELETE revoke clears the share guard first');

select is(
  (select count(*) from public.tuition_records
    where class_id = 'c1000000-0000-0000-0000-000000000001')::int, 0,
  'tuition records cascade');

select is(
  (select count(*) from public.class_invite_codes
    where class_id = 'c1000000-0000-0000-0000-000000000001')::int, 0,
  'invite codes cascade');

-- The other tenant, and the teacher's other class, are untouched.
select is(
  (select count(*) from public.class_members
    where class_id = 'c2000000-0000-0000-0000-000000000002')::int, 1,
  'the same teacher''s other class keeps its roster');

select is(
  (select count(*) from public.class_members
    where class_id = 'c3000000-0000-0000-0000-000000000003')::int, 1,
  'the other teacher''s class is untouched');

select is(
  (select count(*) from public.profiles)::int, 9,
  'deleting a class deletes no people');

rollback to savepoint sec7;

-- ===========================================================================
-- 8. A published report with a live share link cannot be deleted directly.
--
-- The guard protects the parent holding the URL. Deleting the member or the
-- class still works, because both revoke on the way down (section 7).
-- ===========================================================================
savepoint sec8;

set local role authenticated;
select tests.login('11111111-1111-1111-1111-111111111111');
select lives_ok(
  $$ select public.create_report_share_link('f1000000-0000-0000-0000-000000000001') $$,
  'a teacher can mint a share link');
reset role;

select throws_ok(
  $$ delete from public.monthly_reports
      where id = 'f1000000-0000-0000-0000-000000000001' $$,
  '23001', null,
  'a published report with a live share link cannot be deleted');

select lives_ok(
  $$ update public.monthly_reports set share_revoked_at = now()
      where id = 'f1000000-0000-0000-0000-000000000001' $$,
  'the link can be revoked');

select lives_ok(
  $$ delete from public.monthly_reports
      where id = 'f1000000-0000-0000-0000-000000000001' $$,
  'once revoked, the report can be deleted');

select lives_ok(
  $$ delete from public.class_members
      where id = 'b2000000-0000-0000-0000-000000000002' $$,
  'deleting a member is not blocked by the share link under it');

rollback to savepoint sec8;

-- ===========================================================================
-- 9. A deleted student who signs up again is a NEW person.
--
-- The tombstone must not be resurrectable: it no longer carries the email or
-- the student_id, so neither branch of join_class_with_code can find it. The
-- returning user gets a fresh membership and the old record stays anonymised.
-- Anything else would undo the deletion the first account asked for.
-- ===========================================================================
savepoint sec9;

delete from auth.users where id = '33333333-3333-3333-3333-333333333333';

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'bbbbbbbb-0000-0000-0000-00000000000b',
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'student.x@edutrack.test',
  extensions.crypt('password123', extensions.gen_salt('bf')),
  now(),
  jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
  jsonb_build_object('full_name', 'Student X Again'),
  now(), now()
);

set local role authenticated;
select tests.login('bbbbbbbb-0000-0000-0000-00000000000b');
select lives_ok(
  $$ select public.join_class_with_code('ALPHA23456') $$,
  'the returning user can join the class again');
reset role;

select is(
  (select count(*) from public.class_members
    where class_id = 'c1000000-0000-0000-0000-000000000001'
      and student_id = 'bbbbbbbb-0000-0000-0000-00000000000b')::int, 1,
  'they get a brand new membership row');

select is(
  (select student_id from public.class_members
    where id = 'b1000000-0000-0000-0000-000000000001'),
  null,
  'the tombstone was NOT reclaimed by the matching email address');

select is(
  (select join_status::text from public.class_members
    where id = 'b1000000-0000-0000-0000-000000000001'),
  'departed',
  'the tombstone is still departed');

select is(
  (select count(*) from public.score_entries
    where class_member_id = (select id from public.class_members
                              where class_id = 'c1000000-0000-0000-0000-000000000001'
                                and student_id = 'bbbbbbbb-0000-0000-0000-00000000000b'))::int,
  0,
  'and the new membership starts with an empty score history');

rollback to savepoint sec9;

-- ===========================================================================
-- 10. Structural guarantees behind the behaviour above, asserted against the
--    catalogue so a future migration cannot quietly relax them.
--
--    The two composite session FKs must carry a SET NULL COLUMN LIST. Without
--    it section 1 and section 2 fail with 23502 — that is blocker B1.
--
--    Authorship columns must be RESTRICT, so no delete can silently rewrite
--    who recorded a score or wrote a lesson log to NULL.
-- ===========================================================================
select is(
  (select array_agg(a.attname order by k.ord)
     from pg_constraint c
     cross join unnest(c.confdelsetcols) with ordinality k(att, ord)
     join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.att
    where c.conname = 'lesson_logs_session_fk'),
  array['session_id']::name[],
  'lesson_logs_session_fk sets only session_id to null');

select is(
  (select array_agg(a.attname order by k.ord)
     from pg_constraint c
     cross join unnest(c.confdelsetcols) with ordinality k(att, ord)
     join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.att
    where c.conname = 'homework_assignments_session_fk'),
  array['session_id']::name[],
  'homework_assignments_session_fk sets only session_id to null');

select is(
  (select count(*) from pg_constraint c
    where c.contype = 'f'
      and c.connamespace = 'public'::regnamespace
      and c.conname in ('score_entries_created_by_fkey',
                        'lesson_logs_created_by_fkey',
                        'homework_assignments_created_by_fkey',
                        'monthly_reports_generated_by_fkey',
                        'classes_teacher_id_fkey')
      and c.confdeltype = 'r')::int, 5,
  'every authorship and ownership FK is ON DELETE RESTRICT');

select * from finish();
rollback;
