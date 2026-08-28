-- EduTrack Phase 1 — Step 10: derived views
--
-- Every view is declared WITH (security_invoker = on). Without it a view runs
-- with its OWNER's privileges and silently bypasses RLS, which would hand
-- every student's attendance and bands to every caller.

-- ---------------------------------------------------------------------------
-- v_member_session_attendance
--
-- One row per (member, countable session). This is the authoritative Phase 1
-- attendance definition, expressed at session grain so every consumer can
-- window it differently from one source:
--   student dashboard / roster -> no date filter (lifetime)
--   monthly report snapshot    -> filtered to period_month
--   tuition sessions_attended  -> filtered to period_month
--
-- A session is countable for a member when:
--   1. it belongs to the member's class
--   2. it is not cancelled
--   3. it has already started (starts_at <= now())
--   4. it starts on or after the member joined
--   5. it starts on or before the member was removed (if they were)
--   6. the member does not have an 'excused' mark for it
--
-- Conditions 3-5 are what make the rule behave. Without 3 a January-June
-- class shows ~20% attendance in February, because May's sessions are
-- scheduled but obviously unattended. Without 4 a student joining in month
-- three inherits an unrecoverable deficit. Without 5 a removed student
-- accrues absences forever.
--
-- Contribution table:
--   present  numerator +1  denominator +1
--   late     numerator +1  denominator +1
--   absent   numerator +0  denominator +1
--   excused  numerator +0  denominator +0   (row excluded entirely)
--   unmarked numerator +0  denominator +1   (gaps count against, by design:
--                                            it makes missing records visible)
-- ---------------------------------------------------------------------------
create view public.v_member_session_attendance
with (security_invoker = on) as
select
  m.id                                as class_member_id,
  m.class_id                          as class_id,
  s.id                                as session_id,
  s.starts_at                         as starts_at,
  a.status                            as attendance_status,
  true                                as counts_in_denominator,
  coalesce(a.status in ('present', 'late'), false) as counts_in_numerator
from public.class_members m
join public.class_sessions s
  on s.class_id = m.class_id
left join public.session_attendance a
  on a.session_id = s.id
 and a.class_member_id = m.id
where m.joined_at is not null
  and s.status <> 'cancelled'
  and s.starts_at <= now()
  and s.starts_at >= m.joined_at
  and (m.removed_at is null or s.starts_at <= m.removed_at)
  and (a.status is null or a.status <> 'excused');

comment on view public.v_member_session_attendance is
  'Authoritative Phase 1 attendance grain: one row per countable (member, session). Excused sessions are excluded from both numerator and denominator.';

-- ---------------------------------------------------------------------------
-- v_member_attendance_summary
--
-- Built from class_members with a LATERAL so that every member appears even
-- when they have zero countable sessions. A zero denominator yields NULL, not
-- 0% — a student who joined yesterday has no attendance record, not a perfect
-- absence record.
-- ---------------------------------------------------------------------------
create view public.v_member_attendance_summary
with (security_invoker = on) as
select
  m.id                                   as class_member_id,
  m.class_id                             as class_id,
  coalesce(x.sessions_counted, 0)        as sessions_counted,
  coalesce(x.sessions_attended, 0)       as sessions_attended,
  case
    when coalesce(x.sessions_counted, 0) = 0 then null
    else round(100.0 * x.sessions_attended / x.sessions_counted)
  end                                    as attendance_pct
from public.class_members m
left join lateral (
  select
    count(*)                                          as sessions_counted,
    count(*) filter (where v.counts_in_numerator)     as sessions_attended
  from public.v_member_session_attendance v
  where v.class_member_id = m.id
) x on true;

comment on view public.v_member_attendance_summary is
  'Lifetime attendance per member. attendance_pct is NULL (never 0) when no session has yet counted.';

-- ---------------------------------------------------------------------------
-- v_member_performance_status
--
-- Phase 1 derivation of improving | stable | needs_attention. Never stored.
--
--   scoring_model = 'none'          -> stable
--   fewer than 2 comparable entries -> stable
--   latest > previous               -> improving
--   latest < previous               -> needs_attention
--   otherwise                       -> stable
--
-- "Comparable" means score_entries with a non-null overall. The filter is
-- applied BEFORE ordering, not after: given Mar overall 6.0, Apr overall NULL
-- (skills only), May overall 6.5, this compares May to Mar and returns
-- 'improving'. Taking the two most recent rows and then checking for NULL
-- would instead hit April's NULL and fall back to 'stable'.
--
-- All entry_types participate. No attendance or homework thresholds enter
-- this calculation, and there is no magnitude or recency bound.
-- ---------------------------------------------------------------------------
create view public.v_member_performance_status
with (security_invoker = on) as
select
  m.id       as class_member_id,
  m.class_id as class_id,
  (case
     when c.scoring_model = 'none'                then 'stable'
     when s.prev_overall is null                  then 'stable'
     when s.latest_overall > s.prev_overall       then 'improving'
     when s.latest_overall < s.prev_overall       then 'needs_attention'
     else 'stable'
   end)::public.member_status as status
from public.class_members m
join public.classes c on c.id = m.class_id
left join lateral (
  select
    (array_agg(e.overall order by e.recorded_on desc, e.id desc))[1] as latest_overall,
    (array_agg(e.overall order by e.recorded_on desc, e.id desc))[2] as prev_overall
  from public.score_entries e
  where e.class_member_id = m.id
    and e.overall is not null
) s on true;

comment on view public.v_member_performance_status is
  'Derived member status. Never stored. Compares the two most recent score entries that carry a non-null overall.';

-- ---------------------------------------------------------------------------
-- v_member_current_band
--
-- Starting band is the baseline entry; current band is the most recent entry.
-- Neither is stored on class_members, so the number under the chart can never
-- disagree with the chart.
-- ---------------------------------------------------------------------------
create view public.v_member_current_band
with (security_invoker = on) as
select
  m.id           as class_member_id,
  m.class_id     as class_id,
  m.target_band  as target_band,
  b.overall      as start_overall,
  b.reading      as start_reading,
  b.listening    as start_listening,
  b.writing      as start_writing,
  b.speaking     as start_speaking,
  l.overall      as current_overall,
  l.reading      as current_reading,
  l.listening    as current_listening,
  l.writing      as current_writing,
  l.speaking     as current_speaking,
  l.recorded_on  as current_recorded_on
from public.class_members m
left join lateral (
  select e.* from public.score_entries e
   where e.class_member_id = m.id and e.entry_type = 'baseline'
   limit 1
) b on true
left join lateral (
  select e.* from public.score_entries e
   where e.class_member_id = m.id
   order by e.recorded_on desc, e.id desc
   limit 1
) l on true;

comment on view public.v_member_current_band is
  'Starting / current / target bands derived from score_entries. Nothing here is denormalised onto class_members.';
