-- EduTrack Phase 1 — Step 3c: homework, monthly reports, tuition

-- ---------------------------------------------------------------------------
-- homework_assignments : class level.
-- ---------------------------------------------------------------------------
create table public.homework_assignments (
  id          uuid primary key default gen_random_uuid(),
  class_id    uuid not null references public.classes (id) on delete cascade,
  session_id  uuid,
  title       text not null,
  description text,
  skill       public.skill not null,
  assigned_on date not null default current_date,
  due_date    date,
  max_score   numeric(4, 1) not null default 10,
  created_by  uuid not null references public.profiles (id) on delete restrict,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- ON DELETE SET NULL (session_id), not a bare SET NULL: the bare form nulls
  -- every referencing column including the NOT NULL class_id, which would make
  -- deleting a session that carried homework fail with 23502. See the matching
  -- note on lesson_logs_session_fk.
  constraint homework_assignments_session_fk
    foreign key (session_id, class_id)
    references public.class_sessions (id, class_id) on delete set null (session_id),

  constraint homework_assignments_title_length
    check (length(btrim(title)) between 1 and 300),

  constraint homework_assignments_due_after_assigned
    check (due_date is null or due_date >= assigned_on),

  constraint homework_assignments_max_score_positive check (max_score > 0),

  -- Parent key for homework_submissions' composite FK.
  constraint homework_assignments_id_class_id_key unique (id, class_id)
);

-- ---------------------------------------------------------------------------
-- homework_submissions : one row per member per assignment.
-- Students may move assigned/missed -> submitted (via RPC only).
-- Teachers grade.
-- ---------------------------------------------------------------------------
create table public.homework_submissions (
  id               uuid primary key default gen_random_uuid(),
  assignment_id    uuid not null,
  class_member_id  uuid not null,
  class_id         uuid not null,
  status           public.homework_status not null default 'assigned',
  submitted_at     timestamptz,
  score            numeric(4, 1),
  graded_at        timestamptz,
  teacher_feedback text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint homework_submissions_assignment_fk
    foreign key (assignment_id, class_id)
    references public.homework_assignments (id, class_id) on delete cascade,

  constraint homework_submissions_member_fk
    foreign key (class_member_id, class_id)
    references public.class_members (id, class_id) on delete cascade,

  constraint homework_submissions_assignment_member_key
    unique (assignment_id, class_member_id),

  constraint homework_submissions_score_non_negative
    check (score is null or score >= 0),

  -- Exhaustive state invariant. Every value of homework_status has a branch,
  -- and status is NOT NULL, so this CASE can never evaluate to NULL — which
  -- matters because a CHECK constraint PASSES on NULL. If a fifth value is
  -- ever added to homework_status, this constraint must be extended in the
  -- same migration or it silently stops enforcing anything for that value.
  --
  --   assigned  : submitted_at NULL     score NULL     graded_at NULL
  --   submitted : submitted_at NOT NULL score NULL     graded_at NULL
  --   graded    : submitted_at NOT NULL score NOT NULL graded_at NOT NULL
  --   missed    : submitted_at NULL     score NULL     graded_at NULL
  --
  -- 'assigned' and 'missed' are column-identical by design; only the enum
  -- value distinguishes them, and only the overdue job sets 'missed'.
  constraint homework_submissions_status_invariant check (
    case status
      when 'assigned'  then submitted_at is null
                        and score is null
                        and graded_at is null
      when 'submitted' then submitted_at is not null
                        and score is null
                        and graded_at is null
      when 'graded'    then submitted_at is not null
                        and score is not null
                        and graded_at is not null
      when 'missed'    then submitted_at is null
                        and score is null
                        and graded_at is null
    end
  )
);

comment on constraint homework_submissions_status_invariant
  on public.homework_submissions is
  'Exhaustive per-status nullability invariant. Extend this CASE whenever homework_status gains a value.';
comment on column public.homework_submissions.teacher_feedback is
  'Intentionally unconstrained by the status invariant: qualitative feedback without a numeric score lives on a submitted (not graded) row.';

-- ---------------------------------------------------------------------------
-- monthly_reports : immutable published snapshots + hashed share tokens.
-- ---------------------------------------------------------------------------
create table public.monthly_reports (
  id                   uuid primary key default gen_random_uuid(),
  class_member_id      uuid not null,
  class_id             uuid not null,
  period_month         date not null,
  snapshot             jsonb not null,
  snapshot_version     integer not null default 1,
  teacher_comment      text,
  status               public.report_status not null default 'draft',
  published_at         timestamptz,
  share_token_hash     bytea,
  shared_at            timestamptz,
  share_expires_at     timestamptz,
  share_revoked_at     timestamptz,
  share_view_count     integer not null default 0,
  share_last_viewed_at timestamptz,
  generated_by         uuid not null references public.profiles (id) on delete restrict,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint monthly_reports_member_fk
    foreign key (class_member_id, class_id)
    references public.class_members (id, class_id) on delete cascade,

  constraint monthly_reports_period_is_first_of_month
    check (extract(day from period_month) = 1),

  constraint monthly_reports_published_invariant
    check ((status = 'published') = (published_at is not null)),

  constraint monthly_reports_snapshot_version_positive
    check (snapshot_version > 0),

  constraint monthly_reports_view_count_non_negative
    check (share_view_count >= 0),

  constraint monthly_reports_member_period_key
    unique (class_member_id, period_month)
);

create unique index monthly_reports_share_token_hash_key
  on public.monthly_reports (share_token_hash)
  where share_token_hash is not null;

comment on table public.monthly_reports is
  'Parent-facing monthly report. Once published the snapshot is frozen by a trigger: a report about August must not change when September scores arrive.';
comment on column public.monthly_reports.share_token_hash is
  'SHA-256 of the share token. The plaintext is returned once at creation and never stored.';

-- ---------------------------------------------------------------------------
-- tuition_records : teacher-only ledger. Students never see these rows.
-- ---------------------------------------------------------------------------
create table public.tuition_records (
  id                uuid primary key default gen_random_uuid(),
  class_member_id   uuid not null,
  class_id          uuid not null,
  period_month      date not null,
  sessions_attended integer not null default 0,
  sessions_billed   integer not null default 0,
  rate_per_session  bigint not null,
  currency          char(3) not null default 'VND',
  discount_amount   bigint not null default 0,
  amount_total      bigint generated always as
                      (sessions_billed * rate_per_session - discount_amount) stored,
  status            public.payment_status not null default 'pending',
  paid_at           timestamptz,
  payment_method    text,
  payment_note      text,
  reminder_sent_at  timestamptz,
  reminder_count    integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint tuition_records_member_fk
    foreign key (class_member_id, class_id)
    references public.class_members (id, class_id) on delete cascade,

  constraint tuition_records_period_is_first_of_month
    check (extract(day from period_month) = 1),

  constraint tuition_records_sessions_non_negative
    check (sessions_attended >= 0 and sessions_billed >= 0),

  constraint tuition_records_rate_non_negative check (rate_per_session >= 0),
  constraint tuition_records_discount_non_negative check (discount_amount >= 0),

  -- A discount larger than the billed total would otherwise produce an invoice
  -- that owes the student money.
  constraint tuition_records_amount_total_non_negative check (amount_total >= 0),
  constraint tuition_records_reminder_count_non_negative check (reminder_count >= 0),

  constraint tuition_records_paid_invariant
    check ((status = 'paid') = (paid_at is not null)),

  constraint tuition_records_member_period_key
    unique (class_member_id, period_month)
);

comment on column public.tuition_records.rate_per_session is
  'Whole VND, snapshotted at generation from COALESCE(member override, class default). Later rate changes must not rewrite closed months.';
comment on column public.tuition_records.amount_total is
  'Generated from the stored rate, so the ledger can never disagree with its own inputs.';
