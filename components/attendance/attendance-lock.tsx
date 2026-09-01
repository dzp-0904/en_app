"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { isAttendanceOpen } from "@/lib/attendance";

/**
 * Why the Điểm danh tab is dimmed, and how long for.
 *
 * ## What it is, and what it is not
 *
 * It is an explanation, not a gate. The gate is `isAttendanceOpen` inside
 * `recordAttendance` (`app/teacher/[classId]/actions.ts`) and nothing on this
 * side of the wire can move it: this component renders one sentence and counts
 * down to the minute the sentence names. If a teacher disables JavaScript,
 * edits the DOM, or POSTs to the Server Function by hand, the sentence goes
 * away and the rule does not.
 *
 * It sits directly beneath the tab strip rather than inside the attendance
 * panel, because a disabled tab cannot be opened: the reason has to be visible
 * from wherever the teacher already is, on the tab they are already reading.
 * `?tab=attendance` before the lesson starts falls back to the first panel — the
 * same fallback `?tab=bands` has always taken on a class with no band scale —
 * and lands the visitor next to this line, which then answers the question they
 * arrived with. There is no modal: the workspace stays usable, and five of its
 * six tabs are unaffected.
 *
 * ## Why it is a client component, and the only one this milestone adds
 *
 * The ninth in the application, and the reason is the same one that justified
 * the seventh: a Server Component renders once per request and cannot notice
 * that 19:30 has arrived. A teacher who opens the workspace at 19:25 and waits
 * would otherwise sit in front of a tab that is already wrong, with no way to
 * find that out but a reload. So the countdown ticks, and at zero it calls
 * `router.refresh()` — a *server* re-render, which re-reads `starts_at`,
 * re-evaluates the rule on the server and draws the real sheet. The client does
 * not unlock anything; it asks the server to look again.
 *
 * ## It is seeded, so it is correct with JavaScript off
 *
 * `initialNow` is the server's own `Date.now()`, so the first client render is
 * byte-identical to the server's: no hydration mismatch, no flash of a
 * different number, and — with JavaScript switched off entirely — a correct
 * sentence that simply stops counting. The enhancement adds freshness and takes
 * nothing away, exactly as `components/calendar/now-line.tsx` does.
 *
 * ## The clock is an instant, never a wall clock
 *
 * `Date.now()` in a browser is the same instant as `Date.now()` on the server,
 * whatever zone either machine believes it is in, and `startsAt` is a
 * `timestamptz`. So no timezone arithmetic happens here and none is needed —
 * see `lib/attendance.ts`. `opensAtLabel` is the one thing that *did* need the
 * class's zone, and the server formatted it through `lib/time.ts` before
 * passing it down. A browser with a badly set clock can therefore be wrong
 * about the remaining minutes and still cannot be wrong about the write.
 */

/** Half a minute, matching the calendar's indicator. The label counts minutes. */
const TICK_MS = 30_000;

/** "Còn 2 ngày 3 giờ." / "Còn 2 giờ 15 phút." / "Còn 15 phút." */
function remainingText(ms: number): string {
  if (ms <= 0) return "Buổi học đang bắt đầu.";

  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `Còn ${minutes} phút.`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest === 0 ? `Còn ${hours} giờ.` : `Còn ${hours} giờ ${rest} phút.`;
  }

  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest === 0 ? `Còn ${days} ngày.` : `Còn ${days} ngày ${rest} giờ.`;
}

export function AttendanceLock({
  startsAt,
  opensAtLabel,
  initialNow,
}: {
  /** `class_sessions.starts_at`, the authoritative instant. */
  startsAt: string;
  /** When the lesson starts, already read on the class's clock by the server. */
  opensAtLabel: string;
  /** The server's `Date.now()`, so the first render agrees with the server's. */
  initialNow: number;
}) {
  const router = useRouter();
  const [now, setNow] = useState(initialNow);

  useEffect(() => {
    const opensAt = Date.parse(startsAt);
    if (Number.isNaN(opensAt)) return;

    let timer: ReturnType<typeof setTimeout>;

    const step = () => {
      const current = Date.now();
      setNow(current);

      if (current >= opensAt) {
        // The moment has passed — possibly before this even mounted, if the
        // page was rendered a second before the boundary. Ask the server for
        // the page again rather than revealing the sheet from here: the sheet
        // is server-rendered, and the server is the thing that decides.
        router.refresh();
        return;
      }

      // Never sleep past the boundary, so the refresh lands on the minute
      // rather than up to half a minute after it.
      timer = setTimeout(step, Math.min(opensAt - current, TICK_MS));
    };

    step();
    return () => clearTimeout(timer);
  }, [startsAt, router]);

  // The server has already decided this is locked; if the clock has moved on
  // while the tab sat open, say the lesson is starting rather than counting
  // backwards past zero. The refresh above is what actually resolves it.
  const remaining = isAttendanceOpen(startsAt, now)
    ? 0
    : Date.parse(startsAt) - now;

  return (
    <p className="mb-6 rounded-lg border border-border bg-track px-3.5 py-2.5 text-sm text-muted-foreground">
      {`Điểm danh sẽ mở khi buổi học bắt đầu ${opensAtLabel}. `}
      {remainingText(remaining)}
    </p>
  );
}
