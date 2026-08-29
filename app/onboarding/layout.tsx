import type { Metadata } from "next";

import type { LayoutChildren } from "@/lib/route-types";

export const metadata: Metadata = {
  title: "Set up EduTrack",
};

/**
 * The onboarding frame: one centred column on cream at every width.
 *
 * The access check is not here. A layout renders once per navigation *segment*
 * and Next.js may reuse it across client-side transitions, so a guard placed in
 * it would not run for every request the way it must. Each step calls
 * `requireTeacher()` itself, and so does every Server Action.
 */
export default function OnboardingLayout({ children }: LayoutChildren) {
  return (
    <main className="flex flex-1 items-center justify-center bg-background p-6">
      <div className="w-full max-w-lg">{children}</div>
    </main>
  );
}
