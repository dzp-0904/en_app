import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";

import { BandProgress } from "@/components/student/band-progress";
import {
  LearningHistory,
  RecentFeedback,
} from "@/components/student/feedback-panels";
import { HomeworkList } from "@/components/student/homework-list";
import {
  ScoreTrend,
  type ScoreSeries,
  type TrendFilter,
} from "@/components/student/score-trend";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { Tabs } from "@/components/ui/tabs";
import { ATTENDANCE_LABELS } from "@/lib/attendance";
import { LABELS, isOfferedCourseType } from "@/lib/course-type";
import { loadUserState } from "@/lib/onboarding";
import type { DynamicPageProps } from "@/lib/route-types";
import {
  BAND_FIELD_LABELS,
  formatBand,
  isBandScored,
  MEMBER_STATUS_LABELS,
} from "@/lib/score";
import {
  loadStudentBands,
  loadStudentClass,
  loadStudentFeedback,
  loadStudentHomework,
  loadStudentLessons,
  loadStudentScoreHistory,
  type StudentBands,
  type StudentClassDetail,
  type StudentLesson,
} from "@/lib/student";
import { createClient } from "@/lib/supabase/server";
import { formatZonedDate, formatZonedTime } from "@/lib/time";
import { cn } from "@/lib/utils";

/**
 * One of the student's classes — the Figma's `pages/student/Dashboard.tsx`.
 *
 * This is the design's only student screen, and it is class-scoped: a greeting,
 * the navy band hero, and a segmented control over the views of one class. The
 * Figma's student is hard-coded into a single class (`mockClasses[0]`), so its
 * dashboard and its class page are the same screen; here a student can hold
 * several memberships, so that screen is this route and `/student` is the list
 * that chooses between them — the same relationship `/teacher` has with
 * `/teacher/classes`.
 *
 * ## The tabs
 *
 * Three are the Figma's, in its order — Tiến bộ, Bài tập, Lịch sử — and the
 * fourth is not. **Buổi học** carries the lesson list and this student's own
 * attendance mark against each, which M12 built and which the Figma's mock has
 * no equivalent of. Removing it to match a screenshot would delete a working
 * feature, so it is appended rather than substituted: the Figma's three keep
 * their labels and their relative order, and the addition is visible as an
 * addition.
 *
 * They are `<Link>`s over `?tab=`, not scripted panels, so a tab survives a
 * refresh, sits in the back button, can be shared, and works with JavaScript
 * off. `components/ui/tabs.tsx` explains that choice at length.
 *
 * NOT PREFETCHED, deliberately, and unlike the teacher's class detail. Each tab
 * here is gated — the loader for a view runs only when that view is the one
 * being rendered — so prefetching the three unopened tabs would issue every
 * query on every visit and undo the gating. M24's `PendingTint` acknowledges
 * the click in 1-2 ms instead, which is the same trade `/teacher/reports` and
 * the filter pills already make.
 *
 * ## Reads
 *
 * The membership first, alone, because everything after it is scoped by the
 * `membershipId` it returns. Then one `Promise.all` whose members are chosen by
 * the tab: the hero's bands on every tab (it sits above the strip), the score
 * history and the two feedback rows on Tiến bộ, the assignments on Bài tập, the
 * full feedback list on Lịch sử, the sessions on Buổi học. Nothing is fetched
 * for a view nobody opened.
 *
 * ## Authorization
 *
 * Unchanged from every other page in this half of the application, and not
 * loosened by anything above. `loadUserState` says who is calling;
 * `loadStudentClass` filters `class_members` by `getUser()`'s id, this
 * `classId`, `join_status = 'joined'` and `removed_at is null`, so the URL
 * selects a class and never authorises one; every loader below takes its
 * `membershipId` from *that* answer and never from the request. Underneath all
 * of it the student SELECT policies — `class_members_student_select`,
 * `score_entries_student_select`, `lesson_logs_student_select`,
 * `homework_assignments_student_select`, `homework_submissions_student_select`,
 * `session_attendance_student_select` — pin every read to `auth.uid()` or to
 * `app.my_member_ids()`. A classmate's row is not filtered out of these
 * results; it never arrives in the process.
 *
 * Everything here is read-only. There is no Server Action in this route and no
 * control that can reach one.
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

/** `YYYY-MM-DD` read as a calendar date, not a moment in the viewer's zone. */
function asDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

const TAB_KEYS = ["progress", "homework", "history", "lessons"] as const;
type Tab = (typeof TAB_KEYS)[number];

const TAB_LABELS: Record<Tab, string> = {
  progress: "Tiến bộ",
  homework: "Bài tập",
  history: "Lịch sử",
  lessons: "Buổi học",
};

const SERIES_KEYS = [
  "overall",
  "reading",
  "listening",
  "writing",
  "speaking",
] as const;

/**
 * How many feedback rows each view asks for.
 *
 * The Figma shows two in the Progress tab's card and every one in its History
 * tab, which is the same query at two lengths rather than two queries.
 */
const RECENT_FEEDBACK = 2;
const ALL_FEEDBACK = 60;

function firstOf(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function readTab(value: string | undefined): Tab {
  return TAB_KEYS.includes(value as Tab) ? (value as Tab) : "progress";
}

function readSeries(value: string | undefined): ScoreSeries {
  return SERIES_KEYS.includes(value as ScoreSeries)
    ? (value as ScoreSeries)
    : "overall";
}

/**
 * The Figma's greeting takes the last word of the name — which is the right end
 * of a Vietnamese one. "Phạm Tiến Dũng" is family-first, so the word that
 * addresses the person is "Dũng". The same reasoning `Avatar` uses for its
 * initials, applied to a whole word.
 */
function givenName(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  return words[words.length - 1] ?? fullName;
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

  // `classes.target_band` — the class's goal, which is NOT the same column as
  // `class_members.target_band` in the card beside this one. Two different
  // facts about two different rows, so they are named differently rather than
  // both reading "Mục tiêu" a few pixels apart.
  if (detail.targetBand !== null) {
    facts.push({
      term: "Mục tiêu của lớp",
      value: `IELTS ${detail.targetBand.toFixed(1)}`,
    });
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

/**
 * The student's own standing, in the same shape as the class facts.
 *
 * Every value comes from `v_member_current_band` and
 * `v_member_performance_status` exactly as the database reports them. Nothing
 * is averaged and nothing is compared here — the two views own those
 * definitions, and the teacher's page reads the same ones, so both sides of the
 * application say the same thing about the same student.
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
  // start and end dates go through, and no browser-local conversion.
  if (bands.currentRecordedOn) {
    facts.push({
      term: "Cập nhật",
      value: DATE.format(asDate(bands.currentRecordedOn)),
    });
  }

  return facts;
}

export default async function StudentClassPage({
  params,
  searchParams,
}: DynamicPageProps<{ classId: string }>) {
  const { classId } = await params;

  const state = await loadUserState();

  if (state.kind === "anonymous") {
    redirect("/auth/login");
  }

  // Teachers and unplaceable accounts are both `/`'s problem, not this page's.
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
            would have supplied both, and the shell's own brand link is still
            the way out. */}
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
  const query = await searchParams;
  const tab = readTab(firstOf(query.tab));
  const series = readSeries(firstOf(query.skill));

  // Only an IELTS class has bands at all — `scoringModelFor` is the rule, and
  // `classes_no_target_band_when_unscored` is the schema agreeing.
  const banded = isBandScored(detail.courseType);

  // `detail.membershipId` came from the membership query above, which was
  // filtered by `getUser()`'s id. Nothing off the URL reaches these calls
  // except `classId`, which has just been proved to be one of this student's.
  // None of them answers to any other, so they go out together.
  const [bands, history, feedback, homework, lessons] = await Promise.all([
    banded
      ? loadStudentBands(supabase, detail.classId, detail.membershipId)
      : Promise.resolve(null),
    banded && tab === "progress"
      ? loadStudentScoreHistory(supabase, detail.classId, detail.membershipId)
      : Promise.resolve(null),
    tab === "progress" || tab === "history"
      ? loadStudentFeedback(
          supabase,
          detail.classId,
          detail.membershipId,
          tab === "progress" ? RECENT_FEEDBACK : ALL_FEEDBACK,
        )
      : Promise.resolve(null),
    tab === "homework"
      ? loadStudentHomework(supabase, detail.classId, detail.membershipId)
      : Promise.resolve(null),
    tab === "lessons"
      ? loadStudentLessons(supabase, detail.classId, detail.membershipId)
      : Promise.resolve(null),
  ]);

  const base = `/student/${detail.classId}`;
  // The default tab carries no parameter, so the plain class URL is the
  // Progress view and a shared link is the short one.
  const tabHref = (key: Tab) => (key === "progress" ? base : `${base}?tab=${key}`);
  const seriesHref = (key: ScoreSeries) =>
    key === "overall" ? base : `${base}?skill=${key}`;

  const filters: TrendFilter[] = SERIES_KEYS.map((key) => ({
    series: key,
    // The Figma prints one capital per series. In Vietnamese "Nghe" and "Nói"
    // share an initial, so the short word is the shortest thing that is still
    // a name — and it is the label this application already uses for that
    // column, not a synonym coined for a chip. See the note in
    // `score-trend.tsx`.
    label: BAND_FIELD_LABELS[key],
    href: seriesHref(key),
    current: key === series,
  }));

  const course = isOfferedCourseType(detail.courseType)
    ? LABELS[detail.courseType]
    : detail.courseTypeOther;

  return (
    <Frame>
      {/* The Figma's greeting heads this screen and the class names the trail
          above it — the design addresses the student and puts the class in the
          subtitle, which is exactly what a breadcrumb already does better. The
          last crumb is the current page, never a link (decision M). */}
      <PageHeader
        breadcrumb={[
          { label: "Lớp học", href: "/student" },
          { label: detail.className },
        ]}
        title={`Chào ${givenName(state.student.fullName)} 👋`}
        meta={[
          <>
            <span className="font-medium text-foreground">
              {detail.className}
            </span>
            {course ? ` · ${course}` : ""}
          </>,
          ...(detail.teacherName
            ? [
                <>
                  Giáo viên:{" "}
                  <span className="font-medium text-foreground">
                    {detail.teacherName}
                  </span>
                </>,
              ]
            : []),
        ]}
      />

      {/* The hero sits above the strip, as the Figma places it: it is the one
          fact true of the class as a whole rather than of one view of it. */}
      {banded ? (
        bands === null ? (
          // Not "no bands": the query failed, and the two must not look alike.
          <Alert className="mb-6">
            Chúng tôi chưa tải được tiến bộ của bạn. Vui lòng tải lại trang.
          </Alert>
        ) : (
          <div className="mb-6">
            <BandProgress bands={bands} />
          </div>
        )
      ) : null}

      <Tabs
        variant="primary"
        label="Các mục của lớp học"
        className="mb-5"
        items={TAB_KEYS.map((key) => ({
          label: TAB_LABELS[key],
          href: tabHref(key),
          current: key === tab,
        }))}
      />

      {tab === "progress" ? (
        <>
          <div className="grid items-start gap-5 md:grid-cols-2">
            {/* Left column: the Figma's chart panel. A class with no band
                scoring has no series to plot, so the column is the focus card
                on its own rather than an empty chart. */}
            {banded ? (
              history === null ? (
                <Alert>
                  Chúng tôi chưa tải được lịch sử điểm của bạn. Vui lòng tải lại
                  trang.
                </Alert>
              ) : (
                <ScoreTrend
                  entries={history}
                  series={series}
                  filters={filters}
                />
              )
            ) : null}

            <div className="space-y-4">
              <Focus
                strengths={detail.strengths}
                focusAreas={detail.focusAreas}
              />

              {feedback === null ? (
                <Alert>
                  Chúng tôi chưa tải được nhận xét của giáo viên. Vui lòng tải
                  lại trang.
                </Alert>
              ) : (
                <RecentFeedback entries={feedback} />
              )}
            </div>
          </div>

          {/* Facts the Figma's mock never has to show — the standing the views
              report, when the band was last taken, and the class's own
              schedule and dates. A picture of a band is not the same as being
              told when it was measured. */}
          <div className="mt-5 grid items-start gap-5 md:grid-cols-2">
            {banded && bands !== null ? (
              <Facts title="Chi tiết band" facts={progressFor(bands)} />
            ) : null}

            <Facts title="Thông tin lớp học" facts={factsFor(detail)} />
          </div>
        </>
      ) : null}

      {tab === "homework" ? (
        homework === null ? (
          <Alert>
            Chúng tôi chưa tải được bài tập của bạn. Vui lòng tải lại trang.
          </Alert>
        ) : homework.length === 0 ? (
          <EmptyState
            title="Chưa có bài tập nào"
            description="Khi giáo viên giao bài, bài tập sẽ xuất hiện ở đây."
          />
        ) : (
          <HomeworkList items={homework} />
        )
      ) : null}

      {tab === "history" ? (
        feedback === null ? (
          <Alert>
            Chúng tôi chưa tải được nhận xét của giáo viên. Vui lòng tải lại
            trang.
          </Alert>
        ) : (
          <LearningHistory entries={feedback} />
        )
      ) : null}

      {tab === "lessons" ? (
        lessons === null ? (
          // Not "no lessons": the query failed, and the two must not look alike.
          <Alert>
            Chúng tôi chưa tải được buổi học của bạn. Vui lòng tải lại trang.
          </Alert>
        ) : lessons.length === 0 ? (
          <EmptyState
            title="Chưa có buổi học nào"
            description="Khi giáo viên tạo buổi học, buổi học sẽ xuất hiện ở đây."
          />
        ) : (
          <ul className="space-y-3">
            {lessons.map((lesson) => (
              <li key={lesson.sessionId}>
                <Card variant="list">
                  <Lesson
                    classId={detail.classId}
                    lesson={lesson}
                    timezone={detail.timezone}
                  />
                </Card>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </Frame>
  );
}

/**
 * The Figma's "My Current Focus" card, carrying both of the teacher's lists.
 *
 * The design draws only the weaknesses, and only the first three of them. Both
 * are kept whole here: `strengths` and `focus_areas` are two columns a teacher
 * fills in deliberately (M15), and truncating one or dropping the other would
 * hide something written about this student to make a card shorter. The chips
 * wrap; the card grows.
 *
 * `not null default '{}'`, so "nothing recorded" arrives as `[]` — which must
 * never be what the student reads as an answer.
 */
function Focus({
  strengths,
  focusAreas,
}: {
  strengths: string[];
  focusAreas: string[];
}) {
  return (
    <Card variant="list" className="p-4">
      <h2 className="text-sm font-semibold text-foreground">
        Trọng tâm hiện tại
      </h2>
      <p className="mt-1 mb-3 text-xs text-muted-foreground">
        Do giáo viên của bạn chọn
      </p>

      <Chips
        label="Nội dung cần cải thiện"
        tags={focusAreas}
        empty="Chưa ghi nhận nội dung cần cải thiện nào."
        tone="primary"
      />

      <div className="mt-4">
        <Chips
          label="Điểm mạnh"
          tags={strengths}
          empty="Chưa ghi nhận điểm mạnh nào."
          tone="neutral"
        />
      </div>
    </Card>
  );
}

function Chips({
  label,
  tags,
  empty,
  tone,
}: {
  label: string;
  tags: string[];
  empty: string;
  tone: "primary" | "neutral";
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>

      {tags.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">{empty}</p>
      ) : (
        // Wrapping, never scrolling: a teacher's own phrase can be long, and
        // the card has 326px to work with at 390px.
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <li
              key={tag}
              className={cn(
                "min-w-0 rounded-full px-2.5 py-1 text-xs font-medium break-words",
                // The Figma's focus chips are `#EDF0FF` on `#4466EE`; the
                // strengths have no chip in the design, so they take the
                // neutral outline this page already used for both lists.
                tone === "primary"
                  ? "bg-secondary text-secondary-foreground"
                  : "border border-input bg-background text-foreground",
              )}
            >
              {tag}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A titled definition list — the shape the class facts have always had. */
function Facts({
  title,
  facts,
}: {
  title: string;
  facts: { term: string; value: string }[];
}) {
  return (
    <Card variant="list">
      <h2 className="mb-3 text-sm font-semibold text-foreground">{title}</h2>

      <dl className="space-y-3">
        {facts.map((fact) => (
          <div key={fact.term} className="flex gap-4 text-sm">
            <dt className="w-28 shrink-0 text-muted-foreground">{fact.term}</dt>
            <dd className="min-w-0 break-words text-foreground">
              {fact.value}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
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
 * from every lesson here — says so in words.
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

      {/* A plain link, not a clickable card: the whole surface being a target
          would swallow anything added to it later, and a link is what a
          keyboard and a screen reader can actually find. */}
      <Button asChild variant="outline" size="sm" className="mt-4">
        <Link href={`/student/${classId}/sessions/${lesson.sessionId}`}>
          Mở buổi học
        </Link>
      </Button>
    </>
  );
}

/**
 * The shell every state shares — the Figma's `max-w-4xl mx-auto` column under
 * the student top bar. Each state heads itself, because only the one that
 * loaded knows the class's name; the way out of all of them is the shell's own
 * brand link and the breadcrumb.
 */
function Frame({ children }: { children: ReactNode }) {
  return (
    <PageShell width="4xl" align="center">
      {children}
    </PageShell>
  );
}
