-- EduTrack Phase 1 — Step 6b: triggers

-- auth.users ------------------------------------------------------------
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row execute function app.handle_user_email_sync();

-- updated_at ------------------------------------------------------------
create trigger set_updated_at before update on public.profiles
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on public.classes
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on public.class_members
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on public.class_sessions
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on public.session_attendance
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on public.lesson_logs
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on public.homework_assignments
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on public.homework_submissions
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on public.monthly_reports
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on public.tuition_records
  for each row execute function app.set_updated_at();

-- invariants ------------------------------------------------------------
create trigger enforce_role_immutable
  before update on public.profiles
  for each row execute function app.enforce_profile_role_immutable();

create trigger enforce_published_report_immutable
  before update on public.monthly_reports
  for each row execute function app.enforce_report_immutable();

create trigger enforce_score_within_max
  before insert or update on public.homework_submissions
  for each row execute function app.enforce_homework_score_max();

create trigger enforce_score_entries_append_only
  before update on public.score_entries
  for each row execute function app.enforce_score_entry_append_only();

-- deletion --------------------------------------------------------------
-- Student identities are anonymised in place; teacher identities that own a
-- class are refused. BEFORE DELETE, so this runs ahead of the FK actions.
create trigger handle_profile_delete
  before delete on public.profiles
  for each row execute function app.handle_profile_delete();

-- Both fire ahead of the cascade into monthly_reports, so guard_report_delete
-- below sees an already-revoked link and lets the cascade through.
create trigger revoke_share_links_on_member_delete
  before delete on public.class_members
  for each row execute function app.revoke_member_share_links();

create trigger revoke_share_links_on_class_delete
  before delete on public.classes
  for each row execute function app.revoke_class_share_links();

create trigger guard_report_delete
  before delete on public.monthly_reports
  for each row execute function app.enforce_report_delete_guard();

-- fan-out ---------------------------------------------------------------
create trigger fan_out_submissions
  after insert on public.homework_assignments
  for each row execute function app.fan_out_homework_submissions();
