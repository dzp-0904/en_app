import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
import {
  CLASS_TONES,
  TONE_BLOCK,
  TONE_DOT,
  WEEKDAY_LABELS,
  calendarZone,
  dayLabel,
  loadTeacherWeek,
  readWeekParam,
  shiftWeek,
  todayIn,
  weekDays,
  weekLabel,
  type ClassTone,
} from "@/lib/calendar";
import { loadUserState } from "@/lib/onboarding";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Lịch dạy",
};

/**
 * The teaching week — the Figma's `pages/teacher/Calendar.tsx`.
 *
 * WHAT IS FAITHFUL. The week strip with its month heading and the ← / Hôm nay /
 * → controls, the per-class legend with a coloured swatch each, seven day
 * columns with today marked, and lesson blocks carrying a left colour bar, the
 * time, the class and the title. All of it is the Figma's arrangement.
 *
 * WHAT DELIBERATELY IS NOT. The Figma draws its week as an absolutely
 * positioned canvas: a `grid-cols-[56px_repeat(7,1fr)]` frame sixteen hours
 * tall at 64px an hour, with every event placed by `top`/`height` computed from
 * its minutes. That is a desktop-only object. At 390px each column is 47px
 * wide, which is narrower than the word "IELTS", and it cannot reflow because
 * absolute positions do not wrap — the milestone's own requirement is zero
 * page-level horizontal scrolling down to 320px, and a pixel canvas cannot meet
 * it without either shrinking the type or scrolling the page sideways.
 *
 * So the hour canvas becomes a seven-column agenda: the same week, the same
 * blocks, the same colours, ordered by time within each day, with the time
 * printed on the block instead of implied by its vertical position. Below `lg`
 * the seven columns become seven stacked days, which is what a phone can
 * actually show. Nothing is dropped; the information the `top` offset carried
 * is written down instead.
 *
 * STATE IS IN THE URL. `?week=` is a `YYYY-MM-DD` anchor and the three controls
 * are `<Link>`s, so the calendar pages backwards and forwards with JavaScript
 * disabled — the same rule the class-detail tabs follow. `readWeekParam`
 * validates it and falls back to the current week, because anyone can type
 * anything into a query string.
 */

/** `?week=` is the only parameter, and it is validated before use. */
type CalendarSearchParams = Promise<{ week?: string | string[] }>;

function firstOf(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

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
  const today = todayIn(zone);

  const params = await searchParams;
  const monday = readWeekParam(firstOf(params.week), today);
  const days = weekDays(monday);

  const sessions = await loadTeacherWeek(supabase, classes, days);

  // A class's colour is its position in the teacher's own list, so it is stable
  // between visits and between weeks.
  const tones = new Map<string, ClassTone>(
    classes.map((entry, index) => [
      entry.classId,
      CLASS_TONES[index % CLASS_TONES.length],
    ]),
  );

  const byDay = new Map<string, NonNullable<typeof sessions>>();
  for (const session of sessions ?? []) {
    const bucket = byDay.get(session.date);
    if (bucket) bucket.push(session);
    else byDay.set(session.date, [session]);
  }

  return (
    <PageShell width="5xl" align="start">
      <PageHeader
        title="Lịch dạy"
        breadcrumb={[
          { label: "Tổng quan", href: "/teacher" },
          { label: "Lịch dạy" },
        ]}
        meta={[weekLabel(days)]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/teacher/calendar?week=${shiftWeek(monday, -1)}`}>
                <span aria-hidden className="mr-1">
                  ←
                </span>
                Tuần trước
              </Link>
            </Button>

            <Button asChild variant="outline" size="sm">
              <Link href="/teacher/calendar">Hôm nay</Link>
            </Button>

            <Button asChild variant="outline" size="sm">
              <Link href={`/teacher/calendar?week=${shiftWeek(monday, 1)}`}>
                Tuần sau
                <span aria-hidden className="ml-1">
                  →
                </span>
              </Link>
            </Button>
          </div>
        }
      />

      {/* The Figma's legend. The swatch is decorative — every block prints its
          class name too, so the colour is never the only carrier. */}
      {classes.length > 0 ? (
        <ul className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2">
          {classes.map((entry) => (
            <li
              key={entry.classId}
              className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground"
            >
              <span
                aria-hidden
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  TONE_DOT[tones.get(entry.classId) ?? "primary"],
                )}
              />
              <span className="truncate">{entry.className}</span>
            </li>
          ))}
        </ul>
      ) : null}

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
      ) : sessions.length === 0 ? (
        <EmptyState
          title="Tuần này chưa có buổi học nào"
          description="Mở một lớp học để tạo buổi học, hoặc chuyển sang tuần khác."
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-7 lg:gap-2">
          {days.map((day, index) => {
            const lessons = byDay.get(day) ?? [];
            const isToday = day === today;

            return (
              <section
                key={day}
                aria-label={`${WEEKDAY_LABELS[index]}, ${dayLabel(day)}`}
                className={cn(
                  "min-w-0 rounded-xl border p-3",
                  isToday
                    ? "border-primary/40 bg-secondary"
                    : "border-border bg-card",
                )}
              >
                <h2 className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    {WEEKDAY_LABELS[index]}
                  </span>
                  <span
                    className={cn(
                      "text-sm font-semibold",
                      isToday ? "text-primary-hover" : "text-foreground",
                    )}
                  >
                    {dayLabel(day)}
                  </span>
                  {isToday ? (
                    <span className="text-xs text-primary-hover">Hôm nay</span>
                  ) : null}
                </h2>

                {lessons.length === 0 ? (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Không có buổi học
                  </p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {lessons.map((lesson) => (
                      <li key={lesson.sessionId}>
                        <Link
                          href={`/teacher/${lesson.classId}/sessions/${lesson.sessionId}`}
                          className={cn(
                            "block rounded-lg border-l-[3px] px-2 py-1.5 transition-opacity outline-none hover:opacity-80 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                            TONE_BLOCK[tones.get(lesson.classId) ?? "primary"],
                            // A cancelled lesson still happened in the
                            // teacher's week and is still worth seeing, so it
                            // is shown and marked rather than hidden.
                            lesson.status === "cancelled" && "opacity-60",
                          )}
                        >
                          <p className="text-xs font-semibold">
                            {`${lesson.startTime}–${lesson.endTime}`}
                          </p>
                          <p className="mt-0.5 text-xs font-medium break-words">
                            {lesson.className}
                          </p>
                          {lesson.title ? (
                            <p className="mt-0.5 text-xs break-words opacity-80">
                              {lesson.title}
                            </p>
                          ) : null}
                          {lesson.status === "cancelled" ? (
                            <p className="mt-0.5 text-xs font-medium">Đã hủy</p>
                          ) : null}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
