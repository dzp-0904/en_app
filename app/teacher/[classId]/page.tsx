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
import { PERFORMANCE_LABELS, SKILL_LABELS } from "@/lib/lesson-log";
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
  title: "Class",
};

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
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
  { id: "students", label: "Students" },
  { id: "lessons", label: "Lessons" },
  { id: "info", label: "Class Info" },
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
 * `/teacher/<id>` a teacher arrives on is the same URL the "Students" tab and
 * the "All students" pill point at — one address for one view, and no growing
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
  return entry.name ?? entry.email ?? "This student";
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
          We couldn&apos;t load this class just now. Please refresh the page.
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
  // an unbanded class, which has no bands to load.
  //
  // Nothing is loaded for the panel unless a student is selected, so the roster
  // costs a teacher who has not opened one exactly what it did before.
  const [sessions, bands, overview] = await Promise.all([
    // Loaded separately from the class itself so that a failure here costs the
    // teacher the lesson list and nothing else. `null` is that failure, and it
    // is deliberately not `[]`: "no lessons have been recorded yet" is a claim
    // about the class, and the page is not entitled to make it on the strength
    // of a query that did not come back.
    loadClassSessions(supabase, detail.classId),
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
      ? "That student is no longer on this class list."
      : overview?.kind === "error"
        ? "We couldn't load that student's overview just now. Please try again."
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
    { label: "Students", value: String(students.length) },
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
          { label: "Classes", href: "/teacher" },
          { label: detail.className },
        ]}
        title={detail.className}
        meta={facts
          .map((fact) => fact.summary)
          .filter((summary): summary is string => summary !== undefined)}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={`/teacher/${detail.classId}/edit`}>Edit class</Link>
            </Button>

            <Button asChild>
              <Link href={hrefFor(detail.classId, { tab: "info" }, "invite")}>
                Invite students
              </Link>
            </Button>
          </>
        }
      />

      {notice ? <Alert className="mb-5">{notice}</Alert> : null}

      {banded && bands === null ? (
        <Alert className="mb-5">
          We couldn&apos;t load this class&apos;s bands and progress just now.
          The list below is still your class; please refresh the page to see
          where everyone stands.
        </Alert>
      ) : null}

      <div className={`mb-6 grid gap-4 ${STAT_COLUMNS[stats.length] ?? ""}`}>
        {stats.map((stat) => (
          <StatCard key={stat.label} label={stat.label} value={stat.value} />
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs
          label="Class views"
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
            label="Filter students by progress"
            items={FILTERS.map((item) => ({
              label:
                item === "all" ? "All students" : MEMBER_STATUS_LABELS[item],
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
    facts.push({ term: "Course", value: course, summary: course });
  }

  if (detail.targetBand !== null) {
    const band = `IELTS ${detail.targetBand.toFixed(1)}`;
    facts.push({ term: "Target", value: band, summary: `Target: ${band}` });
  }

  if (detail.scheduleNote) {
    facts.push({
      term: "Schedule",
      value: detail.scheduleNote,
      summary: detail.scheduleNote,
    });
  }

  // Split in the grid, joined in the header — the Figma writes "Start date" and
  // "End date" as two rows of Class Info and one date range under the title.
  const start = DATE.format(asDate(detail.startDate));
  const end = detail.endDate ? DATE.format(asDate(detail.endDate)) : null;

  facts.push({
    term: "Start date",
    value: start,
    summary: end ? `${start} — ${end}` : `From ${start}`,
  });

  // No `summary`: the header has already said this date, inside the range on
  // the fact above. Two rows in the grid, one phrase under the title.
  if (end) {
    facts.push({ term: "End date", value: end });
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
      <Table label="Students" containerClassName="mb-6">
        <TableHeader>
          <TableRow>
            <TableHead>Student</TableHead>
            {standing !== null ? (
              <>
                <TableHead>Current band</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Skills</TableHead>
                <TableHead>Status</TableHead>
              </>
            ) : null}
            <TableHead>
              <span className="sr-only">Open</span>
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
                  ? "Nobody has joined yet. Share the invitation link from Class Info."
                  : "No students in this category."}
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
                          Not recorded
                        </span>
                      )}
                    </TableCell>

                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatBand(entry.targetBand) ?? "Not set"}
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
                    View<span className="sr-only"> {nameOf(entry)}</span>{" "}
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
            Pending invitations ({pending.length})
          </h2>

          <Table label="Pending invitations">
            <TableHeader>
              <TableRow>
                <TableHead>Student</TableHead>
                <TableHead>Invitation</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
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
                      ? `Sent ${DATE.format(new Date(entry.inviteEmailSentAt))}`
                      : "Added, but the invitation email has not gone out — share the link with them."}
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
                            Resend invitation
                          </Button>
                        </form>
                      ) : null}

                      <Confirm
                        label="Cancel invitation"
                        prompt={`${nameOf(entry)} will be taken off this class list. You can invite them again afterwards.`}
                        confirmLabel="Cancel invitation"
                        pendingLabel="Cancelling…"
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
    return <span className="text-muted-foreground">Not recorded</span>;
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
          Invite students
        </h2>

        {link ? (
          <>
            <CopyField label="Class invitation link" value={link} />
            <p className="-mt-1 mb-6 text-sm text-muted-foreground">
              Anyone with this link can join this class.
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
              <Label htmlFor="email">Or invite by email</Label>
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
                <SubmitButton pendingLabel="Sending…">Send</SubmitButton>
              </div>
            </form>
          </>
        ) : (
          // No email form either: the invitation email carries the link, so
          // with no usable code there is nothing to send.
          <p className="text-sm text-muted-foreground">
            This class has no active invitation link right now. Refresh the page
            in a moment to check again.
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
          We couldn&apos;t load this class&apos;s lessons just now. Please
          refresh the page.
        </Alert>
      ) : sessions.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center text-sm text-muted-foreground">
          No lessons have been recorded yet.
        </div>
      ) : (
        <Table label="Lessons">
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Time</TableHead>
              <TableHead>Lesson</TableHead>
              <TableHead>
                <span className="sr-only">Open</span>
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
                      {session.title ?? `Lesson ${index + 1}`}
                    </span>

                    {/* Everything this page creates is `scheduled`, the
                        column's default, so saying so on every row would be
                        noise. The other two states can only arrive from
                        elsewhere, and hiding them would misreport the class. */}
                    {session.status === "cancelled" ? (
                      <Badge tone="destructive">Cancelled</Badge>
                    ) : session.status === "completed" ? (
                      <Badge tone="green">Completed</Badge>
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
                    Open
                    <span className="sr-only">
                      {" "}
                      {session.title ?? `lesson ${index + 1}`}
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
          <Link href={`/teacher/${classId}/sessions/new`}>Create lesson</Link>
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
 * this milestone every student's target-band picker and tag editors were
 * rendered at once, one stack of forms per person; the Figma's table has no
 * room for that and does not need it, so the controls follow the selection.
 * Nothing was removed — the goal, the strengths, the focus areas and the
 * removal are all still here, still the same Server Actions, still posting
 * without JavaScript.
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
  return (
    <section
      id={PANEL_ANCHOR}
      aria-label={`${nameOf(entry)} — overview`}
      className="mb-6 min-w-0 rounded-xl border border-border bg-card p-6"
    >
      {/* One list for every tag input below. A datalist is a suggestion and not
          a constraint — both columns are free text, and a teacher typing "Task 2
          structure" is the case these fields exist for. */}
      <datalist id={SUGGESTION_LIST}>
        {TAG_SUGGESTIONS.map((suggestion) => (
          <option key={suggestion} value={suggestion} />
        ))}
      </datalist>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 grow basis-64 items-center gap-3">
          <Avatar name={nameOf(entry)} size="lg" />
          <div className="min-w-0">
            <h2 className="font-semibold break-words text-foreground">
              {nameOf(entry)}
            </h2>
            {entry.name && entry.email ? (
              <p className="text-sm break-words text-muted-foreground">
                {entry.email}
              </p>
            ) : null}
            {entry.joinedAt ? (
              <p className="mt-0.5 text-xs text-muted-foreground">
                Joined {DATE.format(new Date(entry.joinedAt))}
              </p>
            ) : null}
          </div>
        </div>

        <Button asChild variant="outline" size="sm">
          <Link href={hrefFor(classId, { filter }, anchorFor(entry))}>
            Close
          </Link>
        </Button>
      </div>

      <div className="mt-6 space-y-6">
        {banded ? <TargetBand entry={entry} classId={classId} /> : null}

        <Standing entry={entry} classId={classId} />

        {overview ? (
          <Overview
            overview={overview}
            banded={banded}
            timezone={timezone}
          />
        ) : null}
      </div>

      <div className="mt-6 border-t border-border pt-4">
        <Confirm
          label="Remove student"
          prompt={`${nameOf(entry)} will be taken off this class list. Their account and any other classes they are in are not affected.`}
          confirmLabel="Remove student"
          pendingLabel="Removing…"
          action={removeStudent.bind(null, classId, entry.membershipId)}
        />
      </div>
    </section>
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
    <form action={setTargetBand.bind(null, classId, entry.membershipId)}>
      <label
        htmlFor={field}
        className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
      >
        Target band
      </label>

      <p className="mt-1 text-sm text-foreground">{saved ?? "Not set"}</p>

      {/* `flex-wrap` so the picker and the button stack rather than overflow
          once the panel is 390px wide. */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          id={field}
          name="targetBand"
          defaultValue={saved ?? ""}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
        >
          <option value="">Not set</option>
          {BAND_VALUES.map((band) => (
            <option key={band} value={band}>
              {band}
            </option>
          ))}
        </select>

        <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
      </div>
    </form>
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
    <form
      action={saveStandingNotes.bind(null, classId, entry.membershipId)}
      className="min-w-0 border-t border-border pt-5"
    >
      <TagEditor
        key={`s:${entry.strengths.join("\u0000")}`}
        label="Strengths"
        hint="What this student does well"
        name="strengths"
        addName="addStrength"
        saved={entry.strengths}
        empty="No strengths recorded yet."
        listId={SUGGESTION_LIST}
      />

      <TagEditor
        key={`f:${entry.focusAreas.join("\u0000")}`}
        label="Focus areas"
        hint="What needs improvement"
        name="focusAreas"
        addName="addFocusArea"
        saved={entry.focusAreas}
        empty="No focus areas recorded yet."
        listId={SUGGESTION_LIST}
      />

      <div className="mt-3">
        <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
      </div>
    </form>
  );
}

/**
 * One student's existing facts, gathered.
 *
 * A view and only a view. There is no form here and no Server Action: every one
 * of these values already has a dedicated control elsewhere on this page or on
 * the lesson pages, and a second way to write them would be a second thing to
 * keep correct.
 *
 * `banded` gates the two band sections for the same reason `TargetBand` is
 * gated: a class that scores on nothing has no bands to show, and the actions
 * that record them refuse the write for that class anyway.
 */
function Overview({
  overview,
  banded,
  timezone,
}: {
  overview: StudentOverview;
  banded: boolean;
  timezone: string;
}) {
  const { bands } = overview;

  // Nothing to say rather than three empty rows: a student nobody has assessed
  // has no starting band, no current band and no goal, and printing "Not set"
  // three times says less than one sentence does.
  const unassessed =
    bands.targetBand === null &&
    bands.startOverall === null &&
    bands.currentOverall === null;

  return (
    <div className="min-w-0 space-y-5 border-t border-border pt-5">
      {banded ? (
        <Section title="Progress">
          {unassessed ? (
            <Empty>No bands have been recorded yet.</Empty>
          ) : (
            <dl className="space-y-2">
              {/* Every value here is the database's own. `target_band`,
                  `start_overall` and `current_overall` come off
                  `v_member_current_band` and the status off
                  `v_member_performance_status`; nothing is compared or averaged
                  on this page. */}
              <Fact
                term="Target"
                value={formatBand(bands.targetBand) ?? "Not set"}
              />
              <Fact
                term="Starting"
                value={formatBand(bands.startOverall) ?? "Not recorded"}
              />
              <Fact
                term="Current"
                value={formatBand(bands.currentOverall) ?? "Not recorded"}
              />
              <Fact
                term="Status"
                value={MEMBER_STATUS_LABELS[bands.status]}
              />
            </dl>
          )}
        </Section>
      ) : null}

      {/* Strengths and focus areas are not repeated here. They were their own
          two sections while the overview was a panel of its own; now that the
          editor above sits in the same card and prints the same two saved
          lists, showing them twice would be one column rendered twice on one
          screen. Nothing is lost — `Standing` reads the same values. */}

      <Section title="Attendance">
        {overview.attendance.length === 0 ? (
          <Empty>No attendance recorded yet.</Empty>
        ) : (
          <ul className="space-y-2.5">
            {overview.attendance.map((mark) => (
              <li key={mark.sessionId} className="min-w-0">
                {/* All four statuses, each with its own word and its own tint.
                    The Figma's teacher table reduces attendance to one
                    percentage; EduTrack records four distinct states per
                    lesson, and `excused` in particular is the one that takes a
                    lesson out of the reckoning altogether. */}
                <Badge tone={ATTENDANCE_TONES[mark.status]}>
                  {ATTENDANCE_LABELS[mark.status]}
                </Badge>
                {/* The class's own clock, through `lib/time.ts`, exactly as the
                    lesson list reads the same two instants. */}
                <p className="mt-1 text-xs break-words text-muted-foreground">
                  {formatZonedDate(timezone, mark.startsAt)} ·{" "}
                  {formatZonedTime(timezone, mark.startsAt)} –{" "}
                  {formatZonedTime(timezone, mark.endsAt)}
                  {mark.sessionTitle ? ` · ${mark.sessionTitle}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {banded ? (
        <Section title="Score history">
          {overview.scores.length === 0 ? (
            <Empty>No score entries yet.</Empty>
          ) : (
            <ul className="space-y-2.5">
              {overview.scores.map((score) => (
                <li key={score.entryId} className="min-w-0">
                  {/* `recorded_on` is a bare `date` — a calendar square, read
                      as one. No instant, and so no zone conversion. */}
                  <p className="text-sm text-foreground">
                    {DATE.format(asDate(score.recordedOn))} ·{" "}
                    {SCORE_ENTRY_TYPE_LABELS[score.entryType]}
                  </p>
                  <p className="text-xs break-words text-muted-foreground">
                    {bandsOf(score)}
                  </p>
                  {score.note ? (
                    <p className="mt-1 text-sm break-words text-foreground">
                      {score.note}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : null}

      <Section title="Lesson notes">
        {overview.notes.length === 0 ? (
          <Empty>No lesson notes yet.</Empty>
        ) : (
          <ul className="space-y-2.5">
            {overview.notes.map((note) => (
              <li key={note.noteId} className="min-w-0">
                <p className="text-sm break-words text-foreground">
                  {note.topic}
                </p>
                <p className="text-xs text-muted-foreground">
                  {DATE.format(asDate(note.lessonDate))} ·{" "}
                  {SKILL_LABELS[note.skill]} ·{" "}
                  {PERFORMANCE_LABELS[note.performance]}
                </p>
                {note.note ? (
                  <p className="mt-1 text-sm break-words text-foreground">
                    {note.note}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>
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

/** One labelled block inside the overview. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </p>
      {children}
    </div>
  );
}

/** What a section says when the student has no history of that kind yet. */
function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

/** One term and its value, in the same shape as the class facts. */
function Fact({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex gap-4 text-sm">
      <dt className="w-20 shrink-0 text-muted-foreground">{term}</dt>
      <dd className="break-words text-foreground">{value}</dd>
    </div>
  );
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
        <span className="hidden group-open:inline">Never mind</span>
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
        items={[{ label: "Classes", href: "/teacher" }, { label: "Class" }]}
      />
      {children}
    </PageShell>
  );
}
