-- Local-only seed. This file is NOT applied to a hosted project — it runs on
-- `supabase db reset` against the local stack only.
--
-- It installs pgTAP and the `tests` schema used by supabase/tests/database.
-- Neither belongs in a migration: assertion libraries and fixture builders have
-- no business existing in production.
--
-- No fixture ROWS are inserted here. Each test file calls tests.seed_world()
-- inside its own transaction and rolls back, so tests never see each other's
-- data and `supabase db reset` leaves a clean database.

create extension if not exists pgtap with schema extensions;

-- The `tests` schema is an impersonation surface: tests.login writes
-- request.jwt.claims, which is exactly what auth.uid() reads, and
-- tests.create_user mints confirmed auth.users rows. Nothing anonymous may
-- reach either. USAGE goes to `authenticated` alone, because the test files
-- call tests.login after `set local role authenticated`; every other helper is
-- invoked while still `postgres`, so it needs no grant at all.
--
-- The matching function grants are at the FOOT of this file, after a blanket
-- revoke, so a helper added later starts closed instead of inheriting PUBLIC
-- EXECUTE.
create schema if not exists tests;
revoke all on schema tests from public;
grant usage on schema tests to authenticated;

-- ---------------------------------------------------------------------------
-- Impersonation
--
-- auth.uid() reads request.jwt.claims, so setting that GUC is exactly what
-- PostgREST does per request. `set local role authenticated` (or anon) must be
-- issued separately by the test — a function cannot usefully do it, because a
-- function carrying a SET clause reverts every GUC it touched on exit.
-- ---------------------------------------------------------------------------
create or replace function tests.login(p_user_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
    true
  );
end;
$$;

create or replace function tests.logout()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- tests.create_user
--
-- Inserts into auth.users, which fires app.handle_new_user and produces the
-- public.profiles row. Tests therefore exercise the real signup path rather
-- than fabricating profiles directly.
--
-- p_role is passed through into raw_user_meta_data unchanged — that is exactly
-- what a browser would send — and is then IGNORED by the signup trigger, which
-- hard-codes 'student'. A teacher fixture is produced the way production
-- produces one: by calling app.provision_teacher afterwards, which is
-- service_role-only. 10_role_security.test.sql asserts both halves.
-- ---------------------------------------------------------------------------
create or replace function tests.create_user(
  p_id        uuid,
  p_email     text,
  p_role      text,
  p_name      text,
  p_confirmed boolean default true
)
returns uuid
language plpgsql
as $$
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  )
  values (
    p_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    p_email,
    extensions.crypt('password123', extensions.gen_salt('bf')),
    case when p_confirmed then now() - interval '1 day' else null end,
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    jsonb_build_object('role', p_role, 'full_name', p_name),
    now(), now()
  );

  -- The trigger made a student regardless of what the metadata claimed.
  -- Teachers are provisioned through the privileged path.
  if p_role = 'teacher' then
    perform app.provision_teacher(p_id, 'ielts');
  end if;

  return p_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- tests.seed_world
--
-- Deterministic fixture. IDs are readable on purpose so an assertion failure
-- names the actor rather than a random uuid.
--
--   USERS
--     T1  1111…  teacher.a@edutrack.test        teacher
--     T2  2222…  teacher.b@edutrack.test        teacher
--     S1  3333…  student.x@edutrack.test        student  — the subject
--     S2  4444…  student.y@edutrack.test        student  — S1's classmate in C1
--     S3  5555…  unconfirmed@edutrack.test      student  — email NOT confirmed
--     S4  6666…  invitee@edutrack.test          student  — holds a C1 invitation
--     S5  7777…  outsider@edutrack.test         student  — no membership at all
--     S6  8888…  removed@edutrack.test          student  — removed from C1
--     S7  9999…  teacherb.student@edutrack.test student  — on T2's roster only
--
--   CLASSES
--     C1  c100…  T1  IELTS Intensive     ielts_band
--     C2  c200…  T1  IELTS Evening       ielts_band
--     C3  c300…  T2  General English     scoring_model = 'none'
--
--   MEMBERS
--     M1  b100…  C1 / S1  joined  -40d
--     M2  b200…  C1 / S2  joined  -40d
--     M3  b300…  C2 / S1  joined  -30d   (S1 in two classes)
--     M4  b400…  C3 / S7  joined  -30d
--     M5  b500…  C1       invited only, invited_email = invitee@edutrack.test
--     M6  b600…  C1 / S6  joined  -40d, removed -12d
--
--   SESSIONS (all in C1)
--     SS1 -30d completed | SS2 -25d completed | SS3 -20d completed
--     SS4 -15d completed | SS5 -10d completed | SS6  -5d CANCELLED
--     SS7  +5d scheduled | SS8 -50d completed (before every joined_at)
--
--   ATTENDANCE
--     M1: SS1 present, SS2 late, SS3 absent, SS4 excused,
--         SS6 present (cancelled), SS7 present (future), SS8 present (pre-join)
--         SS5 unmarked
--         => denominator 4 (SS1,SS2,SS3,SS5), numerator 2 => 50%
--     M6: SS1 present, SS5 present
--         => denominator 4 (SS1..SS4 — SS4 is unmarked for M6, and SS5 falls
--            after removed_at), numerator 1 => 25%
--     M2: no attendance rows at all
--         => denominator 5 (SS1..SS5), numerator 0 => 0%
--            Unmarked sessions count against on purpose: a gap in the register
--            should be visible, not invisible.
-- ---------------------------------------------------------------------------
create or replace function tests.seed_world()
returns void
language plpgsql
as $$
declare
  t1 uuid := '11111111-1111-1111-1111-111111111111';
  t2 uuid := '22222222-2222-2222-2222-222222222222';
  s1 uuid := '33333333-3333-3333-3333-333333333333';
  s2 uuid := '44444444-4444-4444-4444-444444444444';
  s3 uuid := '55555555-5555-5555-5555-555555555555';
  s4 uuid := '66666666-6666-6666-6666-666666666666';
  s5 uuid := '77777777-7777-7777-7777-777777777777';
  s6 uuid := '88888888-8888-8888-8888-888888888888';
  s7 uuid := '99999999-9999-9999-9999-999999999999';

  c1 uuid := 'c1000000-0000-0000-0000-000000000001';
  c2 uuid := 'c2000000-0000-0000-0000-000000000002';
  c3 uuid := 'c3000000-0000-0000-0000-000000000003';

  m1 uuid := 'b1000000-0000-0000-0000-000000000001';
  m2 uuid := 'b2000000-0000-0000-0000-000000000002';
  m3 uuid := 'b3000000-0000-0000-0000-000000000003';
  m4 uuid := 'b4000000-0000-0000-0000-000000000004';
  m5 uuid := 'b5000000-0000-0000-0000-000000000005';
  m6 uuid := 'b6000000-0000-0000-0000-000000000006';

  ss1 uuid := 'd1000000-0000-0000-0000-000000000001';
  ss2 uuid := 'd2000000-0000-0000-0000-000000000002';
  ss3 uuid := 'd3000000-0000-0000-0000-000000000003';
  ss4 uuid := 'd4000000-0000-0000-0000-000000000004';
  ss5 uuid := 'd5000000-0000-0000-0000-000000000005';
  ss6 uuid := 'd6000000-0000-0000-0000-000000000006';
  ss7 uuid := 'd7000000-0000-0000-0000-000000000007';
  ss8 uuid := 'd8000000-0000-0000-0000-000000000008';

  ha1 uuid := 'e1000000-0000-0000-0000-000000000001';
  ha2 uuid := 'e2000000-0000-0000-0000-000000000002';

  r1 uuid := 'f1000000-0000-0000-0000-000000000001';
  r2 uuid := 'f2000000-0000-0000-0000-000000000002';
  r3 uuid := 'f3000000-0000-0000-0000-000000000003';

  last_month date := (date_trunc('month', now()) - interval '1 month')::date;
begin
  perform tests.create_user(t1, 'teacher.a@edutrack.test',        'teacher', 'Teacher A');
  perform tests.create_user(t2, 'teacher.b@edutrack.test',        'teacher', 'Teacher B');
  perform tests.create_user(s1, 'student.x@edutrack.test',        'student', 'Student X');
  perform tests.create_user(s2, 'student.y@edutrack.test',        'student', 'Student Y');
  perform tests.create_user(s3, 'unconfirmed@edutrack.test',      'student', 'Unconfirmed', false);
  perform tests.create_user(s4, 'invitee@edutrack.test',          'student', 'Invitee');
  perform tests.create_user(s5, 'outsider@edutrack.test',         'student', 'Outsider');
  perform tests.create_user(s6, 'removed@edutrack.test',          'student', 'Removed');
  perform tests.create_user(s7, 'teacherb.student@edutrack.test', 'student', 'Teacher B Student');

  insert into public.classes
    (id, teacher_id, name, course_type, scoring_model, target_band,
     start_date, default_tuition_rate_per_session)
  values
    (c1, t1, 'IELTS Intensive', 'ielts',           'ielts_band', 7.0,
     (now() - interval '60 days')::date, 300000),
    (c2, t1, 'IELTS Evening',   'ielts',           'ielts_band', 6.5,
     (now() - interval '45 days')::date, 250000),
    (c3, t2, 'General English', 'general_english', 'none',       null,
     (now() - interval '45 days')::date, 200000);

  insert into public.class_invite_codes
    (class_id, code, is_active, expires_at, revoked_at, max_uses, use_count)
  values
    -- 10 characters minimum, over the generator's unambiguous alphabet.
    (c1, 'ALPHA23456',  true, now() + interval '30 days', null, null, 0),
    (c1, 'EXPIRE2345',  true, now() - interval '1 day',   null, null, 0),
    (c1, 'REVOKE2345',  true, now() + interval '30 days', now() - interval '1 day', null, 0),
    (c1, 'MAXOUT2345',  true, now() + interval '30 days', null, 1, 1),
    (c3, 'BRAVO23456',  true, now() + interval '30 days', null, null, 0);

  insert into public.class_members
    (id, class_id, student_id, invited_email, invited_name, join_status,
     invited_at, joined_at, removed_at, target_band, tuition_rate_per_session)
  values
    (m1, c1, s1, 'student.x@edutrack.test', 'Student X', 'joined',
     now() - interval '41 days', now() - interval '40 days', null, 7.0, null),
    (m2, c1, s2, 'student.y@edutrack.test', 'Student Y', 'joined',
     now() - interval '41 days', now() - interval '40 days', null, 6.5, 350000),
    (m3, c2, s1, 'student.x@edutrack.test', 'Student X', 'joined',
     now() - interval '31 days', now() - interval '30 days', null, 6.5, null),
    (m4, c3, s7, 'teacherb.student@edutrack.test', 'Teacher B Student', 'joined',
     now() - interval '31 days', now() - interval '30 days', null, null, null),
    (m5, c1, null, 'invitee@edutrack.test', 'Invitee', 'invited',
     now() - interval '2 days', null, null, null, null),
    (m6, c1, s6, 'removed@edutrack.test', 'Removed', 'joined',
     now() - interval '41 days', now() - interval '40 days',
     now() - interval '12 days', null, null);

  insert into public.class_sessions (id, class_id, starts_at, ends_at, title, status)
  values
    (ss1, c1, now() - interval '30 days', now() - interval '30 days' + interval '2 hours', 'S1', 'completed'),
    (ss2, c1, now() - interval '25 days', now() - interval '25 days' + interval '2 hours', 'S2', 'completed'),
    (ss3, c1, now() - interval '20 days', now() - interval '20 days' + interval '2 hours', 'S3', 'completed'),
    (ss4, c1, now() - interval '15 days', now() - interval '15 days' + interval '2 hours', 'S4', 'completed'),
    (ss5, c1, now() - interval '10 days', now() - interval '10 days' + interval '2 hours', 'S5', 'completed'),
    (ss6, c1, now() - interval '5 days',  now() - interval '5 days'  + interval '2 hours', 'S6 cancelled', 'cancelled'),
    (ss7, c1, now() + interval '5 days',  now() + interval '5 days'  + interval '2 hours', 'S7 future', 'scheduled'),
    (ss8, c1, now() - interval '50 days', now() - interval '50 days' + interval '2 hours', 'S8 pre-join', 'completed');

  insert into public.session_attendance
    (session_id, class_member_id, class_id, status, recorded_by)
  values
    (ss1, m1, c1, 'present', t1),
    (ss2, m1, c1, 'late',    t1),
    (ss3, m1, c1, 'absent',  t1),
    (ss4, m1, c1, 'excused', t1),
    (ss6, m1, c1, 'present', t1),
    (ss7, m1, c1, 'present', t1),
    (ss8, m1, c1, 'present', t1),
    (ss1, m6, c1, 'present', t1),
    (ss5, m6, c1, 'present', t1);

  insert into public.score_entries
    (class_member_id, class_id, recorded_on, entry_type,
     overall, reading, listening, writing, speaking, created_by)
  values
    -- M1: 5.0 -> (skills-only row) -> 6.0  => improving
    (m1, c1, (now() - interval '40 days')::date, 'baseline', 5.0, 5.0, 5.0, 5.0, 5.0, t1),
    (m1, c1, (now() - interval '20 days')::date, 'progress', null, 6.0, null, null, null, t1),
    (m1, c1, (now() - interval '10 days')::date, 'progress', 6.0, 6.0, 6.5, 5.5, 6.0, t1),
    -- M2: 6.5 -> 6.0 => needs_attention
    (m2, c1, (now() - interval '40 days')::date, 'baseline', 6.5, 6.5, 6.5, 6.5, 6.5, t1),
    (m2, c1, (now() - interval '10 days')::date, 'progress', 6.0, 6.0, 6.0, 6.0, 6.0, t1),
    -- M3: a single entry => stable
    (m3, c2, (now() - interval '30 days')::date, 'baseline', 5.5, 5.5, 5.5, 5.5, 5.5, t1),
    -- M4: rising, but C3 does not score => stable
    (m4, c3, (now() - interval '30 days')::date, 'baseline', 5.0, 5.0, 5.0, 5.0, 5.0, t2),
    (m4, c3, (now() - interval '10 days')::date, 'progress', 7.0, 7.0, 7.0, 7.0, 7.0, t2);

  insert into public.lesson_logs
    (class_id, class_member_id, session_id, lesson_date, skill, topic,
     performance, mistakes, created_by)
  values
    (c1, m1, ss1, (now() - interval '30 days')::date, 'writing',
     'Task 2 opinion essay', 'good', array['Article use', 'Paragraphing'], t1);

  -- Fans out one 'assigned' submission per joined, non-removed member.
  insert into public.homework_assignments
    (id, class_id, title, skill, assigned_on, due_date, max_score, created_by)
  values
    (ha1, c1, 'Task 2 essay', 'writing',
     (now() - interval '7 days')::date, (now() - interval '1 day')::date, 10, t1),
    (ha2, c3, 'Vocabulary set 4', 'general',
     (now() - interval '7 days')::date, (now() - interval '1 day')::date, 20, t2);

  insert into public.monthly_reports
    (id, class_member_id, class_id, period_month, snapshot, teacher_comment,
     status, published_at, generated_by)
  values
    (r1, m1, c1, last_month,
     jsonb_build_object('student', 'Student X', 'attendance_pct', 50),
     'Steady progress.', 'published', now() - interval '1 day', t1),
    (r2, m2, c1, last_month,
     jsonb_build_object('student', 'Student Y', 'attendance_pct', 90),
     'Needs more writing practice.', 'published', now() - interval '1 day', t1),
    (r3, m4, c3, last_month,
     jsonb_build_object('student', 'Teacher B Student'),
     null, 'published', now() - interval '1 day', t2);

  insert into public.tuition_records
    (class_member_id, class_id, period_month, sessions_attended, sessions_billed,
     rate_per_session, discount_amount, status)
  values
    (m1, c1, last_month, 4, 8, 300000, 0, 'pending'),
    (m2, c1, last_month, 3, 8, 350000, 50000, 'pending');
end;
$$;

-- ---------------------------------------------------------------------------
-- Function grants, last, so the blanket revoke catches every helper above.
--
-- Only tests.login and tests.logout are reachable by a role a test can assume,
-- and only by `authenticated`. tests.create_user and tests.seed_world run
-- while the session is still `postgres` (the owner), so they need no grant —
-- which means no role a client could hold can mint an auth user.
-- ---------------------------------------------------------------------------
revoke all on all functions in schema tests from public, anon, authenticated;

grant execute on function tests.login(uuid) to authenticated;
grant execute on function tests.logout()    to authenticated;
