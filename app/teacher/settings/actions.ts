"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isOfferedCourseType } from "@/lib/course-type";
import { requireTeacher } from "@/lib/onboarding";
import { createClient } from "@/lib/supabase/server";

/**
 * The Settings screen's one Server Action.
 *
 * It writes the same two `profiles` columns the wizard's first two steps write,
 * under the same rules — `profiles_full_name_length` allows 1..120, and
 * `profiles_teaching_type_teacher_only` permits a non-null `teaching_type` only
 * on a teacher row, which `requireTeacher()` has already established. The
 * validation is repeated here rather than imported from `app/onboarding/actions`
 * because a Server Function is a POST endpoint in its own right: it re-derives
 * the caller from the session cookie and re-checks its own input, and does not
 * inherit either from the page that rendered the form.
 *
 * ONE FORM, TWO COLUMNS. The Figma's Save button writes name and teaching type
 * together, so this does too. Email is rendered `disabled` there and is not
 * read here at all — changing a Supabase Auth email is a verification flow, not
 * a profile update, and a `disabled` input submits nothing anyway.
 *
 * Failures come back on `?error=` and success on `?saved=1`, which keeps the
 * page a Server Component and the form working with JavaScript disabled.
 */

const SETTINGS = "/teacher/settings";

/** Redirects with a message attached. Returns `never` so callers narrow. */
function failTo(message: string): never {
  redirect(`${SETTINGS}?error=${encodeURIComponent(message)}`);
}

/** Records a database failure for the operator without echoing it to the user. */
function logDbError(
  operation: string,
  error: { code?: string; message?: string; details?: string | null },
): void {
  console.error(`[settings] ${operation} failed`, {
    code: error.code,
    message: error.message,
    details: error.details ?? undefined,
  });
}

export async function updateProfile(formData: FormData) {
  const teacher = await requireTeacher();

  const fullName = String(formData.get("full_name") ?? "").trim();
  const teachingType = String(formData.get("teaching_type") ?? "").trim();

  if (!fullName) {
    failTo("Vui lòng nhập tên mà học viên sẽ nhìn thấy.");
  }

  // profiles_full_name_length allows 1..120.
  if (fullName.length > 120) {
    failTo("Vui lòng dùng tên không quá 120 ký tự.");
  }

  if (!isOfferedCourseType(teachingType)) {
    failTo("Vui lòng chọn nội dung bạn chủ yếu giảng dạy.");
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from("profiles")
    .update({ full_name: fullName, teaching_type: teachingType })
    .eq("id", teacher.userId);

  if (error) {
    logDbError("updateProfile", error);
    failTo("Chúng tôi chưa lưu được thay đổi. Vui lòng thử lại.");
  }

  // The name is printed in the sidebar of every signed-in page, so the whole
  // teacher layout is stale, not just this route.
  revalidatePath("/teacher", "layout");
  redirect(`${SETTINGS}?saved=1`);
}
