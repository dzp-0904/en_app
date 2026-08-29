import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireTeacher } from "@/lib/onboarding";
import type { DynamicPageProps } from "@/lib/route-types";
import { createClient } from "@/lib/supabase/server";
import {
  ATTENDANCE_LABELS,
  ATTENDANCE_STATUSES,
  loadClassSession,
  loadEditableClass,
  loadSessionAttendance,
  type SessionAttendee,
} from "@/lib/teacher";
import { formatZonedDate, formatZonedTime } from "@/lib/time";

import { recordAttendance } from "../../actions";

export const metadata: Metadata = {
  title: "Lesson",
};

/**
 * One lesson, and who was there.
 *
 * The page authorises in two steps, and both are queries rather than
 * comparisons. `loadEditableClass` filters `classes` by the authenticated
 * teacher's id, and `loadClassSession` filters `class_sessions` by *both*
 * `id = sessionId` and `class_id = classId`. A session id from another class —
 * another teacher's, or one of this teacher's own — therefore matches no row and
 * is reported as a lesson that does not exist. Nothing about it leaks, because
 * nothing about it was read.
 *
 * `sessions` is a static segment, so `[sessionId]` can never swallow it, and
 * both loaders refuse anything that is not a uuid before making a round trip.
 *
 * Four reads: the class, the session, the active members, the marks for this
 * session. None of them is per student.
 */
export default async function SessionPage({
  params,
  searchParams,
}: DynamicPageProps<{ classId: string; sessionId: string }>) {
  const { classId, sessionId } = await params;

  // Anonymous goes to the login page, a student and an unplaceable account go
  // to `/` — the same guard every other teacher page uses, and the same one
  // `recordAttendance` repeats for itself.
  const teacher = await requireTeacher();

  const supabase = await createClient();
  const owned = await loadEditableClass(supabase, teacher.userId, classId);

  // Another teacher's class is reported exactly as one that does not exist.
  if (owned.kind === "not-found") {
    notFound();
  }

  if (owned.kind === "error") {
    return (
      <Frame classId={classId}>
        {/* Not a 404: the query failed. See the class page. */}
        <Alert>
          We couldn&apos;t load this lesson just now. Please refresh the page.
        </Alert>
      </Frame>
    );
  }

  const found = await loadClassSession(supabase, classId, sessionId);

  if (found.kind === "not-found") {
    notFound();
  }

  if (found.kind === "error") {
    return (
      <Frame classId={classId}>
        <Alert>
          We couldn&apos;t load this lesson just now. Please refresh the page.
        </Alert>
      </Frame>
    );
  }

  const { fields } = owned;
  const { session } = found;

  // Separately from the lesson itself, so that a failure here costs the
  // attendance list and nothing else — the lesson's own facts still render.
  // `null` is that failure and is deliberately not `[]`: "no students are
  // enrolled" is a claim this page may only make on an answer it actually got.
  const attendees = await loadSessionAttendance(supabase, classId, sessionId);

  const query = await searchParams;
  const error = typeof query.error === "string" ? query.error : undefined;

  return (
    <Frame classId={classId}>
      <h1 className="font-serif text-2xl leading-relaxed text-foreground">
        {fields.className}
      </h1>

      {/* Read on the class's own clock, by the same two functions the lesson
          list uses. See `lib/time.ts`. */}
      <p className="mt-1 text-sm text-muted-foreground">
        {formatZonedDate(fields.timezone, session.startsAt)} ·{" "}
        {formatZonedTime(fields.timezone, session.startsAt)} –{" "}
        {formatZonedTime(fields.timezone, session.endsAt)}
      </p>

      {session.title ? (
        <p className="mt-3 text-foreground">{session.title}</p>
      ) : null}

      {/* Only when it is not the default this application creates. Nothing here
          can change it; showing it stops the page misreporting the lesson. */}
      {session.status === "scheduled" ? null : (
        <p className="mt-3 text-sm text-muted-foreground">
          {session.status === "cancelled"
            ? "This lesson was cancelled."
            : "This lesson is marked completed."}
        </p>
      )}

      {error ? <Alert className="mt-6">{error}</Alert> : null}

      <h2 className="mt-10 mb-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Attendance
      </h2>

      {attendees === null ? (
        <Alert>
          We couldn&apos;t load this class&apos;s students just now. Please
          refresh the page.
        </Alert>
      ) : attendees.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground">
            No students are currently enrolled in this class.
          </p>
        </Card>
      ) : (
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
      )}
    </Frame>
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
          {attendee.email ?? "Unnamed student"}
        </h3>
      )}

      {attendee.attendance === null ? (
        <p className="mt-2 text-xs text-muted-foreground">Not recorded</p>
      ) : null}

      <form
        action={recordAttendance.bind(
          null,
          classId,
          sessionId,
          attendee.membershipId,
        )}
        className="mt-3 flex flex-wrap gap-2"
      >
        {ATTENDANCE_STATUSES.map((status) => (
          <Button
            key={status}
            type="submit"
            name="status"
            value={status}
            size="sm"
            variant={attendee.attendance === status ? "default" : "outline"}
          >
            {ATTENDANCE_LABELS[status]}
          </Button>
        ))}
      </form>
    </>
  );
}

/**
 * The shell every state shares — including the error states, which keep the
 * back link so a failed load does not strand anyone on a page with no exit.
 */
function Frame({
  classId,
  children,
}: {
  classId: string;
  children: ReactNode;
}) {
  return (
    <main className="flex flex-1 justify-center bg-background p-8">
      <div className="w-full max-w-lg">
        <Button asChild variant="ghost" size="inline" className="mb-6 text-sm">
          <Link href={`/teacher/${classId}`}>← Back to class</Link>
        </Button>

        {children}
      </div>
    </main>
  );
}
