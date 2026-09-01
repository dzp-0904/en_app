import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SessionDrag } from "@/components/calendar/session-drag";
import { WeekGrid, type ClassMeta } from "@/components/calendar/week-grid";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { PendingTint } from "@/components/ui/pending-tint";
import {
  CLASS_TONES,
  TONE_DOT,
  calendarZone,
  gridRange,
  loadTeacherWeek,
  nowIn,
  readWeekParam,
  shiftWeek,
  weekDays,
  weekLabel,
  type ClassTone,
} from "@/lib/calendar";
import { loadUserState } from "@/lib/onboarding";
import { createClient } from "@/lib/supabase/server";
import { tallyClassMembers } from "@/lib/teacher";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Lịch dạy",
};

/**
 * The teaching week — the Figma's `pages/teacher/Calendar.tsx`.
 *
 * This page used to draw the week as seven day cards, on the argument that the
 * Figma's absolutely positioned hour canvas is a desktop-only object that
 * cannot meet the zero-horizontal-scroll requirement at 320px. The premise was
 * right and the conclusion was wrong: the canvas does not have to reflow, it
 * has to *scroll*, and scrolling one card sideways is a treatment this
 * repository already ships in `components/ui/table.tsx`. The page never
 * overflows; the grid does, inside its own labelled region. So the canvas is
 * built, at the Figma's own geometry — see `components/calendar/week-grid.tsx`,
 * which holds the drawing and the reasoning behind each piece of it.
 *
 * WHAT THIS FILE DOES. It authorises, reads, and lays out the frame: the title
 * and month, the class legend, and the Today / left / right controls, all three
 * of which the Figma puts on one line to the right of the heading.
 *
 * STATE IS IN THE URL. `?week=` is a `YYYY-MM-DD` anchor and every control is a
 * `<Link>`, so the calendar pages backwards and forwards with JavaScript
 * disabled — the same rule the class-detail tabs follow. `readWeekParam`
 * validates it and falls back to the current week, because anyone can type
 * anything into a query string.
 *
 * TWO READS, ISSUED TOGETHER. The week and the roster tally go out in one
 * `Promise.all`, so the student count on a lesson block costs no extra
 * wall-clock. The class list itself is not read at all — M24 put it on
 * `TeacherContext` precisely so pages like this one would stop asking for it.
 *
 * M30 WRAPPED THE GRID, NOT REPLACED IT. `SessionDrag` is a client component
 * that adds four drag listeners and one hidden form around the same
 * server-rendered week; the grid, the columns and every lesson block are still
 * produced here, on the server, and every block is still a real `<a href>`. The
 * drag is an enhancement — with JavaScript off, `SessionDrag` renders its
 * children, one hint line and nothing else, and the calendar behaves exactly as
 * it did before. Moving a lesson without a pointer is the date and time form on
 * the session's own page, which the hint names.
 */

/** `?week=` is the only parameter, and it is validated before use. */
type CalendarSearchParams = Promise<{ week?: string | string[] }>;

function firstOf(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The Figma's joined arrow pair: two buttons sharing one rounded outline, with
 * a single rule between them. Hand-built rather than two `Button`s, because a
 * `Button` carries its own border and radius and there is no variant that means
 * "one half of a segmented control".
 */
const STEP =
  "relative flex items-center bg-card px-3 py-1.5 text-sm text-muted-foreground transition-colors outline-none hover:bg-track focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring";

export default async function TeacherCalendarPage({
  searchParams,
}: {
  searchParams: CalendarSearchParams;
}) {
  const state = await loadUserState();

  if (state.kind === "anonymous") {
    redirect("/auth/login");
  }

  if (state.kind !== "teacher") {
    redirect("/");
  }

  const supabase = await createClient();

  // The class list comes off the context rather than from a query of its own.
  // `loadUserState` already read it to classify the caller, and re-reading it
  // here cost this page a whole extra Supabase round trip — the single change
  // with the largest measured effect in M24. A failed read never reaches this
  // line: it is reported one layer up as an unplaceable account.
  const classes = state.teacher.classes;

  const zone = calendarZone(classes);
  const now = nowIn(zone);

  const params = await searchParams;
  const monday = readWeekParam(firstOf(params.week), now.date);
  const days = weekDays(monday);

  const [sessions, counts] = await Promise.all([
    loadTeacherWeek(supabase, classes, days),
    tallyClassMembers(
      supabase,
      classes.map((entry) => entry.classId),
    ),
  ]);

  // A class's colour is its position in the teacher's own list, so it is stable
  // between visits and between weeks.
  const tones = new Map<string, ClassTone>(
    classes.map((entry, index) => [
      entry.classId,
      CLASS_TONES[index % CLASS_TONES.length],
    ]),
  );

  // A failed tally is not worth an alert on a calendar — the count is the third
  // line of a lesson block, not the reason the page exists. It simply is not
  // printed, and the band still is.
  const meta = new Map<string, ClassMeta>(
    classes.map((entry) => [
      entry.classId,
      {
        studentCount: counts ? (counts.joined.get(entry.classId) ?? 0) : null,
        targetBand: entry.targetBand,
      },
    ]),
  );

  const { startHour, endHour } = gridRange(sessions ?? []);

  return (
    <PageShell width="5xl" align="start">
      <PageHeader
        title="Lịch dạy"
        breadcrumb={[
          { label: "Tổng quan", href: "/teacher" },
          { label: "Lịch dạy" },
        ]}
        meta={
          sessions !== null && sessions.length === 0 && classes.length > 0
            ? [weekLabel(days), "Tuần này chưa có buổi học nào"]
            : [weekLabel(days)]
        }
        actions={
          <>
            {/* The legend. The swatch is decorative — every block prints its
                class name too, so the colour is never the only carrier. */}
            {classes.length > 0 ? (
              <ul className="mr-2 flex max-w-xs min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                {classes.map((entry) => (
                  <li
                    key={entry.classId}
                    className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "size-2.5 shrink-0 rounded-full",
                        TONE_DOT[tones.get(entry.classId) ?? "primary"],
                      )}
                    />
                    <span className="truncate">{entry.className}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            <Button asChild variant="outline" size="sm" className="relative">
              <Link href="/teacher/calendar">
                Hôm nay
                <PendingTint />
              </Link>
            </Button>

            <div className="flex overflow-hidden rounded-lg border border-border">
              <Link
                href={`/teacher/calendar?week=${shiftWeek(monday, -1)}`}
                className={cn(STEP, "border-r border-border")}
              >
                <span aria-hidden>←</span>
                <span className="sr-only">Tuần trước</span>
                <PendingTint />
              </Link>

              <Link
                href={`/teacher/calendar?week=${shiftWeek(monday, 1)}`}
                className={STEP}
              >
                <span aria-hidden>→</span>
                <span className="sr-only">Tuần sau</span>
                <PendingTint />
              </Link>
            </div>
          </>
        }
      />

      {sessions === null ? (
        <Alert>
          Chúng tôi chưa tải được các buổi học trong tuần này. Vui lòng tải lại
          trang.
        </Alert>
      ) : classes.length === 0 ? (
        <EmptyState
          title="Bạn chưa tạo lớp học nào"
          description="Lịch dạy hiển thị các buổi học của những lớp bạn đang dạy."
          action={
            <Button asChild>
              <Link href="/teacher/new">Tạo lớp học</Link>
            </Button>
          }
        />
      ) : (
        // An empty week still gets its grid. A calendar that vanishes when
        // nothing is booked is not a calendar; the week is said in the header
        // instead, where the month already is.
        <SessionDrag>
          <WeekGrid
            days={days}
            sessions={sessions}
            tones={tones}
            meta={meta}
            zone={zone}
            today={now.date}
            nowMinutes={now.minutes}
            startHour={startHour}
            endHour={endHour}
          />
        </SessionDrag>
      )}
    </PageShell>
  );
}
