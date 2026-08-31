import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  PERFORMANCE_LABELS,
  SKILL_LABELS,
  type Performance,
} from "@/lib/lesson-log";
import type { StudentFeedback } from "@/lib/student";

/**
 * The two panels the Figma builds over the same `lesson_logs` rows.
 *
 * `pages/student/Dashboard.tsx` shows this student's feedback twice and in two
 * different shapes, which is a deliberate choice rather than a duplication:
 *
 *   `RecentFeedback`   the Progress tab's compact card — the two newest, each
 *                      one line of metadata over an italic quotation, rows
 *                      separated by a hairline rather than boxed separately.
 *   `LearningHistory`  the History tab — every row, in a bordered card with a
 *                      cream header strip and `divide-y` between the entries.
 *
 * Both live here because they share the performance colour map and the date
 * rule, and keeping one copy of each is what stops the two views of the same
 * row from ever disagreeing about what it says.
 *
 * `lesson_date` is a `date`: a calendar square the teacher already resolved on
 * the class's clock. It is read at UTC midnight and never reinterpreted in the
 * reader's zone — the rule `lib/time.ts` exists to enforce, applied to the one
 * column type that must not go through a zone at all.
 *
 * Server components. There is no state here and no action: `lesson_logs` grants
 * a student SELECT through `lesson_logs_student_select` and nothing else, so
 * this is a report and not a form.
 */

const DATE = new Intl.DateTimeFormat("vi-VN", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});

function dateOf(lessonDate: string): string {
  return DATE.format(new Date(`${lessonDate}T00:00:00Z`));
}

/**
 * The Figma's `performanceColor` map, in this application's `Badge` tones.
 *
 * It paints the label in the colour at full strength over the same colour at
 * `18` hex — about 9% — which `Badge` already expresses as a `*-light` ground
 * under a `*-dark` foreground. The dark pair is the documented AA substitution:
 * `--green` is 2.98:1 on white and fails as text.
 */
export const PERFORMANCE_TONE: Record<
  Performance,
  "green" | "primary" | "orange" | "destructive"
> = {
  excellent: "green",
  good: "primary",
  developing: "orange",
  needs_attention: "destructive",
};

/** The Progress tab's card. `entries` is expected newest-first and short. */
export function RecentFeedback({ entries }: { entries: StudentFeedback[] }) {
  return (
    <Card variant="list" className="p-4">
      <h2 className="mb-3 text-sm font-semibold text-foreground">
        Nhận xét gần đây của giáo viên
      </h2>

      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Giáo viên chưa viết nhận xét nào cho bạn.
        </p>
      ) : (
        <ul className="space-y-3">
          {entries.map((entry, index) => (
            <li
              key={entry.logId}
              className={index > 0 ? "border-t border-track pt-3" : undefined}
            >
              {/* The Figma's one metadata line, wrapping rather than
                  overflowing: a Vietnamese topic and a four-word performance
                  label do not always fit a half-width card at 320px. */}
              <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-xs font-medium text-muted-foreground">
                  {dateOf(entry.lessonDate)}
                </span>
                <span aria-hidden className="text-xs text-muted-foreground">
                  —
                </span>
                <span className="min-w-0 text-xs break-words text-muted-foreground">
                  {SKILL_LABELS[entry.skill]}
                </span>

                <Badge
                  tone={PERFORMANCE_TONE[entry.performance]}
                  className="ml-auto shrink-0 px-1.5 text-[10px]"
                >
                  {PERFORMANCE_LABELS[entry.performance]}
                </Badge>
              </div>

              <p className="text-xs break-words text-foreground">
                {entry.topic}
              </p>

              {/* The Figma wraps the note in typed quotation marks. Rendered as
                  real text rather than CSS `content`, so it is copied with the
                  sentence and read out with it. */}
              {entry.note ? (
                <p className="mt-1 text-xs leading-relaxed break-words whitespace-pre-wrap text-muted-foreground italic">
                  “{entry.note}”
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** The History tab's card: a cream header strip over hairline-divided rows. */
export function LearningHistory({ entries }: { entries: StudentFeedback[] }) {
  return (
    <Card variant="list" className="overflow-hidden p-0">
      <div className="border-b border-border bg-background px-5 py-3">
        <h2 className="text-sm font-semibold text-foreground">
          Lịch sử học tập của tôi
        </h2>
      </div>

      {entries.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">
          Chưa có nhận xét nào được ghi lại.
        </p>
      ) : (
        <ul className="divide-y divide-track">
          {entries.map((entry) => (
            <li
              key={entry.logId}
              className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 py-4"
            >
              <div className="min-w-0 grow basis-64">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-medium text-foreground">
                    {dateOf(entry.lessonDate)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {SKILL_LABELS[entry.skill]}
                  </span>
                </div>

                <p className="mt-0.5 text-xs break-words text-muted-foreground">
                  {entry.topic}
                </p>

                {entry.note ? (
                  <p className="mt-2 text-sm break-words whitespace-pre-wrap text-muted-foreground italic">
                    “{entry.note}”
                  </p>
                ) : null}
              </div>

              <Badge
                tone={PERFORMANCE_TONE[entry.performance]}
                className="shrink-0"
              >
                {PERFORMANCE_LABELS[entry.performance]}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
