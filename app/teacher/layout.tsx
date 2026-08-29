import { AppShell } from "@/components/shell/app-shell";
import { isOnboardingComplete, loadUserState } from "@/lib/onboarding";
import type { LayoutChildren } from "@/lib/route-types";

/**
 * The teacher half of the application, framed.
 *
 * The shell is chrome and is treated as such: this decides what the page is
 * *wrapped in*, never whether the page may be seen. Each page under `/teacher`
 * still runs its own `loadUserState()`/`requireTeacher()` check and redirects
 * for itself, because a layout is reused across client-side transitions within
 * a segment and so cannot be relied on to run for every request. `loadUserState`
 * is memoised per request, so asking twice costs one round trip.
 *
 * Two callers get the bare page instead:
 *
 *   anyone who is not a teacher — anonymous, a student, an unreadable account.
 *     The page below has already decided to redirect them; wrapping a redirect
 *     in a sidebar would only render a teacher's navigation at someone who is
 *     about to be sent somewhere else.
 *
 *   a teacher who has not finished setting up. They belong in the wizard, and
 *     handing them the finished application would say that setup is over. The
 *     only page they can actually reach here is `/teacher` itself, which keeps
 *     its own heading for exactly that case.
 */
export default async function TeacherLayout({ children }: LayoutChildren) {
  const state = await loadUserState();

  if (state.kind !== "teacher" || !isOnboardingComplete(state.teacher)) {
    return <>{children}</>;
  }

  return (
    <AppShell
      role="teacher"
      fullName={state.teacher.fullName}
      email={state.teacher.email}
    >
      {children}
    </AppShell>
  );
}
