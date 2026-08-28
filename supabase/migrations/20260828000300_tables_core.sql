-- EduTrack Phase 1 — Step 3a: core tables
-- profiles -> classes -> class_invite_codes / class_members
--
-- Composite unique keys (id, class_id) etc. are declared here, before any
-- composite FK references them in step 3b/3c.

-- ---------------------------------------------------------------------------
-- profiles : identity, 1:1 with auth.users
-- ---------------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  role          public.app_role not null,
  full_name     text not null,
  email         text not null,
  teaching_type text,
  -- Teacher accounts are deactivated, never hard-deleted: their classes,
  -- lesson logs, scores and reports are the product's record of value, and
  -- Phase 1 has no ownership-transfer flow. Set only by app.set_account_active,
  -- which is executable by service_role alone.
  deactivated_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint profiles_full_name_length
    check (length(btrim(full_name)) between 1 and 120),

  -- Emails are stored pre-normalised so a plain unique index is case-insensitive.
  constraint profiles_email_normalised
    check (email = lower(btrim(email)) and length(email) > 0),

  -- Students never carry a teaching type.
  constraint profiles_teaching_type_teacher_only
    check (role = 'teacher' or teaching_type is null)
);

create unique index profiles_email_key on public.profiles (email);

comment on table public.profiles is
  'User identity. Rows are created by the handle_new_user trigger on auth.users, never by clients.';
comment on column public.profiles.email is
  'Mirrored from auth.users, lower-cased. Used for roster display and invitation matching.';

-- ---------------------------------------------------------------------------
-- classes : the tenancy root. Every RLS policy resolves to classes.teacher_id.
-- ---------------------------------------------------------------------------
create table public.classes (
  id                uuid primary key default gen_random_uuid(),
  teacher_id        uuid not null references public.profiles (id) on delete restrict,
  name              text not null,
  course_type       public.course_type not null,
  course_type_other text,
  scoring_model     public.scoring_model not null default 'ielts_band',
  target_band       public.band,
  description       text,
  start_date        date not null,
  end_date          date,
  schedule_note     text,
  timezone          text not null default 'Asia/Ho_Chi_Minh',
  default_tuition_rate_per_session bigint,
  archived_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint classes_name_length check (length(btrim(name)) between 1 and 200),

  constraint classes_course_type_other_required
    check ((course_type = 'other') = (course_type_other is not null)),

  constraint classes_end_after_start
    check (end_date is null or end_date >= start_date),

  -- A class that does not score cannot carry a band target.
  constraint classes_no_target_band_when_unscored
    check (scoring_model <> 'none' or target_band is null),

  constraint classes_default_rate_non_negative
    check (default_tuition_rate_per_session is null
           or default_tuition_rate_per_session >= 0),

  -- Parent key for composite FKs that carry a denormalised teacher_id.
  constraint classes_id_teacher_id_key unique (id, teacher_id)
);

comment on table public.classes is
  'Tenancy root. A class is owned by exactly one teacher; all access derives from teacher_id.';
comment on column public.classes.schedule_note is
  'Human-readable schedule string for display only. class_sessions is authoritative.';
comment on column public.classes.default_tuition_rate_per_session is
  'Whole VND. Overridden per student by class_members.tuition_rate_per_session.';

-- ---------------------------------------------------------------------------
-- class_invite_codes : separate table so students can never read a code.
-- ---------------------------------------------------------------------------
create table public.class_invite_codes (
  id         uuid primary key default gen_random_uuid(),
  class_id   uuid not null references public.classes (id) on delete cascade,
  code       text not null,
  is_active  boolean not null default true,
  expires_at timestamptz default (now() + interval '30 days'),
  max_uses   integer,
  use_count  integer not null default 0,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),

  -- Codes are stored upper-cased so the unique index is case-insensitive.
  --
  -- The 10-character floor is a security parameter, not formatting. The preview
  -- RPC is anonymous and unauthenticated by design, so the code itself is the
  -- only secret; 10 characters of app.generate_invite_code's 30-symbol
  -- alphabet is ~49 bits. Production rate limiting is enforced at the edge /
  -- API layer, not here — see 20260828001300_rpcs.sql.
  constraint class_invite_codes_normalised
    check (code = upper(btrim(code)) and length(code) between 10 and 40),

  constraint class_invite_codes_max_uses_positive
    check (max_uses is null or max_uses > 0),

  constraint class_invite_codes_use_count_non_negative
    check (use_count >= 0)
);

create unique index class_invite_codes_code_key on public.class_invite_codes (code);

comment on table public.class_invite_codes is
  'Invite codes live apart from classes because students can read their class row but must never read its code.';

-- ---------------------------------------------------------------------------
-- class_members : the pivot. Invitation, enrolment and per-class student
-- record in one row. A student may hold many rows across many classes.
-- ---------------------------------------------------------------------------
create table public.class_members (
  id            uuid primary key default gen_random_uuid(),
  class_id      uuid not null references public.classes (id) on delete cascade,
  student_id    uuid references public.profiles (id) on delete set null,
  invited_email text,
  invited_name  text,
  join_status   public.join_status not null default 'invited',
  invited_at    timestamptz,
  invite_email_sent_at  timestamptz,
  invite_reminder_count integer not null default 0,
  joined_at     timestamptz,
  removed_at    timestamptz,
  target_band   public.band,
  strengths     text[] not null default '{}',
  focus_areas   text[] not null default '{}',
  tuition_rate_per_session bigint,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- A row must identify somebody: a claimed account or an invited address.
  -- A 'departed' row is the sole exception — it identifies nobody on purpose,
  -- because the person it described deleted their account.
  constraint class_members_identifies_someone
    check (join_status = 'departed'
           or student_id is not null
           or invited_email is not null),

  constraint class_members_invited_email_normalised
    check (invited_email is null
           or (invited_email = lower(btrim(invited_email)) and length(invited_email) > 0)),

  -- Exhaustive over join_status, which is NOT NULL, so this CASE can never
  -- evaluate to NULL — which matters because a CHECK constraint PASSES on NULL.
  -- Extend it in the same migration if join_status ever gains a value.
  --
  --   invited  : unclaimed invitation, identified by invited_email alone
  --   joined    : claimed, student_id and joined_at both present
  --   departed  : identity deleted. student_id and both direct identifiers are
  --               cleared; joined_at and removed_at are PRESERVED so the
  --               attendance denominator and every child row stay in range.
  constraint class_members_join_status_invariant check (
    case join_status
      when 'invited'  then student_id is null
                       and joined_at  is null
      when 'joined'   then student_id is not null
                       and joined_at  is not null
      when 'departed' then student_id    is null
                       and invited_email is null
                       and invited_name  is null
                       and joined_at     is not null
                       and removed_at    is not null
    end
  ),

  constraint class_members_reminder_count_non_negative
    check (invite_reminder_count >= 0),

  constraint class_members_rate_non_negative
    check (tuition_rate_per_session is null or tuition_rate_per_session >= 0),

  constraint class_members_removed_after_joined
    check (removed_at is null or joined_at is null or removed_at >= joined_at),

  -- Parent key for every child table's composite FK. This is what makes the
  -- denormalised class_id on children impossible to falsify.
  constraint class_members_id_class_id_key unique (id, class_id)
);

-- Scoped to the class, so a student joining a SECOND class is unconstrained
-- while double-joining one class is a no-op.
create unique index class_members_class_student_key
  on public.class_members (class_id, student_id)
  where student_id is not null;

create unique index class_members_class_invited_email_key
  on public.class_members (class_id, invited_email)
  where invited_email is not null and removed_at is null;

comment on table public.class_members is
  'Invitation + enrolment + per-class student record. student_id is NULL until the invitation is claimed, and again after the account is deleted (join_status = departed).';
comment on column public.class_members.join_status is
  'invited -> joined -> departed. departed is the account-deletion tombstone written by app.anonymise_departed_student; it keeps the teacher''s history while erasing the identity.';
comment on column public.class_members.focus_areas is
  'Teacher-curated current focus. Phase 1 stores current state only; no monthly history.';
