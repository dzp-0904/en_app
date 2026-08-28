-- EduTrack Phase 1 — Step 6a: trigger functions
--
-- All live in the private `app` schema. Every one pins `search_path = ''`, so
-- every reference inside is schema-qualified.

-- ---------------------------------------------------------------------------
-- Generic updated_at maintenance.
-- ---------------------------------------------------------------------------
create or replace function app.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Create the profile row for a new auth user.
--
-- Every public signup becomes a STUDENT. raw_user_meta_data is client-supplied
-- — it is whatever the browser passed to supabase.auth.signUp — so reading a
-- role out of it would let anyone mint a teacher account by editing a JSON
-- literal. Combined with the immutability trigger below that mistake would be
-- permanent.
--
-- Teachers are provisioned afterwards by app.provision_teacher(), which is
-- executable by service_role only. There is deliberately no client-callable
-- path from student to teacher.
--
-- full_name is still taken from metadata: it is display text the user owns and
-- can change afterwards, and it carries no privilege.
-- ---------------------------------------------------------------------------
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name  text;
  v_email text;
begin
  -- Phase 1 is email/password + Google only; phone-only signups have no email
  -- and get no profile rather than a fabricated one.
  if new.email is null then
    return new;
  end if;

  v_email := lower(btrim(new.email));

  v_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
    split_part(v_email, '@', 1)
  );

  -- role is hard-coded, not derived. teaching_type is therefore NULL here by
  -- construction: profiles_teaching_type_teacher_only forbids it on a student.
  insert into public.profiles (id, role, full_name, email, teaching_type)
  values (new.id, 'student', left(v_name, 120), v_email, null)
  on conflict (id) do nothing;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Keep profiles.email in step with auth.users.email.
-- ---------------------------------------------------------------------------
create or replace function app.handle_user_email_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is not null and new.email is distinct from old.email then
    update public.profiles
       set email = lower(btrim(new.email))
     where id = new.id;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles.role is immutable through every client path.
--
-- Three independent layers stop a student promoting themselves: the column
-- grant in step 12 (UPDATE only on full_name and teaching_type), the absence
-- of any role field in signup handling above, and this trigger.
--
-- The single exception is app.provision_teacher(), which raises the
-- `app.allow_role_change` flag for the duration of one statement. A client
-- cannot raise it: PostgREST issues no SET, and the flag is checked here
-- rather than trusted anywhere else.
-- ---------------------------------------------------------------------------
create or replace function app.enforce_profile_role_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role is distinct from old.role
     and coalesce(current_setting('app.allow_role_change', true), '') <> 'on'
  then
    raise exception 'profiles.role is immutable (attempted % -> %)', old.role, new.role
      using errcode = 'check_violation';
  end if;
  if new.id is distinct from old.id then
    raise exception 'profiles.id is immutable' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Account deletion.
--
-- EduTrack exists to preserve a teacher's record of a student's progress, so
-- deleting an identity must not delete the history that identity generated.
--
--   STUDENT  the auth user goes; every class_members row they held is
--            anonymised in place (join_status = 'departed', identifiers
--            cleared, joined_at and removed_at preserved) so scores, lesson
--            logs, attendance, homework, tuition and reports all keep their
--            parent row and stay inside the counted date range. Any live
--            parent-report share link is revoked, because the frozen snapshot
--            behind it still carries the student's name.
--
--   TEACHER  refused outright. A teacher owns classes, and Phase 1 has no
--            ownership transfer, so deleting one would either orphan or
--            destroy every record in their tenant. Offboarding is
--            app.set_account_active(id, false).
--
-- BEFORE DELETE, so the anonymisation lands before the FK actions run and
-- class_members.student_id already reads NULL by the time RI checks it.
-- ---------------------------------------------------------------------------
create or replace function app.handle_profile_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_classes bigint;
begin
  if old.role = 'teacher' then
    select count(*) into v_classes
      from public.classes c
     where c.teacher_id = old.id;

    if v_classes > 0 then
      raise exception
        'teacher % owns % class(es) and cannot be deleted; deactivate the account instead (app.set_account_active)',
        old.id, v_classes
        using errcode = 'restrict_violation';
    end if;

    return old;
  end if;

  -- Kill parent-facing links first: the published snapshot is immutable by
  -- design and still names the student, so revocation is the only lever.
  update public.monthly_reports r
     set share_revoked_at = now()
    from public.class_members m
   where m.id = r.class_member_id
     and m.student_id = old.id
     and r.share_revoked_at is null;

  update public.class_members m
     set join_status   = 'departed',
         student_id    = null,
         invited_email = null,
         invited_name  = null,
         removed_at    = coalesce(m.removed_at, now())
   where m.student_id = old.id;

  return old;
end;
$$;

-- ---------------------------------------------------------------------------
-- Deleting a member or a whole class revokes the parent links underneath it
-- before the cascade reaches monthly_reports, so the delete guard below sees
-- an already-dead link rather than blocking a legitimate cascade.
-- ---------------------------------------------------------------------------
create or replace function app.revoke_member_share_links()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.monthly_reports r
     set share_revoked_at = now()
   where r.class_member_id = old.id
     and r.share_revoked_at is null;
  return old;
end;
$$;

create or replace function app.revoke_class_share_links()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.monthly_reports r
     set share_revoked_at = now()
   where r.class_id = old.id
     and r.share_revoked_at is null;
  return old;
end;
$$;

-- ---------------------------------------------------------------------------
-- A published report with a live share link cannot be deleted out from under
-- the parent holding it. Revoke the link first, or delete the member or class,
-- both of which revoke on the way down.
-- ---------------------------------------------------------------------------
create or replace function app.enforce_report_delete_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'published'
     and old.share_token_hash is not null
     and old.share_revoked_at is null
     and (old.share_expires_at is null or old.share_expires_at > now())
  then
    raise exception
      'monthly_reports row % has a live share link; revoke it before deleting', old.id
      using errcode = 'restrict_violation';
  end if;
  return old;
end;
$$;

-- ---------------------------------------------------------------------------
-- A published report is frozen. Share columns stay mutable so revocation and
-- view counting keep working after publication.
-- ---------------------------------------------------------------------------
create or replace function app.enforce_report_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'published' then
    if new.snapshot         is distinct from old.snapshot
    or new.snapshot_version is distinct from old.snapshot_version
    or new.period_month     is distinct from old.period_month
    or new.class_member_id  is distinct from old.class_member_id
    or new.teacher_comment  is distinct from old.teacher_comment
    then
      raise exception
        'monthly_reports row % is published and its snapshot is immutable', old.id
        using errcode = 'check_violation';
    end if;

    if new.status <> 'published' then
      raise exception 'a published report cannot return to draft'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- score_entries is append-only.
--
-- The band history is the product's central claim, so it must not be
-- rewritable in place. UPDATE is refused here and is not granted in step 12
-- either. DELETE stays available: a teacher who typed 6.0 for 6.5 deletes the
-- row and enters a new one, and — more importantly — ON DELETE CASCADE from
-- class_members and classes has to keep working.
-- ---------------------------------------------------------------------------
create or replace function app.enforce_score_entry_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception
    'score_entries is append-only; delete the row and record a new entry instead'
    using errcode = 'check_violation';
end;
$$;

-- ---------------------------------------------------------------------------
-- score <= assignment.max_score. A cross-table comparison, so it cannot be a
-- CHECK constraint.
--
-- SECURITY INVOKER: only a teacher writes a score, and a teacher can already
-- read their own assignment under RLS. Running as the caller means this
-- trigger can never widen what the statement could otherwise see.
-- ---------------------------------------------------------------------------
create or replace function app.enforce_homework_score_max()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_max numeric(4, 1);
begin
  if new.score is null then
    return new;
  end if;

  select a.max_score into v_max
    from public.homework_assignments a
   where a.id = new.assignment_id;

  if v_max is not null and new.score > v_max then
    raise exception 'homework score % exceeds the assignment maximum of %',
      new.score, v_max
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Creating an assignment fans out one submission row per active member, so
-- "not yet done" is a real row rather than an absence. Without this the
-- completion percentage would need an outer join against the roster and would
-- miscount removed students.
-- ---------------------------------------------------------------------------
create or replace function app.fan_out_homework_submissions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.homework_submissions
    (assignment_id, class_member_id, class_id, status)
  select new.id, m.id, new.class_id, 'assigned'
    from public.class_members m
   where m.class_id = new.class_id
     and m.join_status = 'joined'
     and m.removed_at is null
  on conflict (assignment_id, class_member_id) do nothing;

  return new;
end;
$$;
