import "server-only";

import type { AttendanceStatus } from "@/lib/attendance";
import type { Performance, Skill } from "@/lib/lesson-log";
import type { CourseType } from "@/lib/course-type";
import type { MemberStatus, ScoreEntryType } from "@/lib/score";
import type { createClient } from "@/lib/supabase/server";

/**
 * A student's own enrolments.
 *
 * The counterpart to the teacher half of `lib/onboarding.ts`: where that asks
 * "has this teacher finished setting up", this asks "which classes is this
 * student actually in". Both feed the same classification in `loadUserState`.
 *
 * Nothing here is a security boundary. Every row this module can reach is
 * already fixed by RLS — `class_members_student_select` is `student_id =
 * auth.uid()`, and the two embedded resources are reachable only through
 * `classes_student_select` and `profiles_select`, which resolve through
 * `app.my_student_class_ids()` and `app.my_teacher_ids()` respectively. Both
 * helpers already restrict themselves to `join_status = 'joined'` and
 * `removed_at is null`, so the filters below agree with the policies rather
 * than adding to them: a student cannot see another student's membership, a
 * classmate's profile, or a class they have left, whatever this file asks for.
 */

export type StudentClass = {
  /** class_members.id — the per-class record every child table hangs off. */
  membershipId: string;
  classId: string;
  className: string;
  /** Null only if the teacher's profile became unreadable mid-flight. */
  teacherName: string | null;
  joinedAt: string | null;
};

export type StudentContext = {
  userId: string;
  email: string | null;
  fullName: string;
  /**
   * Every active enrolment, newest first — NOT capped at one. `class_members`
   * is keyed `(class_id, student_id)`, so one student legitimately holds many
   * rows across many classes and the UI has to be able to show all of them.
   *
   * `null` means the query failed, which is deliberately not the same value as
   * `[]`. Collapsing the two would tell a student with three classes that they
   * have none, and invite them to wait for an invitation they already accepted.
   */
  classes: StudentClass[] | null;
};

/**
 * Loads the student's active memberships.
 *
 * `student_id` is passed rather than trusted from anywhere client-side: it comes
 * from `getUser()`, and RLS pins it to `auth.uid()` regardless. The filter is
 * belt-and-braces so the intent is readable at the call site, not because the
 * policy needs help.
 *
 * `!inner` on both hops is what makes a class whose row RLS hides drop the
 * membership too, instead of surfacing a half-populated entry with no name.
 */
export async function loadStudentClasses(
  supabase: Awaited<ReturnType<typeof createClient>>,
  studentId: string,
): Promise<StudentClass[] | null> {
  const { data, error } = await supabase
    .from("class_members")
    .select("id, joined_at, classes!inner(id, name, profiles!inner(full_name))")
    .eq("student_id", studentId)
    .eq("join_status", "joined")
    .is("removed_at", null)
    .order("joined_at", { ascending: false });

  if (error) {
    console.error("[student] failed to load memberships", {
      code: error.code,
      message: error.message,
    });
    return null;
  }

  return (data ?? []).map((row) => ({
    membershipId: row.id,
    classId: row.classes.id,
    className: row.classes.name,
    teacherName: row.classes.profiles?.full_name ?? null,
    joinedAt: row.joined_at,
  }));
}

/**
 * One class, as the student who is in it sees it.
 *
 * Everything `StudentClass` carries, plus the descriptive columns `/student`
 * has no room for. Deliberately only columns that exist on `public.classes` —
 * there is no lesson, homework, score or attendance data here because none of
 * it is being read yet, and a field invented now would have to be unpicked
 * later.
 *
 * `courseTypeOther` is the free-text name for `course_type = 'other'`, which
 * `classes_course_type_other_required` guarantees is non-null in exactly that
 * case and null in every other. `LABELS` covers the three offered types; this
 * is what covers the fourth.
 */
export type StudentClassDetail = StudentClass & {
  courseType: CourseType;
  courseTypeOther: string | null;
  targetBand: number | null;
  /** `start_date` is NOT NULL; `end_date` is optional — an open-ended course. */
  startDate: string;
  endDate: string | null;
  scheduleNote: string | null;
  /**
   * The student's own `class_members.strengths` and `class_members.focus_areas`
   * — read-only here, and only ever their own row.
   *
   * They come off the membership `loadStudentClass` already fetches, which is
   * pinned to `student_id` and to this one class, so a classmate's notes are
   * not filtered out in TypeScript: they are never selected. Both columns are
   * `not null default '{}'`, so empty means the teacher has recorded nothing.
   */
  strengths: string[];
  focusAreas: string[];
  /**
   * `classes.timezone` — the clock every session of this class is read on.
   *
   * Carried here so the lesson list can hand it to `lib/time.ts` unchanged.
   * The alternative is a second lookup, or worse a second idea of what time it
   * is: a session is stored as an instant, and the only zone that turns it back
   * into the hour on the timetable is the class's own.
   */
  timezone: string;
};

/**
 * Why three arms and not `StudentClassDetail | null`.
 *
 * "You are not in this class" and "the database did not answer" are different
 * facts and the page owes the reader a different answer to each: a 404 for the
 * first, "try again" for the second. Collapsing them would tell a student whose
 * query timed out that their class does not exist, which is the same mistake
 * `StudentContext.classes` uses `null` to avoid.
 *
 * There is no `anonymous` arm: the caller has already classified the request
 * through `loadUserState`, and `studentId` below comes from that. Re-deriving
 * the identity here would be a second answer to a question the app answers in
 * one place.
 */
export type StudentClassResult =
  | { kind: "ok"; detail: StudentClassDetail }
  | { kind: "not-found" }
  | { kind: "error" };

/** `class_id` is a uuid column, so anything else cannot name a row. */
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Loads one class the student belongs to.
 *
 * The membership check is not a step before the read — it *is* the read. The
 * query starts from `class_members` and reaches the class through `!inner`, so
 * a `classId` the student is not joined to matches no row and there is nothing
 * to leak: no name, no teacher, no evidence the class exists at all. Same
 * filters as `loadStudentClasses`, plus the id, and `student_id` is still the
 * value `getUser()` returned rather than anything off the URL.
 *
 * `maybeSingle` is safe because `class_members_class_student_key` is unique on
 * `(class_id, student_id) where student_id is not null`.
 *
 * The uuid guard is what keeps the error arm meaningful. Handing PostgREST
 * `/student/nonsense` would come back as `22P02 invalid input syntax for type
 * uuid` — a client mistake arriving in the shape of a server failure, which
 * would show a mistyped URL the "please refresh" banner instead of a 404.
 */
export async function loadStudentClass(
  supabase: Awaited<ReturnType<typeof createClient>>,
  studentId: string,
  classId: string,
): Promise<StudentClassResult> {
  if (!UUID.test(classId)) return { kind: "not-found" };

  const { data, error } = await supabase
    .from("class_members")
    .select(
      "id, joined_at, strengths, focus_areas, classes!inner(id, name, course_type, course_type_other, target_band, start_date, end_date, schedule_note, timezone, profiles!inner(full_name))",
    )
    .eq("student_id", studentId)
    .eq("class_id", classId)
    .eq("join_status", "joined")
    .is("removed_at", null)
    .maybeSingle();

  if (error) {
    console.error("[student] failed to load membership", {
      code: error.code,
      message: error.message,
    });
    return { kind: "error" };
  }

  if (!data) return { kind: "not-found" };

  return {
    kind: "ok",
    detail: {
      membershipId: data.id,
      classId: data.classes.id,
      className: data.classes.name,
      teacherName: data.classes.profiles?.full_name ?? null,
      joinedAt: data.joined_at,
      courseType: data.classes.course_type,
      courseTypeOther: data.classes.course_type_other,
      targetBand: data.classes.target_band,
      startDate: data.classes.start_date,
      endDate: data.classes.end_date,
      scheduleNote: data.classes.schedule_note,
      strengths: data.strengths,
      focusAreas: data.focus_areas,
      timezone: data.classes.timezone,
    },
  };
}

/**
 * One lesson of the student's class, with their own mark for it.
 *
 * `attendance` is null when no `session_attendance` row exists for this student
 * at this session, and that is a real state rather than a missing one: rows are
 * created only when a teacher records something. It is deliberately not read as
 * `absent` — the page says "Not recorded", and nothing here invents a row to
 * fill the gap.
 */
export type StudentLesson = {
  sessionId: string;
  startsAt: string;
  endsAt: string;
  title: string | null;
  status: "scheduled" | "completed" | "cancelled";
  attendance: AttendanceStatus | null;
  /**
   * How many lesson notes this student has at this lesson.
   *
   * A count rather than the notes themselves: the list needs to say whether
   * there is anything to read, and reading it is what the lesson page is for.
   * Fetching every note's text to render the word "2" would move the whole of
   * a term's notes through a page that shows none of them.
   */
  noteCount: number;
};

/**
 * One lesson on its own page: the same facts as a list entry, without the note
 * count, because the notes themselves are shown beneath it.
 */
export type StudentLessonDetail = {
  sessionId: string;
  startsAt: string;
  endsAt: string;
  title: string | null;
  status: "scheduled" | "completed" | "cancelled";
  attendance: AttendanceStatus | null;
};

export type StudentLessonResult =
  | { kind: "ok"; lesson: StudentLessonDetail }
  | { kind: "not-found" }
  | { kind: "error" };

/**
 * One note a teacher wrote about this student at one lesson.
 *
 * The student's own name is deliberately absent — they are the only person
 * these rows can be about — and so is `lesson_date`, which is the lesson's own
 * date and already in the header of the page that shows these.
 */
export type StudentNote = {
  noteId: string;
  skill: Skill;
  performance: Performance;
  topic: string;
  note: string | null;
  createdAt: string;
};

/**
 * The class's lessons and this student's own attendance at them.
 *
 * ## Why not `v_member_session_attendance`
 *
 * It is the obvious candidate and it is the wrong grain for this screen. The
 * view answers "what should this student's attendance *rate* be built from",
 * and to do that it drops rows on purpose: cancelled sessions, sessions that
 * have not started, sessions before the member joined, and — decisively —
 * every session the student was marked `excused` for, which is excluded from
 * numerator and denominator alike. A student marked Excused would find the
 * lesson simply absent from their own list, and the milestone requires that
 * exact word to be shown. The view also carries neither `ends_at` nor `title`,
 * so it cannot render the line above the status either. It stays as it is, for
 * the rate calculations it was written for.
 *
 * ## What authorises this
 *
 * `membershipId` is `class_members.id` as returned by `loadStudentClass`, which
 * derived it from `getUser()` — it is never a value off the URL or a form, and
 * there is no argument here that a browser can choose except `classId`, which
 * selects rather than authorises. Underneath, the two policies say the same
 * thing again: `class_sessions_student_select` admits only
 * `app.my_student_class_ids()` (`join_status = 'joined'`, `removed_at is null`),
 * and `session_attendance_student_select` admits only `app.my_member_ids()` —
 * memberships whose `student_id` is `auth.uid()`. Another student's row is not
 * filtered out of this result; it never arrives in the process at all.
 *
 * Three queries — the lessons, this student's marks, this student's notes —
 * and not one of them is per lesson, so this is not an N+1. `null` means a
 * query failed and is deliberately not `[]`, which means the class has no
 * lessons yet.
 */
export async function loadStudentLessons(
  supabase: Awaited<ReturnType<typeof createClient>>,
  classId: string,
  membershipId: string,
): Promise<StudentLesson[] | null> {
  // All three at once. None of them reads another's answer — the attendance and
  // note queries are keyed on `(class_id, class_member_id)`, which is known
  // before any of this runs — and issuing them one behind the other cost two
  // extra Supabase round trips, ~67 ms each on a hosted project, on every visit
  // to a student's class page. A class with no lessons at all pays for two
  // queries it will not use; a class with lessons, which is every real one,
  // saves the wait.
  const [
    { data: sessions, error: sessionError },
    // Scoped to this membership in the WHERE clause, not in TypeScript. The
    // policy would refuse another student's rows regardless; asking only for
    // one's own is the query saying what it means.
    { data: marks, error: markError },
    // Scoped to this one membership too. `lesson_logs_student_select` admits
    // only `app.my_member_ids()`, so another student's notes are not filtered
    // out afterwards — they are never returned. Only `session_id` is selected:
    // the list is counting, not reading.
    { data: logs, error: logError },
  ] = await Promise.all([
    supabase
      .from("class_sessions")
      .select("id, starts_at, ends_at, title, status")
      .eq("class_id", classId)
      // Chronological on the stored instant, which is what the
      // `(class_id, starts_at)` unique constraint's index already orders.
      .order("starts_at", { ascending: true }),
    supabase
      .from("session_attendance")
      .select("session_id, status")
      .eq("class_id", classId)
      .eq("class_member_id", membershipId),
    supabase
      .from("lesson_logs")
      .select("session_id")
      .eq("class_id", classId)
      .eq("class_member_id", membershipId),
  ]);

  if (sessionError) {
    console.error("[student] failed to load lessons", {
      code: sessionError.code,
      message: sessionError.message,
    });
    return null;
  }

  if (markError) {
    console.error("[student] failed to load attendance", {
      code: markError.code,
      message: markError.message,
    });
    return null;
  }

  if (logError) {
    console.error("[student] failed to load lesson notes", {
      code: logError.code,
      message: logError.message,
    });
    return null;
  }

  if (!sessions || sessions.length === 0) return [];

  const recorded = new Map<string, AttendanceStatus>();
  for (const mark of marks ?? []) recorded.set(mark.session_id, mark.status);

  // `session_id` is nullable — a note whose lesson was deleted keeps its
  // tenancy and loses its session — and a null key simply matches no lesson.
  const notes = new Map<string, number>();
  for (const log of logs ?? []) {
    if (log.session_id === null) continue;
    notes.set(log.session_id, (notes.get(log.session_id) ?? 0) + 1);
  }

  return sessions.map((session) => ({
    sessionId: session.id,
    startsAt: session.starts_at,
    endsAt: session.ends_at,
    title: session.title,
    status: session.status,
    // Absent from the map means unmarked, which is not the same as `absent`.
    attendance: recorded.get(session.id) ?? null,
    noteCount: notes.get(session.id) ?? 0,
  }));
}

/**
 * One lesson of the student's own class, with their own mark on it.
 *
 * The three-arm result the rest of this module uses: `not-found` for a lesson
 * that is not this class's, `error` for a query that failed. They are never
 * conflated — "this lesson does not exist" is a claim only an answered query
 * may make.
 *
 * ## What authorises this
 *
 * `classId` has already been proved to be one of this student's by
 * `loadStudentClass`, and `membershipId` came back from that same query, which
 * was filtered by `getUser()`'s id. Neither is taken from the URL or a form.
 * `sessionId` *is* off the URL, and it is never the only thing selecting the
 * row: the filter is `id = sessionId` AND `class_id = classId` in one WHERE
 * clause, so a session belonging to any other class matches nothing and is
 * reported as a lesson that does not exist. Nothing about it is read, so
 * nothing about it can leak — not even whether it exists.
 *
 * Beneath that, `class_sessions_student_select` admits only
 * `app.my_student_class_ids()`, which is itself `join_status = 'joined'` and
 * `removed_at is null`: a student removed from a class stops being able to read
 * its lessons at the database, not merely in this function.
 */
export async function loadStudentLesson(
  supabase: Awaited<ReturnType<typeof createClient>>,
  classId: string,
  sessionId: string,
  membershipId: string,
): Promise<StudentLessonResult> {
  // Before the round trip, so a mistyped link is a 404 rather than `22P02
  // invalid input syntax for type uuid` arriving as a server fault.
  if (!UUID.test(sessionId)) return { kind: "not-found" };

  const { data: session, error: sessionError } = await supabase
    .from("class_sessions")
    .select("id, starts_at, ends_at, title, status")
    .eq("id", sessionId)
    .eq("class_id", classId)
    .maybeSingle();

  if (sessionError) {
    console.error("[student] failed to load lesson", {
      code: sessionError.code,
      message: sessionError.message,
    });
    return { kind: "error" };
  }

  if (!session) return { kind: "not-found" };

  const { data: mark, error: markError } = await supabase
    .from("session_attendance")
    .select("status")
    .eq("session_id", sessionId)
    .eq("class_id", classId)
    .eq("class_member_id", membershipId)
    .maybeSingle();

  if (markError) {
    console.error("[student] failed to load lesson attendance", {
      code: markError.code,
      message: markError.message,
    });
    return { kind: "error" };
  }

  return {
    kind: "ok",
    lesson: {
      sessionId: session.id,
      startsAt: session.starts_at,
      endsAt: session.ends_at,
      title: session.title,
      status: session.status,
      // No row is "not recorded", which is a state of its own.
      attendance: mark?.status ?? null,
    },
  };
}

/**
 * The lesson notes this student's teacher wrote about *them* at one lesson.
 *
 * One query, oldest first, filtered by the session, the class and this
 * membership together. There may be any number of them: `lesson_logs` carries
 * no unique constraint, so a teacher may write several about one student at one
 * lesson, and nothing here assumes otherwise.
 *
 * The student is never named in the result because every row is theirs by
 * construction. `lesson_logs_student_select` admits only `app.my_member_ids()`,
 * so a note about a classmate cannot reach this process; the `class_member_id`
 * filter is this query agreeing with that policy rather than adding to it.
 *
 * `null` means the query failed, `[]` means nothing was written.
 */
export async function loadStudentSessionNotes(
  supabase: Awaited<ReturnType<typeof createClient>>,
  classId: string,
  sessionId: string,
  membershipId: string,
): Promise<StudentNote[] | null> {
  const { data: logs, error } = await supabase
    .from("lesson_logs")
    .select("id, skill, performance, topic, note, created_at")
    .eq("session_id", sessionId)
    .eq("class_id", classId)
    .eq("class_member_id", membershipId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[student] failed to load lesson notes", {
      code: error.code,
      message: error.message,
    });
    return null;
  }

  return (logs ?? []).map((log) => ({
    noteId: log.id,
    skill: log.skill,
    performance: log.performance,
    topic: log.topic,
    note: log.note,
    createdAt: log.created_at,
  }));
}

/**
 * Where this student currently stands, as the database already computes it.
 *
 * The student's half of `MemberBands` in `lib/teacher.ts`, and deliberately the
 * same fields from the same two views — `v_member_current_band` and
 * `v_member_performance_status`. Both are `security_invoker`, so they resolve
 * through the reader's own policies: `score_entries_student_select` admits only
 * `class_member_id = any (app.my_member_ids())`, which is the student's own
 * enrolments and nothing else. A classmate's bands are not filtered out here;
 * they are unreadable.
 *
 * Nothing is recalculated on this side either. If the teacher's page and this
 * one ever disagreed about what "current band" meant, one of them would be
 * telling a student something their teacher never recorded.
 */
export type StudentBands = {
  status: MemberStatus;
  targetBand: number | null;
  startOverall: number | null;
  /**
   * The baseline entry's per-skill bands.
   *
   * `v_member_current_band` has carried these since the view was written; this
   * loader simply did not ask for them until the progress card needed to say
   * how far each skill has moved. They come from the same `baseline` row
   * `start_overall` does, so a skill can have a start and no current, or the
   * reverse, and both are nulls rather than zeroes.
   */
  startReading: number | null;
  startListening: number | null;
  startWriting: number | null;
  startSpeaking: number | null;
  currentOverall: number | null;
  currentReading: number | null;
  currentListening: number | null;
  currentWriting: number | null;
  currentSpeaking: number | null;
  /** The date of the most recent entry, `YYYY-MM-DD` in the class's zone. */
  currentRecordedOn: string | null;
};

/** One of this student's own band entries. */
export type StudentScoreEntry = {
  entryId: string;
  entryType: ScoreEntryType;
  overall: number | null;
  reading: number | null;
  listening: number | null;
  writing: number | null;
  speaking: number | null;
  note: string | null;
  recordedOn: string;
};

/**
 * This student's standing in one class.
 *
 * Both ids the relationship provides are named — the membership and the class —
 * so a `classId` that does not belong with this membership matches no row rather
 * than being fetched and compared afterwards. `membershipId` never comes off the
 * URL: the caller has already proved it through `loadStudentClass`.
 *
 * `null` means a query failed. A member the views have nothing to say about is
 * not a failure and does not return `null`: the views' own answer for a student
 * with no entries is a row of nulls and `'stable'`, and that is what is
 * reconstructed here, so "never assessed" and "the database did not answer" stay
 * different facts.
 */
export async function loadStudentBands(
  supabase: Awaited<ReturnType<typeof createClient>>,
  classId: string,
  membershipId: string,
): Promise<StudentBands | null> {
  const [bands, status] = await Promise.all([
    supabase
      .from("v_member_current_band")
      .select(
        "target_band, start_overall, start_reading, start_listening, start_writing, start_speaking, current_overall, current_reading, current_listening, current_writing, current_speaking, current_recorded_on",
      )
      .eq("class_member_id", membershipId)
      .eq("class_id", classId)
      .maybeSingle(),
    supabase
      .from("v_member_performance_status")
      .select("status")
      .eq("class_member_id", membershipId)
      .eq("class_id", classId)
      .maybeSingle(),
  ]);

  if (bands.error) {
    console.error("[student] failed to load current band", {
      code: bands.error.code,
      message: bands.error.message,
    });
    return null;
  }

  if (status.error) {
    console.error("[student] failed to load performance status", {
      code: status.error.code,
      message: status.error.message,
    });
    return null;
  }

  return {
    // 'stable' is what the view itself returns when there is nothing to
    // compare, so a missing row and an uneventful one read the same way.
    status: status.data?.status ?? "stable",
    targetBand: bands.data?.target_band ?? null,
    startOverall: bands.data?.start_overall ?? null,
    startReading: bands.data?.start_reading ?? null,
    startListening: bands.data?.start_listening ?? null,
    startWriting: bands.data?.start_writing ?? null,
    startSpeaking: bands.data?.start_speaking ?? null,
    currentOverall: bands.data?.current_overall ?? null,
    currentReading: bands.data?.current_reading ?? null,
    currentListening: bands.data?.current_listening ?? null,
    currentWriting: bands.data?.current_writing ?? null,
    currentSpeaking: bands.data?.current_speaking ?? null,
    currentRecordedOn: bands.data?.current_recorded_on ?? null,
  };
}

/**
 * This student's own band entries dated to one lesson.
 *
 * `score_entries` has no `session_id`, so a lesson's entries are the ones
 * recorded on that lesson's date — the same derivation the teacher's page and
 * `recordScoreEntry` use, on the same class clock. All three ids are named in
 * the filter, and `score_entries_student_select` restricts the same statement to
 * this student's memberships underneath.
 *
 * `null` means the query failed, `[]` means nothing was recorded that day.
 */
export async function loadStudentScoreEntries(
  supabase: Awaited<ReturnType<typeof createClient>>,
  classId: string,
  membershipId: string,
  recordedOn: string,
): Promise<StudentScoreEntry[] | null> {
  const { data: entries, error } = await supabase
    .from("score_entries")
    .select(
      "id, entry_type, overall, reading, listening, writing, speaking, note, recorded_on",
    )
    .eq("class_member_id", membershipId)
    .eq("class_id", classId)
    .eq("recorded_on", recordedOn)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[student] failed to load band entries", {
      code: error.code,
      message: error.message,
    });
    return null;
  }

  return (entries ?? []).map((entry) => ({
    entryId: entry.id,
    entryType: entry.entry_type,
    overall: entry.overall,
    reading: entry.reading,
    listening: entry.listening,
    writing: entry.writing,
    speaking: entry.speaking,
    note: entry.note,
    recordedOn: entry.recorded_on,
  }));
}

/**
 * One piece of teacher feedback in this student's own history.
 *
 * The same `lesson_logs` rows the lesson page shows for a single lesson, read
 * across the whole class in reverse chronological order — the Figma's "Recent
 * Teacher Feedback" panel and its "My Learning History" tab are the same rows
 * at two lengths.
 *
 * `mistakes` is deliberately absent. It is a list of the errors a teacher tagged
 * on the day, written for the teacher's own analysis; a student's own page is
 * not improved by a bare list of their mistakes with no lesson around it, and
 * the note beside it is where the teacher put what they wanted the student to
 * read.
 */
export type StudentFeedback = {
  logId: string;
  lessonDate: string;
  skill: Skill;
  performance: Performance;
  topic: string;
  note: string | null;
};

/**
 * This student's own lesson feedback across one class.
 *
 * `lesson_logs_student_select` is `class_member_id = any(app.my_member_ids())`,
 * so a student reaches their own rows and no one else's whatever this query
 * asks for. Both ids are named anyway — the membership the caller has already
 * proved through `loadStudentClass`, and the class it belongs to — so a
 * mismatched pair matches no row rather than being fetched and compared after.
 *
 * `null` means the query failed, `[]` means the teacher has written nothing.
 */
export async function loadStudentFeedback(
  supabase: Awaited<ReturnType<typeof createClient>>,
  classId: string,
  membershipId: string,
  limit: number,
): Promise<StudentFeedback[] | null> {
  const { data: logs, error } = await supabase
    .from("lesson_logs")
    .select("id, lesson_date, skill, performance, topic, note")
    .eq("class_member_id", membershipId)
    .eq("class_id", classId)
    .order("lesson_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[student] failed to load lesson feedback", {
      code: error.code,
      message: error.message,
    });
    return null;
  }

  return (logs ?? []).map((log) => ({
    logId: log.id,
    lessonDate: log.lesson_date,
    skill: log.skill,
    performance: log.performance,
    topic: log.topic,
    note: log.note,
  }));
}

/**
 * Every band this student has been given in one class, oldest first.
 *
 * The Figma draws this as a recharts line chart with a per-skill filter. There
 * is no charting library in this application and adding one for a single panel
 * would be a dependency carried by every page in the bundle — so the same rows
 * are rendered as a list, each entry showing what was recorded and when. The
 * trajectory the chart drew is still readable; the pixels are not.
 *
 * `score_entries_student_select` restricts this to the caller's own memberships
 * underneath. Oldest first because that is the direction progress is read in,
 * and because `v_member_current_band` already names the newest one on its own.
 *
 * `null` means the query failed, `[]` means nothing has been recorded.
 */
export async function loadStudentScoreHistory(
  supabase: Awaited<ReturnType<typeof createClient>>,
  classId: string,
  membershipId: string,
): Promise<StudentScoreEntry[] | null> {
  const { data: entries, error } = await supabase
    .from("score_entries")
    .select(
      "id, entry_type, overall, reading, listening, writing, speaking, note, recorded_on",
    )
    .eq("class_member_id", membershipId)
    .eq("class_id", classId)
    .order("recorded_on", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[student] failed to load band history", {
      code: error.code,
      message: error.message,
    });
    return null;
  }

  return (entries ?? []).map((entry) => ({
    entryId: entry.id,
    entryType: entry.entry_type,
    overall: entry.overall,
    reading: entry.reading,
    listening: entry.listening,
    writing: entry.writing,
    speaking: entry.speaking,
    note: entry.note,
    recordedOn: entry.recorded_on,
  }));
}
