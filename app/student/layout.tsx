import { AppShell } from "@/components/shell/app-shell";
import { loadUserState } from "@/lib/onboarding";
import type { LayoutChildren } from "@/lib/route-types";

/**
 * The student half of the application, framed.
 *
 * The same arrangement as `app/teacher/layout.tsx`, and the same division of
 * labour: this chooses the frame, the page inside it decides who may see it.
 * There is no onboarding condition here because students have no onboarding —
 * they arrive through an invitation link, and `/student` is theirs from the
 * first visit whether they have joined a class yet or not.
 *
 * Anyone who is not a student gets the bare page, which is already redirecting
 * them. That is also what keeps the teacher's navigation off a student's screen
 * and the student's off a teacher's: the role comes from the profile row that
 * `loadUserState` read, and each layout only ever names its own.
 */
export default async function StudentLayout({ children }: LayoutChildren) {
  const state = await loadUserState();

  if (state.kind !== "student") {
    return <>{children}</>;
  }

  return (
    <AppShell
      role="student"
      fullName={state.student.fullName}
      email={state.student.email}
    >
      {children}
    </AppShell>
  );
}
