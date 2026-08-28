-- EduTrack Phase 1 — Step 9: RLS policies
--
-- Every policy is scoped `to authenticated`. `anon` therefore matches no
-- policy on any table and reads nothing — its entire surface is the two
-- public RPCs in step 11, which run as owner and narrow their own output.
--
-- Every helper is argument-free and wrapped as `(select app.fn())`. Because
-- the subquery references no column of the candidate row it is uncorrelated,
-- so PostgreSQL evaluates it ONCE per statement as an InitPlan and the per-row
-- work is a single array membership test. The earlier `(select
-- app.is_class_teacher(class_id))` form looked identical but was correlated,
-- and cost one function call plus one index lookup for every row scanned.
-- See 20260828000900_app_helper_functions.sql.
--
-- The `::uuid[]` cast on every helper call is required, not decorative.
-- `x = any ((select f()))` is ambiguous in PostgreSQL's grammar and resolves to
-- the *subquery* branch — comparing uuid against the subquery's single column of
-- type uuid[], which fails with "operator does not exist: uuid = uuid[]".
-- Casting makes the operand an ordinary expression, so the parser takes the
-- array branch. The InitPlan behaviour above is unaffected.

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
-- Self, plus the teachers of classes you joined, plus the students on your
-- own rosters. A student cannot reach a classmate's profile by any path.
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or id = any ((select app.my_teacher_ids())::uuid[])
    or id = any ((select app.my_student_ids())::uuid[])
  );

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- No INSERT or DELETE policy: profile rows are created solely by the
-- app.handle_new_user trigger and removed by the cascade from auth.users.

-- ---------------------------------------------------------------------------
-- classes
-- ---------------------------------------------------------------------------
-- This is the one policy that cannot be expressed through app.my_class_ids():
-- the WITH CHECK on INSERT is evaluated before the row exists, so there is
-- nothing for the helper to return. app.is_teacher() carries both jobs
-- instead — without it a student could insert a class with teacher_id = their
-- own uid and self-promote, and a DEACTIVATED teacher would keep full access to
-- their tenant, because teacher_id = auth.uid() knows nothing about
-- deactivated_at. Every other policy inherits the check through the helpers.
create policy classes_teacher_all on public.classes
  for all to authenticated
  using (teacher_id = (select auth.uid()) and (select app.is_teacher()))
  with check (teacher_id = (select auth.uid()) and (select app.is_teacher()));

create policy classes_student_select on public.classes
  for select to authenticated
  using (id = any ((select app.my_student_class_ids())::uuid[]));

-- ---------------------------------------------------------------------------
-- class_invite_codes  (teacher only — students must never read a code)
-- ---------------------------------------------------------------------------
create policy class_invite_codes_teacher_all on public.class_invite_codes
  for all to authenticated
  using (class_id = any ((select app.my_class_ids())::uuid[]))
  with check (class_id = any ((select app.my_class_ids())::uuid[]));

-- ---------------------------------------------------------------------------
-- class_members
-- ---------------------------------------------------------------------------
create policy class_members_teacher_all on public.class_members
  for all to authenticated
  using (class_id = any ((select app.my_class_ids())::uuid[]))
  with check (class_id = any ((select app.my_class_ids())::uuid[]));

-- Identity-scoped, NOT class-scoped. Joining a second class adds a row the
-- student can see; it never widens what they see in the first.
create policy class_members_student_select on public.class_members
  for select to authenticated
  using (student_id = (select auth.uid()));

-- No student INSERT or UPDATE policy. Membership is created and claimed only
-- by public.join_class_with_code().

-- ---------------------------------------------------------------------------
-- class_sessions
-- ---------------------------------------------------------------------------
create policy class_sessions_teacher_all on public.class_sessions
  for all to authenticated
  using (class_id = any ((select app.my_class_ids())::uuid[]))
  with check (class_id = any ((select app.my_class_ids())::uuid[]));

create policy class_sessions_student_select on public.class_sessions
  for select to authenticated
  using (class_id = any ((select app.my_student_class_ids())::uuid[]));

-- ---------------------------------------------------------------------------
-- session_attendance
-- ---------------------------------------------------------------------------
create policy session_attendance_teacher_all on public.session_attendance
  for all to authenticated
  using (class_id = any ((select app.my_class_ids())::uuid[]))
  with check (class_id = any ((select app.my_class_ids())::uuid[]));

create policy session_attendance_student_select on public.session_attendance
  for select to authenticated
  using (class_member_id = any ((select app.my_member_ids())::uuid[]));

-- ---------------------------------------------------------------------------
-- score_entries
-- ---------------------------------------------------------------------------
create policy score_entries_teacher_all on public.score_entries
  for all to authenticated
  using (class_id = any ((select app.my_class_ids())::uuid[]))
  with check (class_id = any ((select app.my_class_ids())::uuid[]));

create policy score_entries_student_select on public.score_entries
  for select to authenticated
  using (class_member_id = any ((select app.my_member_ids())::uuid[]));

-- ---------------------------------------------------------------------------
-- lesson_logs
-- ---------------------------------------------------------------------------
create policy lesson_logs_teacher_all on public.lesson_logs
  for all to authenticated
  using (class_id = any ((select app.my_class_ids())::uuid[]))
  with check (class_id = any ((select app.my_class_ids())::uuid[]));

create policy lesson_logs_student_select on public.lesson_logs
  for select to authenticated
  using (class_member_id = any ((select app.my_member_ids())::uuid[]));

-- ---------------------------------------------------------------------------
-- mistake_tags  (global seeds are readable by every teacher)
-- ---------------------------------------------------------------------------
create policy mistake_tags_teacher_select on public.mistake_tags
  for select to authenticated
  using (
    (select app.is_teacher())
    and (teacher_id is null or teacher_id = (select auth.uid()))
  );

create policy mistake_tags_teacher_insert on public.mistake_tags
  for insert to authenticated
  with check (teacher_id = (select auth.uid()) and (select app.is_teacher()));

-- app.is_teacher() again, for the same reason as classes_teacher_all: a bare
-- teacher_id = auth.uid() would leave a deactivated account able to write.
create policy mistake_tags_teacher_update on public.mistake_tags
  for update to authenticated
  using (teacher_id = (select auth.uid()) and (select app.is_teacher()))
  with check (teacher_id = (select auth.uid()) and (select app.is_teacher()));

create policy mistake_tags_teacher_delete on public.mistake_tags
  for delete to authenticated
  using (teacher_id = (select auth.uid()) and (select app.is_teacher()));

-- ---------------------------------------------------------------------------
-- homework_assignments
-- ---------------------------------------------------------------------------
create policy homework_assignments_teacher_all on public.homework_assignments
  for all to authenticated
  using (class_id = any ((select app.my_class_ids())::uuid[]))
  with check (class_id = any ((select app.my_class_ids())::uuid[]));

create policy homework_assignments_student_select on public.homework_assignments
  for select to authenticated
  using (class_id = any ((select app.my_student_class_ids())::uuid[]));

-- ---------------------------------------------------------------------------
-- homework_submissions
-- ---------------------------------------------------------------------------
create policy homework_submissions_teacher_all on public.homework_submissions
  for all to authenticated
  using (class_id = any ((select app.my_class_ids())::uuid[]))
  with check (class_id = any ((select app.my_class_ids())::uuid[]));

-- Read only. Students submit through public.submit_homework(), because
-- Supabase maps teachers and students to the same `authenticated` Postgres
-- role and column-level GRANTs cannot tell them apart — a student granted
-- UPDATE on `status` would also hold UPDATE on `score`.
create policy homework_submissions_student_select on public.homework_submissions
  for select to authenticated
  using (class_member_id = any ((select app.my_member_ids())::uuid[]));

-- ---------------------------------------------------------------------------
-- monthly_reports  (teacher only in Phase 1)
-- ---------------------------------------------------------------------------
create policy monthly_reports_teacher_all on public.monthly_reports
  for all to authenticated
  using (class_id = any ((select app.my_class_ids())::uuid[]))
  with check (class_id = any ((select app.my_class_ids())::uuid[]));

-- ---------------------------------------------------------------------------
-- tuition_records  (teacher only)
-- ---------------------------------------------------------------------------
create policy tuition_records_teacher_all on public.tuition_records
  for all to authenticated
  using (class_id = any ((select app.my_class_ids())::uuid[]))
  with check (class_id = any ((select app.my_class_ids())::uuid[]));
