import { SubmitButton } from "@/components/auth/submit-button";
import { OnboardingShell } from "@/components/onboarding/onboarding-shell";
import { RadioCard } from "@/components/onboarding/radio-card";
import { Alert } from "@/components/ui/alert";
import { COURSE_TYPES, LABELS } from "@/lib/course-type";
import { requireTeacher } from "@/lib/onboarding";
import type { PageSearchParams } from "@/lib/route-types";

import { saveTeachingType } from "../actions";

/**
 * Step 2 — what the teacher primarily teaches.
 *
 * The answer lands in `profiles.teaching_type` and does two jobs: it is the only
 * durable marker that onboarding has begun, and it pre-selects the course type
 * on the next step.
 *
 * Three options, not four. The `course_type` enum also carries `other`, but the
 * Figma offers no field for the free-text description that
 * `classes_course_type_other_required` demands alongside it, so offering it here
 * would lead to a class that cannot be saved.
 */
export default async function TeachingTypePage({
  searchParams,
}: PageSearchParams) {
  const teacher = await requireTeacher();
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : undefined;

  return (
    <OnboardingShell
      step={1}
      title="What do you primarily teach?"
      description="This helps us tailor your experience."
    >
      {error ? <Alert className="mb-5">{error}</Alert> : null}

      <form action={saveTeachingType}>
        <fieldset>
          <legend className="sr-only">What do you primarily teach?</legend>

          <div className="mb-6 grid grid-cols-2 gap-3">
            {COURSE_TYPES.map((type) => (
              <RadioCard
                key={type}
                name="teaching_type"
                value={type}
                label={LABELS[type]}
                defaultChecked={teacher.teachingType === type}
              />
            ))}
          </div>
        </fieldset>

        <SubmitButton pendingLabel="Saving…" className="w-full">
          Continue
        </SubmitButton>
      </form>
    </OnboardingShell>
  );
}
