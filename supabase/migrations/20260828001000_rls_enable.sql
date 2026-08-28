-- EduTrack Phase 1 — Step 8: enable and FORCE row level security
--
-- FORCE matters: without it the table owner bypasses every policy. With it,
-- only SECURITY DEFINER functions (which run as the owner but are written to
-- narrow their own results) can cross a tenancy boundary.
--
-- A table with RLS enabled and no matching policy returns zero rows. That is
-- the default posture for every role on every table here.

alter table public.profiles              enable row level security;
alter table public.profiles              force  row level security;
alter table public.classes               enable row level security;
alter table public.classes               force  row level security;
alter table public.class_invite_codes    enable row level security;
alter table public.class_invite_codes    force  row level security;
alter table public.class_members         enable row level security;
alter table public.class_members         force  row level security;
alter table public.class_sessions        enable row level security;
alter table public.class_sessions        force  row level security;
alter table public.session_attendance    enable row level security;
alter table public.session_attendance    force  row level security;
alter table public.score_entries         enable row level security;
alter table public.score_entries         force  row level security;
alter table public.lesson_logs           enable row level security;
alter table public.lesson_logs           force  row level security;
alter table public.mistake_tags          enable row level security;
alter table public.mistake_tags          force  row level security;
alter table public.homework_assignments  enable row level security;
alter table public.homework_assignments  force  row level security;
alter table public.homework_submissions  enable row level security;
alter table public.homework_submissions  force  row level security;
alter table public.monthly_reports       enable row level security;
alter table public.monthly_reports       force  row level security;
alter table public.tuition_records       enable row level security;
alter table public.tuition_records       force  row level security;
