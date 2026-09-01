import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { LogoMark } from "@/components/brand/logo-mark";
import { TodoPanel } from "@/components/dashboard/todo-panel";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { PendingTint } from "@/components/ui/pending-tint";
import { SectionHeading } from "@/components/ui/section-heading";
import { StatCard } from "@/components/ui/stat-card";
import { calendarZone } from "@/lib/calendar";
import {
  loadTeacherDashboard,
  type DashboardClass,
  type DashboardMember,
} from "@/lib/dashboard";
import { isOnboardingComplete, loadUserState } from "@/lib/onboarding";
import type { PageSearchParams } from "@/lib/route-types";
import { MEMBER_STATUS_LABELS } from "@/lib/score";
import { createClient } from "@/lib/supabase/server";
import { loadTeacherTasks, taskClock } from "@/lib/teacher-tasks";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Tổng quan",
};

/**
 * The teacher's dashboard — the Figma's `pages/teacher/Dashboard.tsx`, rebuilt
 * in M32 against the updated design.
 *
 * The rule this page has carried since M22 has not changed: every number below
 * comes from somewhere. The strip's four figures are counts of rows the teacher
 * owns and of the two states `v_member_performance_status` computes; each class
 * row's student and improving counts are the same rows tallied per class; the
 * segments under a row are one per student, coloured by that student's own
 * standing. Nothing is averaged, estimated, or carried over from the mock.
 *
 * ## What the updated Figma changed, and what this did about each
 *
 * **The stat tiles became a compact strip.** Four `StatCard layout="inline"`
 * cards in one row rather than a 2×4 grid of tall tiles. The design's third and
 * fourth tiles are "Avg Homework 86%" and "Reports Due 6" — the second of which
 * is the literal number `6` in the Make source, and the first an average this
 * product has repeatedly declined to invent (`app/teacher/[classId]/page.tsx`
 * says so about the same figure). They keep the two real standings counts M22
 * put there, in the design's new shape.
 *
 * **Classes and To-do sit side by side.** `grid-cols-5` with the class list at
 * `col-span-3` and the To-do at `col-span-2`, exactly as the Figma lays them
 * out, stacking below `lg`.
 *
 * **The class list is sorted, paginated, and denser.** See `SORTING` below.
 * Five rows a page over `?page=`, which is a link and therefore works without
 * JavaScript and survives Back.
 *
 * **"Students Needing Attention" is gone from the design and kept here**, moved
 * to a full-width section beneath the two columns. It is backed by a real view
 * and shows real students; removing a working, data-backed feature because one
 * revision of a mock stopped drawing it is the thing decision **Y** already
 * refused for the student's fourth tab. The Figma's other dropped section,
 * "Recent Progress", was never built — it was always a four-item literal.
 *
 * The un-onboarded case is unchanged. A teacher who has not finished setup gets
 * no shell from `app/teacher/layout.tsx`, so this page carries the brand and
 * the wizard's centred column itself — and it has no dashboard to show, because
 * they have no class yet.
 */

/** The Figma's `CLASSES_PER_PAGE`. */
const PER_PAGE = 5;

/**
 * SORTING. Newest-starting class first, on a copy this page owns.
 *
 * The rows arrive on `TeacherContext.classes`, which is M24's single `classes`
 * read ordered `created_at` DESC, and they are shared with `/teacher/classes`,
 * `/teacher/lesson-logs`, `/teacher/reports`, `/teacher/tuition` and
 * `/teacher/calendar` — the last of which indexes `CLASS_TONES`
 * **positionally**, so reordering the shared query would recolour the calendar.
 * Decision **AG** settled this for M29 and the same answer holds: sort a
 * derived copy in the page, never the loader.
 *
 * `start_date` is the right definition of "latest" and it is not a guess. The
 * Figma sorts on `startDate` DESC; `/teacher/classes` has shown a
 * `start_date`-ordered table since M29; and it is the only column that says
 * when the teaching began, as against `created_at`, which says when the row was
 * typed — a class entered late for a course that started in June is not the
 * newest thing the teacher is doing. `end_date` orders by when something stops,
 * which puts a finished class above a running one, and the session data is
 * about individual lessons rather than the class.
 *
 * Both operands are `YYYY-MM-DD`, so they compare as strings — no `Date` is
 * constructed and `toISOString().slice(0, 10)` appears nowhere. The comparator
 * returns 0 for equal start dates on purpose: `Array.prototype.sort` is stable
 * and the rows arrive `created_at` DESC, so same-day starts keep
 * newest-created first for free. Do not replace it with one that breaks ties.
 */
function byStartDateDesc(a: DashboardClass, b: DashboardClass): number {
  if (a.startDate === b.startDate) return 0;
  return a.startDate < b.startDate ? 1 : -1;
}

/**
 * The strip under a class row: one segment per student, by standing.
 *
 * Steady is the Figma's `#E8E6DE` — the border grey, i.e. an unfilled segment.
 * It was indigo until M23, which made a student with nothing to report look
 * like the most emphasised thing on the card. The design fills a segment only
 * when the standing is news.
 */
const SEGMENT: Record<DashboardMember["status"], string> = {
  improving: "bg-green",
  stable: "bg-border",
  needs_attention: "bg-orange",
};

/**
 * The Figma's `BandBadge` thresholds, mapped onto this palette's badge tones.
 *
 * `>= 7` green, `>= 6` indigo, `>= 5.5` neutral, below that orange — the
 * design's own four steps. It is a *target*, so the colour says how ambitious
 * the class is, not how a student is doing.
 */
function bandTone(band: number): "green" | "primary" | "neutral" | "orange" {
  if (band >= 7) return "green";
  if (band >= 6) return "primary";
  if (band >= 5.5) return "neutral";
  return "orange";
}

/** `?page=` — 1-based, clamped, and silently forgiving of nonsense. */
function readPage(raw: string | string[] | undefined, pages: number): number {
  const value = typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isInteger(value)) return 1;
  return Math.min(Math.max(value, 1), Math.max(pages, 1));
}

export default async function TeacherPage({ searchParams }: PageSearchParams) {
  const state = await loadUserState();

  if (state.kind === "anonymous") {
    redirect("/auth/login");
  }

  // Students and unplaceable accounts are both `/`'s problem, not this page's.
  if (state.kind !== "teacher") {
    redirect("/");
  }

  const { fullName } = state.teacher;
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : undefined;

  // The same condition the layout uses to decide whether to draw the shell. A
  // teacher who has not finished setting up is not given it, and this page is
  // the only one under `/teacher` they can reach — so it carries the brand
  // itself rather than rendering with nothing at the top of it.
  const framed = isOnboardingComplete(state.teacher);

  const supabase = await createClient();

  // Both reads are independent of each other, so they cost one wall-clock trip
  // between them rather than two. The class rows come off the context —
  // `loadUserState` has already read them — so neither of these is re-fetching
  // a list the page was handed.
  const [dashboard, tasks] = await Promise.all([
    loadTeacherDashboard(supabase, state.teacher.classes),
    loadTeacherTasks(supabase, state.teacher.userId),
  ]);

  // "Today" for the to-do deadlines, on the same clock the calendar reads its
  // own today on (§7). `profiles` has no timezone column; `calendarZone` is the
  // answer this project already settled for exactly that gap.
  const { today, now } = taskClock(calendarZone(state.teacher.classes));

  const classes = dashboard?.classes ?? [];
  const sorted = [...classes].sort(byStartDateDesc);
  const pages = Math.max(1, Math.ceil(sorted.length / PER_PAGE));
  const page = readPage(params.page, pages);
  const from = (page - 1) * PER_PAGE;
  const visible = sorted.slice(from, from + PER_PAGE);

  return (
    // Start-aligned at the Figma's own width — its teacher screens hang from
    // the sidebar's edge rather than centring in the viewport. Without the
    // shell there is no edge to hang from, so the un-onboarded case keeps the
    // wizard's centred column and its own brand mark.
    <PageShell width={framed ? "5xl" : "lg"} align={framed ? "start" : "center"}>
      {framed ? null : <LogoMark className="mb-12" />}

      <PageHeader
        title={`Chào mừng trở lại, ${fullName}`}
        meta={
          framed
            ? ["Đây là tình hình học tập của học viên trong tháng này."]
            : undefined
        }
        actions={
          classes.length > 0 ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/teacher/new">Tạo lớp học</Link>
            </Button>
          ) : null
        }
      />

      {/* A Server Action's refusal comes back on `?error=`, which is what keeps
          the To-do panel free of client state. */}
      {error ? <Alert className="mb-5">{error}</Alert> : null}

      {dashboard === null ? (
        // Distinct from "no classes" on purpose: the query failed, and a
        // teacher told they have none would reasonably go and make another.
        <Alert>
          Chúng tôi chưa tải được tổng quan của bạn. Vui lòng tải lại trang.
        </Alert>
      ) : classes.length === 0 ? (
        <Card>
          <p className="mb-5 text-sm text-muted-foreground">
            Bạn chưa tạo lớp học nào.
          </p>
          <Button asChild>
            <Link href="/onboarding/class">Tạo lớp học đầu tiên</Link>
          </Button>
        </Card>
      ) : (
        <>
          {/* The Figma's compact strip. Two counts of rows the teacher owns and
              two of the states `v_member_performance_status` returns — no
              average, no estimate, nothing this page had to invent. It wraps
              rather than scrolling: four cards at 1280 and 1024, two apiece
              below that. */}
          <div className="mb-7 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              layout="inline"
              tone="primary"
              label="Lớp học đang dạy"
              value={classes.length}
            />
            <StatCard
              layout="inline"
              tone="primary"
              label="Học viên"
              value={dashboard.studentTotal}
            />
            <StatCard
              layout="inline"
              tone="green"
              label="Đang tiến bộ"
              value={dashboard.improvingTotal}
            />
            <StatCard
              layout="inline"
              tone="orange"
              label="Cần chú ý"
              value={dashboard.needsAttention.length}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-5">
            <section aria-labelledby="classes-heading" className="min-w-0 lg:col-span-3">
              <SectionHeading
                title={<span id="classes-heading">Lớp học của bạn</span>}
                action={
                  <Button asChild variant="link" size="inline">
                    <Link href="/teacher/classes">Xem tất cả</Link>
                  </Button>
                }
              />

              <ul className="space-y-2">
                {visible.map((entry) => (
                  <li key={entry.classId}>
                    {/* The Figma draws the whole row as one clickable card. It
                        is a real `<a>` here rather than a div with a handler,
                        so it is in the tab order, has an accessible name built
                        from its own text, and navigates without JavaScript. */}
                    <Link
                      href={`/teacher/${entry.classId}`}
                      className={cn(
                        "relative block rounded-xl border border-border bg-card px-4 py-3.5 transition-colors",
                        "hover:border-primary/30",
                        "focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                      )}
                    >
                      <PendingTint />

                      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                        <div className="min-w-0 grow basis-48">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm font-medium break-words text-foreground">
                              {entry.className}
                            </h3>

                            {entry.targetBand === null ? null : (
                              <Badge tone={bandTone(entry.targetBand)}>
                                {`IELTS ${entry.targetBand.toFixed(1)}`}
                              </Badge>
                            )}
                          </div>

                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {entry.scheduleNote ?? "Chưa đặt lịch học"}
                          </p>
                        </div>

                        <p className="shrink-0 text-xs text-muted-foreground">
                          {`${entry.studentCount} học viên`}
                          {entry.improvingCount > 0 ? (
                            <span className="text-green-dark">
                              {` · ${entry.improvingCount} đang tiến bộ`}
                            </span>
                          ) : null}
                        </p>
                      </div>

                      {/* The Figma's per-student strip. One segment per student
                          in the class, coloured by that student's own standing
                          — a picture of the roster rather than progress towards
                          anything. `aria-hidden` because the counts above
                          already say it in words. */}
                      {entry.members.length > 0 ? (
                        <div aria-hidden className="mt-2.5 flex gap-0.5">
                          {entry.members.map((member) => (
                            <span
                              key={member.membershipId}
                              className={cn(
                                "h-1 min-w-0 flex-1 rounded-full",
                                SEGMENT[member.status],
                              )}
                            />
                          ))}
                        </div>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>

              {/* Pagination is links, not state, so a page survives a refresh,
                  Back and Forward, and works with JavaScript off. Rendered only
                  when there is more than one page, exactly as the Figma. */}
              {pages > 1 ? (
                <nav
                  aria-label="Trang lớp học"
                  className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
                >
                  <p className="text-xs text-muted-foreground">
                    {`Hiển thị ${from + 1}–${from + visible.length} trong ${sorted.length} lớp học`}
                  </p>

                  <ul className="flex items-center gap-1">
                    {Array.from({ length: pages }, (_, index) => index + 1).map(
                      (number) => (
                        <li key={number}>
                          <Link
                            href={number === 1 ? "/teacher" : `/teacher?page=${number}`}
                            aria-current={number === page ? "page" : undefined}
                            className={cn(
                              "relative flex size-7 items-center justify-center rounded-lg text-xs font-medium transition-colors",
                              "focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                              number === page
                                ? "bg-primary text-primary-foreground"
                                : "border border-border bg-card text-muted-foreground hover:border-primary/40",
                            )}
                          >
                            <PendingTint />
                            {number}
                          </Link>
                        </li>
                      ),
                    )}
                  </ul>
                </nav>
              ) : null}
            </section>

            <div className="min-w-0 lg:col-span-2">
              <TodoPanel tasks={tasks} today={today} now={now} />
            </div>
          </div>

          {/* Dropped by the updated Figma, kept here and moved below the two
              columns. It is real: `v_member_performance_status` decides who is
              on it, and `class_members.focus_areas` is what the teacher
              themself wrote. Decision **Y**. */}
          <section aria-labelledby="attention-heading" className="mt-8">
            <SectionHeading
              title={<span id="attention-heading">Học viên cần chú ý</span>}
            />

            {dashboard.needsAttention.length === 0 ? (
              <EmptyState
                title="Tất cả học viên đều ổn"
                description="Chưa có học viên nào bị đánh dấu cần chú ý."
              />
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {dashboard.needsAttention.map((member) => (
                  <li key={member.membershipId}>
                    <Card variant="list" className="h-full">
                      <div className="flex items-start gap-3">
                        <span
                          aria-hidden
                          className="mt-1.5 size-2 shrink-0 rounded-full bg-orange"
                        />

                        <div className="min-w-0">
                          <h3 className="font-medium break-words text-foreground">
                            {member.name ?? "Học viên chưa đặt tên"}
                          </h3>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {member.className}
                          </p>

                          <p className="mt-2 text-xs text-muted-foreground">
                            {`Kết quả: ${MEMBER_STATUS_LABELS[member.status]}`}
                            {member.currentOverall === null
                              ? null
                              : ` · Band hiện tại ${member.currentOverall.toFixed(1)}`}
                          </p>

                          {/* `class_members.focus_areas` — what the teacher
                              themself wrote this student is working on. The
                              Figma printed a mock "Issue:" line here; this is
                              the column that actually holds one. */}
                          {member.focusAreas.length > 0 ? (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {`Cần cải thiện: ${member.focusAreas.join(", ")}`}
                            </p>
                          ) : null}

                          <Button
                            asChild
                            variant="link"
                            size="inline"
                            className="mt-3 text-xs"
                          >
                            <Link
                              href={`/teacher/${member.classId}?student=${member.membershipId}`}
                            >
                              Xem học viên
                            </Link>
                          </Button>
                        </div>
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </PageShell>
  );
}
