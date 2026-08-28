-- EduTrack Phase 1 — Step 11: public RPCs
--
-- Seven functions. Two are the ONLY surfaces `anon` may touch; because they
-- run as owner and bypass RLS, their return signatures ARE the access policy.
-- The rest exist because RLS alone cannot express the rule they enforce.
--
-- RATE LIMITING IS NOT IMPLEMENTED HERE, DELIBERATELY.
-- get_class_invite_preview and get_shared_report are both anonymous, so both
-- are enumerable at whatever rate the network allows. The database defends
-- with entropy — 10 symbols from a 30-character alphabet for an invite code
-- (~49 bits), 256 bits for a share token — and PRODUCTION MUST ADD REQUEST
-- RATE LIMITING AT THE EDGE / API LAYER in front of PostgREST. Phase 1 has no
-- invite-attempt table by decision; the counter would be a write amplifier on
-- an anonymous path and a denial-of-service lever of its own.

-- ===========================================================================
-- 0. generate_invite_code  (authenticated teachers)
--
-- Server-side generation so a code can never be human-chosen. Codes are the
-- only secret protecting the anonymous preview, and "IELTS2026" is not a
-- secret.
--
-- Alphabet is 30 symbols: digits 2-9 and A-Z minus I, L, O, U. The excluded
-- characters are the ones that get misread over Zalo or dictated over the
-- phone (1/I/L, 0/O) plus U, which keeps the generator from spelling words.
--
-- SECURITY INVOKER: it touches no table, so there is nothing to elevate.
-- ===========================================================================
create or replace function public.generate_invite_code(p_length integer default 10)
returns text
language plpgsql
security invoker
volatile
set search_path = ''
as $$
declare
  k_alphabet constant text    := '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  k_symbols  constant integer := 30;
  -- 240 is the largest multiple of 30 below 256. Bytes at or above it are
  -- discarded rather than folded, because 256 % 30 <> 0 would otherwise
  -- over-represent the first six symbols of the alphabet.
  k_ceiling  constant integer := 240;
  v_out  text := '';
  v_buf  bytea;
  v_byte integer;
  -- `i` is deliberately NOT declared: a FOR .. IN a .. b loop declares its own
  -- integer variable, and a matching declaration here would shadow it.
begin
  if p_length < 10 or p_length > 40 then
    raise exception 'invite code length must be between 10 and 40'
      using errcode = '22023';
  end if;

  while pg_catalog.length(v_out) < p_length loop
    v_buf := extensions.gen_random_bytes(p_length);
    for i in 0 .. pg_catalog.length(v_buf) - 1 loop
      exit when pg_catalog.length(v_out) >= p_length;
      v_byte := pg_catalog.get_byte(v_buf, i);
      if v_byte < k_ceiling then
        v_out := v_out
              || pg_catalog.substr(k_alphabet, (v_byte % k_symbols) + 1, 1);
      end if;
    end loop;
  end loop;

  return v_out;
end;
$$;

comment on function public.generate_invite_code(integer) is
  'CSPRNG invite code over a 30-symbol unambiguous alphabet. Teachers call this and insert the result into class_invite_codes; codes are never client-chosen.';

-- ===========================================================================
-- 1. get_class_invite_preview  (anon + authenticated)
--
-- Returns no identifiers: no class_id, no teacher_id, no member ids. A guessed
-- code yields two display names and nothing usable as a key elsewhere.
--
-- Invalid, expired, revoked, exhausted and archived all return ZERO ROWS,
-- identical in shape, so probing cannot distinguish "wrong" from "real but
-- closed".
--
-- STABLE and write-free: a read-only preview cannot burn a class's use_count.
-- ===========================================================================
create or replace function public.get_class_invite_preview(p_code text)
returns table (
  class_name    text,
  teacher_name  text,
  course_type   public.course_type,
  scoring_model public.scoring_model,
  target_band   numeric,
  start_date    date,
  end_date      date,
  schedule_note text
)
language sql
security definer
stable
set search_path = ''
as $$
  select c.name, t.full_name, c.course_type, c.scoring_model,
         c.target_band::numeric, c.start_date, c.end_date, c.schedule_note
    from public.class_invite_codes ic
    join public.classes  c on c.id = ic.class_id
    join public.profiles t on t.id = c.teacher_id
   where ic.code = upper(btrim(coalesce(p_code, '')))
     and ic.is_active
     and ic.revoked_at is null
     and (ic.expires_at is null or ic.expires_at > now())
     and (ic.max_uses is null or ic.use_count < ic.max_uses)
     and c.archived_at is null;
$$;

-- ===========================================================================
-- 2. join_class_with_code  (authenticated students)
--
-- The single write path into class_members for a student. They hold no INSERT
-- or UPDATE policy on that table at all.
--
-- The security control that matters: the caller's email is read from
-- auth.users INSIDE this function and is never a parameter. A user therefore
-- cannot present someone else's address to inherit their roster row, because
-- they never get to state an address. Email confirmation is required for the
-- same reason — without it an attacker could sign up with a victim's address
-- and claim their invitation first.
--
-- Multi-class safe: nothing here checks whether the caller already belongs to
-- some other class.
-- ===========================================================================
create or replace function public.join_class_with_code(p_code text)
returns table (class_member_id uuid, class_id uuid, class_name text)
language plpgsql
security definer
volatile
set search_path = ''
as $$
-- RETURNS TABLE makes class_member_id / class_id / class_name plpgsql
-- variables, which collide with real column names in the ON CONFLICT targets
-- below. Nothing here assigns to an OUT parameter — every value is carried in
-- a v_-prefixed local — so resolving ambiguity to the column is always right.
#variable_conflict use_column
declare
  v_uid       uuid := (select auth.uid());
  v_role      public.app_role;
  v_email     text;
  v_confirmed timestamptz;
  v_code_id   uuid;
  v_class_id  uuid;
  v_member_id uuid;
  v_removed   timestamptz;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  select p.role into v_role from public.profiles p where p.id = v_uid;
  if not found then
    raise exception 'profile not found' using errcode = '28000';
  end if;
  if v_role <> 'student' then
    raise exception 'only students can join a class' using errcode = '42501';
  end if;

  select lower(btrim(u.email)), u.email_confirmed_at
    into v_email, v_confirmed
    from auth.users u
   where u.id = v_uid;

  if v_email is null then
    raise exception 'account has no email address' using errcode = '42501';
  end if;
  if v_confirmed is null then
    raise exception 'email address must be confirmed before joining a class'
      using errcode = '42501';
  end if;

  select ic.id, ic.class_id
    into v_code_id, v_class_id
    from public.class_invite_codes ic
    join public.classes c on c.id = ic.class_id
   where ic.code = upper(btrim(coalesce(p_code, '')))
     and ic.is_active
     and ic.revoked_at is null
     and (ic.expires_at is null or ic.expires_at > now())
     and (ic.max_uses is null or ic.use_count < ic.max_uses)
     and c.archived_at is null
     for update of ic;

  if not found then
    raise exception 'invalid or expired invite code' using errcode = '22023';
  end if;

  -- Already a member? Idempotent: a double submit or two tabs produce one row.
  select m.id, m.removed_at
    into v_member_id, v_removed
    from public.class_members m
   where m.class_id = v_class_id
     and m.student_id = v_uid
     for update;

  if v_member_id is not null then
    -- Reactivate a soft-removed member. An existing joined_at is deliberately
    -- preserved so their existing lesson logs and attendance stay inside the
    -- counted range; the coalesce only fires on a row a teacher created with
    -- student_id set but joined_at empty, and keeps
    -- class_members_join_status_invariant satisfiable in that case.
    if v_removed is not null then
      update public.class_members m
         set removed_at  = null,
             join_status = 'joined',
             joined_at   = coalesce(m.joined_at, now())
       where m.id = v_member_id;
    end if;
  else
    -- Claim an invitation addressed to this VERIFIED email, if one exists.
    -- 'departed' rows are excluded twice over: they carry no invited_email,
    -- and the join_status filter names the only claimable state.
    select m.id into v_member_id
      from public.class_members m
     where m.class_id = v_class_id
       and m.join_status = 'invited'
       and m.student_id is null
       and m.invited_email = v_email
       and m.removed_at is null
       for update skip locked;

    if v_member_id is not null then
      update public.class_members m
         set student_id  = v_uid,
             joined_at   = now(),
             join_status = 'joined'
       where m.id = v_member_id;
    else
      -- No invitation: join by code alone. invited_email is left NULL so this
      -- row cannot collide with a pending invitation for the same address.
      insert into public.class_members
        (class_id, student_id, join_status, joined_at)
      values (v_class_id, v_uid, 'joined', now())
      on conflict (class_id, student_id) where student_id is not null
        do nothing
      returning id into v_member_id;

      if v_member_id is null then
        select m.id into v_member_id
          from public.class_members m
         where m.class_id = v_class_id and m.student_id = v_uid;
      end if;
    end if;

    update public.class_invite_codes ic
       set use_count = ic.use_count + 1
     where ic.id = v_code_id;
  end if;

  -- Backfill submissions for assignments already open in this class.
  insert into public.homework_submissions
    (assignment_id, class_member_id, class_id, status)
  select a.id, v_member_id, v_class_id, 'assigned'
    from public.homework_assignments a
   where a.class_id = v_class_id
  on conflict (assignment_id, class_member_id) do nothing;

  return query
    select v_member_id, c.id, c.name
      from public.classes c
     where c.id = v_class_id;
end;
$$;

-- ===========================================================================
-- 3. submit_homework  (authenticated students)
--
-- Exists solely because Supabase maps teachers and students to the same
-- `authenticated` Postgres role, so column-level GRANTs cannot give teachers
-- UPDATE on `score` while denying it to students. The student gets exactly
-- one verb and never touches score, graded_at or teacher_feedback.
-- ===========================================================================
create or replace function public.submit_homework(p_assignment_id uuid)
returns table (
  submission_id uuid,
  status        public.homework_status,
  submitted_at  timestamptz
)
language plpgsql
security definer
volatile
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_sub_id uuid;
  v_status public.homework_status;
  v_at     timestamptz;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  select s.id, s.status, s.submitted_at
    into v_sub_id, v_status, v_at
    from public.homework_submissions s
    join public.class_members m on m.id = s.class_member_id
   where s.assignment_id = p_assignment_id
     and m.student_id = v_uid
     and m.removed_at is null
     for update of s;

  if not found then
    raise exception 'no homework submission found for this assignment'
      using errcode = '42501';
  end if;

  if v_status = 'graded' then
    raise exception 'this homework has already been graded'
      using errcode = '42501';
  end if;

  if v_status = 'submitted' then
    return query select v_sub_id, v_status, v_at;
    return;
  end if;

  update public.homework_submissions s
     set status = 'submitted', submitted_at = now()
   where s.id = v_sub_id
   returning s.id, s.status, s.submitted_at
    into v_sub_id, v_status, v_at;

  return query select v_sub_id, v_status, v_at;
end;
$$;

-- ===========================================================================
-- 4. create_report_share_link  (authenticated teachers)
--
-- 32 CSPRNG bytes, base64url, returned exactly ONCE. Only the SHA-256 is
-- stored. Calling again rotates the token and invalidates the previous link.
--
-- No salt and no slow KDF: unlike a password the token carries full entropy,
-- so there is no dictionary to defend against and lookup must stay an
-- indexable exact match. This is the standard treatment for API keys.
-- ===========================================================================
create or replace function public.create_report_share_link(p_report_id uuid)
returns text
language plpgsql
security definer
volatile
set search_path = ''
as $$
declare
  v_status   public.report_status;
  v_class_id uuid;
  v_token    text;
begin
  select r.status, r.class_id into v_status, v_class_id
    from public.monthly_reports r
   where r.id = p_report_id;

  if not found then
    raise exception 'report not found' using errcode = '42501';
  end if;

  if not app.is_class_teacher(v_class_id) then
    raise exception 'not authorised for this report' using errcode = '42501';
  end if;

  if v_status <> 'published' then
    raise exception 'only a published report can be shared' using errcode = '42501';
  end if;

  v_token := rtrim(
    translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'),
    '='
  );

  update public.monthly_reports r
     set share_token_hash     = pg_catalog.sha256(pg_catalog.convert_to(v_token, 'UTF8')),
         shared_at            = now(),
         share_expires_at     = now() + interval '90 days',
         share_revoked_at     = null,
         share_view_count     = 0,
         share_last_viewed_at = null
   where r.id = p_report_id;

  return v_token;
end;
$$;

-- ===========================================================================
-- 5. revoke_report_share_link  (authenticated teachers)
-- ===========================================================================
create or replace function public.revoke_report_share_link(p_report_id uuid)
returns void
language plpgsql
security definer
volatile
set search_path = ''
as $$
declare
  v_class_id uuid;
begin
  select r.class_id into v_class_id
    from public.monthly_reports r where r.id = p_report_id;

  if not found then
    raise exception 'report not found' using errcode = '42501';
  end if;

  if not app.is_class_teacher(v_class_id) then
    raise exception 'not authorised for this report' using errcode = '42501';
  end if;

  update public.monthly_reports r
     set share_revoked_at = now()
   where r.id = p_report_id;
end;
$$;

-- ===========================================================================
-- 6. get_shared_report  (anon + authenticated)
--
-- Returns the frozen snapshot only, never live tables, and exactly one
-- report. VOLATILE because it increments the view counter, which is the
-- teacher's only evidence the parent opened the link.
--
-- Hash lookup is an exact match on a unique index rather than a constant-time
-- comparison; with 256 bits of entropy there is nothing to narrow by timing.
-- ===========================================================================
create or replace function public.get_shared_report(p_token text)
returns table (
  student_name     text,
  class_name       text,
  teacher_name     text,
  period_month     date,
  snapshot         jsonb,
  snapshot_version integer,
  published_at     timestamptz
)
language plpgsql
security definer
volatile
set search_path = ''
as $$
declare
  v_hash bytea;
  v_id   uuid;
begin
  if p_token is null or length(btrim(p_token)) not between 40 and 64 then
    return;
  end if;

  v_hash := pg_catalog.sha256(pg_catalog.convert_to(btrim(p_token), 'UTF8'));

  update public.monthly_reports r
     set share_view_count     = r.share_view_count + 1,
         share_last_viewed_at = now()
   where r.share_token_hash = v_hash
     and r.status = 'published'
     and r.share_revoked_at is null
     and (r.share_expires_at is null or r.share_expires_at > now())
   returning r.id into v_id;

  if v_id is null then
    return;
  end if;

  return query
    select coalesce(p.full_name, m.invited_name, 'Student'),
           c.name,
           t.full_name,
           r.period_month,
           r.snapshot,
           r.snapshot_version,
           r.published_at
      from public.monthly_reports r
      join public.class_members m on m.id = r.class_member_id
      join public.classes       c on c.id = r.class_id
      join public.profiles      t on t.id = c.teacher_id
      left join public.profiles p on p.id = m.student_id
     where r.id = v_id;
end;
$$;

-- ===========================================================================
-- Execute grants: deny by default, then hand out exactly what is intended.
--
-- `revoke ... from public` on its own is NOT enough here. Supabase ships
-- `alter default privileges in schema public grant all on functions to anon,
-- authenticated, service_role`, so every function created in this schema
-- arrives with an EXPLICIT anon grant that a PUBLIC revoke does not touch.
-- anon must therefore be named. Step 12 removes the default privilege itself
-- so future functions do not inherit the same surprise.
-- ===========================================================================
revoke execute on function public.get_class_invite_preview(text)  from public;
revoke execute on function public.join_class_with_code(text)      from public, anon;
revoke execute on function public.submit_homework(uuid)           from public, anon;
revoke execute on function public.create_report_share_link(uuid)  from public, anon;
revoke execute on function public.revoke_report_share_link(uuid)  from public, anon;
revoke execute on function public.get_shared_report(text)         from public;
revoke execute on function public.generate_invite_code(integer)   from public, anon;

-- The two intended public surfaces.
grant execute on function public.get_class_invite_preview(text) to anon, authenticated;
grant execute on function public.get_shared_report(text)        to anon, authenticated;

-- Authenticated-only.
grant execute on function public.join_class_with_code(text)     to authenticated;
grant execute on function public.submit_homework(uuid)          to authenticated;
grant execute on function public.create_report_share_link(uuid) to authenticated;
grant execute on function public.revoke_report_share_link(uuid) to authenticated;
grant execute on function public.generate_invite_code(integer)  to authenticated;
