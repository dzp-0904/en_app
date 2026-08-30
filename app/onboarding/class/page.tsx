import { ClassForm } from "@/components/class/class-form";
import { OnboardingShell } from "@/components/onboarding/onboarding-shell";
import { Alert } from "@/components/ui/alert";
import { requireTeacher, requireTeachingType } from "@/lib/onboarding";
import type { PageSearchParams } from "@/lib/route-types";

import { createClass } from "../actions";

/**
 * Step 3 — the first class.
 *
 * The fields live in `ClassForm`, which `/teacher/new` also renders: the
 * questions are the same wherever they are asked, and only the frame around them
 * differs. This step keeps the wizard's stepper and copy.
 *
 * Nothing here assumes the teacher has no classes. A teacher who already has
 * some can still open this URL and use it; `createClass` reads the existing rows
 * and sends them to the new class rather than on to the invite step.
 */
export default async function ClassPage({ searchParams }: PageSearchParams) {
  const teacher = await requireTeacher();
  const teachingType = requireTeachingType(teacher);

  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : undefined;

  return (
    <OnboardingShell
      step={2}
      title="Tạo lớp học đầu tiên"
      description="Bạn luôn có thể chỉnh sửa sau hoặc thêm lớp học khác."
    >
      {error ? <Alert className="mb-5">{error}</Alert> : null}

      <ClassForm action={createClass} defaultCourseType={teachingType} />
    </OnboardingShell>
  );
}
