import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";

import { inviteStudentByEmail } from "@/app/onboarding/actions";
import { SubmitButton } from "@/components/auth/submit-button";
import { CopyField } from "@/components/onboarding/copy-field";
import { TagEditor } from "@/components/roster/tag-editor";
import { Alert } from "@/components/ui/alert";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { FilterPills } from "@/components/ui/filter-pills";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { ProgressBar } from "@/components/ui/progress-bar";
import { StatCard } from "@/components/ui/stat-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { ATTENDANCE_LABELS, type AttendanceStatus } from "@/lib/attendance";
import { LABELS, isOfferedCourseType } from "@/lib/course-type";
import {
  PERFORMANCE_LABELS,
  SKILL_LABELS,
  type Performance,
} from "@/lib/lesson-log";
import { loadUserState } from "@/lib/onboarding";
import type { DynamicPageProps } from "@/lib/route-types";
import {
  BAND_FIELDS,
  BAND_FIELD_LABELS,
  BAND_SKILLS,
  BAND_VALUES,
  MEMBER_STATUS_LABELS,
  SCORE_ENTRY_TYPE_LABELS,
  formatBand,
  isBandScored,
  type MemberStatus,
} from "@/lib/score";
import { joinUrl } from "@/lib/site-url";
import { TAG_SUGGESTIONS } from "@/lib/standing";
import { createClient } from "@/lib/supabase/server";
import {
  loadClassBands,
  loadClassSessions,
  loadStudentOverview,
  loadTeacherClass,
  type ClassSession,
  type MemberBands,
  type RosterEntry,
  type StudentOverview,
  type TeacherClassDetail,
} from "@/lib/teacher";
import { formatZonedDate, formatZonedTime } from "@/lib/time";

import {
  cancelInvitation,
  removeStudent,
  resendInvitation,
  saveStandingNotes,
  setTargetBand,
} from "./actions";

/**
 * One of the teacher's classes: what it is, how to invite people to it, and who
 * is in it.
 *
 * The roster is the point, and this milestone gives it the Figma's own shape —
 * a table of students with their bands, skills and standing beside them, over
 * the stacked cards it used to be. Nothing about what the page is allowed to
 * read changed with it.
 *
 * Identity comes from `loadUserState`, exactly as `/teacher` and the student
 * pages do. Ownership comes from `loadTeacherClass`, which cannot return a
 * class the caller does not own — the `classId` in the URL selects a row, it
 * does not authorise one. The three selectors this page now carries in its
 * query string (`tab`, `filter`, `student`) are selectors on the same footing:
 * every one of them narrows what is drawn from data the class check has already
 * released, and none of them can widen it.
 *
 * STATE LIVES IN THE URL. Which tab is open, which filter is applied and which
 * student's panel is expanded are all query parameters reached by `<Link>`,
 * because that is what keeps the page a Server Component that works with
 * JavaScript switched off. A `useState` tab, which is what the Figma prototype
 * uses, would have made the roster unreachable without scripting.
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

/** Which panel of the class is open. `students` is the default and is unwritten. */
type Tab = "students" | "lessons" | "info";

const TABS: { id: Tab; label: string }[] = [
  { id: "students", label: "Học viên" },
  { id: "lessons", label: "Buổi học" },
  { id: "info", label: "Thông tin lớp" },
];

function isTab(value: string): value is Tab {
  return TABS.some((tab) => tab.id === value);
}

/** Which slice of the roster is shown. `all` is the default and is unwritten. */
type Filter = "all" | MemberStatus;

const FILTERS: Filter[] = ["all", "improving", "stable", "needs_attention"];

function isFilter(value: string): value is Filter {
  return (FILTERS as string[]).includes(value);
}

/**
 * This page's own URL carrying a different set of selectors.
 *
 * Every default is left out rather than written down, so the plain
 * `/teacher/<id>` a teacher arrives on is the same URL the "Học viên" tab and
 * the "Tất cả học viên" pill point at — one address for one view, and no growing
 * tail of `?tab=students&filter=all` on the way back to where you started.
 */
function hrefFor(
  classId: string,
  selectors: { tab?: Tab; filter?: Filter; student?: string },
  hash?: string,
): string {
  const query = new URLSearchParams();

  if (selectors.tab && selectors.tab !== "students") {
    query.set("tab", selectors.tab);
  }
  if (selectors.filter && selectors.filter !== "all") {
    query.set("filter", selectors.filter);
  }
  if (selectors.student) {
    query.set("student", selectors.student);
  }

  const search = query.toString();

  return `/teacher/${classId}${search ? `?${search}` : ""}${hash ? `#${hash}` : ""}`;
}

/** Where a student's row sits, so closing their panel returns to it. */
function anchorFor(entry: RosterEntry): string {
  return `student-${entry.membershipId}`;
}

/** Where the open panel sits, so opening one lands on it rather than the table. */
const PANEL_ANCHOR = "student-panel";

/** The id every tag input points at; the list itself is rendered once. */
const SUGGESTION_LIST = "tag-suggestions";

/** Whoever the row is about, however much of them it knows. */
function nameOf(entry: RosterEntry): string {
  return entry.name ?? entry.email ?? "Học viên này";
}

/**
 * The Figma's status colours, by the value the database actually stores.
 *
 * `improving` is green and `needs_attention` is orange, exactly as the design
 * sets them. `stable` is the Figma's grey-on-cream, which is what `neutral`
 * already is. The word is always printed beside the tint, so none of this is
 * the only thing carrying the meaning.
 */
const STATUS_TONES: Record<MemberStatus, "green" | "neutral" | "orange"> = {
  improving: "green",
  stable: "neutral",
  needs_attention: "orange",
};

/**
 * The four attendance values, tinted.
 *
 * All four, and four distinct tones, because the difference between them is
 * load-bearing — `excused` is the one that takes a lesson out of the reckoning
 * entirely, and collapsing it into `absent` would lose that. `ATTENDANCE_LABELS`
 * supplies the word in every case.
 */
const ATTENDANCE_TONES: Record<
  AttendanceStatus,
  "green" | "orange" | "destructive" | "neutral"
> = {
  present: "green",
  late: "orange",
  absent: "destructive",
  excused: "neutral",
};

/**
 * The four lesson-note performances, tinted.
 *
 * Straight off the Figma, which colours this vocabulary itself: Excellent
 * #3BA876, Good #4466EE, Developing #E8834A, Needs Attention #EF4444 — the
 * green, primary, orange and destructive pairs, in that order. Nothing is
 * reinterpreted; `PERFORMANCE_LABELS` supplies the word beside every tint.
 */
const PERFORMANCE_TONES: Record<
  Performance,
  "green" | "primary" | "orange" | "destructive"
> = {
  excellent: "green",
  good: "primary",
  developing: "orange",
  needs_attention: "destructive",
};

export default async function TeacherClassPage({
  params,
  searchParams,
}: DynamicPageProps<{ classId: string }>) {
  const { classId } = await params;

  const state = await loadUserState();

  if (state.kind === "anonymous") {
    redirect("/auth/login");
  }

  // Students and unplaceable accounts are `/`'s problem, as on `/teacher`.
  if (state.kind !== "teacher") {
    redirect("/");
  }

  const supabase = await createClient();
  const result = await loadTeacherClass(
    supabase,
    state.teacher.userId,
    classId,
  );

  // Another teacher's class is reported exactly as one that does not exist, so
  // the 404 says nothing about what other teachers run.
  if (result.kind === "not-found") {
    notFound();
  }

  if (result.kind === "error") {
    return (
      <Frame>
        {/* Not a 404: the query failed, and telling a teacher their class is
            gone when the database merely stumbled is the worse of the two. */}
        <Alert>
          Chúng tôi chưa tải được lớp học này. Vui lòng tải lại trang.
        </Alert>
      </Frame>
    );
  }

  const { detail } = result;
  const link = detail.inviteCode ? await joinUrl(detail.inviteCode) : null;

  // Every action on this page — inviting, removing, cancelling, resending —
  // reports failure the same way: by redirecting back with the message
  // attached, so the page stays a Server Component and each form works without
  // JavaScript. One banner serves all of them, at the top, because that is
  // where the reader arrives after the redirect.
  const query = await searchParams;
  const error = typeof query.error === "string" ? query.error : undefined;

  const tab =
    typeof query.tab === "string" && isTab(query.tab) ? query.tab : "students";

  // Anything else in `?filter=` is treated as no filter rather than as an empty
  // roster: a mistyped parameter should not read as "this class has nobody in
  // it".
  const filter =
    typeof query.filter === "string" && isFilter(query.filter)
      ? query.filter
      : "all";

  // Which student's overview is open, if any. A query parameter rather than a
  // route: the panel is one part of this page expanded, so it belongs to this
  // page's URL. It is a selector and not a credential — `loadStudentOverview`
  // re-proves the membership against the class in the database before it reads
  // anything, and this page has already proved the class.
  const selected = typeof query.student === "string" ? query.student : undefined;

  // The same test the session page makes before showing bands at all. A target
  // band is an IELTS goal, and a class that scores on nothing has no use for
  // one — `setTargetBand` refuses the write for the same reason, so the control
  // is absent here rather than present and rejected.
  const banded = isBandScored(detail.courseType);

  // Three reads that the class check has already paid for the right to make,
  // fired together because none depends on another.
  //
  // `loadClassBands` is the same call the session page makes, against the same
  // two views, for the same class: it is where "current band", "skills" and
  // "status" come from, and it is the only reason those columns can exist
  // without this page working any of them out for itself. Nothing is loaded for
  // an unbanded class, which has no bands to load. It is not gated on the tab:
  // the counts above the tab strip are drawn from it, and they are drawn on all
  // three.
  //
  // Nothing is loaded for the panel unless a student is selected, so the roster
  // costs a teacher who has not opened one exactly what it did before.
  const [sessions, bands, overview] = await Promise.all([
    // Loaded separately from the class itself so that a failure here costs the
    // teacher the lesson list and nothing else. `null` is that failure, and it
    // is deliberately not `[]`: "no lessons have been recorded yet" is a claim
    // about the class, and the page is not entitled to make it on the strength
    // of a query that did not come back.
    //
    // Only on the tab that renders it. `Lessons` is the sole reader, so on
    // Students and Class Info this was a table scan of `class_sessions` whose
    // result was discarded — and one paid three times over now that the tab
    // strip prefetches its siblings. It costs no wall time to drop, because it
    // ran beside `loadClassBands` rather than before it, but it is a query the
    // database was answering for nobody.
    tab === "lessons"
      ? loadClassSessions(supabase, detail.classId)
      : Promise.resolve(null),
    banded ? loadClassBands(supabase, detail.classId) : Promise.resolve(null),
    selected
      ? loadStudentOverview(supabase, detail.classId, selected)
      : Promise.resolve(null),
  ]);

  // A membership from another class, a removed one, an invitation that was
  // never claimed and a random uuid all arrive here as the same `not-found`,
  // and are reported with the same sentence the roster actions already use —
  // so none of them can be told apart from the others.
  const notice =
    error ??
    (overview?.kind === "not-found"
      ? "Học viên này không còn trong danh sách lớp."
      : overview?.kind === "error"
        ? "Chúng tôi chưa tải được tổng quan của học viên này. Vui lòng thử lại."
        : undefined);

  const students = detail.roster.filter((entry) => entry.status === "joined");
  const pending = detail.roster.filter((entry) => entry.status === "invited");

  // Bands may be unavailable for two different reasons and only one of them is
  // a failure: an unbanded course has none to show, and a query that did not
  // come back has none to show *yet*. The columns are dropped either way, and
  // the second case says so rather than letting a teacher read blank cells as
  // "nobody has been assessed".
  const standing = banded && bands !== null ? bands : null;

  const facts = factsFor(detail);

  const roster =
    standing === null
      ? students
      : students.filter(
          (entry) => filter === "all" || statusOf(standing, entry) === filter,
        );

  const stats: { label: string; value: string }[] = [
    { label: "Học viên", value: String(students.length) },
  ];

  if (standing !== null) {
    // Counts of a value the database decided, not a judgement made here. The
    // status itself is `v_member_performance_status`'s; tallying how many rows
    // carry it is the same kind of arithmetic as counting the roster.
    //
    // The Figma's other two cards, "Avg. Band" and "Avg. Homework", are absent
    // and are meant to be — see the note on `factsFor` below.
    for (const status of ["improving", "needs_attention"] as const) {
      stats.push({
        label: MEMBER_STATUS_LABELS[status],
        value: String(
          students.filter((entry) => statusOf(standing, entry) === status)
            .length,
        ),
      });
    }
  }

  return (
    <PageShell width="5xl">
      <PageHeader
        breadcrumb={[
          // The Figma's first crumb says "Dashboard". EduTrack has no
          // dashboard, deliberately and in as many words in `app-shell.tsx`;
          // the place this page came from is the class list, and that is what
          // the crumb is named after. It also carries the page's old "← Back to
          // classes" link, which the trail replaces rather than drops.
          { label: "Lớp học", href: "/teacher" },
          { label: detail.className },
        ]}
        title={detail.className}
        meta={facts
          .map((fact) => fact.summary)
          .filter((summary): summary is string => summary !== undefined)}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={`/teacher/${detail.classId}/edit`}>Chỉnh sửa lớp</Link>
            </Button>

            <Button asChild>
              <Link href={hrefFor(detail.classId, { tab: "info" }, "invite")}>
                Mời học viên
              </Link>
            </Button>
          </>
        }
      />

      {notice ? <Alert className="mb-5">{notice}</Alert> : null}

      {banded && bands === null ? (
        <Alert className="mb-5">
          Chúng tôi chưa tải được band và tiến bộ của lớp này. Danh sách bên
          dưới vẫn là lớp của bạn; vui lòng tải lại trang để xem tình hình của
          từng học viên.
        </Alert>
      ) : null}

      <div className={`mb-6 grid gap-4 ${STAT_COLUMNS[stats.length] ?? ""}`}>
        {stats.map((stat) => (
          <StatCard key={stat.label} label={stat.label} value={stat.value} />
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs
          label="Các mục của lớp"
          // See PREFETCH in `tabs.tsx`. These three views are one class the
          // teacher is already reading, so the background render exposes
          // nothing a click a second later would not have.
          prefetch
          items={TABS.map((item) => ({
            label: item.label,
            href: hrefFor(detail.classId, { tab: item.id, filter }),
            current: item.id === tab,
          }))}
        />

        {/* Only where they can act on something. A filter needs a status to
            filter by, and an unbanded class — or one whose standing did not
            load — has none. */}
        {tab === "students" && standing !== null ? (
          <FilterPills
            label="Lọc học viên theo tiến bộ"
            items={FILTERS.map((item) => ({
              label:
                item === "all" ? "Tất cả học viên" : MEMBER_STATUS_LABELS[item],
              href: hrefFor(detail.classId, { filter: item }),
              current: item === filter,
            }))}
          />
        ) : null}
      </div>

      {tab === "students" ? (
        <Students
          classId={detail.classId}
          timezone={detail.timezone}
          banded={banded}
          filter={filter}
          link={link}
          roster={roster}
          rosterTotal={students.length}
          pending={pending}
          standing={standing}
          selected={
            overview?.kind === "ok"
              ? (students.find(
                  (entry) =>
                    entry.membershipId === overview.overview.membershipId,
                ) ?? null)
              : null
          }
          overview={overview?.kind === "ok" ? overview.overview : null}
        />
      ) : null}

      {tab === "lessons" ? (
        <Lessons
          classId={detail.classId}
          timezone={detail.timezone}
          sessions={sessions}
        />
      ) : null}

      {tab === "info" ? (
        <ClassInfo classId={detail.classId} facts={facts} link={link} />
      ) : null}
    </PageShell>
  );
}

/**
 * How wide the statistics row runs, by how many statistics there are.
 *
 * The Figma sets a flat `grid-cols-4`, which only reads as designed with four
 * cards in it. EduTrack has one or three, so the count picks the track list
 * instead of a fixed four leaving a hole on the right. Written out rather than
 * interpolated because Tailwind reads these class names from the source.
 */
const STAT_COLUMNS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-2 sm:grid-cols-3",
  4: "grid-cols-2 lg:grid-cols-4",
};

/**
 * Where one student stands, as the database decided it.
 *
 * `loadClassBands` already answers `stable` for a member it has nothing to
 * compare — that is the view's own answer for an uneventful history, not this
 * page's guess — and the same word is used for a member missing from the map
 * entirely, so the two cannot be told apart by looking.
 */
function statusOf(
  standing: Map<string, MemberBands>,
  entry: RosterEntry,
): MemberStatus {
  return standing.get(entry.membershipId)?.status ?? "stable";
}

/**
 * One fact about the class: its own label, and the shorter form the header uses.
 *
 * `summary` is what runs under the title, where the Figma writes "Target: IELTS
 * 6.5" rather than a labelled row; `term` and `value` are what the Class Info
 * tab lays out as a label above a value. Both readings come from one list so
 * the two can never drift apart.
 */
type Fact = { term: string; value: string; summary?: string };

/**
 * The facts worth showing, skipping every column this class left blank.
 *
 * Blank stays blank rather than becoming "Not set": a class with no schedule
 * note has nothing to say about its schedule, and a row saying so is a row of
 * nothing. The Figma's Class Info grid has fixed rows because its data is a
 * fixture and every field is filled.
 *
 * The Figma also lists an "Invite code" here. EduTrack has one, and it is shown
 * below this grid as the whole joinable link rather than as a bare code,
 * because the link is the thing a teacher sends.
 */
function factsFor(detail: TeacherClassDetail): Fact[] {
  const facts: Fact[] = [];

  const course = isOfferedCourseType(detail.courseType)
    ? LABELS[detail.courseType]
    : detail.courseTypeOther;

  if (course) {
    facts.push({ term: "Khóa học", value: course, summary: course });
  }

  if (detail.targetBand !== null) {
    const band = `IELTS ${detail.targetBand.toFixed(1)}`;
    facts.push({ term: "Mục tiêu", value: band, summary: `Mục tiêu: ${band}` });
  }

  if (detail.scheduleNote) {
    facts.push({
      term: "Lịch học",
      value: detail.scheduleNote,
      summary: detail.scheduleNote,
    });
  }

  // Split in the grid, joined in the header — the Figma writes "Start date" and
  // "End date" as two rows of Class Info and one date range under the title.
  const start = DATE.format(asDate(detail.startDate));
  const end = detail.endDate ? DATE.format(asDate(detail.endDate)) : null;

  facts.push({
    term: "Ngày bắt đầu",
    value: start,
    summary: end ? `${start} — ${end}` : `Từ ${start}`,
  });

  // No `summary`: the header has already said this date, inside the range on
  // the fact above. Two rows in the grid, one phrase under the title.
  if (end) {
    facts.push({ term: "Ngày kết thúc", value: end });
  }

  return facts;
}

/**
 * The roster, and whichever student is open beneath it.
 *
 * The table is the Figma's, minus two of its eight columns. "Homework" is not a
 * column because EduTrack has no homework: there is no table, no view and no
 * number, and a column of dashes would be a promise of a feature. "Attendance"
 * is not a column because the Figma's is a single percentage, and a percentage
 * is a derived metric this application has consistently declined to invent —
 * attendance here is four distinct statuses per lesson, and it is shown as
 * exactly that in the panel below, where there is room to be honest about it.
 *
 * Everything else is the design as drawn: a 32px initials avatar over name and
 * address, the current band in semibold, the goal muted beside it, four thin
 * skill bars, and the standing as a tinted pill.
 */
function Students({
  classId,
  timezone,
  banded,
  filter,
  link,
  roster,
  rosterTotal,
  pending,
  standing,
  selected,
  overview,
}: {
  classId: string;
  timezone: string;
  banded: boolean;
  filter: Filter;
  link: string | null;
  roster: RosterEntry[];
  rosterTotal: number;
  pending: RosterEntry[];
  standing: Map<string, MemberBands> | null;
  selected: RosterEntry | null;
  overview: StudentOverview | null;
}) {
  return (
    <>
      <Table label="Học viên" containerClassName="mb-6">
        <TableHeader>
          <TableRow>
            <TableHead>Học viên</TableHead>
            {standing !== null ? (
              <>
                <TableHead>Band hiện tại</TableHead>
                <TableHead>Mục tiêu</TableHead>
                <TableHead>Kỹ năng</TableHead>
                <TableHead>Trạng thái</TableHead>
              </>
            ) : null}
            <TableHead>
              <span className="sr-only">Mở</span>
            </TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {/* Three different silences, kept apart. Nobody has joined at all;
              the filter matched nobody; or the roster is fine and not empty.
              None of them is an error — a class that could not be read never
              reaches this component. */}
          {roster.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={standing === null ? 2 : 6}
                className="p-12 text-center text-muted-foreground"
              >
                {rosterTotal === 0
                  ? "Chưa có ai tham gia. Hãy chia sẻ liên kết mời trong mục Thông tin lớp."
                  : "Không có học viên nào trong mục này."}
              </TableCell>
            </TableRow>
          ) : null}

          {roster.map((entry) => {
            const bands = standing?.get(entry.membershipId) ?? null;

            return (
              <TableRow
                key={entry.membershipId}
                id={anchorFor(entry)}
                // The open row, marked so the panel below can be traced back to
                // the person it belongs to.
                className={
                  entry.membershipId === selected?.membershipId
                    ? "bg-background"
                    : undefined
                }
              >
                <TableCell>
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar name={nameOf(entry)} />
                    <div className="min-w-0">
                      <p className="font-medium break-words">{nameOf(entry)}</p>
                      {entry.name && entry.email ? (
                        <p className="text-xs break-words text-muted-foreground">
                          {entry.email}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </TableCell>

                {standing !== null ? (
                  <>
                    <TableCell className="font-semibold whitespace-nowrap">
                      {formatBand(bands?.currentOverall ?? null) ?? (
                        <span className="font-normal text-muted-foreground">
                          Chưa ghi nhận
                        </span>
                      )}
                    </TableCell>

                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatBand(entry.targetBand) ?? "Chưa đặt"}
                    </TableCell>

                    <TableCell>
                      <Skills bands={bands} />
                    </TableCell>

                    <TableCell>
                      <Badge tone={STATUS_TONES[bands?.status ?? "stable"]}>
                        {MEMBER_STATUS_LABELS[bands?.status ?? "stable"]}
                      </Badge>
                    </TableCell>
                  </>
                ) : null}

                <TableCell className="whitespace-nowrap">
                  {/* The Figma makes the whole row a click target with an
                      `onClick`. A row cannot be a link, and a scripted row
                      would be a row that stops working with JavaScript off, so
                      the affordance is this — a real link, in the tab order,
                      named after the student it opens. */}
                  <Link
                    href={hrefFor(
                      classId,
                      { filter, student: entry.membershipId },
                      PANEL_ANCHOR,
                    )}
                    className="rounded-sm text-xs font-medium text-primary outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    Xem<span className="sr-only"> {nameOf(entry)}</span>{" "}
                    <span aria-hidden>→</span>
                  </Link>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {selected ? (
        <StudentPanel
          entry={selected}
          overview={overview}
          classId={classId}
          banded={banded}
          filter={filter}
          timezone={timezone}
        />
      ) : null}

      {pending.length > 0 ? (
        <>
          <h2 className="mt-10 mb-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Lời mời đang chờ ({pending.length})
          </h2>

          <Table label="Lời mời đang chờ">
            <TableHeader>
              <TableRow>
                <TableHead>Học viên</TableHead>
                <TableHead>Lời mời</TableHead>
                <TableHead>
                  <span className="sr-only">Thao tác</span>
                </TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {pending.map((entry) => (
                <TableRow key={entry.membershipId}>
                  <TableCell>
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar name={nameOf(entry)} />
                      <div className="min-w-0">
                        <p className="font-medium break-words">
                          {nameOf(entry)}
                        </p>
                        {entry.name && entry.email ? (
                          <p className="text-xs break-words text-muted-foreground">
                            {entry.email}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </TableCell>

                  {/* `invite_email_sent_at` is stamped only after the SMTP send
                      resolves, so this never claims a delivery that did not
                      happen. */}
                  <TableCell className="text-muted-foreground">
                    {entry.inviteEmailSentAt
                      ? `Đã gửi ${DATE.format(new Date(entry.inviteEmailSentAt))}`
                      : "Đã thêm, nhưng email mời chưa được gửi đi — hãy chia sẻ liên kết cho họ."}
                  </TableCell>

                  <TableCell>
                    <div className="min-w-40">
                      {/* Only offered when there is something to send and
                          somewhere to send it: the message carries the
                          invitation link, and a row invited by link alone has
                          no address on it. */}
                      {link && entry.email ? (
                        <form
                          action={resendInvitation.bind(
                            null,
                            classId,
                            entry.membershipId,
                          )}
                        >
                          <Button type="submit" variant="outline" size="sm">
                            Gửi lại lời mời
                          </Button>
                        </form>
                      ) : null}

                      <Confirm
                        label="Hủy lời mời"
                        prompt={`${nameOf(entry)} sẽ được gỡ khỏi danh sách lớp này. Bạn có thể mời lại họ sau.`}
                        confirmLabel="Hủy lời mời"
                        pendingLabel="Đang hủy…"
                        action={cancelInvitation.bind(
                          null,
                          classId,
                          entry.membershipId,
                        )}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      ) : null}
    </>
  );
}

/**
 * One student's four skill bands, drawn.
 *
 * Every number is `v_member_current_band`'s. Nothing is averaged, compared or
 * derived — the bar receives a band and a maximum of 9, which is the scale the
 * band domain itself runs on, and draws it.
 *
 * A skill with no band is left out rather than drawn as an empty track, the
 * same rule the score history already follows: `null` means "not measured", and
 * an empty bar beside three full ones reads as a zero.
 *
 * All four bars are one colour. The Figma turns a bar green above 6.5, which is
 * a judgement about whether a band is good — EduTrack keeps judgements like
 * that in the database, where a target band is per student and per class rather
 * than a number written into a stylesheet.
 */
function Skills({ bands }: { bands: MemberBands | null }) {
  const rows = BAND_SKILLS.map((skill) => {
    const capitalised = (skill.charAt(0).toUpperCase() +
      skill.slice(1)) as "Reading" | "Listening" | "Writing" | "Speaking";
    const band = bands?.[`current${capitalised}`] ?? null;
    return { skill, band };
  }).filter((row) => row.band !== null);

  if (rows.length === 0) {
    return <span className="text-muted-foreground">Chưa ghi nhận</span>;
  }

  return (
    <div className="w-28 space-y-1">
      {rows.map(({ skill, band }) => (
        <div key={skill} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="w-4 shrink-0 text-[10px] text-muted-foreground"
          >
            {BAND_FIELD_LABELS[skill].charAt(0)}
          </span>

          {/* The number is written beside the bar, so the bar itself is
              decoration and is hidden rather than announced twice. */}
          <ProgressBar value={band as number} max={9} />

          <span className="w-6 shrink-0 text-right text-[10px] text-muted-foreground">
            <span className="sr-only">{BAND_FIELD_LABELS[skill]} </span>
            {formatBand(band)}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * The class's own facts, and the way to invite people to it.
 *
 * The Figma's two-column grid, with the fields EduTrack actually stores. Its
 * "Invite code" row is the invitation block underneath: a code on its own is
 * not something a teacher can send, and the link and the email form are the two
 * ways this application has ever offered to hand one out. Both are unchanged —
 * the same `CopyField`, the same `inviteStudentByEmail` bound to the same class.
 */
function ClassInfo({
  classId,
  facts,
  link,
}: {
  classId: string;
  facts: Fact[];
  link: string | null;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <dl className="grid gap-4 sm:grid-cols-2">
        {facts.map((fact) => (
          <div key={fact.term} className="min-w-0">
            <dt className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {fact.term}
            </dt>
            <dd className="text-sm font-medium break-words text-foreground">
              {fact.value}
            </dd>
          </div>
        ))}
      </dl>

      <div id="invite" className="mt-6 border-t border-border pt-6">
        <h2 className="mb-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Mời học viên
        </h2>

        {link ? (
          <>
            <CopyField label="Liên kết mời vào lớp" value={link} />
            <p className="-mt-1 mb-6 text-sm text-muted-foreground">
              Bất kỳ ai có liên kết này đều có thể tham gia lớp.
            </p>

            {/* The same action the wizard's last step uses, bound to the class
                in the URL rather than to whichever class happens to be newest.
                That binding is not what authorises the write — the action
                re-reads the class filtered by the authenticated teacher's id
                before it does anything. Without this form, a teacher with more
                than one class would have no way to invite by email at all,
                because the step that used to offer it now sends them here. */}
            <form
              action={inviteStudentByEmail.bind(null, classId, "class")}
              className="space-y-1.5"
            >
              <Label htmlFor="email">Hoặc mời qua email</Label>
              <div className="flex flex-wrap items-start gap-2">
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="off"
                  placeholder="student@email.com"
                  className="min-w-0 grow basis-48"
                  required
                />
                <SubmitButton pendingLabel="Đang gửi…">Gửi</SubmitButton>
              </div>
            </form>
          </>
        ) : (
          // No email form either: the invitation email carries the link, so
          // with no usable code there is nothing to send.
          <p className="text-sm text-muted-foreground">
            Lớp này hiện chưa có liên kết mời nào đang hoạt động. Hãy tải lại
            trang sau giây lát để kiểm tra.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The lessons this class has held, and the way to add one.
 *
 * The Figma's class detail has no lessons on it — its prototype keeps lesson
 * logs on a page of their own — so this is the design's table vocabulary
 * applied to a section the design does not draw, rather than a screen copied.
 * It is a third tab because the alternative was deleting a working feature to
 * match a mock-up, and because a list of lessons is not a class fact and does
 * not belong in Class Info.
 */
function Lessons({
  classId,
  timezone,
  sessions,
}: {
  classId: string;
  timezone: string;
  sessions: ClassSession[] | null;
}) {
  return (
    <>
      {sessions === null ? (
        <Alert>
          Chúng tôi chưa tải được các buổi học của lớp này. Vui lòng tải lại
          trang.
        </Alert>
      ) : sessions.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center text-sm text-muted-foreground">
          Chưa có buổi học nào được ghi nhận.
        </div>
      ) : (
        <Table label="Buổi học">
          <TableHeader>
            <TableRow>
              <TableHead>Ngày</TableHead>
              <TableHead>Giờ</TableHead>
              <TableHead>Buổi học</TableHead>
              <TableHead>
                <span className="sr-only">Mở</span>
              </TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {sessions.map((session, index) => (
              <TableRow key={session.sessionId}>
                {/* Both instants are read on the class's own clock. Formatting
                    them without naming a zone would show a Vietnamese evening
                    class as having met the previous afternoon on a server
                    running in UTC. */}
                <TableCell className="font-medium whitespace-nowrap">
                  {formatZonedDate(timezone, session.startsAt)}
                </TableCell>

                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatZonedTime(timezone, session.startsAt)} –{" "}
                  {formatZonedTime(timezone, session.endsAt)}
                </TableCell>

                <TableCell>
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    {/* `ordinal` is the row's position in the chronological
                        list, not a stored lesson number — `class_sessions` has
                        no such column. It only gives an untitled lesson
                        something to be called, and so renumbers if a lesson is
                        later inserted between two others. */}
                    <span className="break-words">
                      {session.title ?? `Buổi ${index + 1}`}
                    </span>

                    {/* Everything this page creates is `scheduled`, the
                        column's default, so saying so on every row would be
                        noise. The other two states can only arrive from
                        elsewhere, and hiding them would misreport the class. */}
                    {session.status === "cancelled" ? (
                      <Badge tone="destructive">Đã hủy</Badge>
                    ) : session.status === "completed" ? (
                      <Badge tone="green">Đã hoàn thành</Badge>
                    ) : null}
                  </div>
                </TableCell>

                <TableCell className="whitespace-nowrap">
                  {/* The link carries both segments, and the page behind it
                      proves both — the session id alone does not select the
                      lesson. */}
                  <Link
                    href={`/teacher/${classId}/sessions/${session.sessionId}`}
                    className="rounded-sm text-xs font-medium text-primary outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    Mở
                    <span className="sr-only">
                      {" "}
                      {session.title ?? `buổi ${index + 1}`}
                    </span>{" "}
                    <span aria-hidden>→</span>
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Offered in all three states, including the failed one: whether the
          list could be read has no bearing on whether a lesson can be added. */}
      <div className="mt-4">
        <Button asChild variant="outline" size="sm">
          <Link href={`/teacher/${classId}/sessions/new`}>Tạo buổi học</Link>
        </Button>
      </div>
    </>
  );
}

/**
 * One student, opened: everything recorded about them, and every control that
 * writes it.
 *
 * This is the card the roster used to be, for one student at a time. Before
 * M18 every student's target-band picker and tag editors were rendered at once,
 * one stack of forms per person; the Figma's table has no room for that and
 * does not need it, so the controls follow the selection. Nothing was removed —
 * the goal, the strengths, the focus areas and the removal are all still here,
 * still the same Server Actions, still posting without JavaScript.
 *
 * WHAT THE FIGMA DRAWS. `src/pages/teacher/StudentProfile.tsx` is a full page:
 * a `rounded-2xl` header card carrying the avatar, the name and a band journey
 * on a `#F7F6F1` strip; a four-across row of skill cards; then a segmented
 * control over a two-column body. This is that page, laid out as the panel
 * EduTrack opens on `?student=`, and it is a stack of cards on the page ground
 * rather than one card with rules through it — which is what makes a panel look
 * like the Figma's page without becoming one.
 *
 * WHAT IT DOES NOT. The Figma's header runs "+ Lesson note" and "Generate
 * report" buttons; the first belongs to a lesson, which is where EduTrack
 * writes notes from, and the second has no handler in the Figma and no feature
 * behind it here. The affordance in that corner is Close, because unlike the
 * Figma this is a panel and there is something to close it back to. It stays a
 * link to the roster row, so it works with scripting off and Back still means
 * back.
 *
 * The Figma's tab strip is not reproduced either. Its three tabs are Learning
 * Profile, Lesson History and Homework: the first is built around a recharts
 * line chart, the second is the lesson notes below, and the third has no table
 * behind it in this schema. Reduced to what EduTrack can truthfully fill, the
 * strip would hold one tab and a half — and each press of it would be another
 * server round trip on the page this milestone is making faster. The sections
 * are laid out instead, which is also the only arrangement that keeps every
 * fact reachable with JavaScript switched off.
 *
 * `overview` may be null while `entry` is not: the roster row proved the
 * student is on this class list, and the overview query is a separate read that
 * can fail on its own. When it does, the controls still work and the banner at
 * the top of the page says the history could not be read — which is not the
 * same claim as "this student has no history".
 */
function StudentPanel({
  entry,
  overview,
  classId,
  banded,
  filter,
  timezone,
}: {
  entry: RosterEntry;
  overview: StudentOverview | null;
  classId: string;
  banded: boolean;
  filter: Filter;
  timezone: string;
}) {
  const bands = overview?.bands ?? null;

  return (
    <section
      id={PANEL_ANCHOR}
      aria-label={`Tổng quan về ${nameOf(entry)}`}
      className="mb-6 min-w-0 space-y-5"
    >
      {/* One list for every tag input below. A datalist is a suggestion and not
          a constraint — both columns are free text, and a teacher typing "Task 2
          structure" is the case these fields exist for. */}
      <datalist id={SUGGESTION_LIST}>
        {TAG_SUGGESTIONS.map((suggestion) => (
          <option key={suggestion} value={suggestion} />
        ))}
      </datalist>

      {/* `rounded-2xl`, one step rounder than every other card on the screen.
          That is the Figma's own distinction: the student header is the only
          `rounded-2xl` surface in the file, and it is what marks the block as
          the subject of the page rather than one more panel on it. */}
      <div className="min-w-0 rounded-2xl border border-border bg-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 grow basis-64 items-center gap-4">
            {/* The Figma's `w-14 h-14 rounded-2xl bg-[#EDF0FF] text-[#4466EE]
                text-lg` is `Avatar size="lg"` exactly, down to the corner
                radius. No image: EduTrack stores no avatars, and initials are
                what the Figma draws anyway. */}
            <Avatar name={nameOf(entry)} size="lg" />

            <div className="min-w-0">
              <h2 className="text-xl font-semibold break-words text-foreground">
                {nameOf(entry)}
              </h2>

              {/* The Figma prints the class name on this line. This page is
                  already titled with it, so the line carries the one identifier
                  a teacher looking at two students with the same first name
                  actually needs. */}
              {entry.name && entry.email ? (
                <p className="mt-0.5 text-sm break-words text-muted-foreground">
                  {entry.email}
                </p>
              ) : null}

              <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
                {entry.joinedAt ? (
                  <span>Tham gia {DATE.format(new Date(entry.joinedAt))}</span>
                ) : null}
                {/* Beside the name because the Figma has no home for it — its
                    own header carries an exam date instead, which EduTrack does
                    not record. The value is `v_member_performance_status`'s, not
                    this page's, and the badge spells it out in words. */}
                {bands ? (
                  <Badge tone={STATUS_TONES[bands.status]}>
                    {MEMBER_STATUS_LABELS[bands.status]}
                  </Badge>
                ) : null}
              </p>
            </div>
          </div>

          <Button asChild variant="outline" size="sm">
            <Link href={hrefFor(classId, { filter }, anchorFor(entry))}>
              Đóng
            </Link>
          </Button>
        </div>

        {banded && bands ? <Journey bands={bands} /> : null}
      </div>

      {banded && bands ? <SkillCards bands={bands} /> : null}

      <div className="grid min-w-0 gap-5 lg:grid-cols-2">
        {overview ? (
          <div className="min-w-0 space-y-5">
            {banded ? <ScoreHistory scores={overview.scores} /> : null}
            <AttendanceList marks={overview.attendance} timezone={timezone} />
          </div>
        ) : null}

        <div className="min-w-0 space-y-5">
          {banded ? <TargetBand entry={entry} classId={classId} /> : null}
          <Standing entry={entry} classId={classId} />
        </div>
      </div>

      {overview ? <LessonNotes notes={overview.notes} /> : null}

      <div className="min-w-0 rounded-xl border border-border bg-card p-5">
        <h3 className="text-sm font-semibold text-foreground">
          Xóa khỏi lớp
        </h3>
        <Confirm
          label="Xóa học viên khỏi lớp"
          prompt={`${nameOf(entry)} sẽ được gỡ khỏi danh sách lớp này. Tài khoản của họ và các lớp khác họ đang tham gia không bị ảnh hưởng.`}
          confirmLabel="Xóa học viên khỏi lớp"
          pendingLabel="Đang xóa…"
          action={removeStudent.bind(null, classId, entry.membershipId)}
        />
      </div>
    </section>
  );
}

/**
 * Where this student started, where they are, and where they are going.
 *
 * The Figma's band journey, on its `#F7F6F1` strip inside the header card, with
 * the same three values in the same order and the same three colours: the
 * starting band grey, the current band indigo, the target green.
 *
 * WITHOUT THE BAR. The Figma runs a progress bar between Starting and Current
 * captioned "{n}% to target", filled from
 * `((current - start) / (target - start)) * 100`. That number is not one
 * EduTrack has. It is not on `v_member_current_band`, no view computes it, and
 * working it out here would be this page inventing a metric and then presenting
 * it as a fact about a student — the same thing the attendance percentage was
 * refused for in M18. The three bands it is derived from are all real and are
 * all shown; the arithmetic over them is not, so it is left out rather than
 * approximated.
 *
 * `currentRecordedOn` is shown because the Figma's chart has a time axis and
 * this is the only part of it EduTrack can answer honestly: it says how old the
 * current band is, which is the question a plotted line is being asked. It is
 * the view's own column, read, not computed.
 */
function Journey({ bands }: { bands: StudentOverview["bands"] }) {
  // Nothing to say rather than three empty slots: a student nobody has assessed
  // has no starting band, no current band and no goal, and printing "Not
  // recorded" three times in 24px says less than one sentence does.
  const unassessed =
    bands.targetBand === null &&
    bands.startOverall === null &&
    bands.currentOverall === null;

  return (
    <div className="mt-6 min-w-0 rounded-xl bg-background p-4">
      {unassessed ? (
        <Empty>Chưa có band nào được ghi nhận.</Empty>
      ) : (
        <div className="flex min-w-0 flex-wrap items-end gap-x-6 gap-y-4">
          <Milestone
            term="Ban đầu"
            band={bands.startOverall}
            empty="Chưa ghi nhận"
            className="text-muted-foreground"
          />
          <Milestone
            term="Hiện tại"
            band={bands.currentOverall}
            empty="Chưa ghi nhận"
            className="text-primary"
          />
          {/* Decorative: the two words either side already say which way this
              reads, so the arrow is hidden rather than announced. */}
          <span aria-hidden className="pb-1.5 text-muted-foreground">
            →
          </span>
          {/* `--green-dark`, not the Figma's #3BA876, which is 2.75:1 on this
              strip and fails even the large-text floor. The M18 substitution. */}
          <Milestone
            term="Mục tiêu"
            band={bands.targetBand}
            empty="Chưa đặt"
            className="text-green-dark"
          />

          {bands.currentRecordedOn ? (
            <p className="pb-1.5 text-xs text-muted-foreground sm:ml-auto">
              Band hiện tại ghi nhận ngày{" "}
              {DATE.format(asDate(bands.currentRecordedOn))}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** One of the journey's three bands, or the reason there isn't one. */
function Milestone({
  term,
  band,
  empty,
  className,
}: {
  term: string;
  band: number | null;
  empty: string;
  className: string;
}) {
  const value = formatBand(band);

  return (
    <div className="min-w-0">
      <p className="mb-1 text-xs text-muted-foreground">{term}</p>
      {value === null ? (
        <p className="text-sm font-medium text-muted-foreground">{empty}</p>
      ) : (
        <p className={`text-2xl font-bold ${className}`}>{value}</p>
      )}
    </div>
  );
}

/**
 * The four skills, each on its own card.
 *
 * The Figma's `grid grid-cols-4 gap-3` row, with its label, its `text-2xl`
 * value, its `h-1.5` bar and its target footnote. Four across becomes two at
 * the narrow end, because four 24px numbers do not fit across a 320px screen.
 *
 * WITHOUT THE DELTA. Each Figma card carries a coloured `+0.5` beside the
 * value, the difference between the current skill band and the starting one.
 * `v_member_current_band` records a starting band for the overall score only —
 * there is no `start_reading` — so the difference cannot be computed for any of
 * these four without inventing the number it is measured from. The bar is
 * therefore always indigo rather than turning green on improvement, since that
 * colour is driven by the same missing value.
 *
 * A skill nobody has measured says so. `null` on the view means not measured,
 * and a bar drawn at zero would read as a band of zero — the distinction the
 * roster's own skill column already makes.
 */
function SkillCards({ bands }: { bands: StudentOverview["bands"] }) {
  return (
    <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-4">
      {BAND_SKILLS.map((skill) => {
        const capitalised = (skill.charAt(0).toUpperCase() +
          skill.slice(1)) as Capitalize<typeof skill>;

        return (
          <div
            key={skill}
            className="min-w-0 rounded-xl border border-border bg-card p-4"
          >
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              {BAND_FIELD_LABELS[skill]}
            </p>

            <SkillValue band={bands[`current${capitalised}`]} />

            {bands.targetBand === null ? null : (
              <p className="mt-1.5 text-[10px] text-muted-foreground">
                Mục tiêu {formatBand(bands.targetBand)}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** One skill's band and its bar, or the fact that it has neither. */
function SkillValue({ band }: { band: number | null }) {
  if (band === null) {
    return <p className="text-sm text-muted-foreground">Chưa ghi nhận</p>;
  }

  return (
    <>
      <p className="mb-1.5 text-2xl font-bold text-foreground">
        {formatBand(band)}
      </p>
      {/* The number is above it, so the bar is the same decoration it is on the
          roster and carries no label of its own. */}
      <ProgressBar value={band} max={9} />
    </>
  );
}

/**
 * Every band this student has been given, newest first.
 *
 * This is where the Figma's line chart would go, and it is a list instead. The
 * chart is recharts, which this milestone may not install, and the entries are
 * append-only records rather than points on a curve: an entry has a type, a
 * date, up to five bands and a note, and only two of those survive a plot. The
 * list keeps all of them.
 *
 * Read-only, as it has been since M16. `score_entries` is append-only — a
 * correction is a removal and a fresh record, never an UPDATE — and the removal
 * is offered on the lesson page that recorded the entry, which is the page that
 * knows the context. Adding a second one here would be a second place to keep
 * that rule correct.
 */
function ScoreHistory({ scores }: { scores: StudentOverview["scores"] }) {
  return (
    <Card title="Lịch sử điểm">
      {scores.length === 0 ? (
        <Empty>Chưa có mục điểm nào.</Empty>
      ) : (
        <ul className="min-w-0 space-y-3">
          {scores.map((score) => (
            <li
              key={score.entryId}
              className="min-w-0 border-t border-border pt-3 first:border-0 first:pt-0"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                {/* `recorded_on` is a bare `date` — a calendar square, read as
                    one. No instant, and so no zone conversion. */}
                <p className="text-sm font-semibold text-foreground">
                  {DATE.format(asDate(score.recordedOn))}
                </p>
                {/* One tone for all three types. The Figma gives the entry
                    kinds no colour vocabulary of their own, and inventing one
                    would put a meaning in the tint that nothing else on the
                    screen agrees with. The label carries it. */}
                <Badge>{SCORE_ENTRY_TYPE_LABELS[score.entryType]}</Badge>
              </div>

              <p className="mt-1 text-xs break-words text-muted-foreground">
                {bandsOf(score)}
              </p>

              {score.note ? (
                <p className="mt-1.5 text-sm break-words text-foreground">
                  {score.note}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * Every lesson this student was marked at.
 *
 * The Figma's student profile has no attendance anywhere — its teacher table
 * reduces the whole subject to one percentage — so this section is EduTrack's
 * and is drawn in the Figma's card vocabulary rather than after any block of
 * it. All four statuses keep their own word and their own tint: `excused` in
 * particular is the one that takes a lesson out of the reckoning altogether,
 * and a percentage cannot say so. No percentage is computed here, for the
 * reason M18 refused one.
 */
function AttendanceList({
  marks,
  timezone,
}: {
  marks: StudentOverview["attendance"];
  timezone: string;
}) {
  return (
    <Card title="Điểm danh">
      {marks.length === 0 ? (
        <Empty>Chưa ghi nhận điểm danh nào.</Empty>
      ) : (
        <ul className="min-w-0 space-y-3">
          {marks.map((mark) => (
            <li
              key={mark.sessionId}
              className="min-w-0 border-t border-border pt-3 first:border-0 first:pt-0"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                {/* The class's own clock, through `lib/time.ts`, exactly as the
                    lesson list reads the same two instants. */}
                <p className="min-w-0 text-sm font-semibold break-words text-foreground">
                  {formatZonedDate(timezone, mark.startsAt)}
                </p>
                <Badge tone={ATTENDANCE_TONES[mark.status]}>
                  {ATTENDANCE_LABELS[mark.status]}
                </Badge>
              </div>

              <p className="mt-1 text-xs break-words text-muted-foreground">
                {formatZonedTime(timezone, mark.startsAt)} –{" "}
                {formatZonedTime(timezone, mark.endsAt)}
                {mark.sessionTitle ? ` · ${mark.sessionTitle}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * The lesson notes written about this student, newest first.
 *
 * The Figma's Lesson History tab, card for card: the date and the skill on one
 * line, the topic under it, the performance as a tinted pill on the right, and
 * the note itself in a `#F7F6F1` block labelled "Teacher note". Each note is
 * its own card rather than a row in a list, which is the Figma's arrangement
 * and is also what lets a long note stay readable.
 *
 * Two things the Figma's card carries are absent. It shows a row of mistake
 * chips — `lesson_logs.mistakes` does exist, but nothing in EduTrack writes to
 * it, so every row's array is the empty default and the block would render for
 * no one. And it offers an Edit button; notes are edited where they are
 * written, on the lesson, and this milestone does not add a second route to
 * them.
 *
 * The Figma sets the note in italics inside literal quotation marks. The
 * italics are kept; the quote characters are not, because they are read out as
 * punctuation and the labelled block above already says whose words these are.
 */
function LessonNotes({ notes }: { notes: StudentOverview["notes"] }) {
  return (
    <div className="min-w-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">
          Ghi chú buổi học
        </h3>
        {notes.length > 0 ? (
          <p className="text-sm text-muted-foreground">
            {notes.length} ghi chú
          </p>
        ) : null}
      </div>

      {notes.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Chưa có ghi chú buổi học nào.
        </p>
      ) : (
        <div className="min-w-0 space-y-3">
          {notes.map((note) => (
            <article
              key={note.noteId}
              className="min-w-0 rounded-xl border border-border bg-card p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 grow basis-48">
                  <p className="text-sm font-semibold break-words text-foreground">
                    {DATE.format(asDate(note.lessonDate))}
                    <span className="font-normal text-muted-foreground">
                      {" "}
                      — {SKILL_LABELS[note.skill]}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs break-words text-muted-foreground">
                    {note.topic}
                  </p>
                </div>

                <Badge tone={PERFORMANCE_TONES[note.performance]}>
                  {PERFORMANCE_LABELS[note.performance]}
                </Badge>
              </div>

              {note.note ? (
                <div className="mt-3 min-w-0 rounded-lg bg-background p-3">
                  <p className="text-xs font-medium text-muted-foreground">
                    Ghi chú của giáo viên
                  </p>
                  <p className="mt-1 text-sm break-words text-foreground italic">
                    {note.note}
                  </p>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One student's goal, and the way to change it.
 *
 * The saved value is printed above the picker rather than left to the
 * `<select>`'s own state, because those two can disagree: after a rejected save
 * the browser keeps showing the value the teacher chose while the database
 * still holds the old one. The line is read from the roster on every render, so
 * it is always the stored goal — the picker is the editor, the line is the
 * truth, exactly as `Standing` and `ScoreForm` are split on the session page.
 * It is set in the Figma's green at the Figma's `text-2xl font-bold`, because
 * it is the same number the journey's third milestone shows.
 *
 * The options are `BAND_VALUES`, `public.band`'s CHECK written out, plus one
 * explicit "Not set" carrying the empty string. A goal that has not been set is
 * a real state and clearing one is a real edit, so it is offered as a choice a
 * teacher can pick rather than something only reachable by never touching the
 * control. `setTargetBand` reads that empty string as the clear.
 *
 * A plain `<form action={...}>` with the shared `SubmitButton`: pending shows
 * as "Saving…" on the button, the page re-renders from the server afterwards,
 * and with JavaScript off the whole thing still posts and still saves. No
 * optimistic display, because unlike an attendance mark this value is not one
 * of four buttons whose pressed state is the feedback — the printed line is,
 * and printing a number the server has not accepted yet would be a claim the
 * save succeeded.
 */
function TargetBand({
  entry,
  classId,
}: {
  entry: RosterEntry;
  classId: string;
}) {
  const saved = formatBand(entry.targetBand);
  const field = `target-${entry.membershipId}`;

  return (
    <div className="min-w-0 rounded-xl border border-border bg-card p-5">
      <h3 className="text-sm font-semibold text-foreground">Band mục tiêu</h3>

      {saved === null ? (
        <p className="mt-2 text-sm text-muted-foreground">Chưa đặt</p>
      ) : (
        <p className="mt-2 text-2xl font-bold text-green-dark">{saved}</p>
      )}

      {/* `flex-wrap` so the picker and the button stack rather than overflow
          once the panel is 390px wide. */}
      <form
        action={setTargetBand.bind(null, classId, entry.membershipId)}
        className="mt-3 flex flex-wrap items-center gap-2"
      >
        {/* The heading names the control on screen; this names it to a screen
            reader, which does not read a sibling heading as a label. */}
        <label htmlFor={field} className="sr-only">
          Band mục tiêu
        </label>

        <select
          id={field}
          name="targetBand"
          defaultValue={saved ?? ""}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
        >
          <option value="">Chưa đặt</option>
          {BAND_VALUES.map((band) => (
            <option key={band} value={band}>
              {band}
            </option>
          ))}
        </select>

        <SubmitButton pendingLabel="Đang lưu…">Lưu</SubmitButton>
      </form>
    </div>
  );
}

/**
 * What this student does well, and what they are working on.
 *
 * One form and one Save for both lists, because they are one judgement: a
 * teacher deciding that fluency has come good and grammar is now the problem
 * changes both in the same breath, and two buttons would let a card sit half
 * saved. `saveStandingNotes` writes both columns in a single UPDATE for the
 * same reason.
 *
 * The Figma gives these two lists a card each and tints their chips — strengths
 * green, areas to improve orange. The tints are adopted; the two cards are not,
 * because splitting them would put two headings around one Save and imply two
 * saves. The `tone` prop on `TagEditor` is the whole of that change.
 *
 * The second list keeps EduTrack's name. The Figma heads it "Areas to Improve";
 * the column is `focus_areas` and the student's own page calls it Focus areas,
 * and renaming it on one screen would leave a teacher and a student looking at
 * the same list under two different words.
 *
 * Each `TagEditor` is keyed on its own saved list. That is what re-seeds the
 * pending state from the server after a save: the stored list changes, the key
 * changes, the editor remounts holding what was actually written. It also means
 * a rejected save leaves the editor showing the stored lists again rather than
 * the attempted ones — the same honesty the target-band line has, where what is
 * drawn is always what the database holds.
 *
 * U+0000 joins the key because it cannot occur in a tag; a comma could.
 */
function Standing({ entry, classId }: { entry: RosterEntry; classId: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-card p-5">
      <form action={saveStandingNotes.bind(null, classId, entry.membershipId)}>
        <h3 className="text-sm font-semibold text-foreground">
          Điểm mạnh và nội dung cần cải thiện
        </h3>

        <TagEditor
          key={`s:${entry.strengths.join("\u0000")}`}
          label="Điểm mạnh"
          hint="Học viên này làm tốt điều gì"
          name="strengths"
          addName="addStrength"
          saved={entry.strengths}
          empty="Chưa ghi nhận điểm mạnh nào."
          listId={SUGGESTION_LIST}
          tone="green"
        />

        <TagEditor
          key={`f:${entry.focusAreas.join("\u0000")}`}
          label="Nội dung cần cải thiện"
          hint="Điều gì cần cải thiện"
          name="focusAreas"
          addName="addFocusArea"
          saved={entry.focusAreas}
          empty="Chưa ghi nhận nội dung cần cải thiện nào."
          listId={SUGGESTION_LIST}
          tone="orange"
        />

        <div className="mt-4">
          <SubmitButton pendingLabel="Đang lưu…">Lưu</SubmitButton>
        </div>
      </form>
    </div>
  );
}

/**
 * Every band an entry actually carries, in the schema's own order.
 *
 * A skill that was not measured is left out rather than shown blank: `null` on
 * `score_entries` means "not measured", and an empty slot beside four numbers
 * reads like a zero.
 */
function bandsOf(score: StudentOverview["scores"][number]): string {
  return BAND_FIELDS.map((field) => {
    const band = formatBand(score[field]);
    return band === null ? null : `${BAND_FIELD_LABELS[field]} ${band}`;
  })
    .filter((part): part is string => part !== null)
    .join(" · ");
}

/**
 * One titled card in the overview.
 *
 * The Figma's body card: `bg-white rounded-xl border border-[#E8E6DE] p-5` with
 * a `text-sm font-semibold` heading. `h3` because the student's name above it
 * is the `h2` — the panel is one section of a page whose `h1` is the class.
 */
function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-card p-5">
      <h3 className="mb-3 text-sm font-semibold text-foreground">{title}</h3>
      {children}
    </div>
  );
}

/** What a section says when the student has no history of that kind yet. */
function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

/**
 * A destructive action behind an explicit confirmation.
 *
 * `<details>` rather than a dialog or a `confirm()` call, because every other
 * form on this page posts without JavaScript and this one does too: the
 * disclosure is the browser's own, the submit button only exists once it is
 * open, and the summary turns into the way back out. Nothing here is a client
 * component except the submit button, which is the same purely additive pending
 * state the invite form uses.
 *
 * The button is the outline treatment in the destructive pair rather than a new
 * variant — the Figma has no destructive button, and the tinted-surface-plus-
 * hairline pattern it does have is what `Alert` is already built from.
 */
function Confirm({
  label,
  prompt,
  confirmLabel,
  pendingLabel,
  action,
}: {
  label: string;
  prompt: string;
  confirmLabel: string;
  pendingLabel: string;
  action: () => Promise<void>;
}) {
  return (
    <details className="group mt-3 min-w-0">
      <summary className="inline-flex cursor-pointer list-none items-center text-sm font-medium text-destructive hover:underline [&::-webkit-details-marker]:hidden">
        <span className="group-open:hidden">{label}</span>
        <span className="hidden group-open:inline">Không, giữ lại</span>
      </summary>

      <div className="mt-3 rounded-lg border border-destructive/25 bg-destructive-light p-3.5">
        <p className="mb-3 text-sm break-words text-destructive">{prompt}</p>

        <form action={action}>
          <SubmitButton
            pendingLabel={pendingLabel}
            className="border border-destructive/30 bg-card px-3 py-2 text-xs font-medium text-destructive hover:bg-background"
          >
            {confirmLabel}
          </SubmitButton>
        </form>
      </div>
    </details>
  );
}

/**
 * The shell the failed load sits in — with the trail kept, so a failed read
 * does not strand anyone on a page with no exit.
 */
function Frame({ children }: { children: ReactNode }) {
  return (
    <PageShell width="5xl">
      <Breadcrumb
        className="mb-6"
        items={[{ label: "Lớp học", href: "/teacher" }, { label: "Lớp học" }]}
      />
      {children}
    </PageShell>
  );
}
