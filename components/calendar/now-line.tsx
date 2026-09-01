"use client";

import { useEffect, useState } from "react";

import { formatZonedTime, minutesOfDay, zonedCalendarDate } from "@/lib/time";

/**
 * The current-time indicator: a thin red rule across the week with a small red
 * disc at the time-axis edge.
 *
 * ## Why this is a client component, and what that costs
 *
 * It is the seventh in the application, and the reason is the only one that
 * justifies one: the milestone requires that the indicator "update while the
 * calendar remains open so it does not become stale". A server component
 * renders once per request and cannot tick. Everything else on this calendar —
 * the grid, the day columns, every lesson block — stays on the server; this is
 * one absolutely positioned rule that knows the time.
 *
 * ## It is seeded, not discovered
 *
 * `initialDate` and `initialMinutes` are the server's own reading, from
 * `nowIn(zone)`. They are the initial state, so the first client render is
 * byte-identical to the server's and there is no hydration mismatch, no flash
 * of a differently placed line, and no dependence on JavaScript for the line to
 * be correct *at render*. Without JavaScript it simply stops being updated,
 * which is exactly what the old server-only version did — the enhancement adds
 * freshness and removes nothing.
 *
 * ## The clock is the class's, never the browser's
 *
 * The tick re-reads one instant and converts it through `lib/time.ts` against
 * the class's own IANA zone, the same two functions `nowIn` uses on the server.
 * A teacher travelling, a laptop with the wrong zone, or a machine in UTC all
 * produce the same line, because the viewer's zone is never consulted — which
 * is the whole reason `lib/time.ts` exists and why `toISOString().slice(0, 10)`
 * appears nowhere.
 *
 * ## It marks the time; it does not obstruct it
 *
 * `pointer-events-none` so it cannot intercept a click on the lesson beneath
 * it, and it sits above the blocks only visually. The rule itself is
 * `aria-hidden` — a coloured line has nothing to say — and the same state is
 * printed as text for anyone who cannot see it, so the indicator is never the
 * only way to know what time it is. That text is deliberately not a live
 * region: a polite announcement every half minute would be noise, and the value
 * is correct whenever it is read.
 */

/** Half a minute. The line advances about one pixel a minute at 64px/hour. */
const TICK_MS = 30_000;

export function NowLine({
  zone,
  days,
  startHour,
  endHour,
  slotHeight,
  initialDate,
  initialMinutes,
}: {
  /** `classes.timezone` — the clock this calendar is drawn on. */
  zone: string;
  /** The seven `YYYY-MM-DD` squares on screen. */
  days: string[];
  startHour: number;
  endHour: number;
  slotHeight: number;
  initialDate: string;
  initialMinutes: number;
}) {
  const [now, setNow] = useState({
    date: initialDate,
    minutes: initialMinutes,
  });

  useEffect(() => {
    function read() {
      const instant = new Date().toISOString();
      setNow({
        date: zonedCalendarDate(zone, instant),
        minutes: minutesOfDay(formatZonedTime(zone, instant)),
      });
    }

    // Once on mount as well as on the interval: a tab restored from the
    // back-forward cache, or one left open across a suspend, would otherwise
    // show the moment it was rendered until the first tick landed.
    read();
    const timer = window.setInterval(read, TICK_MS);
    return () => window.clearInterval(timer);
  }, [zone]);

  // Today may not be in this week at all — the teacher may be looking at
  // March. Drawing the line anyway would put it across an arbitrary day and
  // assert something false about it, so nothing is drawn.
  const onScreen =
    days.includes(now.date) &&
    now.minutes >= startHour * 60 &&
    now.minutes < endHour * 60;

  if (!onScreen) return null;

  const top = ((now.minutes - startHour * 60) / 60) * slotHeight;
  const label = `${String(Math.floor(now.minutes / 60)).padStart(2, "0")}:${String(
    now.minutes % 60,
  ).padStart(2, "0")}`;

  return (
    <div
      className="pointer-events-none absolute right-0 left-14 z-20 flex items-center"
      style={{ top }}
    >
      <span
        aria-hidden
        className="-ml-1 size-2 shrink-0 rounded-full bg-destructive"
      />
      <span aria-hidden className="h-px flex-1 bg-destructive" />
      <span className="sr-only">Thời điểm hiện tại: {label}.</span>
    </div>
  );
}
