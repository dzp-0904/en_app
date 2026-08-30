import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";

import { BandProgress } from "@/components/student/band-progress";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { ATTENDANCE_LABELS } from "@/lib/attendance";
import { LABELS, isOfferedCourseType } from "@/lib/course-type";
import {
  PERFORMANCE_LABELS,
  SKILL_LABELS,
  type Performance,
} from "@/lib/lesson-log";
import { loadUserState } from "@/lib/onboarding";
import type { DynamicPageProps } from "@/lib/route-types";
import {
  BAND_FIELD_LABELS,
  formatBand,
  isBandScored,
  MEMBER_STATUS_LABELS,
  SCORE_ENTRY_TYPE_LABELS,
} from "@/lib/score";
import {
  loadStudentBands,
  loadStudentClass,
  loadStudentFeedback,
  loadStudentLessons,
  loadStudentScoreHistory,
  type StudentBands,
  type StudentClassDetail,
  type StudentFeedback,
  type StudentLesson,
  type StudentScoreEntry,
} from "@/lib/student";
import { createClient } from "@/lib/supabase/server";
import { formatZonedDate, formatZonedTime } from "@/lib/time";

/**
 * One of the student's classes.
 *
 * Who teaches it, what it is, when it runs, and the lessons the teacher has
 * scheduled with this student's own mark against each. Homework and progress
 * are still not read here, because nothing writes them yet.
 *
 * Everything on this page is read-only. There is no Server Action in this
 * route and no control that can reach one: attendance is the teacher's to
 * record, and a student's copy of it is a report, not a form.
 *
 * Identity comes from `loadUserState`, exactly as `/student` does, so there is
 * one answer to "who is this request" and not two. Membership comes from
 * `loadStudentClass`, which cannot return a class the caller is not joined to —
 * the `classId` in the URL selects a row, it does not authorise one. Underneath
 * both, `class_members_student_select` pins the query to `auth.uid()` whatever
 * this page asks for.
 */

export const metadata: Metadata = {
  title: "Lớp học",
};

const DATE = new Intl.DateTimeFormat("vi-VN", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * How many pieces of teacher feedback the page shows.
 *
 * The Figma has two panels over the same rows — a "Recent Teacher Feedback"
 * card showing two, and a "My Learning History" tab showing every one. There is
 * one list here rather than two views of the same thing, long enough to be a
 * history and short enough that a student on a phone reaches the lessons below
 * it.
 */
const FEEDBACK_LIMIT = 12;

/** The Figma's performance colours, in this application's `Badge` tones. */
const PERFORMANCE_TONE: Record<
  Performance,
  "green" | "primary" | "orange" | "destructive"
> = {
  excellent: "green",
  good: "primary",
  developing: "orange",
  needs_attention: "destructive",
};

/** `YYYY-MM-DD` read as a calendar date, not a moment in the viewer's zone. */
/**
 * One of the two lists the teacher keeps on this student, read-only.
 *
 * There is no action here and no form: `class_members` grants the student
 * SELECT and nothing else — `class_members_student_select` is the only student
 * policy on the table, and there is no student UPDATE policy for a write to
 * pass through even if this page offered one. The page stays what it has always
 * been, a view of the student's own row.
 *
 * An empty list says so in words. `strengths` and `focus_areas` are
 * `not null default '{}'`, so "nothing recorded" arrives as `[]` — which must
 * never be what the student actually reads.
 */
function Tags({
  label,
  tags,
  empty,
}: {
  label: string;
  tags: string[];
  empty: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>

      {tags.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">{empty}</p>
      ) : (
        // Wrapping, never scrolling: a teacher's own phrase can be long, and
        // the card has 390px to work with.
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <li
              key={tag}
              className="min-w-0 rounded-full border border-input bg-background px-2.5 py-1 text-xs break-words text-foreground"
            >
              {tag}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function asDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

/**
 * The student's own standing, in the same shape as the class facts above.
 *
 * Every value comes from `v_member_current_band` and
 * `v_member_performance_status` exactly as the database reports them. Nothing is
 * averaged and nothing is compared here — the two views own those definitions,
 * and the teacher's page reads the same ones, so both sides of the application
 * say the same thing about the same student.
 *
 * A row this student has no band for is left out rather than shown empty, for
 * the same reason `factsFor` skips a blank column: an empty value reads like a
 * result, and a missing skill is not a zero.
 */
function progressFor(bands: StudentBands): { term: string; value: string }[] {
  const facts: { term: string; value: string }[] = [];

  const start = formatBand(bands.startOverall);
  if (start) facts.push({ term: "Ban đầu", value: start });

  const current = formatBand(bands.currentOverall);
  if (current) facts.push({ term: "Hiện tại", value: current });

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

  if (skills.length > 0) facts.push({ term: "Kỹ năng", value: skills.join(" · ") });

  const target = formatBand(bands.targetBand);
  if (target) facts.push({ term: "Mục tiêu", value: target });

  facts.push({ term: "Tiến bộ", value: MEMBER_STATUS_LABELS[bands.status] });

  // A calendar date in the class's zone, read as one — the same `asDate` the
  // start and end dates above go through, and no browser-local conversion.
  if (bands.currentRecordedOn) {
    facts.push({
      term: "Cập nhật",
      value: DATE.format(asDate(bands.currentRecordedOn)),
    });
  }

  return facts;
}

/** The facts worth showing, skipping every column this class left blank. */
function factsFor(detail: StudentClassDetail): { term: string; value: string }[] {
  const facts: { term: string; value: string }[] = [];

  // `LABELS` covers the three offered types; `course_type_other` is the name a
  // teacher gave anything else, and the CHECK constraint guarantees it is set
  // in precisely that case.
  const course = isOfferedCourseType(detail.courseType)
    ? LABELS[detail.courseType]
    : detail.courseTypeOther;

  if (course) facts.push({ term: "Khóa học", value: course });

  if (detail.targetBand !== null) {
    facts.push({ term: "Mục tiêu", value: `IELTS ${detail.targetBand.toFixed(1)}` });
  }

  facts.push({
    term: "Thời gian",
    value: detail.endDate
      ? `${DATE.format(asDate(detail.startDate))} – ${DATE.format(asDate(detail.endDate))}`
      : `Từ ${DATE.format(asDate(detail.startDate))}`,
  });

  if (detail.scheduleNote) {
    facts.push({ term: "Lịch học", value: detail.scheduleNote });
  }

  return facts;
}

export default async function StudentClassPage({
  params,
}: DynamicPageProps<{ classId: string }>) {
  const { classId } = await params;

  const state = await loadUserState();

  if (state.kind === "anonymous") {
    redirect("/auth/login");
  }

  // Teachers and unplaceable accounts are `/`'s problem, as on `/student`.
  if (state.kind !== "student") {
    redirect("/");
  }

  const supabase = await createClient();
  const result = await loadStudentClass(
    supabase,
    state.student.userId,
    classId,
  );

  // A class this student is not in is reported exactly as one that does not
  // exist, so the 404 says nothing about who else is enrolled.
  if (result.kind === "not-found") {
    notFound();
  }

  if (result.kind === "error") {
    return (
      <Frame>
        {/* No trail and no class name: the load that failed is the one that
            would have supplied both, and the shell's own "Lớp học" link is
            still the way out. */}
        <PageHeader title="Lớp học" />

        {/* Not a 404: the query failed, and telling someone their class is
            gone when the database merely stumbled is the same mistake
            `StudentContext.classes` uses `null` to avoid. */}
        <Alert>
          Chúng tôi chưa tải được lớp học này. Vui lòng tải lại trang.
        </Alert>
      </Frame>
    );
  }

  const { detail } = result;
  const facts = factsFor(detail);

  // Only now: `detail.membershipId` came from the membership query above, which
  // was filtered by `getUser()`'s id. Nothing off the URL reaches this call
  // except `classId`, which has just been proved to be one of this student's.
  // Only an IELTS class has bands at all — `scoringModelFor` is the rule, and
  // `classes_no_target_band_when_unscored` is the schema agreeing. Neither read
  // answers to the other, so they go out together.
  const banded = isBandScored(detail.courseType);

  const [lessons, bands, history, feedback] = await Promise.all([
    loadStudentLessons(supabase, detail.classId, detail.membershipId),
    banded
      ? loadStudentBands(supabase, detail.classId, detail.membershipId)
      : Promise.resolve(null),
    banded
      ? loadStudentScoreHistory(supabase, detail.classId, detail.membershipId)
      : Promise.resolve(null),
    // The Figma's "Recent Teacher Feedback" — this student's own `lesson_logs`
    // rows, newest first. Not gated on `banded`: a teacher writes notes about
    // any class, band-scored or not.
    loadStudentFeedback(
      supabase,
      detail.classId,
      detail.membershipId,
      FEEDBACK_LIMIT,
    ),
  ]);

  return (
    <Frame>
      <PageHeader
        breadcrumb={[
          { label: "Lớp học", href: "/student" },
          { label: detail.className },
        ]}
        title={detail.className}
        meta={
          detail.teacherName
            ? [
                <>
                  Giáo viên:{" "}
                  <span className="font-medium text-foreground">
                    {detail.teacherName}
                  </span>
                </>,
              ]
            : undefined
        }
      />

      <Card>
        <dl className="space-y-3">
          {facts.map((fact) => (
            <div key={fact.term} className="flex gap-4 text-sm">
              <dt className="w-24 shrink-0 text-muted-foreground">
                {fact.term}
              </dt>
              <dd className="text-foreground">{fact.value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <h2 className="mt-10 mb-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Điểm mạnh và nội dung cần cải thiện
      </h2>

      <Card>
        <div className="space-y-4">
          <Tags
            label="Điểm mạnh"
            tags={detail.strengths}
            empty="Chưa ghi nhận điểm mạnh nào."
          />
          <Tags
            label="Nội dung cần cải thiện"
            tags={detail.focusAreas}
            empty="Chưa ghi nhận nội dung cần cải thiện nào."
          />
        </div>
      </Card>

      {banded ? (
        <>
          <h2 className="mt-10 mb-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Tiến bộ của tôi
          </h2>

          {bands === null ? (
            // Not "no bands": the query failed, and the two must not look alike.
            <Alert>
              Chúng tôi chưa tải được tiến bộ của bạn. Vui lòng tải lại
              trang.
            </Alert>
          ) : bands.currentOverall === null && bands.startOverall === null ? (
            <Card>
              <p className="text-sm text-muted-foreground">
                Chưa ghi nhận band nào.
              </p>
            </Card>
          ) : (
            <>
              {/* The Figma's navy hero. The `dl` below keeps the facts it does
                  not draw — the standing the views report, and the date of the
                  most recent entry — because a picture of a band is not the
                  same as being told when it was taken. */}
              <BandProgress bands={bands} />

              <Card className="mt-4">
                <dl className="space-y-3">
                  {progressFor(bands).map((fact) => (
                    <div key={fact.term} className="flex gap-4 text-sm">
                      <dt className="w-24 shrink-0 text-muted-foreground">
                        {fact.term}
                      </dt>
                      <dd className="break-words text-foreground">
                        {fact.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </Card>
            </>
          )}

          <h2 className="mt-10 mb-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Lịch sử điểm
          </h2>

          {history === null ? (
            <Alert>
              Chúng tôi chưa tải được lịch sử điểm của bạn. Vui lòng tải lại
              trang.
            </Alert>
          ) : history.length === 0 ? (
            <Card>
              <p className="text-sm text-muted-foreground">
                Chưa ghi nhận điểm nào.
              </p>
            </Card>
          ) : (
            <ul className="space-y-3">
              {history.map((entry) => (
                <li key={entry.entryId}>
                  <Card>
                    <ScoreEntry entry={entry} />
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}

      <h2 className="mt-10 mb-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Nhận xét của giáo viên
      </h2>

      {feedback === null ? (
        <Alert>
          Chúng tôi chưa tải được nhận xét của giáo viên. Vui lòng tải lại
          trang.
        </Alert>
      ) : feedback.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground">
            Chưa có nhận xét nào.
          </p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {feedback.map((entry) => (
            <li key={entry.logId}>
              <Card>
                <Feedback entry={entry} />
              </Card>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-10 mb-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Buổi học
      </h2>

      {lessons === null ? (
        // Not "no lessons": the query failed, and the two must not look alike.
        <Alert>
          Chúng tôi chưa tải được buổi học của bạn. Vui lòng tải lại trang.
        </Alert>
      ) : lessons.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground">
            Chưa có buổi học nào được ghi nhận.
          </p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {lessons.map((lesson) => (
            <li key={lesson.sessionId}>
              <Card>
                <Lesson
                  classId={detail.classId}
                  lesson={lesson}
                  timezone={detail.timezone}
                />
              </Card>
            </li>
          ))}
        </ul>
      )}
    </Frame>
  );
}

/**
 * One lesson, and what was recorded for this student at it.
 *
 * The same two formatters the teacher's lesson list uses, given the same class
 * timezone, so the hour a student reads is the hour their teacher entered. See
 * `lib/time.ts`; there is no date arithmetic here.
 *
 * A cancelled lesson shows that it was cancelled and no attendance line at all.
 * Attendance at a lesson that did not happen is not a fact about the student,
 * and the database agrees: `v_member_session_attendance` excludes cancelled
 * sessions from the attendance rule entirely.
 *
 * The notes line appears only when there is something to read. Its absence is
 * not ambiguous, because the lesson's own page — one link away, and reachable
 * from every lesson here — says "No lesson notes yet." in words.
 */
function Lesson({
  classId,
  lesson,
  timezone,
}: {
  classId: string;
  lesson: StudentLesson;
  timezone: string;
}) {
  return (
    <>
      <p className="font-medium text-foreground">
        {formatZonedDate(timezone, lesson.startsAt)} ·{" "}
        {formatZonedTime(timezone, lesson.startsAt)} –{" "}
        {formatZonedTime(timezone, lesson.endsAt)}
      </p>

      {lesson.title ? (
        <p className="mt-1 text-sm text-foreground">{lesson.title}</p>
      ) : null}

      {lesson.status === "cancelled" ? (
        <p className="mt-2 text-sm text-muted-foreground">Đã hủy</p>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          Điểm danh:{" "}
          <span className="text-foreground">
            {/* Null is unmarked, which is a state of its own — never `absent`,
                and never a row invented to make the line read better. */}
            {lesson.attendance === null
              ? "Chưa ghi nhận"
              : ATTENDANCE_LABELS[lesson.attendance]}
          </span>
        </p>
      )}

      {lesson.noteCount > 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">
          Ghi chú buổi học:{" "}
          <span className="text-foreground">
            {`${lesson.noteCount} ghi chú`}
          </span>
        </p>
      ) : null}

      {/* A plain link, like the one on `/student` — the whole card being a
          target would swallow anything added to it later. */}
      <Button asChild variant="outline" size="sm" className="mt-4">
        <Link href={`/student/${classId}/sessions/${lesson.sessionId}`}>
          Mở buổi học
        </Link>
      </Button>
    </>
  );
}

/**
 * The shell every state shares. Each state heads itself, because only the one
 * that loaded knows the class's name; the way out of all of them is the
 * shell's own navigation, which every page under `/student` is wrapped in.
 */
function Frame({ children }: { children: ReactNode }) {
  return (
    <PageShell width="lg" align="center">
      {children}
    </PageShell>
  );
}

/**
 * One band entry in the history — what was recorded, and when.
 *
 * `score_entries` is append-only and every row is a measurement the teacher
 * made on a day, so this prints the row rather than interpreting it: the entry
 * type as the teacher chose it, every skill that carries a band, and the note
 * if there is one. Nothing is compared to the entry before it — the hero above
 * owns the only comparison this page makes, and it makes it from the view.
 *
 * A skill with no band is left out rather than shown as a dash: an entry that
 * recorded only Writing is a real thing a teacher does, and four empty cells
 * would suggest four bad results.
 */
function ScoreEntry({ entry }: { entry: StudentScoreEntry }) {
  const skills = (
    [
      ["reading", entry.reading],
      ["listening", entry.listening],
      ["writing", entry.writing],
      ["speaking", entry.speaking],
    ] as const
  )
    .map(([skill, band]) => {
      const shown = formatBand(band);
      return shown === null ? null : `${BAND_FIELD_LABELS[skill]} ${shown}`;
    })
    .filter((part): part is string => part !== null);

  const overall = formatBand(entry.overall);

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 grow basis-48">
          <p className="text-xs text-muted-foreground">
            {DATE.format(asDate(entry.recordedOn))}
          </p>

          {overall === null ? null : (
            <p className="mt-1 text-lg font-semibold text-foreground">
              {`Band ${overall}`}
            </p>
          )}
        </div>

        <Badge tone="neutral" className="shrink-0">
          {SCORE_ENTRY_TYPE_LABELS[entry.entryType]}
        </Badge>
      </div>

      {skills.length > 0 ? (
        <p className="mt-2 text-sm break-words text-muted-foreground">
          {skills.join(" · ")}
        </p>
      ) : null}

      {entry.note ? (
        <p className="mt-3 rounded-lg bg-background p-3 text-sm break-words whitespace-pre-wrap text-muted-foreground italic">
          {entry.note}
        </p>
      ) : null}
    </>
  );
}

/**
 * One lesson note the teacher wrote about this student.
 *
 * Read-only, like everything else on this page. `lesson_logs` grants the
 * student SELECT through `lesson_logs_student_select` and nothing more, so
 * there is no control here that could write one even if the page offered it.
 *
 * `lesson_date` is a `date` — a calendar square the teacher already resolved
 * onto the class clock — so it is read at UTC midnight through the same `DATE`
 * formatter the class dates use, and never reinterpreted in the reader's zone.
 */
function Feedback({ entry }: { entry: StudentFeedback }) {
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 grow basis-48">
          <p className="text-xs text-muted-foreground">
            {`${DATE.format(asDate(entry.lessonDate))} · ${SKILL_LABELS[entry.skill]}`}
          </p>

          <p className="mt-1 font-medium break-words text-foreground">
            {entry.topic}
          </p>
        </div>

        <Badge tone={PERFORMANCE_TONE[entry.performance]} className="shrink-0">
          {PERFORMANCE_LABELS[entry.performance]}
        </Badge>
      </div>

      {entry.note ? (
        <p className="mt-3 rounded-lg bg-background p-3 text-sm break-words whitespace-pre-wrap text-muted-foreground italic">
          {entry.note}
        </p>
      ) : null}
    </>
  );
}
