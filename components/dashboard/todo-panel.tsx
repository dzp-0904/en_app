import { createTask, removeTask, setTaskDone } from "@/app/teacher/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionHeading } from "@/components/ui/section-heading";
import {
  clearsInHours,
  deadlineState,
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_TITLE_MAX,
  type TaskPriority,
  type TeacherTask,
} from "@/lib/teacher-tasks";
import { cn } from "@/lib/utils";

/**
 * The Dashboard's To-do panel — the right-hand column of the updated Figma
 * `pages/teacher/Dashboard.tsx`.
 *
 * A **Server** Component, which is the whole design problem this file solves.
 * The Figma's panel is `useState` over five hardcoded tasks: the `+` opens a
 * form, a checkbox ticks a row, an `×` removes one, and none of it survives a
 * reload because none of it is stored anywhere. Reproducing that literally
 * would have meant a ninth client component holding fake data — the two things
 * §3 and this project's architecture both refuse. So every interaction here is
 * a real `<form>` posting to a Server Action against a real row, the panel
 * re-renders from the database, and it all works with JavaScript disabled.
 *
 * ## The three deliberate deviations, each argued
 *
 * 1. **The `+` is a labelled disclosure, not an icon-only toggle.** The Figma's
 *    24px indigo square with a `+` in it has no accessible name and no
 *    behaviour without JavaScript. It is a `<details>` / `<summary>` here — the
 *    same pattern M30 used for the session's schedule editor — keeping the
 *    Figma's indigo `+` mark as the summary's own glyph beside a real label.
 *    Native keyboard support, native open state, no script.
 * 2. **Priority is a radio group, not three toggle buttons.** `peer sr-only`
 *    radios behind the Figma's pills, exactly as
 *    `components/onboarding/radio-card.tsx` does: arrow keys move between the
 *    options, the selection is exposed rather than implied by colour, and the
 *    value submits with the form.
 * 3. **The remove control is always visible.** The Figma hides it behind
 *    `opacity-0 group-hover:opacity-100`, which is unreachable by touch and
 *    invisible to a keyboard until it already has focus. It is a quiet muted
 *    `×` that darkens on hover instead.
 *
 * ## What is honest about it
 *
 * `tasks === null` means the read failed — which today includes "the table does
 * not exist", because `supabase/migrations/20260901000200_teacher_tasks.sql` is
 * written and deliberately not applied. That case renders the ordinary alert,
 * not an empty list: a teacher told they have no tasks would reasonably stop
 * looking for them. `[]` renders the Figma's own empty state.
 */

/**
 * The Figma's priority dots. High `#EF4444`, medium `#E8834A`, low `#C5C3BB` —
 * mapped onto this palette's `--destructive`, `--orange` and `--placeholder`,
 * the last of which is that exact hex already. Red is the documented AA
 * substitution: `#EF4444` is 3.3:1 on white and carries the label's colour too.
 */
const PRIORITY_DOT: Record<TaskPriority, string> = {
  high: "bg-destructive",
  medium: "bg-orange",
  low: "bg-placeholder",
};

const PRIORITY_PILL: Record<TaskPriority, string> = {
  high: "peer-checked:border-destructive peer-checked:bg-destructive-light peer-checked:text-destructive",
  medium:
    "peer-checked:border-orange peer-checked:bg-orange-light peer-checked:text-orange-dark",
  low: "peer-checked:border-decorative peer-checked:bg-muted peer-checked:text-foreground",
};

/** One priority option: a real radio, drawn as the Figma's pill. */
function PriorityChoice({ priority }: { priority: TaskPriority }) {
  return (
    <label className="cursor-pointer">
      <input
        type="radio"
        name="priority"
        value={priority}
        defaultChecked={priority === "medium"}
        className="peer sr-only"
      />
      <span
        className={cn(
          "flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors",
          "hover:border-primary/40",
          "peer-focus-visible:outline-solid peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring",
          PRIORITY_PILL[priority],
        )}
      >
        <span
          aria-hidden
          className={cn("size-1.5 rounded-full", PRIORITY_DOT[priority])}
        />
        {TASK_PRIORITY_LABELS[priority]}
      </span>
    </label>
  );
}

function TaskRow({
  task,
  today,
  now,
}: {
  task: TeacherTask;
  today: string;
  now: number;
}) {
  const done = task.completedAt !== null;
  const deadline = task.dueDate ? deadlineState(task.dueDate, today) : null;
  // A finished task's deadline is history: the Figma stops colouring it red the
  // moment the row is ticked, which is the difference between "you are late"
  // and "you were late, and you dealt with it".
  const urgent = deadline?.urgent === true && !done;

  return (
    <li
      className={cn(
        "rounded-xl border border-border bg-card px-4 py-3",
        done && "opacity-60",
      )}
    >
      <div className="flex items-start gap-3">
        {/* The tick. A form rather than a checkbox because it writes on
            submit, and it submits the state it wants rather than "toggle" —
            so two rapid clicks converge instead of racing. */}
        <form action={setTaskDone} className="shrink-0 pt-0.5">
          <input type="hidden" name="task_id" value={task.taskId} />
          <input type="hidden" name="done" value={done ? "0" : "1"} />
          <button
            type="submit"
            aria-label={
              done
                ? `Bỏ đánh dấu hoàn thành: ${task.title}`
                : `Đánh dấu hoàn thành: ${task.title}`
            }
            className={cn(
              "flex size-4 items-center justify-center rounded-sm border-2 transition-colors",
              "focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              done
                ? "border-green bg-green text-white"
                : "border-border hover:border-green",
            )}
          >
            {done ? (
              <svg
                aria-hidden
                viewBox="0 0 12 12"
                className="size-3"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M2.5 6.2 4.8 8.5 9.5 3.8" />
              </svg>
            ) : null}
          </button>
        </form>

        <div className="min-w-0 grow">
          <p
            className={cn(
              "text-sm break-words",
              done ? "text-muted-foreground line-through" : "text-foreground",
            )}
          >
            {task.title}
          </p>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden
                className={cn(
                  "size-1.5 rounded-full",
                  PRIORITY_DOT[task.priority],
                )}
              />
              {TASK_PRIORITY_LABELS[task.priority]}
            </span>

            {deadline ? (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5",
                  urgent
                    ? "bg-destructive-light text-destructive"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {deadline.label}
              </span>
            ) : null}

            {/* Not a countdown that ticks — the page was rendered once. It says
                roughly how long the row has left before the 24-hour filter
                stops listing it, which is what the Figma's note means. */}
            {done && task.completedAt ? (
              <span>{`Ẩn sau ${clearsInHours(task.completedAt, now)} giờ`}</span>
            ) : null}
          </div>
        </div>

        <form action={removeTask} className="shrink-0">
          <input type="hidden" name="task_id" value={task.taskId} />
          <button
            type="submit"
            aria-label={`Xóa công việc: ${task.title}`}
            className={cn(
              "flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors",
              "hover:bg-destructive-light hover:text-destructive",
              "focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            )}
          >
            <svg
              aria-hidden
              viewBox="0 0 12 12"
              className="size-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
            >
              <path d="M2.5 2.5 9.5 9.5M9.5 2.5 2.5 9.5" />
            </svg>
          </button>
        </form>
      </div>
    </li>
  );
}

export function TodoPanel({
  tasks,
  today,
  now,
}: {
  /** `null` means the read failed — including "the table is not there yet". */
  tasks: TeacherTask[] | null;
  /** Today on the class's clock, `YYYY-MM-DD`. Resolved by the page. */
  today: string;
  /** The instant the page rendered, for the auto-hide note. */
  now: number;
}) {
  const doneCount = tasks?.filter((task) => task.completedAt !== null).length ?? 0;

  return (
    <section aria-labelledby="todo-heading" className="min-w-0">
      <SectionHeading
        title={<span id="todo-heading">Công việc</span>}
        description="Việc cần làm của riêng bạn."
      />

      {/* The Figma's `+` toggle. `<details>` so it opens without JavaScript and
          announces its own expanded state; `list-none` removes the marker the
          browser would otherwise draw beside our own. */}
      <details className="mb-3">
        <summary
          className={cn(
            "ml-auto flex w-fit cursor-pointer list-none items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-foreground transition-colors",
            "hover:border-primary/40",
            "focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            "[&::-webkit-details-marker]:hidden",
          )}
        >
          <span
            aria-hidden
            className="flex size-5 items-center justify-center rounded-md bg-primary text-sm leading-none font-bold text-primary-foreground"
          >
            +
          </span>
          Thêm công việc
        </summary>

        <form
          action={createTask}
          className="mt-3 rounded-xl border border-primary/30 bg-card p-4"
        >
          <Label htmlFor="task-title">Nội dung</Label>
          <Input
            id="task-title"
            name="title"
            required
            maxLength={TASK_TITLE_MAX}
            placeholder="Ví dụ: Gửi báo cáo tháng cho phụ huynh"
            className="mt-1.5"
          />

          <fieldset className="mt-4">
            <legend className="mb-1.5 block text-sm font-medium text-foreground">
              Mức độ ưu tiên
            </legend>
            <div className="flex flex-wrap gap-2">
              {TASK_PRIORITIES.map((priority) => (
                <PriorityChoice key={priority} priority={priority} />
              ))}
            </div>
          </fieldset>

          <div className="mt-4">
            <Label htmlFor="task-due">Hạn hoàn thành</Label>
            <Input
              id="task-due"
              name="due_date"
              type="date"
              className="mt-1.5"
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              Có thể bỏ trống.
            </p>
          </div>

          <Button type="submit" size="sm" className="mt-4">
            Thêm
          </Button>
        </form>
      </details>

      {tasks === null ? (
        <Alert>
          Chúng tôi chưa tải được danh sách công việc. Vui lòng tải lại trang.
        </Alert>
      ) : tasks.length === 0 ? (
        <EmptyState
          title="Chưa có công việc nào"
          description="Chọn Thêm công việc để ghi lại việc đầu tiên."
        />
      ) : (
        <>
          <ul className="space-y-2">
            {tasks.map((task) => (
              <TaskRow key={task.taskId} task={task} today={today} now={now} />
            ))}
          </ul>

          {doneCount > 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              {`${doneCount} việc đã xong · tự ẩn sau 24 giờ`}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
