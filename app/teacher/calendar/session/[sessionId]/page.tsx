import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { AttendanceLock } from "@/components/attendance/attendance-lock";
import { AttendanceButtons } from "@/components/attendance/status-buttons";
import { SubmitButton } from "@/components/auth/submit-button";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { Select } from "@/components/ui/select";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ATTENDANCE_LABELS, isAttendanceOpen } from "@/lib/attendance";
import { weekStart } from "@/lib/calendar";
import { loadSessionHomework, type SessionHomework } from "@/lib/homework";
import {
  NOTE_MAX_LENGTH,
  PERFORMANCE_LABELS,
  PERFORMANCE_LEVELS,
  SKILL_LABELS,
  SKILLS,
  TOPIC_MAX_LENGTH,
} from "@/lib/lesson-log";
import {
  formatBytes,
  loadSessionMaterials,
  materialTypeLabel,
  MATERIAL_ACCEPT,
  MAX_MATERIAL_BYTES,
  type Material,
} from "@/lib/materials";
import { requireTeacher } from "@/lib/onboarding";
import type { DynamicPageProps } from "@/lib/route-types";
import {
  BAND_FIELD_LABELS,
  BAND_FIELDS,
  BAND_SKILLS,
  BAND_VALUES,
  formatBand,
  isBandScored,
  MEMBER_STATUS_LABELS,
  SCORE_ENTRY_TYPE_LABELS,
  SCORE_ENTRY_TYPES,
  SCORE_NOTE_MAX_LENGTH,
} from "@/lib/score";
import { HOMEWORK_STATUS_LABELS } from "@/lib/student";
import { createClient } from "@/lib/supabase/server";
import {
  loadClassBands,
  loadScoreEntriesOn,
  loadSessionAttendance,
  loadSessionLessonNotes,
  loadTeacherSession,
  type LessonNote,
  type MemberBands,
  type ScoreEntry,
  type SessionAttendee,
} from "@/lib/teacher";
import {
  formatCalendarDate,
  formatZonedDate,
  formatZonedTime,
  zonedCalendarDate,
} from "@/lib/time";

import {
  createHomework,
  createLessonLog,
  recordAttendance,
  recordScoreEntry,
  removeHomework,
  removeMaterial,
  removeScoreEntry,
  updateSessionSchedule,
  uploadMaterial,
} from "@/app/teacher/[classId]/actions";

export const metadata: Metadata = {
  title: "Buổi học",
};

/**
 * One lesson, and everything a teacher does with it.
 *
 * ## Where it lives, and why it moved here
 *
 * The workspace has **one** URL and it is under the calendar. It was under
 * `/teacher/[classId]/sessions/[sessionId]`, which meant that opening a lesson
 * from Lịch dạy silently moved the teacher into Lớp học: the sidebar picks its
 * active section by path, so the section they were working in changed under
 * them because of where the page happened to be filed.
 *
 * The page was **moved**, not copied. Two routes rendering the same workspace
 * would have been two of everything — and worse, every one of the nine Server
 * Actions on this page redirects to a path built once inside `authoriseSession`,
 * so a second entry point would have needed each of them taught which one the
 * request came from. That includes `recordAttendance`, which is not to be
 * touched. One canonical path means all nine keep their single redirect and
 * every one of them returns the teacher to the calendar context. The old URL is
 * still a route: it redirects here, unconditionally and without a query, so
 * every existing link and bookmark keeps working and the redirect itself
 * discloses nothing about whether that session exists.
 *
 * ## Authorization: one query, and the class comes out of it
 *
 * Because there is no class id in the path any more, there is nothing to check
 * a session against — the class is **resolved from the session**.
 * `loadTeacherSession` reads `class_sessions` joined `classes!inner` and
 * filtered on the authenticated teacher's id, so a session belonging to another
 * teacher matches no row, and a lesson in an archived class matches no row
 * either. The answer is `not-found`, and `notFound()` renders exactly what a
 * session id that was never real renders.
 *
 * That is not a weaker check than the two-step one it replaced; it is a
 * stronger one. Previously the request supplied a class *and* a session and the
 * page had to prove they belonged together. Now it supplies one id and the
 * database returns the pair, so there is no mismatched pair to construct. It is
 * also one round trip fewer. The loader refuses anything that is not a uuid
 * before making that trip at all.
 *
 * `session` is a static segment, so `[sessionId]` can never swallow it.
 *
 * ## The panels
 *
 * This page is the destination of a click on the calendar, so it is the
 * session's workspace rather than an attendance sheet with two extra sections.
 * The four tabs the milestone names come first and in its order —
 * Danh sách học sinh, Điểm danh, Bài tập, Giáo trình — and the two this page
 * already had, Ghi chú and Band điểm, follow them. Neither was removed: they
 * are working features with real tables behind them, and deleting one to match
 * a tab list would be the opposite of fidelity. Band điểm is still absent for a
 * class that is not band-scored, exactly as before.
 *
 * **Nothing under Điểm danh moved.** `components/attendance/status-buttons.tsx`
 * is untouched, `recordAttendance` is untouched, and the form around them is the
 * same bound Server Action with the same four submit buttons. The section
 * changed panel; the mechanism did not.
 *
 * ## Tabs are links, and the loaders follow the tab
 *
 * `?tab=` selects the panel and every tab is a `<Link>`, so the workspace pages
 * with JavaScript disabled and each panel is bookmarkable and in the back
 * button — the same rule the class-detail tabs and the student dashboard follow.
 * They are deliberately **not** prefetched: each tab's reads are gated on that
 * tab being rendered, so prefetching would issue every query on every visit for
 * panels the teacher may never open. `PendingTint` acknowledges the click
 * instead.
 *
 * The class and the session are always read, because the header is made of
 * them. Everything else is chosen by the tab and issued in one `Promise.all`:
 * the roster for the three panels that name students, the standings and today's
 * entries only for a band-scored class, homework and materials only when their
 * own panel is open. A `null` from any of them is a failed read and says so;
 * it is never rendered as "there is nothing here", because that is a claim this
 * page may only make on an answer it actually got.
 */

/** The panels, in the order the milestone asks for them. */
const TABS = [
  { key: "students", label: "Danh sách học sinh" },
  { key: "attendance", label: "Điểm danh" },
  { key: "homework", label: "Bài tập" },
  { key: "materials", label: "Giáo trình" },
  { key: "notes", label: "Ghi chú" },
  { key: "bands", label: "Band điểm" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/**
 * Anything unrecognised falls back to the first panel rather than erroring, and
 * `bands` falls back too when the class has no band scale — a General English
 * class has no such tab to select, and `?tab=bands` must not produce an empty
 * page with no way out of it.
 *
 * `attendance` falls back on exactly the same reasoning, for exactly the same
 * shape of reason: before the lesson starts there is no register to select, so
 * `?tab=attendance` typed into the address bar cannot select one. That is what
 * makes the direct URL safe by construction rather than by a hidden form — the
 * sheet, the four submit buttons and the bound `recordAttendance` are not
 * rendered at all, so there is nothing on the page to submit. The visitor lands
 * on the first panel beside `AttendanceLock`, which tells them when to come
 * back. The rule itself is enforced in the Server Action; this is only which
 * panel to draw.
 */
function readTab(
  value: unknown,
  banded: boolean,
  attendanceOpen: boolean,
): TabKey {
  const found = TABS.find((tab) => tab.key === value);
  if (!found) return "students";
  if (found.key === "bands" && !banded) return "students";
  if (found.key === "attendance" && !attendanceOpen) return "students";
  return found.key;
}

export default async function SessionPage({
  params,
  searchParams,
}: DynamicPageProps<{ sessionId: string }>) {
  const { sessionId } = await params;

  // Anonymous goes to the login page, a student and an unplaceable account go
  // to `/` — the same guard every other teacher page uses, and the same one
  // `recordAttendance` repeats for itself.
  const teacher = await requireTeacher();

  const supabase = await createClient();

  // One query, and the class comes *out* of it rather than in. The join is
  // `classes!inner` filtered on this teacher's id, so a session belonging to
  // anyone else matches no row and is reported as a lesson that does not
  // exist — the same answer, from the same shape of check, as the two-step
  // load this route used when it hung under `/teacher/[classId]`. It is also
  // one round trip fewer, and there is no longer a class id in the URL that
  // could disagree with the session's own.
  const found = await loadTeacherSession(supabase, teacher.userId, sessionId);

  if (found.kind === "not-found") {
    notFound();
  }

  if (found.kind === "error") {
    return (
      <Frame>
        {/* Not a 404: the query failed. `null` is not `[]`, and a load that
            did not answer may not be reported as an absence. */}
        <Alert>
          Chúng tôi chưa tải được buổi học này. Vui lòng tải lại trang.
        </Alert>
      </Frame>
    );
  }

  const { classId, fields, session } = found;

  // `score_entries` has no `session_id` — it hangs off a membership and a
  // `recorded_on date` — so "this lesson's entries" means the entries dated to
  // the day this lesson happened on, read on the class's own clock by the same
  // function `createLessonLog` derives `lesson_date` with.
  const banded = isBandScored(fields.courseType);
  const recordedOn = zonedCalendarDate(fields.timezone, session.startsAt);

  // One instant for the whole render, so the tab, the panel and the countdown
  // are all judged against the same moment. `starts_at` is a `timestamptz` and
  // this is an instant, so the comparison needs no timezone — see
  // `lib/attendance.ts`. The class's zone is used below only to *say* when the
  // register opens.
  const now = new Date();
  const attendanceOpen = isAttendanceOpen(session.startsAt, now.getTime());
  const startsToday =
    recordedOn === zonedCalendarDate(fields.timezone, now.toISOString());

  const query = await searchParams;
  const error = typeof query.error === "string" ? query.error : undefined;
  const tab = readTab(
    typeof query.tab === "string" ? query.tab : undefined,
    banded,
    attendanceOpen,
  );

  // The roster answers for three panels; the rest answer for one each. Every
  // read that is not needed by the open tab is skipped rather than discarded,
  // which is the same gating M19 applied to `loadClassSessions`.
  const wantsRoster =
    tab === "students" || tab === "attendance" || tab === "notes" || tab === "bands";
  const wantsStandings = banded && (tab === "students" || tab === "bands");

  const [attendees, notes, standings, entries, homework, materials] =
    await Promise.all([
      wantsRoster
        ? loadSessionAttendance(supabase, classId, sessionId)
        : Promise.resolve(null),
      tab === "notes"
        ? loadSessionLessonNotes(supabase, classId, sessionId)
        : Promise.resolve(null),
      wantsStandings
        ? loadClassBands(supabase, classId)
        : Promise.resolve(null),
      banded && tab === "bands"
        ? loadScoreEntriesOn(supabase, classId, recordedOn)
        : Promise.resolve(null),
      tab === "homework"
        ? loadSessionHomework(supabase, classId, sessionId)
        : Promise.resolve(null),
      tab === "materials"
        ? loadSessionMaterials(supabase, classId, sessionId)
        : Promise.resolve(null),
    ]);

  const base = `/teacher/calendar/session/${sessionId}`;
  const items: TabItem[] = TABS.filter(
    (entry) => entry.key !== "bands" || banded,
  ).map((entry) => ({
    label: entry.label,
    href: entry.key === "students" ? base : `${base}?tab=${entry.key}`,
    current: entry.key === tab,
    // Visible, dimmed and not a link until the lesson starts. Kept in the strip
    // rather than removed from it because the tab is a fact about this
    // workspace: a teacher who cannot see it would look for it.
    disabled: entry.key === "attendance" && !attendanceOpen,
    disabledHint:
      entry.key === "attendance" && !attendanceOpen ? "chưa mở" : undefined,
  }));

  return (
    <Frame className={fields.className}>
      {/* The lesson names the page and the class names the trail above it,
          which is the Figma's header everywhere: the heading is the thing you
          opened, not the thing it belongs to. An untitled lesson — `title` is
          nullable — falls back to the word for what it is rather than
          borrowing the class name and repeating the crumb.

          The date and the times are read on the class's own clock, by the same
          two functions the lesson list uses. See `lib/time.ts`. They are two
          metadata nodes rather than one `·`-joined string so a narrow screen
          wraps between the date and the times instead of inside either.

          The trail now starts at Lịch dạy, because that is where this page
          lives: the sidebar marks Lịch dạy active on every path below
          `/teacher/calendar`, and a trail that began at Lớp học would have the
          breadcrumb and the navigation naming two different sections of the
          same screen. The class keeps its crumb in the middle — the lesson does
          still belong to it, and that is still the way back to the roster.

          Alongside it, an explicit button back to the week this lesson sits
          in. The week is derived from the lesson's own date rather than carried
          in a query parameter, which means it is right however the teacher
          arrived — from the calendar, from the class page, from a bookmark —
          and, after the schedule is edited, it points at the week the lesson
          has moved to rather than the one it left. */}
      <PageHeader
        breadcrumb={[
          { label: "Lịch dạy", href: "/teacher/calendar" },
          { label: fields.className, href: `/teacher/${classId}` },
          { label: "Buổi học" },
        ]}
        title={session.title ?? "Buổi học"}
        meta={[
          formatZonedDate(fields.timezone, session.startsAt),
          `${formatZonedTime(fields.timezone, session.startsAt)} – ${formatZonedTime(fields.timezone, session.endsAt)}`,
        ]}
        actions={
          <Button asChild variant="outline" size="sm" className="relative">
            <Link
              href={`/teacher/calendar?week=${weekStart(
                zonedCalendarDate(fields.timezone, session.startsAt),
              )}`}
            >
              Quay lại Lịch dạy
            </Link>
          </Button>
        }
      />

      {/* Only when it is not the default this application creates. Nothing here
          can change it; showing it stops the page misreporting the lesson. */}
      {session.status === "scheduled" ? null : (
        <p className="-mt-2 mb-6 text-sm text-muted-foreground">
          {session.status === "cancelled"
            ? "Buổi học này đã bị hủy."
            : "Buổi học này đã được đánh dấu hoàn thành."}
        </p>
      )}

      {error ? <Alert className="mb-6">{error}</Alert> : null}

      <ScheduleEditor
        classId={classId}
        sessionId={sessionId}
        date={recordedOn}
        startTime={formatZonedTime(fields.timezone, session.startsAt)}
        endTime={formatZonedTime(fields.timezone, session.endsAt)}
      />

      <Tabs
        items={items}
        label="Các mục của buổi học"
        className={attendanceOpen ? "mt-6 mb-6" : "mt-6 mb-3"}
      />

      {/* Beneath the strip, so the dimmed tab has its reason next to it on
          whichever panel the teacher is reading. Server-rendered and seeded
          with this render's own instant, so it is right with JavaScript off and
          merely stops counting; in a browser it ticks and asks the server for
          the page again at the start minute. It explains the lock — it is not
          the lock. See `recordAttendance`. */}
      {attendanceOpen ? null : (
        <AttendanceLock
          startsAt={session.startsAt}
          opensAtLabel={
            // The day is only worth saying when it is not today. The header
            // above already carries the full date; this line is one sentence.
            startsToday
              ? `lúc ${formatZonedTime(fields.timezone, session.startsAt)}`
              : `lúc ${formatZonedTime(
                  fields.timezone,
                  session.startsAt,
                )} ngày ${formatCalendarDate(recordedOn)}`
          }
          initialNow={now.getTime()}
        />
      )}

      {tab === "students" ? (
        <StudentsPanel attendees={attendees} standings={standings} />
      ) : null}

      {tab === "attendance" ? (
        <AttendancePanel
          attendees={attendees}
          classId={classId}
          sessionId={sessionId}
        />
      ) : null}

      {tab === "homework" ? (
        <HomeworkPanel
          homework={homework}
          classId={classId}
          sessionId={sessionId}
        />
      ) : null}

      {tab === "materials" ? (
        <MaterialsPanel
          materials={materials}
          classId={classId}
          sessionId={sessionId}
        />
      ) : null}

      {tab === "notes" ? (
        <NotesPanel
          notes={notes}
          attendees={attendees}
          classId={classId}
          sessionId={sessionId}
        />
      ) : null}

      {tab === "bands" && banded ? (
        <BandsPanel
          attendees={attendees}
          standings={standings}
          entries={entries}
          classId={classId}
          sessionId={sessionId}
        />
      ) : null}
    </Frame>
  );
}

/**
 * Moving the lesson without a pointer.
 *
 * The calendar lets a teacher drag a block from one day to another, and the
 * milestone is explicit that a drag "must NOT be the only mechanism for moving
 * a session". This is the other one, and it is the better one: a plain form on
 * a page reached by a plain link, so it works with a keyboard, with a screen
 * reader, on a touch screen where dragging a 12px block is unreasonable, and
 * with JavaScript switched off — none of which is true of a drag. It also does
 * more than the drag can, because it takes the two times as well as the day.
 *
 * A `<details>` rather than an always-open form: the schedule is right, almost
 * always, and a page whose first control is "change this" invites changing it.
 * `<details>` opens natively with no script at all, which is the only kind of
 * disclosure this application uses.
 *
 * `updateSessionSchedule` re-derives the teacher, the class and the session on
 * the server and shares its write with the drag — one validation, one
 * conversion, one statement — so the two paths cannot disagree about what a
 * move means.
 */
function ScheduleEditor({
  classId,
  sessionId,
  date,
  startTime,
  endTime,
}: {
  classId: string;
  sessionId: string;
  date: string;
  startTime: string;
  endTime: string;
}) {
  return (
    <details className="mt-4 rounded-xl border border-border bg-card px-5 py-4">
      <summary className="cursor-pointer list-none text-sm font-medium text-foreground outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        Lịch buổi học — sửa ngày, giờ
      </summary>

      <form
        action={updateSessionSchedule.bind(null, classId, sessionId)}
        className="mt-4 space-y-4"
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="schedule-date">Ngày</Label>
            <Input
              id="schedule-date"
              name="date"
              type="date"
              defaultValue={date}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="schedule-start">Giờ bắt đầu</Label>
            <Input
              id="schedule-start"
              name="start_time"
              type="time"
              defaultValue={startTime}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="schedule-end">Giờ kết thúc</Label>
            <Input
              id="schedule-end"
              name="end_time"
              type="time"
              defaultValue={endTime}
              required
            />
          </div>
        </div>

        <SubmitButton pendingLabel="Đang lưu…">Lưu lịch</SubmitButton>
      </form>
    </details>
  );
}

/**
 * Tab 1 — who is in this class.
 *
 * The roster of the *selected class*, read by `loadSessionAttendance`, which
 * filters `class_members` by `class_id` and by the two state columns that mean
 * "currently enrolled". A student of another class cannot appear here: there is
 * no id from the request anywhere in that query, and
 * `class_members_teacher_all` scopes it to this teacher's classes underneath.
 *
 * Name, email and — for a band-scored class — the standing the database already
 * computes. Nothing is derived on this page. There is no attendance rate, no
 * homework percentage and no invented metric of any kind: `v_member_current_band`
 * and `v_member_performance_status` are the only opinions expressed here, and
 * they are the same ones the class page and the student's own screen show.
 */
function StudentsPanel({
  attendees,
  standings,
}: {
  attendees: SessionAttendee[] | null;
  standings: Map<string, MemberBands> | null;
}) {
  if (attendees === null) {
    return (
      <Alert>
        Chúng tôi chưa tải được danh sách học viên của lớp này. Vui lòng tải lại
        trang.
      </Alert>
    );
  }

  if (attendees.length === 0) {
    return (
      <EmptyState
        title="Lớp này chưa có học viên nào"
        description="Mời học viên từ trang lớp học để họ xuất hiện ở đây."
      />
    );
  }

  return (
    <ul className="space-y-3">
      {attendees.map((attendee) => (
        <li key={attendee.membershipId}>
          <Card variant="list">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-semibold break-words text-foreground">
                  {attendee.name ?? attendee.email ?? "Học viên chưa có tên"}
                </h3>
                {attendee.name && attendee.email ? (
                  <p className="mt-0.5 text-sm break-words text-muted-foreground">
                    {attendee.email}
                  </p>
                ) : null}
              </div>

              {/* The mark this lesson already carries, so the list of who is in
                  the class also says who was here — the same value the Điểm
                  danh tab writes, read from the same row. "Chưa ghi nhận" is a
                  state of its own and never `absent`. */}
              <Badge tone="neutral">
                {attendee.attendance
                  ? ATTENDANCE_LABELS[attendee.attendance]
                  : "Chưa ghi nhận"}
              </Badge>
            </div>

            {standings ? (
              <Standing bands={standings.get(attendee.membershipId) ?? null} />
            ) : null}
          </Card>
        </li>
      ))}
    </ul>
  );
}

/**
 * Tab 2 — the attendance sheet, moved into a panel and otherwise untouched.
 *
 * Same `Attendee` component, same bound `recordAttendance`, same
 * `AttendanceButtons`. M12's optimistic `useFormStatus().data` mechanism and its
 * no-JavaScript fallback of one form with four submit buttons are exactly as
 * they were; this function only decides which of the three states to render.
 *
 * There is deliberately no fourth state for "the lesson has not started". This
 * panel is only reached once it has: `readTab` cannot resolve to `attendance`
 * while the register is shut, so nothing here — no form, no bound action, no
 * submit button — is rendered before the start minute, and there is no locked
 * variant of the sheet that could drift out of step with the working one. The
 * explanation lives above the tab strip in `AttendanceLock`, and the rule that
 * matters lives in `recordAttendance`.
 */
function AttendancePanel({
  attendees,
  classId,
  sessionId,
}: {
  attendees: SessionAttendee[] | null;
  classId: string;
  sessionId: string;
}) {
  if (attendees === null) {
    return (
      <Alert>
        Chúng tôi chưa tải được danh sách học viên của lớp này. Vui lòng tải lại
        trang.
      </Alert>
    );
  }

  if (attendees.length === 0) {
    return (
      <EmptyState
        title="Lớp này chưa có học viên nào"
        description="Điểm danh cần ít nhất một học viên trong lớp."
      />
    );
  }

  return (
    <ul className="space-y-3">
      {attendees.map((attendee) => (
        <li key={attendee.membershipId}>
          <Card>
            <Attendee
              attendee={attendee}
              classId={classId}
              sessionId={sessionId}
            />
          </Card>
        </li>
      ))}
    </ul>
  );
}

/**
 * Tab 3 — the homework set for this lesson.
 *
 * `homework_assignments` has carried a nullable `session_id` bound to its class
 * by a composite foreign key since the foundation commit, so the relationship
 * this panel needs already existed and nothing was invented for it. Creating an
 * assignment also writes one `homework_submissions` row per active member —
 * see `createHomework`, and `public.submit_homework()`, which raises rather
 * than inserting when no row is waiting for the student.
 *
 * The tally is four counts and not a percentage, because `public.homework_status`
 * distinguishes a student who has not started from one who missed the deadline
 * and collapsing them would throw that away.
 */
function HomeworkPanel({
  homework,
  classId,
  sessionId,
}: {
  homework: SessionHomework[] | null;
  classId: string;
  sessionId: string;
}) {
  return (
    <>
      {homework === null ? (
        <Alert>
          Chúng tôi chưa tải được bài tập của buổi học này. Vui lòng tải lại
          trang.
        </Alert>
      ) : homework.length === 0 ? (
        <Card variant="list">
          <p className="text-sm text-muted-foreground">
            Buổi học này chưa có bài tập nào.
          </p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {homework.map((item) => (
            <li key={item.assignmentId}>
              <Card variant="list">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-semibold break-words text-foreground">
                      {item.title}
                    </h3>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {SKILL_LABELS[item.skill]}
                      {item.dueDate ? ` · Hạn nộp ${item.dueDate}` : ""}
                      {` · Điểm tối đa ${item.maxScore}`}
                    </p>
                  </div>

                  <form
                    action={removeHomework.bind(
                      null,
                      classId,
                      sessionId,
                      item.assignmentId,
                    )}
                  >
                    <SubmitButton
                      pendingLabel="Đang xóa…"
                      className="border border-destructive/30 bg-card px-3 py-1.5 text-xs font-medium text-destructive hover:bg-background"
                    >
                      Xóa
                    </SubmitButton>
                  </form>
                </div>

                {item.description ? (
                  <p className="mt-3 text-sm break-words whitespace-pre-line text-foreground">
                    {item.description}
                  </p>
                ) : null}

                {item.total === 0 ? (
                  <p className="mt-3 text-sm text-muted-foreground">
                    Chưa giao cho học viên nào.
                  </p>
                ) : (
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {(
                      ["assigned", "submitted", "graded", "missed"] as const
                    ).map((status) => (
                      <li key={status}>
                        <Badge tone="neutral">
                          {HOMEWORK_STATUS_LABELS[status]} {item.counts[status]}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Card className="mt-3">
        <HomeworkForm classId={classId} sessionId={sessionId} />
      </Card>
    </>
  );
}

/**
 * The form that sets one.
 *
 * `assigned_on`, `class_id`, `session_id` and `created_by` are not fields here.
 * All four are derived on the server — the lesson's own date on the class's
 * clock, the two proved ids, and the teacher in the session cookie — because a
 * field the browser could set is a field the browser could lie about.
 *
 * `max_score` defaults to 10 because `homework_assignments.max_score` does, and
 * the skill defaults to `general`, the enum's own value for "not one skill in
 * particular".
 */
function HomeworkForm({
  classId,
  sessionId,
}: {
  classId: string;
  sessionId: string;
}) {
  return (
    <form
      action={createHomework.bind(null, classId, sessionId)}
      className="space-y-4"
    >
      <div className="space-y-1.5">
        <Label htmlFor="homework-title">Tên bài tập</Label>
        <Input
          id="homework-title"
          name="title"
          type="text"
          maxLength={300}
          placeholder="Nội dung bài tập về nhà"
          required
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="homework-skill">Kỹ năng</Label>
          <Select
            id="homework-skill"
            name="skill"
            defaultValue="general"
            required
          >
            {SKILLS.map((skill) => (
              <option key={skill} value={skill}>
                {SKILL_LABELS[skill]}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="homework-due">Hạn nộp</Label>
          <Input id="homework-due" name="due_date" type="date" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="homework-max">Điểm tối đa</Label>
          <Input
            id="homework-max"
            name="max_score"
            type="number"
            min="0.1"
            max="999.9"
            step="0.1"
            defaultValue="10"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="homework-description">Mô tả</Label>
        <Textarea
          id="homework-description"
          name="description"
          rows={3}
          maxLength={NOTE_MAX_LENGTH}
          placeholder="Không bắt buộc — hướng dẫn cho học viên"
        />
      </div>

      <SubmitButton pendingLabel="Đang giao bài tập…" className="mt-6 w-full">
        Giao bài tập
      </SubmitButton>
    </form>
  );
}

/**
 * Tab 4 — the curriculum files attached to this lesson.
 *
 * ## Storage, and why there is a migration
 *
 * There was no file storage in this application at all before M30: no bucket,
 * no upload helper, no metadata table, nothing in fifteen migrations and
 * nothing in `app/`, `lib/` or `components/`. So the smallest secure thing
 * consistent with the existing architecture was designed —
 * `supabase/migrations/20260901000100_class_materials.sql`, a **private**
 * bucket plus one `class_materials` table with the same teacher-scoped RLS
 * shape every other table here uses. It is written but deliberately **not
 * applied**; until a human runs it this panel renders the ordinary failed-read
 * alert, which is the honest thing for a page to do about a table that is not
 * there yet.
 *
 * ## The file never becomes a public URL
 *
 * The bucket is private, the storage policies key on the class id being the
 * first path segment and on `app.my_class_ids()`, and the object path is a
 * `crypto.randomUUID()` under the class — not the filename, so nothing is
 * guessable from a name a teacher typed. A download goes through
 * `app/teacher/[classId]/materials/[materialId]/route.ts`, which re-proves the
 * teacher and reads the path *out of the row* before asking the object store
 * for a sixty-second signed URL. There is no service-role key in this path, or
 * anywhere in this application.
 *
 * Nothing parses, indexes, summarises or otherwise processes the file. It is
 * stored and it is handed back.
 */
function MaterialsPanel({
  materials,
  classId,
  sessionId,
}: {
  materials: Material[] | null;
  classId: string;
  sessionId: string;
}) {
  return (
    <>
      {materials === null ? (
        <Alert>
          Chúng tôi chưa tải được giáo trình của buổi học này. Vui lòng tải lại
          trang.
        </Alert>
      ) : materials.length === 0 ? (
        <Card variant="list">
          <p className="text-sm text-muted-foreground">
            Buổi học này chưa có tài liệu nào.
          </p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {materials.map((material) => (
            <li key={material.materialId}>
              <Card variant="list">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    {/* A real link to a real route: click, middle-click,
                        keyboard and no-JavaScript all work, which a scripted
                        download button cannot claim. */}
                    <Link
                      href={`/teacher/${classId}/materials/${material.materialId}`}
                      className="relative font-semibold break-words text-primary underline-offset-4 outline-none hover:underline focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      {material.fileName}
                    </Link>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {materialTypeLabel(material.mimeType, material.fileName)} ·{" "}
                      {formatBytes(material.byteSize)}
                    </p>
                  </div>

                  <form
                    action={removeMaterial.bind(
                      null,
                      classId,
                      sessionId,
                      material.materialId,
                    )}
                  >
                    <SubmitButton
                      pendingLabel="Đang xóa…"
                      className="border border-destructive/30 bg-card px-3 py-1.5 text-xs font-medium text-destructive hover:bg-background"
                    >
                      Xóa
                    </SubmitButton>
                  </form>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Card className="mt-3">
        <form
          action={uploadMaterial.bind(null, classId, sessionId)}
          encType="multipart/form-data"
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="material-file">Tệp giáo trình</Label>
            <Input
              id="material-file"
              name="file"
              type="file"
              accept={MATERIAL_ACCEPT}
              required
            />
            {/* `accept` is a hint the browser may ignore and a POST is not a
                form, so the server checks the type and the size again. This
                line is what the teacher is told beforehand. */}
            <p className="text-xs text-muted-foreground">
              PDF, Word, Excel hoặc PowerPoint, tối đa{" "}
              {formatBytes(MAX_MATERIAL_BYTES)}.
            </p>
          </div>

          <SubmitButton pendingLabel="Đang tải lên…" className="mt-6 w-full">
            Tải giáo trình lên
          </SubmitButton>
        </form>
      </Card>
    </>
  );
}

/** Tab 5 — the lesson notes this page already carried, in a panel of their own. */
function NotesPanel({
  notes,
  attendees,
  classId,
  sessionId,
}: {
  notes: LessonNote[] | null;
  attendees: SessionAttendee[] | null;
  classId: string;
  sessionId: string;
}) {
  return (
    <>
      {notes === null ? (
        <Alert>
          Chúng tôi chưa tải được ghi chú của buổi học này. Vui lòng tải lại
          trang.
        </Alert>
      ) : notes.length === 0 ? (
        <Card variant="list">
          <p className="text-sm text-muted-foreground">
            Chưa có ghi chú nào được thêm.
          </p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {notes.map((note) => (
            <li key={note.noteId}>
              <Card>
                <Note note={note} />
              </Card>
            </li>
          ))}
        </ul>
      )}

      {/* A note names a student, so there is nothing to write until the class
          has one. A failed roster read is reported rather than silently
          removing the form. */}
      {attendees === null ? (
        <Alert className="mt-3">
          Chúng tôi chưa tải được danh sách học viên của lớp này. Vui lòng tải
          lại trang.
        </Alert>
      ) : attendees.length > 0 ? (
        <Card className="mt-3">
          <NoteForm
            attendees={attendees}
            classId={classId}
            sessionId={sessionId}
          />
        </Card>
      ) : null}
    </>
  );
}

/**
 * Tab 6 — the band panel, and only for a class that keeps bands at all.
 *
 * `scoringModelFor` is the rule and `classes_no_target_band_when_unscored` is
 * the schema agreeing. A General English class gets no tab, `readTab` refuses
 * `?tab=bands` for it, and `recordScoreEntry` refuses the write underneath.
 */
function BandsPanel({
  attendees,
  standings,
  entries,
  classId,
  sessionId,
}: {
  attendees: SessionAttendee[] | null;
  standings: Map<string, MemberBands> | null;
  entries: ScoreEntry[] | null;
  classId: string;
  sessionId: string;
}) {
  if (standings === null || entries === null || attendees === null) {
    return (
      <Alert>
        Chúng tôi chưa tải được band điểm của lớp này. Vui lòng tải lại trang.
      </Alert>
    );
  }

  return (
    <>
      {attendees.length === 0 && entries.length === 0 ? (
        <EmptyState
          title="Lớp này chưa có học viên nào"
          description="Band điểm được ghi nhận cho từng học viên trong lớp."
        />
      ) : (
        <ul className="space-y-3">
          {bandRows(attendees, standings, entries).map((row) => (
            <li key={row.membershipId}>
              <Card>
                <BandRow row={row} classId={classId} sessionId={sessionId} />
              </Card>
            </li>
          ))}
        </ul>
      )}

      {/* An entry names a student, like a note does. */}
      {attendees.length > 0 ? (
        <Card className="mt-3">
          <ScoreForm
            attendees={attendees}
            classId={classId}
            sessionId={sessionId}
          />
        </Card>
      ) : null}
    </>
  );
}

/**
 * One note as it was written.
 *
 * The topic leads because it is what the note is about; the student, the skill
 * and how they did are the three enum-shaped facts beside it; the note itself is
 * the body. The lesson's date is not repeated — every note on this page carries
 * the same one, and it is already in the header.
 *
 * `whitespace-pre-line` keeps the teacher's paragraph breaks. React escapes the
 * text, so nothing typed into the field can become markup.
 */
function Note({ note }: { note: LessonNote }) {
  return (
    <>
      {/* `break-words` because both of these are free text: a 300-character
          topic with no spaces in it would otherwise widen the whole page. */}
      <h3 className="font-semibold break-words text-foreground">{note.topic}</h3>

      <p className="mt-1 text-sm text-muted-foreground">
        {note.studentName ?? "Học viên chưa có tên"} · {SKILL_LABELS[note.skill]} ·{" "}
        {PERFORMANCE_LABELS[note.performance]}
      </p>

      {note.note ? (
        <p className="mt-3 text-sm break-words whitespace-pre-line text-foreground">
          {note.note}
        </p>
      ) : null}
    </>
  );
}

/**
 * The form that writes one.
 *
 * Four fields rather than one, because `lesson_logs` is a per-student
 * observation and its NOT NULL columns say so: a row cannot exist without a
 * `class_member_id`, a `skill`, a `topic` and a `performance`. The milestone's
 * wording describes a single memo; the schema is what this follows.
 *
 * `lesson_date` and `created_by` are not here at all. Both are derived on the
 * server — the lesson's own start read on the class's clock, and the teacher in
 * the session cookie — because a field the browser could set is a field the
 * browser could lie about.
 *
 * The student and the performance start unselected. A `<select>` always has a
 * selection, so defaulting either would file a note against whoever happened to
 * be first on the roster, or record a judgement the teacher never made; an empty
 * `required` option makes the browser ask instead. The skill defaults to
 * `general`, which is the enum's own value for "not one skill in particular".
 *
 * Two ids are bound on the server and neither is trusted there; `maxLength` here
 * is a courtesy that stops the field over-filling, and the action checks both
 * lengths again against the schema's constraint and the application's cap.
 */
function NoteForm({
  attendees,
  classId,
  sessionId,
}: {
  attendees: SessionAttendee[];
  classId: string;
  sessionId: string;
}) {
  return (
    <form
      action={createLessonLog.bind(null, classId, sessionId)}
      className="space-y-4"
    >
      <div className="space-y-1.5">
        <Label htmlFor="class_member_id">Học viên</Label>
        <Select
          id="class_member_id"
          name="class_member_id"
          defaultValue=""
          required
        >
          <option value="" disabled>
            Chọn học viên
          </option>
          {attendees.map((attendee) => (
            <option key={attendee.membershipId} value={attendee.membershipId}>
              {attendee.name ?? attendee.email ?? "Học viên chưa có tên"}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="topic">Chủ đề</Label>
        <Input
          id="topic"
          name="topic"
          type="text"
          maxLength={TOPIC_MAX_LENGTH}
          placeholder="Nội dung buổi học"
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="skill">Kỹ năng</Label>
          <Select id="skill" name="skill" defaultValue="general" required>
            {SKILLS.map((skill) => (
              <option key={skill} value={skill}>
                {SKILL_LABELS[skill]}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="performance">Kết quả</Label>
          <Select id="performance" name="performance" defaultValue="" required>
            <option value="" disabled>
              Chọn
            </option>
            {PERFORMANCE_LEVELS.map((level) => (
              <option key={level} value={level}>
                {PERFORMANCE_LABELS[level]}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="note">Ghi chú buổi học</Label>
        <Textarea
          id="note"
          name="note"
          rows={4}
          maxLength={NOTE_MAX_LENGTH}
          placeholder="Tình hình học tập của học viên trong buổi này"
          required
        />
      </div>

      <SubmitButton pendingLabel="Đang thêm ghi chú…" className="mt-6 w-full">
        Thêm ghi chú
      </SubmitButton>
    </form>
  );
}

/**
 * One student, and the four marks a teacher can give them.
 *
 * One form, four submit buttons, each carrying its own `status` value — so the
 * mark is made by the button that was pressed and the whole thing works without
 * JavaScript, like every other form in this application. The three ids are bound
 * on the server; `status` is the only value the browser supplies, and the action
 * checks it against `public.attendance_status` before using it.
 *
 * The current mark is the filled button rather than a badge, so the state and
 * the control are the same object and there is nothing to keep in agreement. An
 * unmarked student says so in words, because a row of four outline buttons on
 * its own would look identical to one whose mark simply failed to render.
 *
 * The buttons themselves are a client component so that the press registers
 * before the server answers — see `components/attendance/status-buttons.tsx`.
 * The form around them is unchanged: same bound Server Action, same
 * authorization, same no-JavaScript fallback.
 */
function Attendee({
  attendee,
  classId,
  sessionId,
}: {
  attendee: SessionAttendee;
  classId: string;
  sessionId: string;
}) {
  return (
    <>
      {attendee.name ? (
        <>
          <h3 className="mb-1 font-semibold text-foreground">
            {attendee.name}
          </h3>
          {attendee.email ? (
            <p className="text-sm text-muted-foreground">{attendee.email}</p>
          ) : null}
        </>
      ) : (
        <h3 className="font-semibold text-foreground">
          {attendee.email ?? "Học viên chưa có tên"}
        </h3>
      )}

      <form
        action={recordAttendance.bind(
          null,
          classId,
          sessionId,
          attendee.membershipId,
        )}
      >
        <AttendanceButtons recorded={attendee.attendance} />
      </form>
    </>
  );
}

/**
 * One student's band standing, and whatever was recorded for them today.
 *
 * `entries` is the entries dated to this lesson, which is as close to "this
 * lesson's scores" as the schema gets — `score_entries` has no `session_id`.
 */
type BandRowData = {
  membershipId: string;
  name: string | null;
  bands: MemberBands | null;
  entries: ScoreEntry[];
};

/**
 * The active roster, each student carrying their standing and today's entries,
 * followed by anyone else today's entries mention.
 *
 * The second part is the reason this is a function rather than a `.map`. A
 * student can be removed from a class after being assessed in it, and
 * `score_entries` survives that on purpose — the composite foreign key cascades
 * on the membership, not on `removed_at`. Those entries would otherwise be
 * invisible on the only page that can delete them, so they are listed after the
 * roster under the name the entry itself carries.
 */
function bandRows(
  attendees: SessionAttendee[],
  standings: Map<string, MemberBands>,
  entries: ScoreEntry[],
): BandRowData[] {
  const byMember = new Map<string, ScoreEntry[]>();
  for (const entry of entries) {
    const existing = byMember.get(entry.membershipId);
    if (existing) existing.push(entry);
    else byMember.set(entry.membershipId, [entry]);
  }

  const rows: BandRowData[] = attendees.map((attendee) => ({
    membershipId: attendee.membershipId,
    name: attendee.name ?? attendee.email,
    bands: standings.get(attendee.membershipId) ?? null,
    entries: byMember.get(attendee.membershipId) ?? [],
  }));

  const listed = new Set(attendees.map((attendee) => attendee.membershipId));
  for (const [membershipId, group] of byMember) {
    if (listed.has(membershipId)) continue;
    rows.push({
      membershipId,
      name: group[0].studentName,
      bands: standings.get(membershipId) ?? null,
      entries: group,
    });
  }

  return rows;
}

function BandRow({
  row,
  classId,
  sessionId,
}: {
  row: BandRowData;
  classId: string;
  sessionId: string;
}) {
  return (
    <>
      <h3 className="font-semibold break-words text-foreground">
        {row.name ?? "Học viên chưa có tên"}
      </h3>

      <Standing bands={row.bands} />

      {row.entries.length > 0 ? (
        <ul className="mt-4 space-y-4 border-t border-border pt-4">
          {row.entries.map((entry) => (
            <li key={entry.entryId}>
              <Entry entry={entry} classId={classId} sessionId={sessionId} />
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

/**
 * Where this student stands, as the database already computes it.
 *
 * Every number here comes from `v_member_current_band` and every word from
 * `v_member_performance_status`. Nothing is averaged, compared or derived on
 * this page: "starting band" is the baseline row, "current" is the latest one,
 * and the status is the view's own comparison of the last two entries. Two
 * copies of those definitions would be two chances for the teacher's screen and
 * the student's to disagree.
 *
 * A skill with no band is left out rather than shown as a dash, because a run of
 * four dashes reads like a result. `flex-wrap` is unnecessary on a wrapping
 * paragraph, but `break-words` is not: a long name above it and a long line here
 * both have to stay inside 390px.
 */
function Standing({ bands }: { bands: MemberBands | null }) {
  const current = bands ? formatBand(bands.currentOverall) : null;
  const start = bands ? formatBand(bands.startOverall) : null;
  const target = bands ? formatBand(bands.targetBand) : null;

  if (!bands || (current === null && start === null)) {
    return (
      <p className="mt-1 text-sm text-muted-foreground">
        Chưa ghi nhận band nào.
      </p>
    );
  }

  const overall = [
    start === null ? null : `Ban đầu ${start}`,
    current === null ? null : `Hiện tại ${current}`,
    target === null ? null : `Mục tiêu ${target}`,
    MEMBER_STATUS_LABELS[bands.status],
  ].filter((part): part is string => part !== null);

  const skills = (
    [
      ["reading", bands.currentReading],
      ["listening", bands.currentListening],
      ["writing", bands.currentWriting],
      ["speaking", bands.currentSpeaking],
    ] as const
  )
    .map(([skill, band]) => {
      const shown = formatBand(band);
      return shown === null ? null : `${BAND_FIELD_LABELS[skill]} ${shown}`;
    })
    .filter((part): part is string => part !== null);

  return (
    <>
      <p className="mt-1 text-sm break-words text-muted-foreground">
        {overall.join(" · ")}
      </p>
      {skills.length > 0 ? (
        <p className="mt-1 text-sm break-words text-muted-foreground">
          {skills.join(" · ")}
        </p>
      ) : null}
    </>
  );
}

/**
 * One entry recorded today, and the only way to take it back.
 *
 * Removal rather than editing because that is the whole of what the schema
 * offers: `20260828001400_grants.sql` grants no UPDATE, and
 * `enforce_score_entries_append_only` refuses one. The table's own comment says
 * why — a wrong entry is deleted and re-entered, which leaves the history honest
 * instead of silently rewritten.
 *
 * The button is a plain destructive submit rather than the roster's `<details>`
 * confirmation. Removing a student ends an enrolment and takes their whole
 * history off the page with it; removing one band entry undoes a typo, and the
 * form directly below re-records it. It still posts to a bound Server Action and
 * still works with JavaScript off.
 */
function Entry({
  entry,
  classId,
  sessionId,
}: {
  entry: ScoreEntry;
  classId: string;
  sessionId: string;
}) {
  const bands = BAND_FIELDS.map((field) => {
    const band = formatBand(entry[field]);
    return band === null ? null : `${BAND_FIELD_LABELS[field]} ${band}`;
  }).filter((part): part is string => part !== null);

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm font-medium text-foreground">
          {SCORE_ENTRY_TYPE_LABELS[entry.entryType]}
        </p>

        <form
          action={removeScoreEntry.bind(
            null,
            classId,
            sessionId,
            entry.entryId,
          )}
        >
          <SubmitButton
            pendingLabel="Đang xóa…"
            className="border border-destructive/30 bg-card px-3 py-1.5 text-xs font-medium text-destructive hover:bg-background"
          >
            Xóa
          </SubmitButton>
        </form>
      </div>

      <p className="mt-1 text-sm break-words text-muted-foreground">
        {bands.join(" · ")}
      </p>

      {entry.note ? (
        <p className="mt-2 text-sm break-words whitespace-pre-line text-foreground">
          {entry.note}
        </p>
      ) : null}
    </>
  );
}

/**
 * The form that records one.
 *
 * Five bands and a note, all of them optional, because `score_entries` has
 * exactly one rule about what an entry must contain: `score_entries_not_empty`,
 * at least one of the five. A student assessed on speaking alone is a real
 * entry, so every band starts unselected and blank means "not measured" rather
 * than zero.
 *
 * The options are `BAND_VALUES`, which is `public.band`'s CHECK written out —
 * every half point from 0.0 to 9.0 — so what is offered and what the domain
 * accepts are the same set by construction. The action reads each field the same
 * way regardless, because a `<select>` is a suggestion and a POST is not.
 *
 * `recorded_on` and `created_by` are not here at all, exactly as in `NoteForm`:
 * the lesson's own date on the class's clock, and the teacher in the session
 * cookie. A field the browser could set is a field the browser could lie about.
 */
function ScoreForm({
  attendees,
  classId,
  sessionId,
}: {
  attendees: SessionAttendee[];
  classId: string;
  sessionId: string;
}) {
  return (
    <form
      action={recordScoreEntry.bind(null, classId, sessionId)}
      className="space-y-4"
    >
      <div className="space-y-1.5">
        <Label htmlFor="band-student">Học viên</Label>
        <Select
          id="band-student"
          name="membershipId"
          defaultValue=""
          required
        >
          <option value="" disabled>
            Chọn học viên
          </option>
          {attendees.map((attendee) => (
            <option key={attendee.membershipId} value={attendee.membershipId}>
              {attendee.name ?? attendee.email ?? "Học viên chưa có tên"}
            </option>
          ))}
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="band-entry">Loại đánh giá</Label>
          <Select
            id="band-entry"
            name="entryType"
            defaultValue="progress"
            required
          >
            {SCORE_ENTRY_TYPES.map((type) => (
              <option key={type} value={type}>
                {SCORE_ENTRY_TYPE_LABELS[type]}
              </option>
            ))}
          </Select>
        </div>

        <BandField field="overall" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        {BAND_SKILLS.map((skill) => (
          <BandField key={skill} field={skill} />
        ))}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="band-note">Ghi chú</Label>
        <Textarea
          id="band-note"
          name="note"
          rows={3}
          maxLength={SCORE_NOTE_MAX_LENGTH}
          placeholder="Không bắt buộc — kết quả này phản ánh điều gì"
        />
      </div>

      <SubmitButton pendingLabel="Đang ghi nhận…" className="mt-6 w-full">
        Ghi nhận band
      </SubmitButton>
    </form>
  );
}

/**
 * One band picker. Empty is the default, and it means "not measured".
 *
 * Every control in this form carries a `band-` prefixed `id` while keeping the
 * column's own `name`. The lesson-note form already owns `note` on its own
 * panel, and two elements with one id is two labels pointing at the same
 * control.
 */
function BandField({ field }: { field: (typeof BAND_FIELDS)[number] }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`band-${field}`}>{BAND_FIELD_LABELS[field]}</Label>
      <Select id={`band-${field}`} name={field} defaultValue="">
        <option value="">—</option>
        {BAND_VALUES.map((band) => (
          <option key={band} value={band}>
            {band}
          </option>
        ))}
      </Select>
    </div>
  );
}

/**
 * The shell every state shares. The error state heads itself, because it has
 * neither a lesson nor a class name to head the page with, and its trail stops
 * at Lịch dạy: the read that just failed is the one that would have told us
 * which class this lesson belongs to, so there is no class to offer a link to.
 */
function Frame({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <PageShell width="4xl">
      {className ? null : (
        <PageHeader
          breadcrumb={[
            { label: "Lịch dạy", href: "/teacher/calendar" },
            { label: "Buổi học" },
          ]}
          title="Buổi học"
        />
      )}

      {children}
    </PageShell>
  );
}
