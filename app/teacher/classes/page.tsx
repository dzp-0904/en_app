import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { PendingTint } from "@/components/ui/pending-tint";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LABELS } from "@/lib/course-type";
import { loadUserState } from "@/lib/onboarding";
import { createClient } from "@/lib/supabase/server";
import { loadTeacherClasses, type TeacherClass } from "@/lib/teacher";
import { zonedCalendarDate } from "@/lib/time";

export const metadata: Metadata = {
  title: "Lớp học",
};

/**
 * Every class the teacher has, as one table.
 *
 * The list that used to be `/teacher`. It moved when that page became the
 * Figma's Dashboard, which shows only the first few classes and links here for
 * the rest — the same split the Figma's own sidebar draws by naming "Dashboard"
 * and "Classes" as two destinations.
 *
 * `/teacher/classes` sits beside `/teacher/[classId]` in the routing table, and
 * a static segment wins over a dynamic one in Next.js, so this page is reached
 * and no class is shadowed: `classId` is a uuid and "classes" is not one, which
 * `isUuid` already refuses on the detail page.
 *
 * M29 rebuilt it from a card list into the six-column table below. The Figma
 * has no `Classes.tsx` (decision **T**), so there was no mock to be faithful
 * to; the table is the repository's own `components/ui/table.tsx` — the same
 * card, header row, hairlines and hover the roster and the tuition ledger use —
 * carrying the six columns the milestone asked for and nothing else.
 *
 * Every value on it was already in memory. `loadUserState` reads the class rows
 * once (M24), `loadTeacherClasses` adds the roster tally, and the six columns
 * are `name`, this file's `DELIVERY_MODE` constant, `start_date`/`end_date`, a
 * status derived from those two dates, the tally, and `schedule_note`. **No
 * second `classes` query was added.**
 */

/**
 * "Loại lớp" for every row.
 *
 * M29 asked for an Online / Offline column. There is no column behind it:
 * `public.classes` carries no delivery mode, `public.course_type` is the
 * *subject* (`ielts | general_english | academic_english | other`),
 * `components/class/class-form.tsx` never asks, and the only adjacent column in
 * all fifteen migrations is `class_sessions.location` — nullable free text on
 * an individual session rather than a property of the class. Asked rather than
 * guessed, the teacher answered that the value has exactly one possibility:
 * every class here is taught online.
 *
 * So this is a stated product fact, and it is written here as one constant
 * rather than smuggled into a loader as though it had been read from a row. The
 * day a class meets in a room, this is not the thing to edit: `classes` needs a
 * real column, the class form needs to ask for it, and the existing rows need a
 * backfill decision. Until then the column tells the truth about every class in
 * the table.
 */
const DELIVERY_MODE = "Online";

/** The three states of "Tiến độ học", and the tone each is drawn in. */
type Progress = {
  label: string;
  tone: "primary" | "green" | "neutral";
};

/**
 * Where a class is in its own life, derived from its two date columns and
 * nothing else.
 *
 * Derived on purpose. A stored status would have to be written by something,
 * and nothing here runs on the day a course starts or ends, so the row would be
 * wrong for as long as nobody opened the class. Two dates and today's date
 * cannot go stale.
 *
 * All three arguments are `YYYY-MM-DD` — `start_date` and `end_date` are `date`
 * columns and `today` comes from `zonedCalendarDate` — so `<` and `>` compare
 * calendar days, in order, without constructing a `Date` at all.
 *
 * `end_date` is nullable (`classes_end_after_start` allows it), and an
 * open-ended course is never "Kết thúc": it has started and has not been given
 * a last day, which is exactly "Đang diễn ra".
 *
 * Both edges are inclusive, as the milestone specified: a class is running on
 * its first day and still running on its last.
 */
function progressOf(
  today: string,
  startDate: string,
  endDate: string | null,
): Progress {
  if (today < startDate) return { label: "Sắp tới", tone: "primary" };
  if (endDate !== null && today > endDate) {
    return { label: "Kết thúc", tone: "neutral" };
  }
  return { label: "Đang diễn ra", tone: "green" };
}

/**
 * Newest cohort first, by the day the class starts.
 *
 * Sorted here rather than in `loadTeacherClassList` deliberately. That loader
 * *is* M24's single `classes` read, and its rows are `TeacherContext.classes` —
 * shared with the dashboard, the calendar and the three pages whose class
 * filter pills are drawn in list order, and indexed positionally by
 * `CLASS_TONES` on `/teacher/calendar`. Moving its `ORDER BY` would reorder and
 * recolour five pages this milestone was told not to modify, and the only way
 * to sort in the database without doing that is a second `classes` query, which
 * it was also told not to add. These are one teacher's own unarchived classes,
 * already in memory, so the comparator costs nothing worth measuring.
 *
 * The tie-break is free: `Array.prototype.sort` is stable, and the array
 * arrives from that loader in `created_at` descending order, so two classes
 * starting on the same day stay newest-created first — the ordering the rest of
 * the application already uses.
 */
function byStartDateDesc(a: TeacherClass, b: TeacherClass): number {
  if (a.startDate === b.startDate) return 0;
  return a.startDate < b.startDate ? 1 : -1;
}

/**
 * `start_date` and `end_date` are `date` columns — calendar squares, not
 * instants — so they are read at UTC midnight and formatted there. See
 * `lib/time.ts` for the instants, which are a different problem: a `date` has
 * no time of day to move across a zone boundary, and putting one through a
 * timezone is how you print the wrong day.
 */
const DATE = new Intl.DateTimeFormat("vi-VN", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});

function formatDate(isoDate: string): string {
  return DATE.format(new Date(`${isoDate}T00:00:00Z`));
}

export default async function TeacherClassesPage() {
  const state = await loadUserState();

  if (state.kind === "anonymous") {
    redirect("/auth/login");
  }

  if (state.kind !== "teacher") {
    redirect("/");
  }

  const supabase = await createClient();
  // `loadUserState` has already read the class rows; only the roster tally is
  // still outstanding, so that is all this asks for.
  const classes = await loadTeacherClasses(supabase, state.teacher.classes);

  // One instant for the whole page, so every row is judged against the same
  // moment — and converted per class, because each class carries its own
  // `timezone` and "today" is not the same day everywhere at once.
  const now = new Date().toISOString();

  const rows = classes === null ? null : [...classes].sort(byStartDateDesc);

  return (
    // `min-w-0` is load-bearing, not tidying. `PageShell` renders `flex-1` on
    // its `<main>`, and from `lg` up `AppShell` lays the sidebar and that main
    // out as a flex *row* — where a flex item's `min-width` defaults to `auto`,
    // so it never shrinks below its content's minimum. The table below sets a
    // `min-width`, so at exactly 1024px the main refused to narrow, the scroller
    // never got the chance to scroll, and the whole document went 135px wide.
    // Measured, then fixed here rather than in the primitive: no other page has
    // content with an intrinsic minimum, so this is the one that needs it.
    <PageShell width="5xl" align="start" className="min-w-0">
      <PageHeader
        title="Lớp học"
        breadcrumb={[
          { label: "Tổng quan", href: "/teacher" },
          { label: "Lớp học" },
        ]}
        meta={
          rows && rows.length > 0
            ? [`${rows.length} lớp học đang hoạt động`]
            : undefined
        }
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/teacher/new">Tạo lớp học</Link>
          </Button>
        }
      />

      {rows === null ? (
        <Alert>
          Chúng tôi chưa tải được danh sách lớp học của bạn. Vui lòng tải lại
          trang.
        </Alert>
      ) : rows.length === 0 ? (
        <EmptyState
          title="Bạn chưa tạo lớp học nào"
          description="Tạo lớp học đầu tiên để bắt đầu theo dõi tiến bộ của học viên."
          action={
            <Button asChild>
              <Link href="/teacher/new">Tạo lớp học</Link>
            </Button>
          }
        />
      ) : (
        // Six columns do not fit a phone, and a bare `<table>` would widen the
        // document until the whole page scrolled sideways. `Table` puts it in
        // its own labelled, focusable `overflow-x-auto` region instead — the
        // treatment the roster, the calendar and the report table already use —
        // so the columns keep a readable width and the page never scrolls.
        <Table label="Danh sách lớp học" className="min-w-[52rem]">
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[13rem]">Tên lớp</TableHead>
              <TableHead>Loại lớp</TableHead>
              <TableHead className="whitespace-nowrap">
                Khai giảng - Kết thúc
              </TableHead>
              <TableHead className="whitespace-nowrap">Tiến độ học</TableHead>
              <TableHead>Sĩ số</TableHead>
              <TableHead className="min-w-[11rem]">Lịch học</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {rows.map((entry) => {
              const progress = progressOf(
                zonedCalendarDate(entry.timezone, now),
                entry.startDate,
                entry.endDate,
              );

              return (
                <TableRow key={entry.classId}>
                  <TableCell className="align-top">
                    {/* The class name is the row's navigation target. A whole
                        clickable row would swallow anything added to the table
                        later and gives a keyboard and a screen reader nothing
                        to find; a link named after the class gives both the
                        destination in its own words. */}
                    <Link
                      href={`/teacher/${entry.classId}`}
                      className="relative inline-block rounded-sm font-semibold break-words text-foreground hover:text-primary focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      {entry.className}
                      <PendingTint />
                    </Link>

                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {entry.courseType === "other"
                        ? (entry.courseTypeOther ?? "Khác")
                        : LABELS[entry.courseType]}
                      {entry.targetBand === null
                        ? null
                        : ` · Band mục tiêu ${entry.targetBand.toFixed(1)}`}
                    </p>
                  </TableCell>

                  <TableCell className="align-top whitespace-nowrap">
                    {DELIVERY_MODE}
                  </TableCell>

                  <TableCell className="align-top whitespace-nowrap tabular-nums">
                    {`${formatDate(entry.startDate)} - ${
                      entry.endDate ? formatDate(entry.endDate) : "Chưa đặt"
                    }`}
                  </TableCell>

                  <TableCell className="align-top">
                    {/* The state is the badge's own text, so it survives
                        greyscale, a screen reader and a colour-blind reader —
                        the tint only repeats what the word already says. */}
                    <Badge tone={progress.tone} className="whitespace-nowrap">
                      {progress.label}
                    </Badge>
                  </TableCell>

                  <TableCell className="align-top tabular-nums">
                    {entry.studentCount}
                    {entry.pendingCount > 0 ? (
                      <span className="mt-0.5 block text-xs whitespace-nowrap text-muted-foreground">
                        {`${entry.pendingCount} đang chờ`}
                      </span>
                    ) : null}
                  </TableCell>

                  {/* `schedule_note` is display-only by the migration's own
                      comment, so it is printed as the teacher typed it and
                      nothing is derived from it. A class without one says so
                      rather than being given a schedule it does not have. */}
                  <TableCell className="align-top break-words">
                    {entry.scheduleNote ?? (
                      <span className="text-muted-foreground">Chưa đặt</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </PageShell>
  );
}
