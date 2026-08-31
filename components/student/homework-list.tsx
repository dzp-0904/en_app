import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { SKILL_LABELS } from "@/lib/lesson-log";
import {
  HOMEWORK_STATUS_LABELS,
  type HomeworkStatus,
  type StudentHomework,
} from "@/lib/student";
import { cn } from "@/lib/utils";

/**
 * The Figma's Homework tab: one row per assignment, each a bordered card with
 * a tinted 40px square on the left, the title and its two facts in the middle,
 * and the state as a pill on the right.
 *
 * FOUR STATES, NOT TWO. The Figma's mock knows only "pending" and "submitted"
 * and colours everything from that one boolean. `public.homework_status` is
 * `assigned | submitted | graded | missed`, and the schema's own status
 * invariant makes each of them mean something specific — `graded` is the only
 * one that carries a score, `missed` is written by the overdue job and is
 * column-identical to `assigned` apart from the enum value. All four are shown
 * with their own label and colour, because collapsing "đã chấm" into "đã nộp"
 * would hide the mark the student is actually waiting for.
 *
 * The square carries the skill's first letter, as the Figma does. It is
 * `aria-hidden`: in Vietnamese "Nghe" and "Nói" share an initial, so the letter
 * is decoration, and the skill is named in full on the line underneath it.
 *
 * READ-ONLY. There is no submit control here. The Figma has none either, and
 * writing a submission is `public.submit_homework()`'s job — an RPC precisely
 * because a student holding UPDATE on `status` would also hold it on `score`.
 *
 * A server component: no state, no action, no client boundary.
 */

const DUE = new Intl.DateTimeFormat("vi-VN", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * The tinted square's palette, and the pill's. The Figma pairs green with
 * submitted work and orange with outstanding work; `graded` joins the green
 * side because the work is in, and `missed` is the one state that is neither.
 */
const TONE: Record<
  HomeworkStatus,
  { square: string; badge: "green" | "orange" | "destructive" }
> = {
  assigned: { square: "bg-orange-light text-orange-dark", badge: "orange" },
  submitted: { square: "bg-green-light text-green-dark", badge: "green" },
  graded: { square: "bg-green-light text-green-dark", badge: "green" },
  missed: {
    square: "bg-destructive-light text-destructive",
    badge: "destructive",
  },
};

export function HomeworkList({ items }: { items: StudentHomework[] }) {
  return (
    <ul className="space-y-3">
      {items.map((item) => {
        // No submission row is still assigned work — see the note on
        // `StudentHomework.status`. It is never read as "done".
        const status: HomeworkStatus = item.status ?? "assigned";
        const tone = TONE[status];

        return (
          <li key={item.assignmentId}>
            <Card
              variant="list"
              className="flex flex-wrap items-center gap-4"
            >
              <span
                aria-hidden
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-xl text-xs font-bold",
                  tone.square,
                )}
              >
                {Array.from(SKILL_LABELS[item.skill])[0]}
              </span>

              <div className="min-w-0 grow basis-48">
                <p className="text-sm font-medium break-words text-foreground">
                  {item.title}
                </p>

                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {/* `due_date` is nullable and a missing deadline is not an
                      overdue one, so it says so rather than showing a dash. */}
                  <span>
                    {item.dueDate
                      ? `Hạn nộp: ${DUE.format(new Date(`${item.dueDate}T00:00:00Z`))}`
                      : "Không có hạn nộp"}
                  </span>
                  <span aria-hidden>·</span>
                  <span>{SKILL_LABELS[item.skill]}</span>

                  {/* Only `graded` carries a score — the schema's status
                      invariant guarantees the other three never do. */}
                  {item.score !== null ? (
                    <>
                      <span aria-hidden>·</span>
                      <span className="font-medium text-foreground">
                        {item.score}/{item.maxScore}
                      </span>
                    </>
                  ) : null}
                </div>

                {item.teacherFeedback ? (
                  <p className="mt-2 text-xs break-words whitespace-pre-wrap text-muted-foreground italic">
                    “{item.teacherFeedback}”
                  </p>
                ) : null}
              </div>

              <Badge tone={tone.badge} className="shrink-0">
                {HOMEWORK_STATUS_LABELS[status]}
              </Badge>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
