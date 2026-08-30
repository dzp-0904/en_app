import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { updateClass } from "@/app/onboarding/actions";
import { ClassForm } from "@/components/class/class-form";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { isOfferedCourseType } from "@/lib/course-type";
import { requireTeacher } from "@/lib/onboarding";
import type { DynamicPageProps } from "@/lib/route-types";
import { createClient } from "@/lib/supabase/server";
import { loadEditableClass } from "@/lib/teacher";

export const metadata: Metadata = {
  title: "Chỉnh sửa lớp",
};

/**
 * Correcting a class that already exists.
 *
 * The same `ClassForm` as the wizard's third step and `/teacher/new`, filled in
 * — this page is the frame and the loader, not a second way to describe a class.
 * What changes is the surroundings: a way back to the class rather than to the
 * list, and "Save changes" on the button.
 *
 * `edit` is a static segment under `[classId]`, so it can never be mistaken for
 * a class id; and `loadEditableClass` would refuse it in any case, since "edit"
 * is not a uuid.
 *
 * Nothing here checks whether onboarding is finished, and it does not need to:
 * reaching past the loader means the teacher owns a class, and owning a class is
 * what `isOnboardingComplete` means. The application shell that
 * `app/teacher/layout.tsx` draws therefore always wraps this page.
 */
export default async function EditClassPage({
  params,
  searchParams,
}: DynamicPageProps<{ classId: string }>) {
  const { classId } = await params;

  // Anonymous goes to the login page, a student and an unplaceable account go
  // to `/` — the same guard `/teacher/new` uses, and the same one `updateClass`
  // repeats for itself, because a page is not what protects a POST endpoint.
  const teacher = await requireTeacher();

  const supabase = await createClient();
  const result = await loadEditableClass(supabase, teacher.userId, classId);

  // Another teacher's class is reported exactly as one that does not exist, so
  // the 404 says nothing about what other teachers run.
  if (result.kind === "not-found") {
    notFound();
  }

  if (result.kind === "error") {
    return (
      <Frame classId={classId}>
        {/* Not a 404: the query failed, and telling a teacher their class is
            gone when the database merely stumbled is the worse of the two. */}
        <Alert>
          Chúng tôi chưa tải được lớp học này. Vui lòng tải lại trang.
        </Alert>
      </Frame>
    );
  }

  const { fields } = result;

  // `course_type = 'other'` carries a free-text name in `course_type_other`,
  // and this form has no control for it — `COURSE_TYPES` deliberately omits
  // `other` because the Figma never asks for that name. Such a class cannot be
  // produced by this application, only by direct SQL, but if one exists then
  // opening the form on it would silently reclassify it and drop the name on
  // save. Refusing is the honest answer, and it costs the teacher nothing they
  // could otherwise have had.
  if (!isOfferedCourseType(fields.courseType)) {
    return (
      <Frame classId={classId} className={fields.className}>
        <Alert>
          Lớp này được thiết lập với loại khóa học tùy chỉnh mà biểu mẫu này
          chưa chỉnh sửa được.
        </Alert>
      </Frame>
    );
  }

  const query = await searchParams;
  const error = typeof query.error === "string" ? query.error : undefined;

  return (
    <Frame classId={classId} className={fields.className}>
      {error ? <Alert className="mb-5">{error}</Alert> : null}

      <Card>
        <ClassForm
          // Bound on the server from the segment this page was rendered at, so
          // the class being edited is not a field the browser gets to fill in.
          // It is still not the authorisation: `updateClass` re-establishes the
          // teacher and filters on `teacher_id` regardless of what it is given.
          action={updateClass.bind(null, fields.classId)}
          defaultCourseType={fields.courseType}
          defaults={{
            name: fields.className,
            targetBand: fields.targetBand,
            startDate: fields.startDate,
            endDate: fields.endDate,
            scheduleNote: fields.scheduleNote,
          }}
          submitLabel="Lưu thay đổi"
          pendingLabel="Đang lưu thay đổi…"
        />
      </Card>
    </Frame>
  );
}

/**
 * The shell every state shares — including the error states, which keep the
 * trail so a failed load does not strand anyone on a page with no exit.
 *
 * The trail passes through the class rather than jumping straight to the list:
 * the class is where the teacher came from and where a successful save returns
 * them. The class crumb is dropped only when the load failed outright and there
 * is no name to put in it; `/teacher` still gets them out.
 */
function Frame({
  classId,
  className,
  children,
}: {
  classId: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <PageShell width="2xl">
      <PageHeader
        breadcrumb={[
          { label: "Lớp học", href: "/teacher" },
          ...(className
            ? [{ label: className, href: `/teacher/${classId}` }]
            : []),
          { label: "Chỉnh sửa lớp" },
        ]}
        title="Chỉnh sửa lớp"
      />

      {children}
    </PageShell>
  );
}
