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
import { requireTeacher } from "@/lib/onboarding";
import type { DynamicPageProps } from "@/lib/route-types";
import { createClient } from "@/lib/supabase/server";
import { loadEditableClass } from "@/lib/teacher";

import { createSession } from "../../actions";

export const metadata: Metadata = {
  title: "Create lesson",
};

/**
 * Recording one lesson of a class.
 *
 * Framed exactly like `/teacher/[classId]/edit` — same loader, same three arms,
 * same way back — because it is the same shape of thing: a small form about one
 * class the teacher owns.
 *
 * The form asks for the four values `class_sessions` actually needs and no
 * others. `starts_at` and `ends_at` are both NOT NULL with
 * `ends_at > starts_at`, so an end time is a requirement of the table rather
 * than a nicety; `title` is nullable and therefore optional; `status` has a
 * default of `'scheduled'`, which is what a lesson being created is; and
 * `location` is left out because nothing in this milestone reads it back.
 *
 * The class's schedule is not repeated here. `classes.schedule_note` is
 * display-only by the migration's own comment — "class_sessions is
 * authoritative" — so a lesson states its own date and time, and does not
 * inherit one that could later disagree.
 *
 * `sessions` and `new` are static segments under `[classId]`, so neither can be
 * mistaken for a class id, and `loadEditableClass` would refuse them anyway.
 */
export default async function NewSessionPage({
  params,
  searchParams,
}: DynamicPageProps<{ classId: string }>) {
  const { classId } = await params;

  // The same guard the class page and the edit page use, and the same one
  // `createSession` repeats for itself: a page is not what protects a POST.
  const teacher = await requireTeacher();

  const supabase = await createClient();
  const result = await loadEditableClass(supabase, teacher.userId, classId);

  // Another teacher's class is reported exactly as one that does not exist.
  if (result.kind === "not-found") {
    notFound();
  }

  if (result.kind === "error") {
    return (
      <Frame classId={classId}>
        {/* Not a 404: the query failed. See the class page. */}
        <Alert>
          We couldn&apos;t load this class just now. Please refresh the page.
        </Alert>
      </Frame>
    );
  }

  const { fields } = result;

  const query = await searchParams;
  const error = typeof query.error === "string" ? query.error : undefined;

  return (
    <Frame classId={classId}>
      <h1 className="mb-2 font-serif text-2xl leading-relaxed text-foreground">
        Create lesson
      </h1>
      <p className="mb-8 text-sm text-muted-foreground">{fields.className}</p>

      {error ? <Alert className="mb-5">{error}</Alert> : null}

      <Card>
        {/* Bound on the server from the segment this page was rendered at, so
            the class is not a field the browser gets to fill in. It is still
            not the authorisation: `createSession` re-establishes the teacher
            and re-reads the class filtered by their id regardless. */}
        <form action={createSession.bind(null, fields.classId)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="date">Date</Label>
            <Input id="date" name="date" type="date" required autoFocus />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="start_time">Starts</Label>
              <Input id="start_time" name="start_time" type="time" required />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="end_time">Ends</Label>
              <Input id="end_time" name="end_time" type="time" required />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="title">Lesson title</Label>
            <Input
              id="title"
              name="title"
              type="text"
              placeholder="Optional"
              maxLength={200}
            />
          </div>

          {/* Said once, plainly, rather than repeated under both time fields:
              the two clocks are the class's own, not the reader's. */}
          <p className="text-xs text-muted-foreground">
            Times are in this class&apos;s timezone ({fields.timezone}).
          </p>

          <SubmitButton pendingLabel="Creating lesson…" className="mt-6 w-full">
            Create lesson
          </SubmitButton>
        </form>
      </Card>
    </Frame>
  );
}

/**
 * The shell every state shares — including the error state, which keeps the
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
