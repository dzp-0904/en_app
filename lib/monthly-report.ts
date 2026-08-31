import "server-only";

import type { AttendanceStatus } from "@/lib/attendance";
import type { CourseType } from "@/lib/course-type";
import type { Performance, Skill } from "@/lib/lesson-log";
import {
  isInMonth,
  monthBounds,
  monthLabel,
  type MonthKey,
} from "@/lib/report-period";
import {
  BAND_FIELDS,
  type MemberStatus,
  type ScoreEntryType,
} from "@/lib/score";
import type { createClient } from "@/lib/supabase/server";
import { isUuid, type TeacherClassFields } from "@/lib/teacher";
import { zonedCalendarDate } from "@/lib/time";
import type { HomeworkStatus } from "@/lib/student";

/**
 * One month of one student, assembled from the tables that already hold it.
 *
 * ## Why this module exists at all
 *
 * M27 has four consumers of the same facts — the web preview, a PDF, a `.docx`
 * and an `.xlsx` — and the one thing that must never happen is for the report a
 * parent receives to disagree with the report the teacher read on screen. So
 * there is exactly one loader, it returns one plain object, and the three
 * formatters are pure functions of that object. Nothing downstream re-queries,
 * and nothing downstream recalculates: if a number is in the document it came
 * out of `MonthlyStudentReport`.
 *
 * ## Nothing here is generated
 *
 * Every field below is a column, a view column, or arithmetic on two of them.
 * There is no summarisation, no scoring heuristic, no prose. `movements` is the
 * subtraction of the month's first recorded band from its last; `attendance` is
 * a count of the rows `v_member_session_attendance` already decided were
 * countable. Where the Figma prints invented sentences — its "Improvements This
 * Month" list is a hardcoded array and its teacher's comment is a template
 * literal built from the student's name — this returns what the database has
 * and lets the page render an empty state when that is nothing.
 *
 * ## What authorises it
 *
 * `classFields` is an entry of `TeacherContext.classes`, which `readUserState`
 * built from `classes` filtered by the authenticated teacher's own id. So the
 * class is settled before this function is called and `membershipId` — the one
 * value a browser chooses — never selects a row on its own: the first statement
 * names it together with that class id, `join_status = 'joined'` and
 * `removed_at is null` in a single WHERE clause, exactly as
 * `loadStudentOverview` does. Every read after it is filtered on `class_id`
 * too, which is the same column the `..._teacher_all` policies resolve through,
 * so the filters agree with RLS rather than standing in for it.
 *
 * `null` from a query means the read failed and the caller must say so;
 * an empty array means the month really is empty. The two are never conflated.
 */

/** `overall` and the four skills — the columns a band can be recorded in. */
type BandField = (typeof BAND_FIELDS)[number];

/** One session in the month, with what was recorded against it. */
export type ReportLesson = {
  sessionId: string;
  startsAt: string;
  endsAt: string;
  title: string | null;
  /** `public.session_status` — a cancelled lesson is shown, and marked. */
  sessionStatus: "scheduled" | "completed" | "cancelled";
  /** The calendar day the lesson fell on, on the class's own clock. */
  calendarDate: string;
  /** `null` is "Chưa ghi nhận" — a state of its own, never `absent`. */
  attendance: AttendanceStatus | null;
  notes: ReportNote[];
  scores: ReportScore[];
};

export type ReportNote = {
  noteId: string;
  lessonDate: string;
  skill: Skill;
  performance: Performance;
  topic: string;
  note: string | null;
  mistakes: string[];
};

export type ReportScore = {
  entryId: string;
  entryType: ScoreEntryType;
  recordedOn: string;
  overall: number | null;
  reading: number | null;
  listening: number | null;
  writing: number | null;
  speaking: number | null;
  note: string | null;
};

export type ReportHomework = {
  assignmentId: string;
  title: string;
  description: string | null;
  skill: Skill;
  assignedOn: string;
  dueDate: string | null;
  maxScore: number;
  status: HomeworkStatus | null;
  score: number | null;
  submittedAt: string | null;
  teacherFeedback: string | null;
};

/** A band that moved inside the month: its first entry against its last. */
export type BandMovement = {
  field: BandField;
  from: number;
  to: number;
  firstRecordedOn: string;
  lastRecordedOn: string;
};

export type ReportAttendance = {
  /** Sessions `v_member_session_attendance` counted in the month. */
  counted: number;
  attended: number;
  /** `null`, never 0, when nothing counted — the view's own convention. */
  pct: number | null;
};

export type ReportHomeworkSummary = {
  assigned: number;
  submitted: number;
  graded: number;
  missed: number;
  /** Submitted or graded, over assigned. `null` when nothing was assigned. */
  completionPct: number | null;
  /**
   * The mean of `score / max_score` over graded submissions, as a percentage,
   * with the number of submissions it is over.
   *
   * A percentage rather than the Figma's `"8.1/10"`, which is hardcoded there:
   * `homework_assignments.max_score` is per-assignment, so a raw mean of 8 out
   * of 10 and 30 out of 40 is not a number that means anything. `null` when no
   * submission in the month is graded — an average over nothing is not zero.
   */
  averagePct: number | null;
  averageOver: number;
};

/** The band standing, straight from `v_member_current_band`. */
export type ReportBands = {
  targetBand: number | null;
  startOverall: number | null;
  startReading: number | null;
  startListening: number | null;
  startWriting: number | null;
  startSpeaking: number | null;
  currentOverall: number | null;
  currentReading: number | null;
  currentListening: number | null;
  currentWriting: number | null;
  currentSpeaking: number | null;
  currentRecordedOn: string | null;
};

export type MonthlyStudentReport = {
  month: MonthKey;
  monthLabel: string;

  classId: string;
  className: string;
  courseType: CourseType;
  courseTypeOther: string | null;
  classTargetBand: number | null;
  timezone: string;

  teacherName: string;
  teacherEmail: string | null;

  membershipId: string;
  studentName: string | null;
  studentEmail: string | null;
  joinedAt: string | null;

  bands: ReportBands;
  /** `v_member_performance_status` — never re-derived here. See §6. */
  status: MemberStatus;
  strengths: string[];
  focusAreas: string[];

  attendance: ReportAttendance;
  /** Every session in the month, newest first. */
  lessons: ReportLesson[];
  /** Notes whose `lesson_date` matched no session in the month. */
  unmatchedNotes: ReportNote[];
  /** Entries whose `recorded_on` matched no session in the month. */
  unmatchedScores: ReportScore[];
  /** The month's entries, oldest first — the order a chart plots them in. */
  scores: ReportScore[];
  movements: BandMovement[];
  homework: ReportHomework[];
  homeworkSummary: ReportHomeworkSummary;
  /**
   * `monthly_reports.teacher_comment` for this member and month, when a row
   * exists.
   *
   * Read, never written. `monthly_reports` requires a NOT NULL `snapshot` and
   * freezes it on publication — it is where a report is *published and shared*
   * from, not where one is computed, and M27 computes from the source tables.
   * Nothing in the application writes this table yet, so in practice this is
   * `null` and the report shows the month's own lesson notes instead.
   */
  teacherComment: string | null;
};

export type MonthlyStudentReportResult =
  | { kind: "ok"; report: MonthlyStudentReport }
  | { kind: "not-found" }
  | { kind: "error" };

/** One line of the class index: what the teacher scans before opening a report. */
export type MonthlyClassRow = {
  membershipId: string;
  name: string | null;
  email: string | null;
  status: MemberStatus;
  currentOverall: number | null;
  targetBand: number | null;
  attendance: ReportAttendance;
  lessonCount: number;
  scoreCount: number;
};

export type MonthlyClassSummary = {
  month: MonthKey;
  monthLabel: string;
  classId: string;
  className: string;
  rows: MonthlyClassRow[];
};

function logDbError(
  operation: string,
  error: { code?: string; message?: string },
): void {
  console.error("[monthly-report] " + operation + " failed", {
    code: error.code,
    message: error.message,
  });
}

const MEMBER_COLUMNS =
  "id, joined_at, strengths, focus_areas, invited_name, invited_email, profiles!class_members_student_id_fkey(full_name, email)";

const BAND_COLUMNS =
  "class_member_id, target_band, start_overall, start_reading, start_listening, start_writing, start_speaking, current_overall, current_reading, current_listening, current_writing, current_speaking, current_recorded_on";

const SESSION_COLUMNS =
  "id, starts_at, ends_at, title, status, session_attendance!session_attendance_session_fk(class_member_id, status)";

const NOTE_COLUMNS =
  "id, lesson_date, skill, performance, topic, note, mistakes, created_at";

const SCORE_COLUMNS =
  "id, entry_type, recorded_on, overall, reading, listening, writing, speaking, note, created_at";

const HOMEWORK_COLUMNS =
  "id, title, description, skill, assigned_on, due_date, max_score, homework_submissions(class_member_id, status, score, submitted_at, teacher_feedback)";

/**
 * Everything one student's monthly report says.
 *
 * One statement to settle the membership, then a single `Promise.all` of eight
 * reads that do not depend on each other. Eight round trips in the time of one
 * rather than eight in sequence — the same shape `loadStudentOverview` and the
 * M19 class-detail load already use, and the reason a report opens in roughly
 * the time one query takes.
 */
export async function loadMonthlyStudentReport(
  supabase: Awaited<ReturnType<typeof createClient>>,
  classFields: TeacherClassFields,
  teacher: { fullName: string; email: string | null },
  membershipId: string,
  month: MonthKey,
): Promise<MonthlyStudentReportResult> {
  if (!isUuid(membershipId)) return { kind: "not-found" };

  const classId = classFields.classId;
  const zone = classFields.timezone;
  const bounds = monthBounds(zone, month);

  const { data: member, error: memberError } = await supabase
    .from("class_members")
    .select(MEMBER_COLUMNS)
    .eq("id", membershipId)
    .eq("class_id", classId)
    // State in the WHERE clause, not read back and asserted: an invitation or a
    // removed membership is never fetched, so it can never be reported on.
    .eq("join_status", "joined")
    .is("removed_at", null)
    .maybeSingle();

  if (memberError) {
    logDbError("class_members.select", memberError);
    return { kind: "error" };
  }
  if (!member) return { kind: "not-found" };

  const [bands, statuses, sessions, notes, scores, homework, marks, published] =
    await Promise.all([
      supabase
        .from("v_member_current_band")
        .select(BAND_COLUMNS)
        .eq("class_id", classId)
        .eq("class_member_id", membershipId)
        .maybeSingle(),
      supabase
        .from("v_member_performance_status")
        .select("status")
        .eq("class_id", classId)
        .eq("class_member_id", membershipId)
        .maybeSingle(),
      supabase
        .from("class_sessions")
        .select(SESSION_COLUMNS)
        .eq("class_id", classId)
        // Half-open on the class's own clock. See `lib/report-period.ts`.
        .gte("starts_at", bounds.startsAt)
        .lt("starts_at", bounds.endsAt)
        .eq("session_attendance.class_member_id", membershipId)
        .order("starts_at", { ascending: false }),
      supabase
        .from("lesson_logs")
        .select(NOTE_COLUMNS)
        .eq("class_id", classId)
        .eq("class_member_id", membershipId)
        .gte("lesson_date", bounds.firstDay)
        .lte("lesson_date", bounds.lastDay)
        .order("lesson_date", { ascending: false })
        .order("created_at", { ascending: false }),
      supabase
        .from("score_entries")
        .select(SCORE_COLUMNS)
        .eq("class_id", classId)
        .eq("class_member_id", membershipId)
        .gte("recorded_on", bounds.firstDay)
        .lte("recorded_on", bounds.lastDay)
        // Oldest first: this list is plotted left to right and read as a
        // journey, and `created_at` breaks a same-day tie the way
        // `v_member_current_band` breaks it.
        .order("recorded_on", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase
        .from("homework_assignments")
        .select(HOMEWORK_COLUMNS)
        .eq("class_id", classId)
        .gte("assigned_on", bounds.firstDay)
        .lte("assigned_on", bounds.lastDay)
        .eq("homework_submissions.class_member_id", membershipId)
        .order("due_date", { ascending: true, nullsFirst: false })
        .order("assigned_on", { ascending: false }),
      supabase
        .from("v_member_session_attendance")
        .select("session_id, counts_in_numerator")
        .eq("class_id", classId)
        .eq("class_member_id", membershipId)
        .gte("starts_at", bounds.startsAt)
        .lt("starts_at", bounds.endsAt),
      supabase
        .from("monthly_reports")
        .select("teacher_comment")
        .eq("class_id", classId)
        .eq("class_member_id", membershipId)
        .eq("period_month", bounds.firstDay)
        .maybeSingle(),
    ]);

  const failure =
    firstError("v_member_current_band.select", bands.error) ??
    firstError("v_member_performance_status.select", statuses.error) ??
    firstError("class_sessions.select", sessions.error) ??
    firstError("lesson_logs.select", notes.error) ??
    firstError("score_entries.select", scores.error) ??
    firstError("homework_assignments.select", homework.error) ??
    firstError("v_member_session_attendance.select", marks.error) ??
    firstError("monthly_reports.select", published.error);

  if (failure) return { kind: "error" };

  const noteRows: ReportNote[] = (notes.data ?? []).map((row) => ({
    noteId: row.id,
    lessonDate: row.lesson_date,
    skill: row.skill,
    performance: row.performance,
    topic: row.topic,
    note: row.note,
    mistakes: row.mistakes ?? [],
  }));

  const scoreRows: ReportScore[] = (scores.data ?? []).map((row) => ({
    entryId: row.id,
    entryType: row.entry_type,
    recordedOn: row.recorded_on,
    overall: row.overall,
    reading: row.reading,
    listening: row.listening,
    writing: row.writing,
    speaking: row.speaking,
    note: row.note,
  }));

  // A lesson's notes and entries are the ones filed under the day it fell on,
  // read on the class's clock. `score_entries` has no `session_id` — see §6 —
  // and `lesson_logs.session_id` is nullable, so the date is the only join
  // both tables can offer, and it is the one the rest of the app already uses.
  const claimedNotes = new Set<string>();
  const claimedScores = new Set<string>();

  const lessons: ReportLesson[] = (sessions.data ?? []).map((session) => {
    const calendarDate = zonedCalendarDate(zone, session.starts_at);

    const own = noteRows.filter((note) => note.lessonDate === calendarDate);
    const entries = scoreRows.filter((score) => score.recordedOn === calendarDate);

    for (const note of own) claimedNotes.add(note.noteId);
    for (const score of entries) claimedScores.add(score.entryId);

    return {
      sessionId: session.id,
      startsAt: session.starts_at,
      endsAt: session.ends_at,
      title: session.title,
      sessionStatus: session.status,
      calendarDate,
      attendance: session.session_attendance?.[0]?.status ?? null,
      notes: own,
      scores: entries,
    };
  });

  const homeworkRows: ReportHomework[] = (homework.data ?? []).map((row) => {
    const mine = row.homework_submissions?.[0] ?? null;

    return {
      assignmentId: row.id,
      title: row.title,
      description: row.description,
      skill: row.skill,
      assignedOn: row.assigned_on,
      dueDate: row.due_date,
      maxScore: row.max_score,
      status: mine?.status ?? null,
      score: mine?.score ?? null,
      submittedAt: mine?.submitted_at ?? null,
      teacherFeedback: mine?.teacher_feedback ?? null,
    };
  });

  const band = bands.data;

  return {
    kind: "ok",
    report: {
      month,
      monthLabel: monthLabel(month),

      classId,
      className: classFields.className,
      courseType: classFields.courseType,
      courseTypeOther: classFields.courseTypeOther,
      classTargetBand: classFields.targetBand,
      timezone: zone,

      teacherName: teacher.fullName,
      teacherEmail: teacher.email,

      membershipId: member.id,
      // The profile wins over the name the teacher typed, as on the roster.
      studentName: member.profiles?.full_name ?? member.invited_name,
      studentEmail: member.profiles?.email ?? member.invited_email,
      joinedAt: member.joined_at,

      bands: {
        targetBand: band?.target_band ?? null,
        startOverall: band?.start_overall ?? null,
        startReading: band?.start_reading ?? null,
        startListening: band?.start_listening ?? null,
        startWriting: band?.start_writing ?? null,
        startSpeaking: band?.start_speaking ?? null,
        currentOverall: band?.current_overall ?? null,
        currentReading: band?.current_reading ?? null,
        currentListening: band?.current_listening ?? null,
        currentWriting: band?.current_writing ?? null,
        currentSpeaking: band?.current_speaking ?? null,
        currentRecordedOn: band?.current_recorded_on ?? null,
      },
      // 'stable' is the view's own answer for a member with nothing to compare,
      // so a missing row and an uneventful one read the same way.
      status: statuses.data?.status ?? "stable",
      strengths: member.strengths,
      focusAreas: member.focus_areas,

      attendance: tallyAttendance(marks.data ?? []),
      lessons,
      unmatchedNotes: noteRows.filter((note) => !claimedNotes.has(note.noteId)),
      unmatchedScores: scoreRows.filter(
        (score) => !claimedScores.has(score.entryId),
      ),
      scores: scoreRows,
      movements: movementsIn(scoreRows),
      homework: homeworkRows,
      homeworkSummary: summariseHomework(homeworkRows),
      teacherComment: published.data?.teacher_comment ?? null,
    },
  };
}

/**
 * Every student in one class, with the month's headline figures.
 *
 * Six queries whatever the roster size — the tallies are read for the whole
 * class in one statement each and bucketed here, so thirty students still cost
 * six round trips rather than a hundred and eighty. §11's rule, kept.
 */
export async function loadMonthlyClassSummary(
  supabase: Awaited<ReturnType<typeof createClient>>,
  classFields: TeacherClassFields,
  month: MonthKey,
): Promise<MonthlyClassSummary | null> {
  const classId = classFields.classId;
  const bounds = monthBounds(classFields.timezone, month);

  const [roster, bands, statuses, marks, notes, scores] = await Promise.all([
    supabase
      .from("class_members")
      .select(
        "id, invited_name, invited_email, profiles!class_members_student_id_fkey(full_name, email)",
      )
      .eq("class_id", classId)
      .eq("join_status", "joined")
      .is("removed_at", null)
      .order("joined_at", { ascending: true }),
    supabase
      .from("v_member_current_band")
      .select("class_member_id, target_band, current_overall")
      .eq("class_id", classId),
    supabase
      .from("v_member_performance_status")
      .select("class_member_id, status")
      .eq("class_id", classId),
    supabase
      .from("v_member_session_attendance")
      .select("class_member_id, counts_in_numerator")
      .eq("class_id", classId)
      .gte("starts_at", bounds.startsAt)
      .lt("starts_at", bounds.endsAt),
    supabase
      .from("lesson_logs")
      .select("id, class_member_id")
      .eq("class_id", classId)
      .gte("lesson_date", bounds.firstDay)
      .lte("lesson_date", bounds.lastDay),
    supabase
      .from("score_entries")
      .select("id, class_member_id")
      .eq("class_id", classId)
      .gte("recorded_on", bounds.firstDay)
      .lte("recorded_on", bounds.lastDay),
  ]);

  const failure =
    firstError("class_members.select(summary)", roster.error) ??
    firstError("v_member_current_band.select(summary)", bands.error) ??
    firstError("v_member_performance_status.select(summary)", statuses.error) ??
    firstError("v_member_session_attendance.select(summary)", marks.error) ??
    firstError("lesson_logs.select(summary)", notes.error) ??
    firstError("score_entries.select(summary)", scores.error);

  if (failure) return null;

  const bandOf = new Map(
    (bands.data ?? []).flatMap((row) =>
      row.class_member_id ? [[row.class_member_id, row] as const] : [],
    ),
  );
  const statusOf = new Map(
    (statuses.data ?? []).flatMap((row) =>
      row.class_member_id && row.status
        ? [[row.class_member_id, row.status] as const]
        : [],
    ),
  );

  const marksOf = new Map<string, { counts_in_numerator: boolean | null }[]>();
  for (const row of marks.data ?? []) {
    if (!row.class_member_id) continue;
    const bucket = marksOf.get(row.class_member_id) ?? [];
    bucket.push(row);
    marksOf.set(row.class_member_id, bucket);
  }

  const countBy = (rows: { class_member_id: string }[]): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      counts.set(row.class_member_id, (counts.get(row.class_member_id) ?? 0) + 1);
    }
    return counts;
  };

  const noteCounts = countBy(notes.data ?? []);
  const scoreCounts = countBy(scores.data ?? []);

  return {
    month,
    monthLabel: monthLabel(month),
    classId,
    className: classFields.className,
    rows: (roster.data ?? []).map((row) => ({
      membershipId: row.id,
      name: row.profiles?.full_name ?? row.invited_name,
      email: row.profiles?.email ?? row.invited_email,
      status: statusOf.get(row.id) ?? "stable",
      currentOverall: bandOf.get(row.id)?.current_overall ?? null,
      targetBand: bandOf.get(row.id)?.target_band ?? null,
      attendance: tallyAttendance(marksOf.get(row.id) ?? []),
      lessonCount: noteCounts.get(row.id) ?? 0,
      scoreCount: scoreCounts.get(row.id) ?? 0,
    })),
  };
}

function firstError(
  operation: string,
  error: { code?: string; message?: string } | null,
): true | null {
  if (!error) return null;
  logDbError(operation, error);
  return true;
}

/**
 * The month's attendance, counted the way the view already decided.
 *
 * Each row is one countable (member, session) — `excused` marks and cancelled,
 * future, pre-join and post-removal sessions were dropped by
 * `v_member_session_attendance` itself, and `counts_in_numerator` is its own
 * verdict on whether the student was there. Nothing is re-decided here; the
 * rows are counted. A zero denominator yields `null`, not 0%, which is the
 * view's convention and the difference between "no lessons yet" and "attended
 * none of them".
 */
function tallyAttendance(
  rows: { counts_in_numerator: boolean | null }[],
): ReportAttendance {
  const counted = rows.length;
  const attended = rows.filter((row) => row.counts_in_numerator === true).length;

  return {
    counted,
    attended,
    pct: counted === 0 ? null : Math.round((100 * attended) / counted),
  };
}

/**
 * Which bands moved inside the month.
 *
 * The Figma's "Improvements This Month" is a hardcoded array of sentences. This
 * is the one part of it that is a fact: the first band recorded in the month
 * against the last, per field, listed only when the two differ. A field with a
 * single entry has not moved and is left out; a gap is not a zero, so a `null`
 * in one entry is skipped rather than read as a fall to 0.0.
 *
 * `entries` must be oldest first, which is the order the loader reads them in.
 */
function movementsIn(entries: ReportScore[]): BandMovement[] {
  const movements: BandMovement[] = [];

  for (const field of BAND_FIELDS) {
    const recorded = entries.filter((entry) => entry[field] !== null);
    if (recorded.length < 2) continue;

    const first = recorded[0];
    const last = recorded[recorded.length - 1];

    const from = first[field];
    const to = last[field];
    if (from === null || to === null || from === to) continue;

    movements.push({
      field,
      from,
      to,
      firstRecordedOn: first.recordedOn,
      lastRecordedOn: last.recordedOn,
    });
  }

  return movements;
}

/**
 * The month's homework, counted.
 *
 * `public.homework_status` is exhaustive and its invariant says only `graded`
 * carries a score, so `averagePct` is taken over graded rows alone. An
 * assignment with no submission row is counted as assigned rather than dropped:
 * work was set, and silence about it is the finding.
 */
function summariseHomework(rows: ReportHomework[]): ReportHomeworkSummary {
  const assigned = rows.length;
  const submitted = rows.filter((row) => row.status === "submitted").length;
  const graded = rows.filter((row) => row.status === "graded").length;
  const missed = rows.filter((row) => row.status === "missed").length;

  const scored = rows.filter(
    (row): row is ReportHomework & { score: number } =>
      row.status === "graded" && row.score !== null && row.maxScore > 0,
  );

  const averagePct =
    scored.length === 0
      ? null
      : Math.round(
          (100 *
            scored.reduce((total, row) => total + row.score / row.maxScore, 0)) /
            scored.length,
        );

  return {
    assigned,
    submitted,
    graded,
    missed,
    completionPct:
      assigned === 0
        ? null
        : Math.round((100 * (submitted + graded)) / assigned),
    averagePct,
    averageOver: scored.length,
  };
}

/** Re-exported so callers need one import for the month and its report. */
export { isInMonth };
