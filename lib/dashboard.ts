import "server-only";

import type { MemberStatus } from "@/lib/score";
import type { createClient } from "@/lib/supabase/server";
import {
  tallyClassMembers,
  withMemberCounts,
  type TeacherClass,
  type TeacherClassFields,
} from "@/lib/teacher";

/**
 * The teacher's landing page, read in one pass.
 *
 * The Figma's Dashboard is four summary tiles, the class list, a "Students
 * Needing Attention" column and a "Recent Progress" feed. Three of those four
 * are answerable from tables and views this product already has; the fourth is
 * not, and is not built. `recentProgress` in `pages/teacher/Dashboard.tsx` is a
 * literal array of four sentences in the Make source, there is no activity or
 * event table anywhere in the schema, and a feed assembled from `updated_at`
 * columns would be a different claim wearing the same words.
 *
 * The same rule settles the tiles. The Figma's third and fourth read "Avg
 * Homework 86%" and "Reports Due 6". `homework_submissions` and
 * `monthly_reports` both exist, and nothing in this application writes to
 * either, so both figures would be a confident 0 — which is not "no data", it
 * is a wrong number. They are replaced by the two counts
 * `v_member_performance_status` actually computes: how many students are
 * improving and how many need attention. Same shape, same four tiles, same
 * colours; every one of them is a figure the database returned.
 *
 * SIX QUERIES, FOUR OF THEM PARALLEL. `loadTeacherClasses` runs first because
 * everything below is scoped by the ids it returns — that is the same
 * sequential authorisation step `/teacher/[classId]` makes, and it is not
 * collapsed into the parallel block. The rest are one statement each across
 * *all* the teacher's classes rather than one per class, so a teacher with ten
 * classes still costs six round trips.
 *
 * Every statement filters on `class_id in (…)` where the ids came from a query
 * already restricted to `teacher_id = <session user>`; underneath,
 * `class_members_teacher_all` and the two `security_invoker` views resolve the
 * same ownership through `app.my_class_ids()`. The filter agrees with the
 * policy rather than standing in for it.
 *
 * `null` means something failed. It is deliberately not an empty dashboard: a
 * teacher shown four zeroes would reasonably conclude their classes were gone.
 */

export type DashboardMember = {
  membershipId: string;
  classId: string;
  className: string;
  name: string | null;
  status: MemberStatus;
  currentOverall: number | null;
  targetBand: number | null;
  /** `class_members.focus_areas` — what this student is working on. */
  focusAreas: string[];
};

export type DashboardClass = TeacherClass & {
  members: DashboardMember[];
  improvingCount: number;
};

export type TeacherDashboard = {
  classes: DashboardClass[];
  studentTotal: number;
  improvingTotal: number;
  /** Everyone the standing view marks `needs_attention`, across all classes. */
  needsAttention: DashboardMember[];
  /** `class_sessions` still to come — `scheduled`, starting from now. */
  upcomingSessions: number;
};

function logDbError(
  operation: string,
  error: { code?: string; message?: string },
): void {
  console.error(`[dashboard] ${operation} failed`, {
    code: error.code,
    message: error.message,
  });
}

export async function loadTeacherDashboard(
  supabase: Awaited<ReturnType<typeof createClient>>,
  classes: TeacherClassFields[],
): Promise<TeacherDashboard | null> {
  if (classes.length === 0) {
    return {
      classes: [],
      studentTotal: 0,
      improvingTotal: 0,
      needsAttention: [],
      upcomingSessions: 0,
    };
  }

  const classIds = classes.map((entry) => entry.classId);
  const now = new Date().toISOString();

  // The member tally rides in this batch rather than ahead of it. It only
  // needs the class ids, which are already in hand, so making it wait for its
  // own round trip before these four start added ~67 ms to every dashboard
  // load for nothing.
  const [counts, roster, statuses, bands, upcoming] = await Promise.all([
    tallyClassMembers(supabase, classIds),
    supabase
      .from("class_members")
      .select("id, class_id, invited_name, target_band, focus_areas, profiles(full_name)")
      .in("class_id", classIds)
      .eq("join_status", "joined")
      .is("removed_at", null),
    supabase
      .from("v_member_performance_status")
      .select("class_member_id, class_id, status")
      .in("class_id", classIds),
    supabase
      .from("v_member_current_band")
      .select("class_member_id, current_overall")
      .in("class_id", classIds),
    supabase
      .from("class_sessions")
      .select("id", { count: "exact", head: true })
      .in("class_id", classIds)
      .eq("status", "scheduled")
      .gte("starts_at", now),
  ]);

  if (roster.error) {
    logDbError("class_members.select", roster.error);
    return null;
  }
  if (statuses.error) {
    logDbError("v_member_performance_status.select", statuses.error);
    return null;
  }
  if (bands.error) {
    logDbError("v_member_current_band.select", bands.error);
    return null;
  }
  if (upcoming.error) {
    logDbError("class_sessions.count", upcoming.error);
    return null;
  }
  if (counts === null) return null;

  const counted = withMemberCounts(classes, counts);

  const status = new Map<string, MemberStatus>();
  for (const row of statuses.data ?? []) {
    if (row.class_member_id && row.status) status.set(row.class_member_id, row.status);
  }

  const overall = new Map<string, number | null>();
  for (const row of bands.data ?? []) {
    if (row.class_member_id) overall.set(row.class_member_id, row.current_overall);
  }

  const names = new Map(classes.map((entry) => [entry.classId, entry.className]));
  const byClass = new Map<string, DashboardMember[]>();

  for (const row of roster.data ?? []) {
    const member: DashboardMember = {
      membershipId: row.id,
      classId: row.class_id,
      className: names.get(row.class_id) ?? "",
      // The profile wins over the name the teacher typed, as on the roster.
      name: row.profiles?.full_name ?? row.invited_name ?? null,
      // 'stable' is what the view itself returns for a member with nothing to
      // compare, so a missing row and an uneventful one read the same way.
      status: status.get(row.id) ?? "stable",
      currentOverall: overall.get(row.id) ?? null,
      targetBand: row.target_band,
      focusAreas: row.focus_areas ?? [],
    };

    const bucket = byClass.get(row.class_id);
    if (bucket) bucket.push(member);
    else byClass.set(row.class_id, [member]);
  }

  const withMembers: DashboardClass[] = counted.map((entry) => {
    const members = byClass.get(entry.classId) ?? [];

    return {
      ...entry,
      members,
      improvingCount: members.filter((one) => one.status === "improving").length,
    };
  });

  const everyone = withMembers.flatMap((entry) => entry.members);

  return {
    classes: withMembers,
    studentTotal: everyone.length,
    improvingTotal: everyone.filter((one) => one.status === "improving").length,
    needsAttention: everyone.filter((one) => one.status === "needs_attention"),
    upcomingSessions: upcoming.count ?? 0,
  };
}
