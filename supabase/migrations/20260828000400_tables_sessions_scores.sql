-- EduTrack Phase 1 — Step 3b: sessions, attendance, scores, lesson logs, tags

-- ---------------------------------------------------------------------------
-- class_sessions : real datetimes, materialised from the schedule pattern.
-- ---------------------------------------------------------------------------
create table public.class_sessions (
  id               uuid primary key default gen_random_uuid(),
  class_id         uuid not null references public.classes (id) on delete cascade,
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  title            text,
  location         text,
  status           public.session_status not null default 'scheduled',
  cancelled_reason text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint class_sessions_ends_after_starts check (ends_at > starts_at),

  -- Makes schedule regeneration idempotent.
  constraint class_sessions_class_starts_key unique (class_id, starts_at),

  -- Parent key for lesson_logs.session_id and session_attendance.session_id.
  constraint class_sessions_id_class_id_key unique (id, class_id)
);

comment on table public.class_sessions is
  'Materialised sessions. Authoritative over classes.schedule_note for calendar, attendance and tuition.';

-- ---------------------------------------------------------------------------
-- session_attendance : attendance is independent of whether a lesson log
-- was ever written. One fact per (session, member).
-- ---------------------------------------------------------------------------
create table public.session_attendance (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null,
  class_member_id uuid not null,
  class_id        uuid not null,
  status          public.attendance_status not null,
  note            text,
  recorded_by     uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint session_attendance_session_fk
    foreign key (session_id, class_id)
    references public.class_sessions (id, class_id) on delete cascade,

  constraint session_attendance_member_fk
    foreign key (class_member_id, class_id)
    references public.class_members (id, class_id) on delete cascade,

  -- One attendance fact per student per session; makes roster marking an upsert.
  constraint session_attendance_session_member_key unique (session_id, class_member_id)
);

comment on table public.session_attendance is
  'Attendance decoupled from lesson_logs. Both composite FKs share class_id, so a member of one class cannot be marked at another class''s session.';

-- ---------------------------------------------------------------------------
-- score_entries : append-only IELTS band history. Nothing is overwritten.
-- ---------------------------------------------------------------------------
create table public.score_entries (
  id              uuid primary key default gen_random_uuid(),
  class_member_id uuid not null,
  class_id        uuid not null,
  recorded_on     date not null,
  entry_type      public.score_entry_type not null default 'progress',
  overall         public.band,
  reading         public.band,
  listening       public.band,
  writing         public.band,
  speaking        public.band,
  note            text,
  -- RESTRICT is explicit rather than the NO ACTION default: a teacher who has
  -- recorded a band cannot be hard-deleted. Teacher offboarding is
  -- deactivation (profiles.deactivated_at), never deletion — see
  -- app.set_account_active.
  created_by      uuid not null references public.profiles (id) on delete restrict,
  created_at      timestamptz not null default now(),

  constraint score_entries_member_fk
    foreign key (class_member_id, class_id)
    references public.class_members (id, class_id) on delete cascade,

  -- Reject entries that record nothing at all.
  constraint score_entries_not_empty
    check (num_nonnulls(overall, reading, listening, writing, speaking) > 0)
);

-- Exactly one starting band per enrolment.
create unique index score_entries_one_baseline_per_member
  on public.score_entries (class_member_id)
  where entry_type = 'baseline';

comment on table public.score_entries is
  'Append-only band history, enforced: no UPDATE grant and a blocking trigger (app.enforce_score_entry_append_only). A wrong entry is deleted and re-entered, which leaves the history honest instead of silently rewritten. "Current band" is the latest row; "starting band" is the baseline row. Neither is stored on class_members.';
comment on column public.score_entries.overall is
  'Stored, not generated. The app suggests the IELTS-rounded average of the four skills; a teacher may overwrite it with an official result.';

-- ---------------------------------------------------------------------------
-- lesson_logs : narrative only. No attendance, no homework columns.
-- ---------------------------------------------------------------------------
create table public.lesson_logs (
  id              uuid primary key default gen_random_uuid(),
  class_id        uuid not null references public.classes (id) on delete cascade,
  class_member_id uuid not null,
  session_id      uuid,
  lesson_date     date not null,
  skill           public.skill not null,
  topic           text not null,
  performance     public.performance not null,
  mistakes        text[] not null default '{}',
  note            text,
  created_by      uuid not null references public.profiles (id) on delete restrict,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint lesson_logs_member_fk
    foreign key (class_member_id, class_id)
    references public.class_members (id, class_id) on delete cascade,

  -- The column list is load-bearing. A bare ON DELETE SET NULL on a composite
  -- FK nulls EVERY referencing column, including class_id — which is NOT NULL,
  -- so deleting a session that had any lesson log would fail with 23502. The
  -- (session_id) form detaches the log from the session and preserves its
  -- tenancy. Requires PostgreSQL 15+; this project targets 17.
  constraint lesson_logs_session_fk
    foreign key (session_id, class_id)
    references public.class_sessions (id, class_id) on delete set null (session_id),

  constraint lesson_logs_topic_length check (length(btrim(topic)) between 1 and 300)
);

comment on table public.lesson_logs is
  'Post-lesson narrative note. Attendance lives in session_attendance; homework lives in the homework tables.';
comment on column public.lesson_logs.mistakes is
  'Mistake labels copied by value, not FKs. Renaming a tag must never rewrite historical observations.';

-- ---------------------------------------------------------------------------
-- mistake_tags : vocabulary for the lesson-note chip picker.
-- ---------------------------------------------------------------------------
create table public.mistake_tags (
  id         uuid primary key default gen_random_uuid(),
  teacher_id uuid references public.profiles (id) on delete cascade,
  skill      public.skill,
  label      text not null,
  created_at timestamptz not null default now(),

  constraint mistake_tags_label_length check (length(btrim(label)) between 1 and 80)
);

-- Case-insensitive uniqueness, split by ownership.
create unique index mistake_tags_global_label_key
  on public.mistake_tags (lower(label))
  where teacher_id is null;

create unique index mistake_tags_teacher_label_key
  on public.mistake_tags (teacher_id, lower(label))
  where teacher_id is not null;

comment on table public.mistake_tags is
  'Chip vocabulary only. teacher_id IS NULL means a global seed tag. lesson_logs stores labels by value, not references to this table.';
