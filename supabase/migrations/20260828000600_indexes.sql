-- EduTrack Phase 1 — Step 5: indexes
--
-- Two jobs here:
--   1. Cover every foreign key. PostgreSQL does not index FK columns
--      automatically, and an uncovered FK makes parent deletes seq-scan the
--      child. Composite FKs need an index whose leading columns match the FK
--      column list in order.
--   2. Serve the RLS policies and the dashboard aggregates.

-- classes ---------------------------------------------------------------
-- The hottest index in the schema: every teacher policy resolves through it.
create index classes_teacher_id_idx on public.classes (teacher_id);

-- class_invite_codes ----------------------------------------------------
-- One index only. A partial (class_id) index filtered to live codes was
-- dropped: it is a strict subset of this one on a table holding a handful of
-- rows per class, so it cost writes and bought nothing.
create index class_invite_codes_class_id_idx on public.class_invite_codes (class_id);

-- class_members ---------------------------------------------------------
create index class_members_class_id_idx on public.class_members (class_id);

-- How a student enumerates their classes for the class switcher.
create index class_members_student_id_idx on public.class_members (student_id);

-- The invitation claim lookup in join_class_with_code.
create index class_members_invited_email_unclaimed_idx
  on public.class_members (invited_email)
  where student_id is null;

-- class_sessions --------------------------------------------------------
-- The (class_id, starts_at) unique constraint already covers the class_id FK
-- and serves the calendar range scan and the attendance denominator.

-- session_attendance ----------------------------------------------------
create index session_attendance_session_fk_idx
  on public.session_attendance (session_id, class_id);

-- Covers the member composite FK and the attendance numerator in one index.
create index session_attendance_member_status_idx
  on public.session_attendance (class_member_id, class_id, status);

create index session_attendance_class_id_idx on public.session_attendance (class_id);
create index session_attendance_recorded_by_idx on public.session_attendance (recorded_by);

-- score_entries ---------------------------------------------------------
-- Serves the line chart, the DISTINCT-ON current-band lookup and the FK.
create index score_entries_member_recorded_idx
  on public.score_entries (class_member_id, class_id, recorded_on desc, id desc);

create index score_entries_class_id_idx on public.score_entries (class_id);
create index score_entries_created_by_idx on public.score_entries (created_by);

-- lesson_logs -----------------------------------------------------------
create index lesson_logs_member_date_idx
  on public.lesson_logs (class_member_id, class_id, lesson_date desc);

create index lesson_logs_class_date_idx on public.lesson_logs (class_id, lesson_date desc);
create index lesson_logs_session_fk_idx on public.lesson_logs (session_id, class_id);
create index lesson_logs_created_by_idx on public.lesson_logs (created_by);

-- Recurring-mistakes aggregation on the student profile.
create index lesson_logs_mistakes_gin on public.lesson_logs using gin (mistakes);

-- mistake_tags ----------------------------------------------------------
create index mistake_tags_teacher_skill_idx on public.mistake_tags (teacher_id, skill);

-- homework_assignments --------------------------------------------------
create index homework_assignments_class_due_idx
  on public.homework_assignments (class_id, due_date desc);
create index homework_assignments_session_fk_idx
  on public.homework_assignments (session_id, class_id);
create index homework_assignments_created_by_idx
  on public.homework_assignments (created_by);

-- homework_submissions --------------------------------------------------
create index homework_submissions_assignment_fk_idx
  on public.homework_submissions (assignment_id, class_id);
create index homework_submissions_member_status_idx
  on public.homework_submissions (class_member_id, class_id, status);
create index homework_submissions_class_status_idx
  on public.homework_submissions (class_id, status);

-- monthly_reports -------------------------------------------------------
create index monthly_reports_member_fk_idx
  on public.monthly_reports (class_member_id, class_id);
create index monthly_reports_class_period_idx
  on public.monthly_reports (class_id, period_month desc);
create index monthly_reports_generated_by_idx on public.monthly_reports (generated_by);

-- tuition_records -------------------------------------------------------
create index tuition_records_member_fk_idx
  on public.tuition_records (class_member_id, class_id);
create index tuition_records_class_period_idx
  on public.tuition_records (class_id, period_month desc, status);
