import Link from "next/link";

import { PendingTint } from "@/components/ui/pending-tint";
import {
  SLOT_HEIGHT,
  TONE_BLOCK,
  WEEKDAY_LABELS,
  WEEKDAY_SHORT,
  dayLabel,
  dayNumber,
  type CalendarSession,
  type ClassTone,
} from "@/lib/calendar";
import { cn } from "@/lib/utils";

/**
 * The week as a time grid — the Figma's `pages/teacher/Calendar.tsx`.
 *
 * Its geometry is copied rather than approximated: a
 * `grid-cols-[56px_repeat(7,1fr)]` frame, one 64px band per hour, a solid rule
 * on the hour and a dashed one on the half hour, the day number in a 28px disc
 * that fills indigo on today, the today column washed in `--secondary`, and a
 * thin indigo line with a dot on its left end marking now. A lesson is an
 * absolutely positioned block inside its own day column, offset by its start
 * time and as tall as it lasts.
 *
 * WHY THE BLOCK IS A CHILD OF ITS COLUMN. The Figma positions all 7×n blocks
 * against the grid itself with `left: calc(56px + col * ((100% - 56px) / 7))`.
 * That arithmetic exists only because the blocks are siblings of the columns
 * rather than children of them; making each day cell `relative` and giving the
 * block `inset-x-0.5` says the same thing with no percentages to round, and it
 * keeps a block from ever landing a pixel outside the column it belongs to.
 *
 * WHY IT SCROLLS SIDEWAYS AND NOT DOWNWARDS. Seven columns plus a time gutter
 * cannot be read at 320px — each column would be 28px, narrower than the word
 * "IELTS" — and absolute positions cannot reflow. So the grid keeps a
 * `min-width` and the *card* scrolls horizontally beneath it, which is the
 * `components/ui/table.tsx` treatment this repository already uses for the same
 * problem, focus ring and labelled region included. The page itself never
 * scrolls sideways at any width.
 *
 * It does not scroll vertically. The Figma's grid is a `flex-1` box inside an
 * `h-full` shell, so its own scrollbar is a consequence of that shell rather
 * than a design decision, and reproducing it here would put a nested scroller
 * inside a scrolling document — with the first visible hour being 06:00 and
 * this product's classes meeting in the evening, every real lesson would start
 * the page hidden. The whole day is drawn instead, and the page scrolls the way
 * every other page does.
 *
 * A server component. Nothing here reacts to anything: the week comes from the
 * URL, and `now` is read once per request, which is exactly what the Figma's
 * own `new Date()` does at render.
 */

/** What the third line of a block can say, when a class has it to say. */
export type ClassMeta = {
  studentCount: number | null;
  targetBand: number | null;
};

/**
 * Small enough to be a click target when a lesson is very short, and small
 * enough that it cannot visually swallow the lesson underneath it.
 */
const MIN_BLOCK = 24;

/** The Figma's own threshold for printing the third line. */
const THIRD_LINE_AT = 56;

/**
 * Seven columns at 88px plus the 56px gutter. Below this the card scrolls; at
 * 768px and above it never needs to, because the shell's sidebar has already
 * moved to the top of the page by then.
 */
const MIN_GRID = 672;

const STEP_TEXT = "text-[10px] leading-tight";

function metaLine(meta: ClassMeta | undefined): string {
  if (!meta) return "";

  const parts: string[] = [];
  if (meta.studentCount !== null) parts.push(`${meta.studentCount} học viên`);
  // `classes_no_target_band_when_unscored` means only a band-scored class has
  // one, so its absence is the schema saying this class is not scored on bands
  // rather than a value nobody filled in.
  if (meta.targetBand !== null) parts.push(`IELTS ${meta.targetBand.toFixed(1)}`);

  return parts.join(" · ");
}

export function WeekGrid({
  days,
  sessions,
  tones,
  meta,
  today,
  nowMinutes,
  startHour,
  endHour,
}: {
  /** The seven `YYYY-MM-DD` squares, Monday first. */
  days: string[];
  sessions: CalendarSession[];
  tones: Map<string, ClassTone>;
  meta: Map<string, ClassMeta>;
  /** Today on the calendar's own clock, which may not be in `days` at all. */
  today: string;
  /** Minutes past midnight, on that same clock. */
  nowMinutes: number;
  startHour: number;
  endHour: number;
}) {
  const hours = Array.from(
    { length: endHour - startHour },
    (_, index) => startHour + index,
  );
  const height = (endHour - startHour) * SLOT_HEIGHT;

  const byDay = new Map<string, CalendarSession[]>();
  for (const session of sessions) {
    const bucket = byDay.get(session.date);
    if (bucket) bucket.push(session);
    else byDay.set(session.date, [session]);
  }

  const nowVisible =
    days.includes(today) &&
    nowMinutes >= startHour * 60 &&
    nowMinutes < endHour * 60;
  const nowTop = ((nowMinutes - startHour * 60) / 60) * SLOT_HEIGHT;

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div
        role="region"
        aria-label="Lưới lịch tuần"
        tabIndex={0}
        className="overflow-x-auto outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      >
        <div style={{ minWidth: MIN_GRID }}>
          {/* Day headings. A separate grid from the body, with the same track
              list, so the two line up without the body having to reserve a
              row for something that must not scroll with it. */}
          <div className="grid grid-cols-[56px_repeat(7,1fr)] border-b border-border">
            <div className="border-r border-border" />

            {days.map((day, index) => {
              const isToday = day === today;

              return (
                <div
                  key={day}
                  {...(isToday ? { "aria-current": "date" as const } : {})}
                  className={cn(
                    "border-r border-border px-2 py-3 text-center last:border-r-0",
                    isToday && "bg-secondary",
                  )}
                >
                  <p
                    className={cn(
                      "mb-1 text-xs font-medium tracking-wide uppercase",
                      isToday ? "text-primary" : "text-muted-foreground",
                    )}
                  >
                    {/* "T2" is how the day is written on a Vietnamese
                        calendar and unreadable when spoken, so the column is
                        named in full for anyone listening to it. */}
                    <span aria-hidden>{WEEKDAY_SHORT[index]}</span>
                    {/* `normal-case` because the heading is uppercased and a
                        screen reader reads the *rendered* text — "THỨ HAI" is
                        liable to be spelled out letter by letter. */}
                    <span className="sr-only normal-case">
                      {WEEKDAY_LABELS[index]}, {dayLabel(day)}
                    </span>
                  </p>

                  <span
                    className={cn(
                      "mx-auto flex size-7 items-center justify-center rounded-full text-sm font-semibold",
                      isToday
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {dayNumber(day)}
                  </span>
                </div>
              );
            })}
          </div>

          <div
            className="relative grid grid-cols-[56px_repeat(7,1fr)]"
            style={{ height }}
          >
            {/* The gutter. Each label is centred on its own rule, except the
                first, which would be half outside the card. */}
            <div className="relative border-r border-border">
              {hours.map((hour, index) => (
                <span
                  key={hour}
                  className={cn(
                    "absolute right-2 text-[10px] leading-none text-muted-foreground",
                    index > 0 && "-translate-y-1/2",
                  )}
                  style={{ top: index * SLOT_HEIGHT }}
                >
                  {String(hour).padStart(2, "0")}:00
                </span>
              ))}
            </div>

            {days.map((day, index) => {
              const isToday = day === today;
              const lessons = byDay.get(day) ?? [];

              return (
                <div
                  key={day}
                  className={cn(
                    "relative border-r border-border last:border-r-0",
                    isToday && "bg-secondary/30",
                  )}
                >
                  {lessons.map((lesson) => {
                    const tone = tones.get(lesson.classId) ?? "primary";
                    const top =
                      ((lesson.startMinutes - startHour * 60) / 60) *
                      SLOT_HEIGHT;
                    const box = Math.max(
                      ((lesson.endMinutes - lesson.startMinutes) / 60) *
                        SLOT_HEIGHT,
                      MIN_BLOCK,
                    );
                    const cancelled = lesson.status === "cancelled";
                    const third = cancelled
                      ? "Đã hủy"
                      : metaLine(meta.get(lesson.classId));

                    return (
                      <Link
                        key={lesson.sessionId}
                        href={`/teacher/${lesson.classId}/sessions/${lesson.sessionId}`}
                        // The 2px inset on each side is the Figma's: it is what
                        // keeps two consecutive lessons from sharing an edge.
                        style={{ top: top + 2, height: box - 4 }}
                        className={cn(
                          "absolute inset-x-0.5 z-10 block overflow-hidden rounded-lg border-l-[3px] px-2 py-1.5 transition-opacity outline-none hover:opacity-85 focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                          TONE_BLOCK[tone],
                          // A cancelled lesson still happened in the teacher's
                          // week and is still worth seeing, so it is shown and
                          // marked rather than hidden.
                          cancelled && "opacity-60",
                        )}
                      >
                        <span className="block truncate text-[11px] leading-tight font-semibold">
                          {lesson.className}
                        </span>

                        <span
                          className={cn(
                            "mt-0.5 block truncate opacity-75",
                            STEP_TEXT,
                          )}
                        >
                          {lesson.startTime}–{lesson.endTime}
                        </span>

                        {third && box > THIRD_LINE_AT ? (
                          <span
                            className={cn(
                              "mt-1 block truncate opacity-60",
                              STEP_TEXT,
                            )}
                          >
                            {third}
                          </span>
                        ) : null}

                        {/* What the block is too small to print, and what a
                            colour alone would otherwise have to carry. */}
                        <span className="sr-only">
                          {WEEKDAY_LABELS[index]}, {dayLabel(day)}
                          {lesson.title ? `. ${lesson.title}` : ""}
                          {cancelled ? ". Đã hủy" : ""}
                        </span>

                        <PendingTint />
                      </Link>
                    );
                  })}
                </div>
              );
            })}

            {/* Hour and half-hour rules, drawn once across the seven columns
                rather than seven times down each of them. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 right-0 left-14"
            >
              {hours.map((hour, index) => (
                <div
                  key={`hour-${hour}`}
                  className="absolute inset-x-0 border-t border-track"
                  style={{ top: index * SLOT_HEIGHT }}
                />
              ))}
              {hours.map((hour, index) => (
                <div
                  key={`half-${hour}`}
                  className="absolute inset-x-0 border-t border-dashed border-track"
                  style={{ top: index * SLOT_HEIGHT + SLOT_HEIGHT / 2 }}
                />
              ))}
            </div>

            {nowVisible ? (
              <div
                aria-hidden
                className="pointer-events-none absolute right-0 left-14 z-20 flex items-center"
                style={{ top: nowTop }}
              >
                <span className="-ml-1 size-2 shrink-0 rounded-full bg-primary" />
                <span className="h-px flex-1 bg-primary" />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
