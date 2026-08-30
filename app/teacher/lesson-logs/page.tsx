import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterPills, type FilterPillItem } from "@/components/ui/filter-pills";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
import {
  PERFORMANCE_LABELS,
  SKILLS,
  SKILL_LABELS,
  isSkill,
  type Performance,
  type Skill,
} from "@/lib/lesson-log";
import {
  LESSON_LOG_PAGE_SIZE,
  loadTeacherLessonLogs,
} from "@/lib/lesson-logs";
import { loadUserState } from "@/lib/onboarding";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/teacher";

export const metadata: Metadata = {
  title: "Nhật ký buổi học",
};

/**
 * Every lesson note the teacher has written — the Figma's
 * `pages/teacher/LessonLogs.tsx`.
 *
 * The same `lesson_logs` rows the session page shows one lesson at a time, read
 * across every class in reverse chronological order. This is a reading screen:
 * the Figma pairs the list with an inline "+ Add Lesson Note" form, and writing
 * a note already has a home — `/teacher/[classId]/sessions/[sessionId]`, where
 * the note is attached to the lesson it is about and the roster it applies to
 * is already loaded. A second form here would be a second write path to the
 * same table with a different idea of which session a note belongs to, so the
 * "add" control links to the class list instead of duplicating it.
 *
 * The Figma's card is reproduced: the date and skill on one line, the topic
 * under it, the performance as a pill, the mistake tags as chips, and the note
 * itself quoted on the tinted surface. `mistakes` is `text[] not null default
 * '{}'` — an empty array is a real answer and renders as no chips.
 *
 * FILTERS ARE LINKS, NOT STATE. `?class=` and `?skill=` are query parameters
 * rendered as `FilterPills`, so the list narrows with JavaScript disabled.
 * `?class=` is validated against the teacher's own classes before it reaches
 * the query and `?skill=` against `public.skill`; underneath,
 * `lesson_logs_teacher_all` admits only `app.my_class_ids()` whatever arrives.
 */

const DATE = new Intl.DateTimeFormat("vi-VN", {
  weekday: "long",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  // `lesson_date` is a `date` — a calendar square already resolved onto the
  // class's clock when it was written. It is read back at UTC midnight, not
  // reinterpreted in another zone. See `lib/time.ts`.
  timeZone: "UTC",
});

/** Performance tones, matching `Badge`'s documented mapping. */
const PERFORMANCE_TONE: Record<
  Performance,
  "green" | "primary" | "orange" | "destructive"
> = {
  excellent: "green",
  good: "primary",
  developing: "orange",
  needs_attention: "destructive",
};

type LessonLogSearchParams = Promise<{
  class?: string | string[];
  skill?: string | string[];
}>;

function firstOf(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Rebuilds the query string with one parameter changed. */
function hrefWith(
  current: { classId: string | null; skill: Skill | null },
  change: Partial<{ classId: string | null; skill: Skill | null }>,
): string {
  const next = { ...current, ...change };
  const params = new URLSearchParams();

  if (next.classId) params.set("class", next.classId);
  if (next.skill) params.set("skill", next.skill);

  const query = params.toString();
  return query ? `/teacher/lesson-logs?${query}` : "/teacher/lesson-logs";
}

export default async function TeacherLessonLogsPage({
  searchParams,
}: {
  searchParams: LessonLogSearchParams;
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

  const params = await searchParams;

  const rawClass = firstOf(params.class);
  const rawSkill = firstOf(params.skill);

  // A malformed id is not a database error waiting to happen: it is simply not
  // a filter. `isUuid` is the same predicate the class routes use.
  const classId =
    rawClass && isUuid(rawClass) && classes.some((one) => one.classId === rawClass)
      ? rawClass
      : null;

  const skill = rawSkill && isSkill(rawSkill) ? rawSkill : null;

  const logs = await loadTeacherLessonLogs(supabase, classes, {
    classId,
    skill,
  });

  const selected = { classId, skill };

  const classPills: FilterPillItem[] = [
    {
      label: "Tất cả lớp",
      href: hrefWith(selected, { classId: null }),
      current: classId === null,
    },
    ...(classes ?? []).map((entry) => ({
      label: entry.className,
      href: hrefWith(selected, { classId: entry.classId }),
      current: classId === entry.classId,
    })),
  ];

  const skillPills: FilterPillItem[] = [
    {
      label: "Tất cả kỹ năng",
      href: hrefWith(selected, { skill: null }),
      current: skill === null,
    },
    ...SKILLS.map((one) => ({
      label: SKILL_LABELS[one],
      href: hrefWith(selected, { skill: one }),
      current: skill === one,
    })),
  ];

  return (
    <PageShell width="4xl" align="start">
      <PageHeader
        title="Nhật ký buổi học"
        breadcrumb={[
          { label: "Tổng quan", href: "/teacher" },
          { label: "Nhật ký buổi học" },
        ]}
        meta={
          logs && logs.length > 0 ? [`${logs.length} ghi chú`] : undefined
        }
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/teacher/classes">Mở lớp để thêm ghi chú</Link>
          </Button>
        }
      />

      {logs === null ? (
        <Alert>
          Chúng tôi chưa tải được ghi chú buổi học. Vui lòng tải lại trang.
        </Alert>
      ) : classes.length === 0 ? (
        <EmptyState
          title="Bạn chưa tạo lớp học nào"
          description="Ghi chú buổi học được viết trong từng buổi học của một lớp."
          action={
            <Button asChild>
              <Link href="/teacher/new">Tạo lớp học</Link>
            </Button>
          }
        />
      ) : (
        <>
          <div className="mb-6 space-y-3">
            <FilterPills items={classPills} label="Lọc theo lớp học" />
            <FilterPills items={skillPills} label="Lọc theo kỹ năng" />
          </div>

          {logs.length === 0 ? (
            <EmptyState
              title="Chưa có ghi chú nào"
              description={
                classId || skill
                  ? "Không có ghi chú nào khớp với bộ lọc đang chọn."
                  : "Mở một buổi học của lớp để viết ghi chú đầu tiên."
              }
            />
          ) : (
            <ul className="space-y-3">
              {logs.map((log) => (
                <li key={log.logId}>
                  <Card variant="list">
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                      <div className="min-w-0 grow basis-64">
                        <p className="text-xs text-muted-foreground">
                          {`${DATE.format(new Date(`${log.lessonDate}T00:00:00Z`))} · ${SKILL_LABELS[log.skill]}`}
                        </p>

                        <h2 className="mt-1 font-semibold break-words text-foreground">
                          {log.topic}
                        </h2>

                        <p className="mt-0.5 text-sm text-muted-foreground">
                          {`${log.studentName ?? "Học viên chưa đặt tên"} · ${log.className}`}
                        </p>
                      </div>

                      <Badge
                        tone={PERFORMANCE_TONE[log.performance]}
                        className="shrink-0"
                      >
                        {PERFORMANCE_LABELS[log.performance]}
                      </Badge>
                    </div>

                    {/* Mistake labels are copied by value into `mistakes`, not
                        referenced — the migration says so — so these are the
                        words written on the day, not today's tag list. */}
                    {log.mistakes.length > 0 ? (
                      <ul className="mt-3 flex flex-wrap gap-1.5">
                        {log.mistakes.map((mistake) => (
                          <li key={mistake}>
                            <span className="inline-block rounded-full bg-orange-light px-2.5 py-1 text-xs font-medium text-orange-dark">
                              {mistake}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {log.note ? (
                      <p className="mt-3 rounded-lg bg-background p-3 text-sm break-words whitespace-pre-wrap text-muted-foreground italic">
                        {log.note}
                      </p>
                    ) : null}

                    <Button
                      asChild
                      variant="link"
                      size="inline"
                      className="mt-3 text-xs"
                    >
                      <Link
                        href={`/teacher/${log.classId}?student=${log.membershipId}`}
                      >
                        Xem học viên
                      </Link>
                    </Button>
                  </Card>
                </li>
              ))}
            </ul>
          )}

          {logs.length === LESSON_LOG_PAGE_SIZE ? (
            <p className="mt-4 text-xs text-muted-foreground">
              {`Đang hiển thị ${LESSON_LOG_PAGE_SIZE} ghi chú gần nhất. Hãy lọc theo lớp học hoặc kỹ năng để thu hẹp danh sách.`}
            </p>
          ) : null}
        </>
      )}
    </PageShell>
  );
}
