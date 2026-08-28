-- EduTrack Phase 1 — Step 2: enum types and the band domain

-- Exactly two roles. No admin: the product has no back-office (Figma analysis §2).
create type public.app_role as enum ('teacher', 'student');

create type public.course_type as enum (
  'ielts', 'general_english', 'academic_english', 'other'
);

-- Drives the conditional IELTS band UI. 'none' classes track progress through
-- attendance, homework and per-lesson performance instead of bands.
create type public.scoring_model as enum ('ielts_band', 'none');

create type public.skill as enum (
  'reading', 'listening', 'writing', 'speaking', 'general'
);

create type public.performance as enum (
  'excellent', 'good', 'developing', 'needs_attention'
);

-- 'pending' was removed: joining is auto-approved, invited -> joined.
--
-- 'departed' is the account-deletion tombstone. When a student deletes their
-- auth identity the membership row survives so the teacher keeps the class
-- history, but every direct identifier on it is cleared. It is reachable only
-- through app.handle_profile_delete(); no client path can write it.
create type public.join_status as enum ('invited', 'joined', 'departed');

create type public.session_status as enum ('scheduled', 'completed', 'cancelled');

create type public.attendance_status as enum ('present', 'absent', 'late', 'excused');

create type public.score_entry_type as enum ('baseline', 'progress', 'mock_test');

create type public.homework_status as enum ('assigned', 'submitted', 'graded', 'missed');

create type public.report_status as enum ('draft', 'published');

create type public.payment_status as enum ('pending', 'paid', 'waived');

-- Type only. No table has a column of this type: performance status is derived
-- at query time by public.v_member_performance_status and is never stored.
-- Declared so `supabase gen types typescript` emits a string union rather than
-- a bare `string` for the view column.
create type public.member_status as enum ('improving', 'stable', 'needs_attention');

-- IELTS bands: 0.0-9.0 on the half-point grid.
create domain public.band as numeric(2, 1)
  check (value >= 0 and value <= 9 and (value * 2) = floor(value * 2));

comment on domain public.band is
  'IELTS band score: 0.0-9.0 constrained to half-point increments.';
