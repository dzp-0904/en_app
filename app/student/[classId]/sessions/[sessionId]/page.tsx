import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ATTENDANCE_LABELS } from "@/lib/attendance";
import { PERFORMANCE_LABELS, SKILL_LABELS } from "@/lib/lesson-log";
import { loadUserState } from "@/lib/onboarding";
import type { DynamicPageProps } from "@/lib/route-types";
import {
  loadStudentClass,
  loadStudentLesson,
  loadStudentSessionNotes,
  type StudentNote,
} from "@/lib/student";
import { createClient } from "@/lib/supabase/server";
import { formatZonedDate, formatZonedTime } from "@/lib/time";

export const metadata: Metadata = {
  title: "Lesson",
};

/**
 * One lesson, as the student sees it: when it was, whether they were marked
 * there, and what their teacher wrote about them.
 *
 * The mirror of `/teacher/[classId]/sessions/[sessionId]`, and deliberately not
 * a copy of it. There is no attendance control, no roster, no other student's
 * name, no note-writing form and no Server Action anywhere in this route — a
 * student's copy of all of this is a report, not a form.
 *
 * ## Authorization
 *
 * Three steps, each of them a query rather than a comparison:
 *
 *   1. `loadUserState` says who is calling. Anonymous goes to the login page and
 *      a teacher goes to `/`, exactly as on `/student` and `/student/[classId]`.
 *   2. `loadStudentClass` filters `class_members` by `getUser()`'s id, this
 *      `classId`, `join_status = 'joined'` and `removed_at is null`. A class the
 *      caller is not actively in matches no row, so `classId` from the URL
 *      selects a class — it never authorises one. The `membershipId` used below
 *      comes out of *that* query and never off the URL.
 *   3. `loadStudentLesson` filters `class_sessions` by `id = sessionId` AND
 *      `class_id = classId` together. A session id from another class — a
 *      classmate's other class, a stranger's, or one of this student's own other
 *      classes — matches nothing and is answered as a lesson that does not
 *      exist. Nothing about it is read, so nothing about it leaks.
 *
 * Underneath all three, RLS says the same thing again and would say it even if
 * this file were wrong: `class_members_student_select` is pinned to
 * `auth.uid()`, `class_sessions_student_select` to `app.my_student_class_ids()`,
 * and both `session_attendance_student_select` and `lesson_logs_student_select`
 * to `app.my_member_ids()`. A classmate's mark or note is not filtered out of
 * these results; it never arrives in the process.
 *
 * `sessions` is a static segment, so `[sessionId]` cannot swallow it, and both
 * loaders refuse a non-uuid before making a round trip.
 *
 * Four reads: the membership, the lesson, this student's mark, this student's
 * notes. None of them is per note.
 */
export default async function StudentLessonPage({
  params,
}: DynamicPageProps<{ classId: string; sessionId: string }>) {
  const { classId, sessionId } = await params;

  const state = await loadUserState();

  if (state.kind === "anonymous") {
    redirect("/auth/login");
  }

  // Teachers and unplaceable accounts are `/`'s problem, as everywhere else in
  // this half of the application.
  if (state.kind !== "student") {
    redirect("/");
  }

  const supabase = await createClient();
  const membership = await loadStudentClass(
    supabase,
    state.student.userId,
    classId,
  );

  // A class this student is not in is reported exactly as one that does not
  // exist, so the 404 says nothing about who else is enrolled.
  if (membership.kind === "not-found") {
    notFound();
  }

  if (membership.kind === "error") {
    return (
      <Frame classId={classId}>
        {/* Not a 404: the query failed. Telling someone their lesson is gone
            when the database merely stumbled is the mistake this whole module
            uses a three-arm result to avoid. */}
        <Alert>
          We couldn&apos;t load this lesson just now. Please refresh the page.
        </Alert>
      </Frame>
    );
  }

  const { detail } = membership;

  const found = await loadStudentLesson(
    supabase,
    detail.classId,
    sessionId,
    detail.membershipId,
  );

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

  const { lesson } = found;

  // Separately from the lesson itself, so a failure here costs the notes and
  // nothing else — the lesson's own facts still render. `null` is that failure
  // and is deliberately not `[]`: "your teacher wrote nothing" is a claim this
  // page may only make on an answer it actually got.
  const notes = await loadStudentSessionNotes(
    supabase,
    detail.classId,
    sessionId,
    detail.membershipId,
  );

  return (
    <Frame classId={classId}>
      <h1 className="font-serif text-2xl leading-relaxed text-foreground">
        {detail.className}
      </h1>

      {/* Read on the class's own clock, by the same two functions the lesson
          list and the teacher's page use. See `lib/time.ts`. */}
      <p className="mt-1 text-sm text-muted-foreground">
        {formatZonedDate(detail.timezone, lesson.startsAt)} ·{" "}
        {formatZonedTime(detail.timezone, lesson.startsAt)} –{" "}
        {formatZonedTime(detail.timezone, lesson.endsAt)}
      </p>

      {lesson.title ? (
        <p className="mt-3 text-foreground">{lesson.title}</p>
      ) : null}

      {lesson.status === "cancelled" ? (
        <p className="mt-3 text-sm text-muted-foreground">
          This lesson was cancelled.
        </p>
      ) : null}

      <h2 className="mt-10 mb-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        My attendance
      </h2>

      <Card>
        {/* A cancelled lesson carries no attendance line for the reason the
            class list gives: attendance at a lesson that did not happen is not
            a fact about the student, and `v_member_session_attendance` excludes
            cancelled sessions from the attendance rule entirely. */}
        {lesson.status === "cancelled" ? (
          <p className="text-sm text-muted-foreground">
            This lesson was cancelled.
          </p>
        ) : lesson.attendance === null ? (
          // Never `absent`, and never a row invented to make the line read
          // better: no mark is a state of its own.
          <p className="text-sm text-muted-foreground">
            Attendance not recorded.
          </p>
        ) : (
          <p className="font-medium text-foreground">
            {ATTENDANCE_LABELS[lesson.attendance]}
          </p>
        )}
      </Card>

      <h2 className="mt-10 mb-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        My lesson notes
      </h2>

      {notes === null ? (
        <Alert>
          We couldn&apos;t load your lesson notes just now. Please refresh the
          page.
        </Alert>
      ) : notes.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground">No lesson notes yet.</p>
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
    </Frame>
  );
}

/**
 * One note, laid out as the teacher's own page lays it out — topic first, then
 * the two enum-shaped facts, then the note itself — minus the student's name,
 * which on this page is always the reader's.
 *
 * No date: `lesson_date` is the lesson's, it is identical on every note here,
 * and it is already in the header. `break-words` because both the topic and the
 * note are free text, and `whitespace-pre-line` keeps the teacher's paragraph
 * breaks. React escapes the text, so nothing typed into the field can become
 * markup.
 */
function Note({ note }: { note: StudentNote }) {
  return (
    <>
      <h3 className="font-semibold break-words text-foreground">
        {note.topic}
      </h3>

      <p className="mt-1 text-sm text-muted-foreground">
        {SKILL_LABELS[note.skill]} · {PERFORMANCE_LABELS[note.performance]}
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
          <Link href={`/student/${classId}`}>← Back to class</Link>
        </Button>

        {children}
      </div>
    </main>
  );
}
