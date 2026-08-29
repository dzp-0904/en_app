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
import { loadTeacherClass, type RosterEntry, type TeacherClassDetail } from "@/lib/teacher";

import { cancelInvitation, removeStudent, resendInvitation } from "./actions";

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

  // Every action on this page — inviting, removing, cancelling, resending —
  // reports failure the same way: by redirecting back with the message
  // attached, so the page stays a Server Component and each form works without
  // JavaScript. One banner serves all of them, at the top, because that is
  // where the reader arrives after the redirect.
  const query = await searchParams;
  const error = typeof query.error === "string" ? query.error : undefined;

  const students = detail.roster.filter((entry) => entry.status === "joined");
  const pending = detail.roster.filter((entry) => entry.status === "invited");

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

      {error ? <Alert className="mb-5">{error}</Alert> : null}

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
        Students ({students.length})
      </h2>

      {students.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground">
            Nobody has joined yet. Share the invitation link above.
          </p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {students.map((entry) => (
            <li key={entry.membershipId}>
              <Card>
                <Person entry={entry} />
                {entry.joinedAt ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Joined {DATE.format(new Date(entry.joinedAt))}
                  </p>
                ) : null}

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
        <p className="mb-3 text-sm text-destructive">{prompt}</p>

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
        <h3 className="mb-1 font-semibold text-foreground">{entry.name}</h3>
        {entry.email ? (
          <p className="text-sm text-muted-foreground">{entry.email}</p>
        ) : null}
      </>
    );
  }

  return (
    <h3 className="font-semibold text-foreground">
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
