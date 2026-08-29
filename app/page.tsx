import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { LogoMark } from "@/components/brand/logo-mark";
import { Button } from "@/components/ui/button";
import { isOnboardingComplete, loadUserState } from "@/lib/onboarding";
import { readPendingJoin } from "@/lib/pending-join";

import { signOut } from "./auth/actions";

/**
 * The Figma has no landing screen, so this is deliberately the smallest page
 * that can exist: it says what EduTrack is and offers the two doors into it.
 *
 * Its composition is the brand panel's, moved onto cream — logo, one Lora line,
 * a sentence, then the capability list — so that arriving at `/auth/login` feels
 * like the same product rather than a different one. Every string here already
 * appears in the Figma.
 *
 * It is also the flow's junction. Both the auth actions and `/auth/callback`
 * finish here, so this is where two interrupted journeys get picked back up: an
 * invitation that was waiting on a sign-in, and a teacher who has not finished
 * setting up. Neither is a dashboard — nothing here reports on anything.
 *
 * Which makes the signed-in branch load-bearing rather than cosmetic. `/` is the
 * first thing a user sees after confirming their email address, and the two
 * doors below are the only evidence they have about whether it worked. When this
 * page rendered them unconditionally it told every freshly-confirmed account
 * that it was signed out, which is both false and the exact opposite of what the
 * flow just achieved. Anyone signed in must be named back to themselves here.
 */
const POINTS = [
  "Track every student's IELTS progress",
  "Log a full lesson in under a minute",
  "Send parents a monthly report automatically",
];

export default async function Home() {
  const state = await loadUserState();

  if (state.kind === "anonymous") {
    return (
      <Shell>
        <h1 className="mb-4 font-serif text-2xl leading-relaxed text-foreground">
          Teachers who track progress clearly teach more effectively.
        </h1>

        <p className="text-sm text-muted-foreground">
          Designed for freelance English and IELTS teachers who care deeply about
          student outcomes.
        </p>

        <ul className="mt-8 space-y-3">
          {POINTS.map((point) => (
            <li
              key={point}
              className="flex items-center gap-3 text-sm text-muted-foreground"
            >
              <span
                aria-hidden="true"
                className="size-1.5 shrink-0 rounded-full bg-primary"
              />
              {point}
            </li>
          ))}
        </ul>

        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <Button asChild className="sm:flex-1">
            <Link href="/auth/signup">Create account</Link>
          </Button>
          <Button asChild variant="outline" className="sm:flex-1">
            <Link href="/auth/login">Sign in</Link>
          </Button>
        </div>
      </Shell>
    );
  }

  // Everything below is a signed-in user being sorted. The three redirects are
  // flat rather than nested so each one narrows `state` for the next — and so
  // that only the two arms with nowhere else to go reach the render.

  // Someone followed an invitation, signed in, and landed back here. Take them
  // to the class they were actually trying to reach. The cookie is cleared by
  // the join page, on success or on "Not now", so this cannot trap them.
  const pendingCode = await readPendingJoin();

  if (pendingCode) {
    redirect(`/join/${encodeURIComponent(pendingCode)}`);
  }

  // Students get their own page whether or not they are in a class yet:
  // `/student` shows the roll or the waiting state, and either way it is a
  // student's answer rather than a teacher's page with the words changed.
  // Never `/onboarding` — that wizard creates classes, which students do not do
  // and which RLS would refuse them anyway.
  if (state.kind === "student") {
    redirect("/student");
  }

  // A teacher with no class yet has not finished onboarding. `/onboarding`
  // works out which step that is.
  if (state.kind === "teacher" && !isOnboardingComplete(state.teacher)) {
    redirect("/onboarding");
  }

  const email = state.kind === "teacher" ? state.teacher.email : state.email;

  return (
    <Shell>
      <h1 className="mb-4 font-serif text-2xl leading-relaxed text-foreground">
        {state.kind === "teacher"
          ? `Welcome back, ${state.teacher.fullName}.`
          : "You're signed in."}
      </h1>

      {/* Named rather than merely acknowledged: this is the page that has to
          answer "did the confirmation link work, and as whom?". */}
      {email ? (
        <p className="text-sm text-muted-foreground">
          Signed in as{" "}
          <span className="font-medium text-foreground">{email}</span>.
        </p>
      ) : null}

      <p className="mt-6 text-sm text-muted-foreground">
        {state.kind === "teacher"
          ? "Your class is ready. Invite students to it whenever you like."
          : // Only unplaceable accounts reach this line now — a deactivated
            // profile, or one that could not be read. Students are redirected
            // to `/student` above, so this deliberately no longer says "your
            // teacher will send you an invitation link": that was written for
            // an arm that held students, and it told anyone who had already
            // joined a class to go and join one.
            "This account doesn't have access to EduTrack right now. If you were invited to a class, open the invitation link your teacher sent you."}
      </p>

      <div className="mt-10 flex flex-col gap-3 sm:flex-row">
        {state.kind === "teacher" ? (
          <Button asChild className="sm:flex-1">
            <Link href="/onboarding/invite">Invite students</Link>
          </Button>
        ) : null}

        <form action={signOut} className="sm:flex-1">
          <Button type="submit" variant="outline" className="w-full">
            Sign out
          </Button>
        </form>
      </div>
    </Shell>
  );
}

/** The cream panel both states share, so they cannot drift apart. */
function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="flex flex-1 items-center justify-center bg-background p-8">
      <div className="w-full max-w-md">
        <LogoMark className="mb-16" />
        {children}
      </div>
    </main>
  );
}
