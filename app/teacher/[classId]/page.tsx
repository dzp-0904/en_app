import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";

import { inviteStudentByEmail } from "@/app/onboarding/actions";
import { SubmitButton } from "@/components/auth/submit-button";
import { CopyField } from "@/components/onboarding/copy-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LABELS, isOfferedCourseType } from "@/lib/course-type";
import { loadUserState } from "@/lib/onboarding";
import type { DynamicPageProps } from "@/lib/route-types";
import { joinUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";
import {
  loadClassSessions,
  loadStudentOverview,
  loadTeacherClass,
  type ClassSession,
  type RosterEntry,
  type StudentOverview,
  type TeacherClassDetail,
} from "@/lib/teacher";
import { formatZonedDate, formatZonedTime } from "@/lib/time";

import { TagEditor } from "@/components/roster/tag-editor";
import { ATTENDANCE_LABELS } from "@/lib/attendance";
import { PERFORMANCE_LABELS, SKILL_LABELS } from "@/lib/lesson-log";
import {
  BAND_FIELDS,
  BAND_FIELD_LABELS,
  BAND_VALUES,
  MEMBER_STATUS_LABELS,
  SCORE_ENTRY_TYPE_LABELS,
  formatBand,
  isBandScored,
} from "@/lib/score";
import { TAG_SUGGESTIONS } from "@/lib/standing";
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
 * The roster is the point. Every table this milestone deliberately leaves alone
 * — attendance, scores, lesson logs, homework submissions — hangs off
 * `class_members.id`, so this list is the thing all of them will later be
 * recorded against. Showing it is what turns a class from a row created during
 * onboarding into something a teacher can work with.
 *
 * Identity comes from `loadUserState`, exactly as `/teacher` and the student
 * pages do. Ownership comes from `loadTeacherClass`, which cannot return a
 * class the caller does not own — the `classId` in the URL selects a row, it
 * does not authorise one.
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

/** The facts worth showing, skipping every column this class left blank. */
function factsFor(detail: TeacherClassDetail): { term: string; value: string }[] {
  const facts: { term: string; value: string }[] = [];

  const course = isOfferedCourseType(detail.courseType)
    ? LABELS[detail.courseType]
    : detail.courseTypeOther;

  if (course) facts.push({ term: "Course", value: course });

  if (detail.targetBand !== null) {
    facts.push({ term: "Target", value: `IELTS ${detail.targetBand.toFixed(1)}` });
  }

  facts.push({
    term: "Dates",
    value: detail.endDate
      ? `${DATE.format(asDate(detail.startDate))} – ${DATE.format(asDate(detail.endDate))}`
      : `From ${DATE.format(asDate(detail.startDate))}`,
  });

  if (detail.scheduleNote) {
    facts.push({ term: "Schedule", value: detail.scheduleNote });
  }

  return facts;
}

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

  // Loaded separately from the class itself so that a failure here costs the
  // teacher the lesson list and nothing else — the facts, the invitation link
  // and the roster above are already in hand. `null` is that failure, and it is
  // deliberately not `[]`: "no lessons have been recorded yet" is a claim about
  // the class, and the page is not entitled to make it on the strength of a
  // query that did not come back.
  const sessions = await loadClassSessions(supabase, detail.classId);

  // Every action on this page — inviting, removing, cancelling, resending —
  // reports failure the same way: by redirecting back with the message
  // attached, so the page stays a Server Component and each form works without
  // JavaScript. One banner serves all of them, at the top, because that is
  // where the reader arrives after the redirect.
  const query = await searchParams;
  const error = typeof query.error === "string" ? query.error : undefined;

  // Which student's overview is open, if any. A query parameter rather than a
  // route: the panel is one card of this page expanded, so it belongs to this
  // page's URL. It is a selector and not a credential — `loadStudentOverview`
  // re-proves the membership against the class in the database before it reads
  // anything, and this page has already proved the class.
  const selected = typeof query.student === "string" ? query.student : undefined;

  // Nothing is loaded unless a student is selected, so the roster costs exactly
  // what it did before this milestone for every teacher who has not opened one.
  const overview = selected
    ? await loadStudentOverview(supabase, detail.classId, selected)
    : null;

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

  // The same test the session page makes before showing bands at all. A target
  // band is an IELTS goal, and a class that scores on nothing has no use for
  // one — `setTargetBand` refuses the write for the same reason, so the control
  // is absent here rather than present and rejected.
  const banded = isBandScored(detail.courseType);

  return (
    <Frame>
      {/* Same pairing as the list's "Create class": the heading names what you
          are looking at, the button beside it is the one thing you can do to
          it. Editing is a page rather than an inline form because the fields
          are the whole of `ClassForm`, not a single value. */}
      <div className="mb-8 flex items-baseline justify-between gap-4">
        <h1 className="font-serif text-2xl leading-relaxed text-foreground">
          {detail.className}
        </h1>

        <Button asChild variant="outline" size="sm">
          <Link href={`/teacher/${detail.classId}/edit`}>Edit class</Link>
        </Button>
      </div>

      {notice ? <Alert className="mb-5">{notice}</Alert> : null}

      <Card>
        <dl className="space-y-3">
          {factsFor(detail).map((fact) => (
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
        Invite students
      </h2>

      {link ? (
        <Card>
          <CopyField label="Class invitation link" value={link} />
          <p className="-mt-1 mb-6 text-sm text-muted-foreground">
            Anyone with this link can join this class.
          </p>

          {/* The same action the wizard's last step uses, bound to the class in
              the URL rather than to whichever class happens to be newest. That
              binding is not what authorises the write — the action re-reads the
              class filtered by the authenticated teacher's id before it does
              anything. Without this form, a teacher with more than one class
              would have no way to invite by email at all, because the step that
              used to offer it now sends them here. */}
          <form
            action={inviteStudentByEmail.bind(null, detail.classId, "class")}
            className="space-y-1.5"
          >
            <Label htmlFor="email">Or invite by email</Label>
            <div className="flex items-start gap-2">
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="off"
                placeholder="student@email.com"
                className="flex-1"
                required
              />
              <SubmitButton pendingLabel="Sending…">Send</SubmitButton>
            </div>
          </form>
        </Card>
      ) : (
        // No email form either: the invitation email carries the link, so with
        // no usable code there is nothing to send.
        <Card>
          <p className="text-sm text-muted-foreground">
            This class has no active invitation link right now. Refresh the page
            in a moment to check again.
          </p>
        </Card>
      )}

      <h2 className="mt-10 mb-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Lessons
      </h2>

      {sessions === null ? (
        <Alert>
          We couldn&apos;t load this class&apos;s lessons just now. Please
          refresh the page.
        </Alert>
      ) : sessions.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground">
            No lessons have been recorded yet.
          </p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {sessions.map((session, index) => (
            <li key={session.sessionId}>
              <Card>
                <Lesson
                  session={session}
                  classId={detail.classId}
                  timezone={detail.timezone}
                  ordinal={index + 1}
                />
              </Card>
            </li>
          ))}
        </ul>
      )}

      {/* Offered in all three states, including the failed one: whether the
          list could be read has no bearing on whether a lesson can be added. */}
      <div className="mt-4">
        <Button asChild variant="outline" size="sm">
          <Link href={`/teacher/${detail.classId}/sessions/new`}>
            Create lesson
          </Link>
        </Button>
      </div>

      <h2 className="mt-10 mb-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Students ({students.length})
      </h2>

      {/* One list for every card below. A datalist is a suggestion and not a
          constraint — both columns are free text, and a teacher typing "Task 2
          structure" is the case these fields exist for. */}
      <datalist id={SUGGESTION_LIST}>
        {TAG_SUGGESTIONS.map((suggestion) => (
          <option key={suggestion} value={suggestion} />
        ))}
      </datalist>

      {students.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground">
            Nobody has joined yet. Share the invitation link above.
          </p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {students.map((entry) => (
            // The anchor the overview links carry, so opening and closing a
            // panel returns the reader to the card they pressed rather than to
            // the top of a long roster.
            <li key={entry.membershipId} id={anchorFor(entry)}>
              <Card>
                <Person entry={entry} />
                {entry.joinedAt ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Joined {DATE.format(new Date(entry.joinedAt))}
                  </p>
                ) : null}

                {banded ? (
                  <TargetBand entry={entry} classId={detail.classId} />
                ) : null}

                <Standing entry={entry} classId={detail.classId} />

                <Overview
                  entry={entry}
                  classId={detail.classId}
                  banded={banded}
                  timezone={detail.timezone}
                  overview={
                    overview?.kind === "ok" &&
                    overview.overview.membershipId === entry.membershipId
                      ? overview.overview
                      : null
                  }
                />

                <Confirm
                  label="Remove student"
                  prompt={`${nameOf(entry)} will be taken off this class list. Their account and any other classes they are in are not affected.`}
                  confirmLabel="Remove student"
                  pendingLabel="Removing…"
                  action={removeStudent.bind(
                    null,
                    detail.classId,
                    entry.membershipId,
                  )}
                />
              </Card>
            </li>
          ))}
        </ul>
      )}

      {pending.length > 0 ? (
        <>
          <h2 className="mt-10 mb-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Pending invitations ({pending.length})
          </h2>

          <ul className="space-y-3">
            {pending.map((entry) => (
              <li key={entry.membershipId}>
                <Card>
                  <Person entry={entry} />
                  {/* `invite_email_sent_at` is stamped only after the SMTP
                      send resolves, so this never claims a delivery that did
                      not happen. */}
                  <p className="mt-2 text-xs text-muted-foreground">
                    {entry.inviteEmailSentAt
                      ? `Invitation sent ${DATE.format(new Date(entry.inviteEmailSentAt))}`
                      : "Added, but the invitation email has not gone out — share the link with them."}
                  </p>

                  {/* Only offered when there is something to send and somewhere
                      to send it: the message carries the invitation link, and a
                      row invited by link alone has no address on it. */}
                  {link && entry.email ? (
                    <form
                      action={resendInvitation.bind(
                        null,
                        detail.classId,
                        entry.membershipId,
                      )}
                      className="mt-3"
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
                      detail.classId,
                      entry.membershipId,
                    )}
                  />
                </Card>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Frame>
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
    <form
      action={setTargetBand.bind(null, classId, entry.membershipId)}
      className="mt-3 border-t border-border pt-3"
    >
      <label
        htmlFor={field}
        className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
      >
        Target band
      </label>

      <p className="mt-1 text-sm text-foreground">{saved ?? "Not set"}</p>

      {/* `flex-wrap` so the picker and the button stack rather than overflow
          once the card is 390px wide. */}
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

/** The id every tag input points at; the list itself is rendered once. */
const SUGGESTION_LIST = "tag-suggestions";

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
 * `\u0000` joins the key because it cannot occur in a tag; a comma could.
 */
function Standing({ entry, classId }: { entry: RosterEntry; classId: string }) {
  return (
    <form
      action={saveStandingNotes.bind(null, classId, entry.membershipId)}
      className="mt-3 min-w-0 border-t border-border pt-3"
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
 * One lesson: when it is, and what it is called.
 *
 * Date and time first, title after, because a lesson is identified by when it
 * happened — the title is the optional part, and most rows will not have one.
 *
 * Both are read on the class's own clock. `starts_at` is an instant, so
 * formatting it without naming a zone would show a Vietnamese evening class as
 * having met the previous afternoon on a server running in UTC.
 *
 * `ordinal` is the row's position in the chronological list, not a stored lesson
 * number — `class_sessions` has no such column, and the only order it defines is
 * `starts_at`. It is used solely to give an untitled lesson something to be
 * called, and it therefore renumbers if a lesson is later inserted between two
 * others, which is the honest behaviour for a derived position.
 */
function Lesson({
  session,
  classId,
  timezone,
  ordinal,
}: {
  session: ClassSession;
  classId: string;
  timezone: string;
  ordinal: number;
}) {
  return (
    <>
      <h3 className="font-semibold text-foreground">
        {formatZonedDate(timezone, session.startsAt)}
      </h3>

      <p className="mt-1 text-sm text-muted-foreground">
        {formatZonedTime(timezone, session.startsAt)} –{" "}
        {formatZonedTime(timezone, session.endsAt)}
      </p>

      <p className="mt-2 text-sm text-foreground">
        {session.title ?? `Lesson ${ordinal}`}
      </p>

      {/* Everything this page creates is `scheduled`, the column's default, so
          saying so on every row would be noise. The other two states can only
          arrive from elsewhere, and hiding them would misreport the class. */}
      {session.status === "scheduled" ? null : (
        <p className="mt-2 text-xs text-muted-foreground">
          {session.status === "cancelled" ? "Cancelled" : "Completed"}
        </p>
      )}

      {/* The same pairing the class list uses for "Open class": one card, one
          way in. The link carries both segments, and the page behind it proves
          both — the session id alone does not select the lesson. */}
      <Button asChild variant="outline" size="sm" className="mt-4">
        <Link href={`/teacher/${classId}/sessions/${session.sessionId}`}>
          Open lesson
        </Link>
      </Button>
    </>
  );
}

/** Where a card sits in the page, so a link can return to it. */
function anchorFor(entry: RosterEntry): string {
  return `student-${entry.membershipId}`;
}

/**
 * One student's existing facts, gathered — and the control that opens them.
 *
 * A view and only a view. There is no form here and no Server Action: every one
 * of these values already has a dedicated control elsewhere on this page or on
 * the lesson pages, and a second way to write them would be a second thing to
 * keep correct. Opening the panel is a `<Link>`, closing it is a `<Link>`, and
 * both work with JavaScript off.
 *
 * The panel is this card expanded rather than a page of its own. Everything it
 * needs — the teacher's identity, the class's ownership, the roster — has
 * already been established by the time the card renders, and a separate route
 * would have to establish all of it again.
 *
 * `banded` gates the two band sections for the same reason `TargetBand` is
 * gated: a class that scores on nothing has no bands to show, and the actions
 * that record them refuse the write for that class anyway.
 */
function Overview({
  entry,
  classId,
  banded,
  timezone,
  overview,
}: {
  entry: RosterEntry;
  classId: string;
  banded: boolean;
  timezone: string;
  overview: StudentOverview | null;
}) {
  const anchor = anchorFor(entry);

  if (!overview) {
    return (
      <div className="mt-3">
        <Button asChild variant="outline" size="sm">
          <Link
            href={`/teacher/${classId}?student=${entry.membershipId}#${anchor}`}
          >
            View overview
          </Link>
        </Button>
      </div>
    );
  }

  const { bands } = overview;

  // Nothing to say rather than three empty rows: a student nobody has assessed
  // has no starting band, no current band and no goal, and printing "Not set"
  // three times says less than one sentence does.
  const unassessed =
    bands.targetBand === null &&
    bands.startOverall === null &&
    bands.currentOverall === null;

  return (
    <div className="mt-3 min-w-0 border-t border-border pt-3">
      {/* Named again inside the panel: the card's heading is above it, but the
          overview is the thing being read and it should say whose it is. */}
      <h4 className="font-semibold break-words text-foreground">
        {overview.name ?? overview.email ?? "This student"}
      </h4>
      {overview.name && overview.email ? (
        <p className="mb-4 text-sm break-words text-muted-foreground">
          {overview.email}
        </p>
      ) : (
        <div className="mb-4" />
      )}

      <div className="space-y-5">
        {banded ? (
          <Section title="Progress">
            {unassessed ? (
              <Empty>No bands have been recorded yet.</Empty>
            ) : (
              <dl className="space-y-2">
                {/* Every value here is the database's own. `target_band`,
                    `start_overall` and `current_overall` come off
                    `v_member_current_band` and the status off
                    `v_member_performance_status`; nothing is compared or
                    averaged on this page. */}
                <Fact term="Target" value={formatBand(bands.targetBand) ?? "Not set"} />
                <Fact
                  term="Starting"
                  value={formatBand(bands.startOverall) ?? "Not recorded"}
                />
                <Fact
                  term="Current"
                  value={formatBand(bands.currentOverall) ?? "Not recorded"}
                />
                <Fact term="Status" value={MEMBER_STATUS_LABELS[bands.status]} />
              </dl>
            )}
          </Section>
        ) : null}

        <Section title="Strengths">
          <Tags tags={overview.strengths} empty="No strengths recorded yet." />
        </Section>

        <Section title="Focus areas">
          <Tags tags={overview.focusAreas} empty="No focus areas recorded yet." />
        </Section>

        <Section title="Attendance">
          {overview.attendance.length === 0 ? (
            <Empty>No attendance recorded yet.</Empty>
          ) : (
            <ul className="space-y-2.5">
              {overview.attendance.map((mark) => (
                <li key={mark.sessionId} className="min-w-0">
                  <p className="text-sm text-foreground">
                    {ATTENDANCE_LABELS[mark.status]}
                  </p>
                  {/* The class's own clock, through `lib/time.ts`, exactly as
                      the lesson list above reads the same two instants. */}
                  <p className="text-xs break-words text-muted-foreground">
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

      <div className="mt-5">
        <Button asChild variant="outline" size="sm">
          <Link href={`/teacher/${classId}#${anchor}`}>Close overview</Link>
        </Button>
      </div>
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

/** One term and its value, in the same shape as the class facts above. */
function Fact({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex gap-4 text-sm">
      <dt className="w-20 shrink-0 text-muted-foreground">{term}</dt>
      <dd className="break-words text-foreground">{value}</dd>
    </div>
  );
}

/**
 * A read-only list of tags, or the sentence that says there are none.
 *
 * The same chips `TagEditor` renders, without the remove control — the editor
 * three lines up this card is where these are changed, and offering a second
 * way to change them here would be two controls writing one column.
 */
function Tags({ tags, empty }: { tags: string[]; empty: string }) {
  if (tags.length === 0) return <Empty>{empty}</Empty>;

  return (
    <ul className="flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <li
          key={tag}
          className="min-w-0 rounded-full border border-input bg-background px-2.5 py-1 text-xs break-words text-foreground"
        >
          {tag}
        </li>
      ))}
    </ul>
  );
}

/** Whoever the card is about, however much of them the row knows. */
function nameOf(entry: RosterEntry): string {
  return entry.name ?? entry.email ?? "This student";
}

/**
 * A destructive action behind an explicit confirmation.
 *
 * `<details>` rather than a dialog or a `confirm()` call, because every other
 * form on this milestone posts without JavaScript and this one does too: the
 * disclosure is the browser’s own, the submit button only exists once it is
 * open, and the summary turns into the way back out. Nothing here is a client
 * component except the submit button, which is the same purely additive
 * pending state the invite form uses.
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
    <details className="group mt-3">
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
 * One person's name and address.
 *
 * A pending invitation usually has an address and no name, so the address is
 * promoted to the heading rather than leaving an empty line above it.
 */
function Person({ entry }: { entry: RosterEntry }) {
  if (entry.name) {
    return (
      <>
        <h3 className="mb-1 font-semibold break-words text-foreground">
          {entry.name}
        </h3>
        {entry.email ? (
          <p className="text-sm break-words text-muted-foreground">
            {entry.email}
          </p>
        ) : null}
      </>
    );
  }

  return (
    <h3 className="font-semibold break-words text-foreground">
      {entry.email ?? "Unnamed student"}
    </h3>
  );
}

/**
 * The shell every state shares — including the error state, which keeps the
 * back link so a failed load does not strand anyone on a page with no exit.
 */
function Frame({ children }: { children: ReactNode }) {
  return (
    <main className="flex flex-1 justify-center bg-background p-8">
      <div className="w-full max-w-lg">
        <Button asChild variant="ghost" size="inline" className="mb-6 text-sm">
          <Link href="/teacher">← Back to classes</Link>
        </Button>

        {children}
      </div>
    </main>
  );
}
