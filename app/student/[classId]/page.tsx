import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LABELS, isOfferedCourseType } from "@/lib/course-type";
import { loadUserState } from "@/lib/onboarding";
import type { DynamicPageProps } from "@/lib/route-types";
import { loadStudentClass, type StudentClassDetail } from "@/lib/student";
import { createClient } from "@/lib/supabase/server";

/**
 * One of the student's classes.
 *
 * The foundation only: who teaches it, what it is, when it runs. Lessons,
 * homework and progress are not read here because nothing reads them yet, and
 * the placeholder at the bottom says so rather than showing an empty chart that
 * implies data exists.
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
function asDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
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
        Coursework
      </h2>

      <Card>
        <p className="text-sm text-muted-foreground">
          Your lessons, homework and progress will appear here once your teacher
          starts recording them.
        </p>
      </Card>
    </Frame>
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
