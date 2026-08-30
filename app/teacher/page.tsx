import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { LogoMark } from "@/components/brand/logo-mark";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { SectionHeading } from "@/components/ui/section-heading";
import { StatCard } from "@/components/ui/stat-card";
import { loadTeacherDashboard, type DashboardMember } from "@/lib/dashboard";
import { isOnboardingComplete, loadUserState } from "@/lib/onboarding";
import { MEMBER_STATUS_LABELS } from "@/lib/score";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Tổng quan",
};

/**
 * The teacher's dashboard — the Figma's `pages/teacher/Dashboard.tsx`.
 *
 * This page used to be the class list, and carried a comment saying it was "not
 * a dashboard and reports on nothing", because "a number on this page would
 * have to come from somewhere". That was the right rule and it has not changed;
 * what changed is that every number below now comes from somewhere. The four
 * tiles are counts of rows the teacher owns and of the two performance states
 * `v_member_performance_status` computes; the class cards' student and
 * improving counts are the same rows tallied per class; the strip under each
 * card is one segment per student, coloured by that student's own standing.
 * Nothing is averaged, estimated, or carried over from the mock.
 *
 * WHAT THE FIGMA HAS AND THIS DOES NOT. Its right-hand column ends in a "Recent
 * Progress" feed, which is a literal four-item array in the Make source. There
 * is no activity table in this schema and no `updated_at` sweep would mean the
 * same thing, so it is not built — see `lib/dashboard.ts`. Its third and fourth
 * tiles ("Avg Homework 86%", "Reports Due 6") are replaced by two figures the
 * views actually return, for the same reason.
 *
 * The full class list moved to `/teacher/classes`, which is the sidebar's
 * second row. This page keeps the Figma's own arrangement: the four most recent
 * classes beside the students who need attention, with a link to the rest.
 *
 * The un-onboarded case is unchanged. A teacher who has not finished setup gets
 * no shell from `app/teacher/layout.tsx`, so this page carries the brand and
 * the wizard's centred column itself — and it has no dashboard to show, because
 * they have no class yet.
 */

/** How many classes the dashboard shows before deferring to `/teacher/classes`. */
const PREVIEW = 4;

/**
 * The strip under a class card: one segment per student, by standing.
 *
 * Steady is the Figma's `#E8E6DE` — the border grey, i.e. an unfilled segment.
 * It was indigo until M23, which made a student with nothing to report look
 * like the most emphasised thing on the card and left the strip with three
 * saturated colours competing. The design fills a segment only when the
 * standing is news.
 */
const SEGMENT: Record<DashboardMember["status"], string> = {
  improving: "bg-green",
  stable: "bg-border",
  needs_attention: "bg-orange",
};

export default async function TeacherPage() {
  const state = await loadUserState();

  if (state.kind === "anonymous") {
    redirect("/auth/login");
  }

  // Students and unplaceable accounts are both `/`'s problem, not this page's.
  if (state.kind !== "teacher") {
    redirect("/");
  }

  const { fullName } = state.teacher;

  // The same condition the layout uses to decide whether to draw the shell. A
  // teacher who has not finished setting up is not given it, and this page is
  // the only one under `/teacher` they can reach — so it carries the brand
  // itself rather than rendering with nothing at the top of it.
  const framed = isOnboardingComplete(state.teacher);

  const supabase = await createClient();
  // The class rows come off the context — `loadUserState` has already read
  // them — so the dashboard starts at its own queries instead of spending a
  // round trip re-fetching a list it was handed.
  const dashboard = await loadTeacherDashboard(supabase, state.teacher.classes);

  const classes = dashboard?.classes ?? [];
  const preview = classes.slice(0, PREVIEW);

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
          {/* The Figma's four tiles. Two counts of rows the teacher owns and
              two of the states `v_member_performance_status` returns — no
              average, no estimate, nothing this page had to invent. */}
          <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              tone="primary"
              label="Lớp học đang dạy"
              value={classes.length}
            />
            <StatCard
              tone="primary"
              label="Học viên"
              value={dashboard.studentTotal}
            />
            <StatCard
              tone="green"
              label="Đang tiến bộ"
              value={dashboard.improvingTotal}
            />
            <StatCard
              tone="orange"
              label="Cần chú ý"
              value={dashboard.needsAttention.length}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <section className="min-w-0 lg:col-span-2">
              <SectionHeading
                title="Lớp học của bạn"
                action={
                  <Button asChild variant="link" size="inline">
                    <Link href="/teacher/classes">Xem tất cả</Link>
                  </Button>
                }
              />

              <ul className="space-y-3">
                {preview.map((entry) => (
                  <li key={entry.classId}>
                    <Card variant="list">
                      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                        <div className="min-w-0 grow basis-48">
                          <h3 className="font-semibold break-words text-foreground">
                            {entry.className}
                          </h3>

                          {entry.scheduleNote ? (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {entry.scheduleNote}
                            </p>
                          ) : null}
                        </div>

                        {entry.targetBand === null ? null : (
                          <div className="shrink-0 text-right">
                            <p className="text-xs text-muted-foreground">
                              Band mục tiêu
                            </p>
                            <Badge tone="primary" className="mt-1">
                              {`IELTS ${entry.targetBand.toFixed(1)}`}
                            </Badge>
                          </div>
                        )}
                      </div>

                      <p className="mt-3 text-sm text-muted-foreground">
                        {`${entry.studentCount} học viên`}
                        {entry.improvingCount > 0
                          ? ` · ${entry.improvingCount} đang tiến bộ`
                          : null}
                      </p>

                      {/* The Figma's per-student strip. One segment per
                          student in the class, coloured by that student's own
                          standing — so it is a picture of the roster rather
                          than a progress bar towards anything. `aria-hidden`
                          because the counts above already say it in words. */}
                      {entry.members.length > 0 ? (
                        <div aria-hidden className="mt-3 flex gap-0.5">
                          {entry.members.map((member) => (
                            <span
                              key={member.membershipId}
                              className={cn(
                                "h-1.5 min-w-0 flex-1 rounded-full",
                                SEGMENT[member.status],
                              )}
                            />
                          ))}
                        </div>
                      ) : null}

                      <Button
                        asChild
                        variant="outline"
                        size="sm"
                        className="mt-4"
                      >
                        <Link href={`/teacher/${entry.classId}`}>Mở lớp</Link>
                      </Button>
                    </Card>
                  </li>
                ))}
              </ul>
            </section>

            <section className="min-w-0">
              <SectionHeading title="Học viên cần chú ý" />

              {dashboard.needsAttention.length === 0 ? (
                <EmptyState
                  title="Tất cả học viên đều ổn"
                  description="Chưa có học viên nào bị đánh dấu cần chú ý."
                />
              ) : (
                <ul className="space-y-3">
                  {dashboard.needsAttention.map((member) => (
                    <li key={member.membershipId}>
                      <Card variant="list">
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
                                Figma prints a mock "Issue:" line here; this is
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
          </div>
        </>
      )}
    </PageShell>
  );
}
