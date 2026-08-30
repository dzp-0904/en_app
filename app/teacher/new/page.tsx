import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ClassForm } from "@/components/class/class-form";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
import {
  isOnboardingComplete,
  requireTeacher,
  requireTeachingType,
} from "@/lib/onboarding";
import type { PageSearchParams } from "@/lib/route-types";

import { createClass } from "../../onboarding/actions";

export const metadata: Metadata = {
  title: "Tạo lớp học",
};

/**
 * Adding a class once setup is done.
 *
 * The same `ClassForm` and the same `createClass` action as the wizard's third
 * step — this page is the frame, not a second way to create a class. What
 * changes is the surroundings: no stepper, no "your first class", and a way back
 * to the list.
 *
 * A static segment, so it takes precedence over `/teacher/[classId]`; "new" is
 * not a uuid, so that route would refuse it in any case.
 */
export default async function NewClassPage({ searchParams }: PageSearchParams) {
  const teacher = await requireTeacher();

  // A teacher who has not finished setting up belongs in the wizard, which asks
  // for a teaching type first and tracks its own progress. Sending them here
  // would skip a step and leave the stepper wrong for the rest of the flow.
  if (!isOnboardingComplete(teacher)) {
    redirect("/onboarding");
  }

  const teachingType = requireTeachingType(teacher);

  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : undefined;

  return (
    <PageShell width="2xl">
      <PageHeader
        breadcrumb={[
          { label: "Lớp học", href: "/teacher" },
          { label: "Tạo lớp học" },
        ]}
        title="Tạo lớp học"
      />

      {error ? <Alert className="mb-5">{error}</Alert> : null}

      <Card>
        <ClassForm action={createClass} defaultCourseType={teachingType} />
      </Card>
    </PageShell>
  );
}
