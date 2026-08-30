import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
  loadStudentLessons,
  type StudentBands,
  type StudentClassDetail,
  type StudentLesson,
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
  title: "Class",
};

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

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
  if (start) facts.push({ term: "Starting", value: start });

  const current = formatBand(bands.currentOverall);
  if (current) facts.push({ term: "Current", value: current });

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

  if (skills.length > 0) facts.push({ term: "Skills", value: skills.join(" · ") });

  const target = formatBand(bands.targetBand);
  if (target) facts.push({ term: "Target", value: target });

  facts.push({ term: "Progress", value: MEMBER_STATUS_LABELS[bands.status] });

  // A calendar date in the class's zone, read as one — the same `asDate` the
  // start and end dates above go through, and no browser-local conversion.
  if (bands.currentRecordedOn) {
    facts.push({
      term: "Updated",
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
        {/* Not a 404: the query failed, and telling someone their class is
            gone when the database merely stumbled is the same mistake
            `StudentContext.classes` uses `null` to avoid. */}
        <Alert>
          We couldn&apos;t load this class just now. Please refresh the page.
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

  const [lessons, bands] = await Promise.all([
    loadStudentLessons(supabase, detail.classId, detail.membershipId),
    banded
      ? loadStudentBands(supabase, detail.classId, detail.membershipId)
      : Promise.resolve(null),
  ]);

  return (
    <Frame>
      <div className="mb-8">
        <h1 className="mb-1 font-serif text-2xl leading-relaxed text-foreground">
          {detail.className}
        </h1>

        {detail.teacherName ? (
          <p className="text-sm text-muted-foreground">
            Teacher:{" "}
            <span className="font-medium text-foreground">
              {detail.teacherName}
            </span>
          </p>
        ) : null}
      </div>

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
        My strengths and focus
      </h2>

      <Card>
        <div className="space-y-4">
          <Tags
            label="Strengths"
            tags={detail.strengths}
            empty="No strengths recorded yet."
          />
          <Tags
            label="Focus areas"
            tags={detail.focusAreas}
            empty="No focus areas recorded yet."
          />
        </div>
      </Card>

      {banded ? (
        <>
          <h2 className="mt-10 mb-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            My progress
          </h2>

          {bands === null ? (
            // Not "no bands": the query failed, and the two must not look alike.
            <Alert>
              We couldn&apos;t load your progress just now. Please refresh the
              page.
            </Alert>
          ) : bands.currentOverall === null && bands.startOverall === null ? (
            <Card>
              <p className="text-sm text-muted-foreground">
                No bands have been recorded yet.
              </p>
            </Card>
          ) : (
            <Card>
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
          )}
        </>
      ) : null}

      <h2 className="mt-10 mb-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Lessons
      </h2>

      {lessons === null ? (
        // Not "no lessons": the query failed, and the two must not look alike.
        <Alert>
          We couldn&apos;t load your lessons just now. Please refresh the page.
        </Alert>
      ) : lessons.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground">
            No lessons have been recorded yet.
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
        <p className="mt-2 text-sm text-muted-foreground">Cancelled</p>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          Attendance:{" "}
          <span className="text-foreground">
            {/* Null is unmarked, which is a state of its own — never `absent`,
                and never a row invented to make the line read better. */}
            {lesson.attendance === null
              ? "Not recorded"
              : ATTENDANCE_LABELS[lesson.attendance]}
          </span>
        </p>
      )}

      {lesson.noteCount > 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">
          Lesson notes:{" "}
          <span className="text-foreground">
            {lesson.noteCount === 1 ? "1 note" : `${lesson.noteCount} notes`}
          </span>
        </p>
      ) : null}

      {/* A plain link, like the one on `/student` — the whole card being a
          target would swallow anything added to it later. */}
      <Button asChild variant="outline" size="sm" className="mt-4">
        <Link href={`/student/${classId}/sessions/${lesson.sessionId}`}>
          Open lesson
        </Link>
      </Button>
    </>
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
          <Link href="/student">← Back to classes</Link>
        </Button>

        {children}
      </div>
    </main>
  );
}
