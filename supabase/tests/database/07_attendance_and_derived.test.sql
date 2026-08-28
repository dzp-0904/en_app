-- Attendance arithmetic and the derived views.
--
-- The authoritative Phase 1 rule:
--   present  numerator +1  denominator +1
--   late     numerator +1  denominator +1
--   absent   numerator +0  denominator +1
--   excused  numerator +0  denominator +0   (excluded entirely)
--   unmarked numerator +0  denominator +1   (a gap in the register counts
--                                            against, so it stays visible)
-- Denominator: non-cancelled sessions with starts_at <= now(), on or after the
-- member's joined_at, and on or before removed_at where one exists.
--
-- Without the now() bound a January-June class shows ~20% attendance in
-- February. Without joined_at a mid-course joiner inherits an unrecoverable
-- deficit. Without removed_at a removed student accrues absences forever.

begin;
select plan(26);

select tests.seed_world();

-- --------------------------------------------------------------------------
-- The summary
-- --------------------------------------------------------------------------
select is((select sessions_counted from public.v_member_attendance_summary
            where class_member_id = 'b1000000-0000-0000-0000-000000000001')::int, 4,
  'M1: four sessions count (cancelled, future, pre-join and excused all drop out)');

select is((select sessions_attended from public.v_member_attendance_summary
            where class_member_id = 'b1000000-0000-0000-0000-000000000001')::int, 2,
  'M1: present + late make the numerator');

select is((select attendance_pct from public.v_member_attendance_summary
            where class_member_id = 'b1000000-0000-0000-0000-000000000001'), 50::numeric,
  'M1: 2 of 4 is 50%');

select is((select sessions_counted from public.v_member_attendance_summary
            where class_member_id = 'b2000000-0000-0000-0000-000000000002')::int, 5,
  'M2: an entirely unmarked register still counts five sessions');

select is((select attendance_pct from public.v_member_attendance_summary
            where class_member_id = 'b2000000-0000-0000-0000-000000000002'), 0::numeric,
  'M2: unmarked sessions count against, so a missing register is visible');

select is((select sessions_counted from public.v_member_attendance_summary
            where class_member_id = 'b6000000-0000-0000-0000-000000000006')::int, 4,
  'M6: counting stops at removed_at');

select is((select sessions_attended from public.v_member_attendance_summary
            where class_member_id = 'b6000000-0000-0000-0000-000000000006')::int, 1,
  'M6: only the pre-removal attendance counts');

select is((select attendance_pct from public.v_member_attendance_summary
            where class_member_id = 'b6000000-0000-0000-0000-000000000006'), 25::numeric,
  'M6: 1 of 4 is 25%');

-- NULL, not 0. A student who joined yesterday has no attendance record — not a
-- perfect absence record.
select is((select attendance_pct from public.v_member_attendance_summary
            where class_member_id = 'b3000000-0000-0000-0000-000000000003'), null::numeric,
  'a member with no countable session yet has NULL attendance, not 0%');

-- --------------------------------------------------------------------------
-- Exclusions, one at a time
-- --------------------------------------------------------------------------
select is((select count(*) from public.v_member_session_attendance
            where session_id = 'd6000000-0000-0000-0000-000000000006')::int, 0,
  'a cancelled session is excluded even when someone was marked present');

select is((select count(*) from public.v_member_session_attendance
            where session_id = 'd7000000-0000-0000-0000-000000000007')::int, 0,
  'a session that has not started yet is excluded');

select is((select count(*) from public.v_member_session_attendance
            where session_id = 'd8000000-0000-0000-0000-000000000008')::int, 0,
  'a session before every member''s joined_at is excluded');

select is((select count(*) from public.v_member_session_attendance
            where session_id = 'd5000000-0000-0000-0000-000000000005'
              and class_member_id = 'b6000000-0000-0000-0000-000000000006')::int, 0,
  'a session after removed_at is excluded for that member');

select is((select count(*) from public.v_member_session_attendance
            where session_id = 'd4000000-0000-0000-0000-000000000004'
              and class_member_id = 'b1000000-0000-0000-0000-000000000001')::int, 0,
  'an excused session leaves both numerator and denominator');

-- --------------------------------------------------------------------------
-- Per-status contribution
-- --------------------------------------------------------------------------
select ok((select counts_in_numerator from public.v_member_session_attendance
            where session_id = 'd1000000-0000-0000-0000-000000000001'
              and class_member_id = 'b1000000-0000-0000-0000-000000000001'),
  'present counts in the numerator');

select ok((select counts_in_numerator from public.v_member_session_attendance
            where session_id = 'd2000000-0000-0000-0000-000000000002'
              and class_member_id = 'b1000000-0000-0000-0000-000000000001'),
  'late counts in the numerator');

select ok((select not counts_in_numerator from public.v_member_session_attendance
            where session_id = 'd3000000-0000-0000-0000-000000000003'
              and class_member_id = 'b1000000-0000-0000-0000-000000000001'),
  'absent counts in the denominator only');

select ok((select not counts_in_numerator from public.v_member_session_attendance
            where session_id = 'd5000000-0000-0000-0000-000000000005'
              and class_member_id = 'b1000000-0000-0000-0000-000000000001'),
  'an unmarked session counts in the denominator only');

select ok((select bool_and(counts_in_denominator)
             from public.v_member_session_attendance),
  'every row the view emits is a denominator row by construction');

-- --------------------------------------------------------------------------
-- Derived performance status. Never stored; recomputed on read.
-- --------------------------------------------------------------------------
select is((select status from public.v_member_performance_status
            where class_member_id = 'b1000000-0000-0000-0000-000000000001')::text,
  'improving',
  'M1 improves: the skills-only entry between 5.0 and 6.0 is transparent');

select is((select status from public.v_member_performance_status
            where class_member_id = 'b2000000-0000-0000-0000-000000000002')::text,
  'needs_attention',
  'M2 falls from 6.5 to 6.0');

select is((select status from public.v_member_performance_status
            where class_member_id = 'b3000000-0000-0000-0000-000000000003')::text,
  'stable',
  'a single score entry is not a trend');

select is((select status from public.v_member_performance_status
            where class_member_id = 'b4000000-0000-0000-0000-000000000004')::text,
  'stable',
  'a class with scoring_model = none is always stable, even when bands rise');

select is((select current_overall::numeric from public.v_member_current_band
            where class_member_id = 'b1000000-0000-0000-0000-000000000001'), 6.0::numeric,
  'the current band is the most recent entry, not a stored column');

-- --------------------------------------------------------------------------
-- The views are security_invoker: without it they would run as their owner and
-- hand every student''s attendance to every caller.
-- --------------------------------------------------------------------------
set local role authenticated;

select tests.login('33333333-3333-3333-3333-333333333333');  -- Student X
select is((select count(*) from public.v_member_attendance_summary)::int, 2,
  'a student sees attendance only for their own two memberships');

select tests.login('11111111-1111-1111-1111-111111111111');  -- Teacher A
select is((select count(*) from public.v_member_attendance_summary)::int, 5,
  'a teacher sees attendance for their own roster only');

reset role;
select * from finish();
rollback;
