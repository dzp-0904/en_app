import { SubmitButton } from "@/components/auth/submit-button";
import { OnboardingShell } from "@/components/onboarding/onboarding-shell";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { COURSE_TYPES, LABELS, TARGET_BANDS } from "@/lib/course-type";
import { requireTeacher, requireTeachingType } from "@/lib/onboarding";
import type { PageSearchParams } from "@/lib/route-types";

import { createFirstClass } from "../actions";

/**
 * Step 3 — the first class.
 *
 * The target band field only applies to IELTS. `scoring_model = 'none'` forbids a
 * band outright (`classes_no_target_band_when_unscored`), so the field is hidden
 * for the other course types using `:has()` on the live `<select>` value — which
 * keeps the whole form working without JavaScript.
 *
 * CSS is presentation, not enforcement. In a browser without `:has()` the field
 * stays visible and can be filled in, so `targetBandFor()` on the server drops
 * the value for any non-IELTS class regardless of what was submitted. The two
 * layers agree; only one of them is trusted.
 */
export default async function ClassPage({ searchParams }: PageSearchParams) {
  const teacher = await requireTeacher();
  const teachingType = requireTeachingType(teacher);

  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : undefined;

  return (
    <OnboardingShell
      step={2}
      title="Create your first class"
      description="You can always edit this later or add more classes."
    >
      {error ? <Alert className="mb-5">{error}</Alert> : null}

      <form action={createFirstClass} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="name">Class name</Label>
          <Input
            id="name"
            name="name"
            type="text"
            placeholder="IELTS Evening Group"
            maxLength={200}
            required
            autoFocus
          />
        </div>

        <div className="group grid grid-cols-2 gap-3">
          <div className="hidden space-y-1.5 group-has-[option[value=ielts]:checked]:block">
            <Label htmlFor="target_band">Target band</Label>
            <Select id="target_band" name="target_band" defaultValue="">
              <option value="">Not set</option>
              {TARGET_BANDS.map((band) => (
                <option key={band} value={band}>
                  {band}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="course_type">Course type</Label>
            <Select
              id="course_type"
              name="course_type"
              defaultValue={teachingType}
              required
            >
              {COURSE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {LABELS[type]}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="start_date">Start date</Label>
            <Input id="start_date" name="start_date" type="date" required />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="end_date">End date</Label>
            <Input id="end_date" name="end_date" type="date" />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="schedule_note">Schedule</Label>
          <Input
            id="schedule_note"
            name="schedule_note"
            type="text"
            placeholder="Tuesday & Thursday, 7:30 PM"
          />
        </div>

        <SubmitButton pendingLabel="Creating class…" className="mt-6 w-full">
          Create class
        </SubmitButton>
      </form>
    </OnboardingShell>
  );
}
