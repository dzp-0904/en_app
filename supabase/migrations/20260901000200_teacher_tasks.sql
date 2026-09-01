-- EduTrack M32 — the teacher's own to-do list, for the Dashboard's To-do panel.
--
-- ---------------------------------------------------------------------------
-- NOT APPLIED. This file was written during M32 and deliberately NOT executed
-- against the hosted project, at the user's explicit instruction ("write
-- migration, don't apply"). Until a human runs it, `public.teacher_tasks` does
-- not exist and the Dashboard's To-do panel renders the application's ordinary
-- "we could not load this" alert — the same thing every other failed read
-- renders. Nothing in the application creates the table on demand.
--
-- `20260901000100_class_materials.sql` is in the same state, for the same
-- reason. Every other migration in this directory is live.
-- ---------------------------------------------------------------------------
--
-- WHY A NEW TABLE AT ALL.
-- The audit that preceded this milestone looked for somewhere existing to put
-- a teacher's task and found nothing that means the same thing:
--
--   homework_assignments.due_date   a *student's* homework, not the teacher's
--                                   task, and it is class-scoped and visible to
--                                   students through their own RLS policy.
--   tuition_records.reminder_sent_at  a timestamp on an invoice, not a task.
--   class_members.invite_reminder_count  a counter on one membership.
--   monthly_reports.status = 'draft'  a report that exists but is unpublished;
--                                   there is no row at all for a report the
--                                   teacher has not started.
--
-- None of those can hold free text, a priority the teacher chose, or a
-- completion state the teacher controls. Overloading one of them would make an
-- existing column mean two different things depending on who wrote it, which is
-- how a schema stops being readable. The Figma's own To-do is `useState` over
-- five hardcoded strings and has no backend at all, so there was nothing to
-- reuse on that side either.
--
-- WHAT THIS DELIBERATELY IS NOT.
-- Not a shared work queue: a task belongs to exactly one teacher and no student
-- policy is created, so this table is invisible to the student role in the same
-- way `tuition_records` is. Not linked to a class or a session: the Figma's
-- tasks are free text ("Send August progress reports to parents") and inventing
-- a foreign key the design does not have would force every task to be about
-- something the schema already models. A `class_id` column can be added later
-- without rewriting anything here.

-- ---------------------------------------------------------------------------
-- The priority scale. Three values, ordered strongest first, matching the
-- Figma's High / Medium / Low picker exactly.
-- ---------------------------------------------------------------------------
create type public.task_priority as enum ('high', 'medium', 'low');

comment on type public.task_priority is
  'Teacher-chosen urgency for a teacher_tasks row. Declared strongest first so enum order is also display order.';

-- ---------------------------------------------------------------------------
-- teacher_tasks : one row per task, owned by one teacher.
-- ---------------------------------------------------------------------------
create table public.teacher_tasks (
  id           uuid primary key default gen_random_uuid(),

  -- profiles, not auth.users, for the same reason every other owning column in
  -- this schema points at profiles: app.is_teacher() reads that table, and a
  -- deactivated account must lose its rows through the same door as its
  -- classes. ON DELETE CASCADE because a task is worthless without its author —
  -- unlike created_by on score_entries, which is RESTRICT precisely because the
  -- score outlives the person who typed it.
  teacher_id   uuid not null references public.profiles (id) on delete cascade,

  title        text not null,
  priority     public.task_priority not null default 'medium',

  -- A calendar date, not a timestamptz. The Figma's picker is `<input
  -- type="date">` and its labels are Overdue / Today / Tomorrow, which are
  -- statements about a day. A teacher has one working timezone, so unlike
  -- class_sessions there is no per-row clock to disagree with.
  due_date     date,

  -- Completion is a nullable timestamp rather than a boolean, because the panel
  -- has to answer "how long ago" as well as "is it done": the Figma hides a
  -- completed task 24 hours after it was ticked. A boolean would need a second
  -- column to say when, and the two could then disagree.
  completed_at timestamptz,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- Same bound as homework_assignments_title_length. A task is a line, not a
  -- document.
  constraint teacher_tasks_title_length
    check (length(btrim(title)) between 1 and 300)
);

-- The panel's only read: this teacher's rows, unfinished ones and recently
-- finished ones, ordered by when they are due.
create index teacher_tasks_owner_idx
  on public.teacher_tasks (teacher_id, completed_at, due_date);

comment on table public.teacher_tasks is
  'The teacher''s private to-do list, shown on the Dashboard. Teacher-only, like tuition_records: there is no student policy and none is intended.';
comment on column public.teacher_tasks.completed_at is
  'NULL while outstanding. Set when ticked; the Dashboard stops showing a task 24 hours after this timestamp, so the row is retained rather than deleted.';
comment on column public.teacher_tasks.due_date is
  'Optional. A task with no due date is valid and renders without a deadline pill.';

-- ---------------------------------------------------------------------------
-- RLS. The same shape as classes_teacher_all.
-- ---------------------------------------------------------------------------
alter table public.teacher_tasks enable row level security;
alter table public.teacher_tasks force row level security;

-- app.is_teacher() as well as the ownership test, for the reason
-- classes_teacher_all states: a bare teacher_id = auth.uid() would leave a
-- deactivated account still able to write its own rows.
create policy teacher_tasks_owner_all on public.teacher_tasks
  for all to authenticated
  using (teacher_id = (select auth.uid()) and (select app.is_teacher()))
  with check (teacher_id = (select auth.uid()) and (select app.is_teacher()));

-- No student policy, deliberately. A student has no business reading, and no
-- reason to write, a teacher's task list.

-- UPDATE is granted here, unlike class_materials and score_entries: ticking a
-- task is an update to completed_at, and the Figma allows un-ticking it again.
grant select, insert, update, delete on public.teacher_tasks to authenticated;

-- ---------------------------------------------------------------------------
-- updated_at, through the same trigger every other mutable table uses.
-- ---------------------------------------------------------------------------
create trigger set_updated_at before update on public.teacher_tasks
  for each row execute function app.set_updated_at();
