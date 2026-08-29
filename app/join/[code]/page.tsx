import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { SubmitButton } from "@/components/auth/submit-button";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LABELS, isOfferedCourseType } from "@/lib/course-type";
import { toInvitePreview } from "@/lib/invite-preview";
import { loadUserState } from "@/lib/onboarding";
import type { DynamicPageProps } from "@/lib/route-types";
import { createClient } from "@/lib/supabase/server";

import { dismissInvitation, joinClass, rememberAndAuthenticate } from "./actions";

export const metadata: Metadata = {
  title: "Join a class",
};

/**
 * The invitation landing page.
 *
 * Two cards, as the Figma draws them: what the invitation is, then what to do
 * about it. The second card is where this departs from the design, and
 * deliberately.
 *
 * The Figma puts a complete sign-up/log-in form inside this page, with a
 * "Create account & join class" button that does both at once. That cannot be
 * built against this database, and should not be built against this codebase:
 *
 *   - `join_class_with_code` refuses to act until `email_confirmed_at` is set,
 *     and confirmation is required by product decision. A new account therefore
 *     cannot join in the same submission — the person has to visit their inbox
 *     first. A button promising otherwise would be lying.
 *   - Reproducing the form would mean a second authentication implementation
 *     living beside the real one in `app/auth`, which is exactly what "do not
 *     redesign the existing authentication flow" rules out.
 *
 * So the card keeps its shape and its two labels and hands off to the existing
 * flow, parking the code in a cookie so the visitor is returned here afterwards.
 *
 * The Figma's closing line, "By joining, you agree to EduTrack's Terms of
 * Service", is dropped: there is no such document, and pointing at one that does
 * not exist is worse than saying nothing.
 */

const MONTH_YEAR = new Intl.DateTimeFormat("en-GB", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const MONTH = new Intl.DateTimeFormat("en-GB", {
  month: "short",
  timeZone: "UTC",
});

/** `YYYY-MM-DD` read as a calendar date, not a moment in the viewer's zone. */
function asDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function formatRange(start: string, end: string | null): string {
  const from = asDate(start);

  if (!end) return `From ${MONTH_YEAR.format(from)}`;

  const to = asDate(end);

  // "Aug–Dec 2026" rather than "Aug 2026–Dec 2026" when the year is shared.
  return from.getUTCFullYear() === to.getUTCFullYear()
    ? `${MONTH.format(from)}–${MONTH_YEAR.format(to)}`
    : `${MONTH_YEAR.format(from)}–${MONTH_YEAR.format(to)}`;
}

/** Monogram for the teacher avatar: first and last initial. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";

  const first = parts[0].charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : "";

  return (first + last).toUpperCase();
}

export default async function JoinPage({
  params,
  searchParams,
}: DynamicPageProps<{ code: string }>) {
  const { code } = await params;
  const query = await searchParams;

  const error = typeof query.error === "string" ? query.error : undefined;
  const joinedClassName =
    typeof query.joined === "string" ? query.joined : undefined;

  const supabase = await createClient();

  // Readable by `anon` as well as `authenticated`, and it returns nothing at all
  // for a code that is unknown, expired, revoked, exhausted or archived — the
  // five cases are indistinguishable on purpose, so probing learns nothing.
  const { data } = await supabase.rpc("get_class_invite_preview", {
    p_code: code,
  });
  const preview = toInvitePreview(data?.[0]);

  const state = await loadUserState();

  // Only ever shown to someone signed in: the success state is reached by
  // redirect from the join action, and `?joined=` on its own proves nothing.
  if (joinedClassName !== undefined && state.kind !== "anonymous") {
    return (
      <Frame>
        <div className="text-center">
          <div
            aria-hidden="true"
            className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-green-light text-3xl text-green"
          >
            ✓
          </div>

          <h1 className="mb-2 text-xl font-semibold text-foreground">
            You&apos;ve joined the class!
          </h1>

          <p className="mb-6 text-sm text-muted-foreground">
            You&apos;re now enrolled in{" "}
            <strong className="font-semibold text-foreground">
              {joinedClassName || "your class"}
            </strong>
            {preview ? ` with ${preview.teacher_name}` : null}.
          </p>

          <Button asChild>
            <Link href="/">Continue to EduTrack</Link>
          </Button>
        </div>
      </Frame>
    );
  }

  if (!preview) {
    return (
      <Frame>
        <Card className="text-center">
          <h1 className="mb-2 text-xl font-semibold text-foreground">
            This invitation link isn&apos;t valid
          </h1>
          <p className="mb-6 text-sm text-muted-foreground">
            It may have expired, been used up, or been withdrawn. Ask your
            teacher to send you a new link.
          </p>

          <Button asChild variant="outline">
            <Link href="/">Go to EduTrack</Link>
          </Button>
        </Card>
      </Frame>
    );
  }

  const courseLabel = isOfferedCourseType(preview.course_type)
    ? LABELS[preview.course_type]
    : null;

  const facts = [
    preview.target_band !== null
      ? `Target: IELTS ${preview.target_band.toFixed(1)}`
      : courseLabel,
    formatRange(preview.start_date, preview.end_date),
    preview.schedule_note,
  ].filter((fact): fact is string => Boolean(fact));

  return (
    <Frame>
      <Card className="mb-6 text-center">
        <p className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          You&apos;ve been invited to join
        </p>

        <h1 className="mb-1 text-xl font-semibold text-foreground">
          {preview.class_name}
        </h1>

        <div className="mb-4 flex items-center justify-center gap-2">
          <span
            aria-hidden="true"
            className="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
          >
            {initials(preview.teacher_name)}
          </span>
          <span className="text-sm text-muted-foreground">
            Teacher: {preview.teacher_name}
          </span>
        </div>

        <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {facts.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
      </Card>

      <Card>
        {error ? <Alert className="mb-5">{error}</Alert> : null}

        {state.kind === "anonymous" ? (
          <>
            <p className="mb-5 text-sm text-muted-foreground">
              Create an account or log in to join. We&apos;ll bring you straight
              back here.
            </p>

            <div className="space-y-3">
              <form action={rememberAndAuthenticate}>
                <input type="hidden" name="code" value={code} />
                <input type="hidden" name="destination" value="signup" />
                <SubmitButton pendingLabel="Opening…" className="w-full">
                  Create account
                </SubmitButton>
              </form>

              <form action={rememberAndAuthenticate}>
                <input type="hidden" name="code" value={code} />
                <input type="hidden" name="destination" value="login" />
                <Button type="submit" variant="outline" className="w-full">
                  Log in
                </Button>
              </form>
            </div>
          </>
        ) : state.kind === "teacher" ? (
          <>
            <p className="mb-5 text-sm text-muted-foreground">
              You&apos;re signed in as a teacher. Classes are joined by students,
              so this invitation is for a student account.
            </p>

            <Button asChild variant="outline" className="w-full">
              <Link href="/">Go to EduTrack</Link>
            </Button>
          </>
        ) : (
          <div className="space-y-3">
            <form action={joinClass}>
              <input type="hidden" name="code" value={code} />
              <SubmitButton pendingLabel="Joining…" className="w-full">
                Join class
              </SubmitButton>
            </form>

            <form action={dismissInvitation}>
              <Button type="submit" variant="outline" className="w-full">
                Not now
              </Button>
            </form>
          </div>
        )}
      </Card>
    </Frame>
  );
}

/** The Figma's join shell: one narrow centred column on cream. */
function Frame({ children }: { children: ReactNode }) {
  return (
    <main className="flex flex-1 items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
