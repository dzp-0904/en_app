import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { SubmitButton } from "@/components/auth/submit-button";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ATTENDANCE_LABELS, ATTENDANCE_STATUSES } from "@/lib/attendance";
import {
  NOTE_MAX_LENGTH,
  PERFORMANCE_LABELS,
  PERFORMANCE_LEVELS,
  SKILL_LABELS,
  SKILLS,
  TOPIC_MAX_LENGTH,
} from "@/lib/lesson-log";
import { requireTeacher } from "@/lib/onboarding";
import type { DynamicPageProps } from "@/lib/route-types";
import { createClient } from "@/lib/supabase/server";
import {
  loadClassSession,
  loadEditableClass,
  loadSessionAttendance,
  loadSessionLessonNotes,
  type LessonNote,
  type SessionAttendee,
} from "@/lib/teacher";
import { formatZonedDate, formatZonedTime } from "@/lib/time";

import { createLessonLog, recordAttendance } from "../../actions";

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
 * Five reads: the class, the session, the active members, the marks for this
 * session, and this session's lesson notes. None of them is per student, and
 * the last two are one statement each however many rows they return.
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
  // The notes answer to nothing the roster says, so the two go out together
  // rather than one waiting on the other.
  const [attendees, notes] = await Promise.all([
    loadSessionAttendance(supabase, classId, sessionId),
    loadSessionLessonNotes(supabase, classId, sessionId),
  ]);

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

      <h2 className="mt-10 mb-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Lesson notes
      </h2>

      {notes === null ? (
        <Alert>
          We couldn&apos;t load this lesson&apos;s notes just now. Please refresh
          the page.
        </Alert>
      ) : notes.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground">
            No notes have been added yet.
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
          has one. The attendance block above has already said why. */}
      {attendees && attendees.length > 0 ? (
        <Card className="mt-3">
          <NoteForm
            attendees={attendees}
            classId={classId}
            sessionId={sessionId}
          />
        </Card>
      ) : null}
    </Frame>
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
        {note.studentName ?? "Unnamed student"} · {SKILL_LABELS[note.skill]} ·{" "}
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
        <Label htmlFor="class_member_id">Student</Label>
        <Select
          id="class_member_id"
          name="class_member_id"
          defaultValue=""
          required
        >
          <option value="" disabled>
            Choose a student
          </option>
          {attendees.map((attendee) => (
            <option key={attendee.membershipId} value={attendee.membershipId}>
              {attendee.name ?? attendee.email ?? "Unnamed student"}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="topic">Topic</Label>
        <Input
          id="topic"
          name="topic"
          type="text"
          maxLength={TOPIC_MAX_LENGTH}
          placeholder="What this lesson covered"
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="skill">Skill</Label>
          <Select id="skill" name="skill" defaultValue="general" required>
            {SKILLS.map((skill) => (
              <option key={skill} value={skill}>
                {SKILL_LABELS[skill]}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="performance">Performance</Label>
          <Select id="performance" name="performance" defaultValue="" required>
            <option value="" disabled>
              Choose
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
        <Label htmlFor="note">Lesson notes</Label>
        <Textarea
          id="note"
          name="note"
          rows={4}
          maxLength={NOTE_MAX_LENGTH}
          placeholder="How the lesson went for this student"
          required
        />
      </div>

      <SubmitButton pendingLabel="Adding note…" className="mt-6 w-full">
        Add note
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
