import { redirect } from "next/navigation";

import { requireTeacher, resumeHref } from "@/lib/onboarding";

/**
 * `/onboarding` has no screen of its own — it is the entry point that works out
 * where the teacher left off and sends them there.
 *
 * Keeping the resume logic behind one URL means every link into onboarding, from
 * an email or from `/`, can point at the same place and still land correctly.
 */
export default async function OnboardingIndex() {
  const teacher = await requireTeacher();
  redirect(resumeHref(teacher));
}
