"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireTeacher } from "@/lib/onboarding";
import { createClient } from "@/lib/supabase/server";
import { isTaskPriority, TASK_TITLE_MAX } from "@/lib/teacher-tasks";

/**
 * The Dashboard To-do panel's three Server Actions.
 *
 * Each one is a POST endpoint in its own right, so each re-derives the teacher
 * from the session cookie through `requireTeacher()` and re-validates its own
 * input. Nothing is trusted from the form except the task's id and the fields
 * the teacher typed — and the id is only ever used *inside* a WHERE clause that
 * also carries `teacher_id`, so a forged id matches no row rather than someone
 * else's. `teacher_tasks_owner_all` is underneath all three and is the layer
 * that cannot be bypassed from here.
 *
 * WHY THE FILTER RATHER THAN A READ-THEN-CHECK. `eq("teacher_id", …)` in the
 * same statement as the write means two concurrent submissions cannot both
 * succeed on a row that only one of them owns, and it means the "not yours" and
 * "not there" cases are indistinguishable — the same discipline
 * `app/teacher/[classId]/actions.ts` applies to memberships.
 *
 * THESE ACTIONS WILL FAIL UNTIL THE MIGRATION IS RUN.
 * `supabase/migrations/20260901000200_teacher_tasks.sql` is written and
 * deliberately not applied, so `public.teacher_tasks` does not exist yet and
 * every statement below returns an error. That path is handled: the teacher
 * gets a Vietnamese message on `?error=`, the operator gets the real code in
 * the server log, and nothing is silently swallowed.
 *
 * Failures come back on `?error=` and the page re-renders from the database, so
 * the panel needs no client state and the whole thing works with JavaScript
 * disabled.
 */

const DASHBOARD = "/teacher";

/** Redirects with a message attached. Returns `never` so callers narrow. */
function failTo(message: string): never {
  redirect(`${DASHBOARD}?error=${encodeURIComponent(message)}`);
}

/** Records a database failure for the operator without echoing it to the user. */
function logDbError(
  operation: string,
  error: { code?: string; message?: string; details?: string | null },
): void {
  console.error(`[teacher-tasks] ${operation} failed`, {
    code: error.code,
    message: error.message,
    details: error.details ?? undefined,
  });
}

/**
 * `<input type="date">` submits `YYYY-MM-DD`, and an empty field submits "".
 *
 * Checked against the shape *and* re-read through `Date.UTC`, because
 * `2026-02-31` matches the pattern and is not a day. A malformed value is
 * refused rather than quietly dropped: a teacher who typed a deadline should
 * not get a task without one.
 */
function readDueDate(raw: string): string | null {
  if (!raw) return null;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    failTo("Hạn hoàn thành không hợp lệ.");
  }

  const [year, month, day] = raw.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    failTo("Hạn hoàn thành không hợp lệ.");
  }

  return raw;
}

export async function createTask(formData: FormData) {
  const teacher = await requireTeacher();

  const title = String(formData.get("title") ?? "").trim();
  const priority = String(formData.get("priority") ?? "").trim();
  const dueDate = readDueDate(String(formData.get("due_date") ?? "").trim());

  if (!title) {
    failTo("Vui lòng nhập nội dung công việc.");
  }

  // teacher_tasks_title_length allows 1..300 after trimming, and the column is
  // checked on the trimmed value — so this is the same rule, not a stricter one.
  if (title.length > TASK_TITLE_MAX) {
    failTo(`Vui lòng dùng nội dung không quá ${TASK_TITLE_MAX} ký tự.`);
  }

  if (!isTaskPriority(priority)) {
    failTo("Vui lòng chọn mức độ ưu tiên.");
  }

  const supabase = await createClient();

  const { error } = await supabase.from("teacher_tasks").insert({
    // From the session, never from the form. The policy's WITH CHECK refuses
    // any other value regardless, which is what makes this a duplicate rather
    // than the only guard.
    teacher_id: teacher.userId,
    title,
    priority,
    due_date: dueDate,
  });

  if (error) {
    logDbError("createTask", error);
    failTo("Chúng tôi chưa thêm được công việc. Vui lòng thử lại.");
  }

  revalidatePath(DASHBOARD);
  redirect(DASHBOARD);
}

/**
 * Ticks a task, or un-ticks one.
 *
 * The button submits the state it wants rather than "toggle", so two rapid
 * clicks converge on the same answer instead of racing each other back and
 * forth — and so the server never has to read the row to know what to write.
 *
 * Un-ticking sets `completed_at` back to null, which also puts the task back in
 * the panel permanently: the 24-hour window is a property of *being done*, not
 * a countdown the row remembers.
 */
export async function setTaskDone(formData: FormData) {
  const teacher = await requireTeacher();

  const taskId = String(formData.get("task_id") ?? "").trim();
  const done = String(formData.get("done") ?? "") === "1";

  if (!taskId) {
    failTo("Không tìm thấy công việc.");
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from("teacher_tasks")
    .update({ completed_at: done ? new Date().toISOString() : null })
    .eq("id", taskId)
    .eq("teacher_id", teacher.userId);

  if (error) {
    logDbError("setTaskDone", error);
    failTo("Chúng tôi chưa cập nhật được công việc. Vui lòng thử lại.");
  }

  revalidatePath(DASHBOARD);
  redirect(DASHBOARD);
}

export async function removeTask(formData: FormData) {
  const teacher = await requireTeacher();

  const taskId = String(formData.get("task_id") ?? "").trim();

  if (!taskId) {
    failTo("Không tìm thấy công việc.");
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from("teacher_tasks")
    .delete()
    .eq("id", taskId)
    .eq("teacher_id", teacher.userId);

  if (error) {
    logDbError("removeTask", error);
    failTo("Chúng tôi chưa xóa được công việc. Vui lòng thử lại.");
  }

  revalidatePath(DASHBOARD);
  redirect(DASHBOARD);
}
