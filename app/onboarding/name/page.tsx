import { SubmitButton } from "@/components/auth/submit-button";
import { OnboardingShell } from "@/components/onboarding/onboarding-shell";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireTeacher } from "@/lib/onboarding";
import type { PageSearchParams } from "@/lib/route-types";

import { saveName } from "../actions";

/**
 * Step 1 — the name students and parents will see.
 *
 * Pre-filled with whatever `profiles.full_name` holds. For a brand-new account
 * that is the email local-part, put there by `app.handle_new_user`, so the field
 * is rarely blank and this step is usually a confirmation rather than an entry.
 * That is also why it cannot be skipped on a return visit: "has a name" was true
 * before onboarding began, so it carries no information about whether the
 * question was answered.
 *
 * The Figma's description reads "reports and student dashboards". There is no
 * dashboard in the product yet, so the promise is restated to what the name
 * actually does today.
 */
export default async function NamePage({ searchParams }: PageSearchParams) {
  const teacher = await requireTeacher();
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : undefined;

  return (
    <OnboardingShell
      step={0}
      title="What should we call you?"
      description="Your name will appear on reports and to your students."
    >
      {error ? <Alert className="mb-5">{error}</Alert> : null}

      <form action={saveName} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="full_name">Full name</Label>
          <Input
            id="full_name"
            name="full_name"
            type="text"
            autoComplete="name"
            placeholder="Nguyễn Thị Linh"
            defaultValue={teacher.fullName}
            maxLength={120}
            required
            autoFocus
          />
        </div>

        <SubmitButton pendingLabel="Saving…" className="w-full">
          Continue
        </SubmitButton>
      </form>
    </OnboardingShell>
  );
}
