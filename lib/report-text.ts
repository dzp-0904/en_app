import { ATTENDANCE_LABELS, type AttendanceStatus } from "@/lib/attendance";
import { type CourseType, LABELS as COURSE_LABELS } from "@/lib/course-type";
import { SKILL_LABELS } from "@/lib/lesson-log";
import type {
  BandMovement,
  MonthlyStudentReport,
  ReportAttendance,
  ReportHomework,
  ReportLesson,
} from "@/lib/monthly-report";
import {
  BAND_FIELD_LABELS,
  formatBand,
  MEMBER_STATUS_LABELS,
  SCORE_ENTRY_TYPE_LABELS,
} from "@/lib/score";
import { HOMEWORK_STATUS_LABELS } from "@/lib/student";
import { formatZonedDate, formatZonedTime } from "@/lib/time";

/**
 * How a monthly report reads, in one place.
 *
 * The report exists in four forms — a web page, a PDF, a `.docx` and an
 * `.xlsx` — and §10 of the milestone is blunt about what must not happen: the
 * document a parent opens must not disagree with the screen the teacher read.
 * Two of the ways they could disagree are answered by `lib/monthly-report.ts`,
 * which is the only place a number is computed. This module answers the third:
 * every string is written once here, so a band cannot be `6.5` on screen and
 * `6.50` in the spreadsheet, and "Chưa ghi nhận" cannot become "Không có" in
 * the PDF.
 *
 * Nothing here reads the database and nothing here decides anything. Given the
 * same report object every function is a pure mapping onto text, which is also
 * what makes the exporters testable without a session.
 *
 * `EM_DASH` rather than an empty string for a missing value: a blank cell in a
 * printed table reads as an oversight, whereas an em dash is a statement that
 * there is nothing to report — which is what §14 asks every empty state to say.
 */

export const EM_DASH = "—";

export function courseLabel(
  courseType: CourseType,
  courseTypeOther: string | null,
): string {
  return courseType === "other"
    ? (courseTypeOther ?? "Khác")
    : COURSE_LABELS[courseType];
}

/** A band, or the dash. `formatBand` is the one place `.toFixed(1)` lives. */
export function bandText(band: number | null): string {
  return formatBand(band) ?? EM_DASH;
}

/** A band prefixed by its skill: "IELTS 6.5" is the class-level convention. */
export function ieltsBandText(band: number | null): string {
  return band === null ? EM_DASH : `IELTS ${formatBand(band)}`;
}

export function percentText(value: number | null): string {
  return value === null ? EM_DASH : `${value}%`;
}

export function statusLabel(report: MonthlyStudentReport): string {
  return MEMBER_STATUS_LABELS[report.status];
}

/** `null` is a state of its own here — never `absent`. See §5. */
export function attendanceLabel(status: AttendanceStatus | null): string {
  return status === null ? "Chưa ghi nhận" : ATTENDANCE_LABELS[status];
}

export function homeworkStatusLabel(row: ReportHomework): string {
  return row.status === null ? "Chưa nộp" : HOMEWORK_STATUS_LABELS[row.status];
}

/** "8/10" — only `graded` rows carry a score, which is the enum's own rule. */
export function homeworkScoreText(row: ReportHomework): string {
  if (row.status !== "graded" || row.score === null) return EM_DASH;
  return `${row.score}/${row.maxScore}`;
}

/** "12/14 buổi · 86%", or the dash when the month counted nothing. */
export function attendanceText(attendance: ReportAttendance): string {
  if (attendance.counted === 0) return EM_DASH;
  return `${attendance.attended}/${attendance.counted} buổi · ${attendance.pct}%`;
}

export function skillLabel(skill: keyof typeof SKILL_LABELS): string {
  return SKILL_LABELS[skill];
}

export function bandFieldLabel(field: keyof typeof BAND_FIELD_LABELS): string {
  return BAND_FIELD_LABELS[field];
}

export function entryTypeLabel(
  type: keyof typeof SCORE_ENTRY_TYPE_LABELS,
): string {
  return SCORE_ENTRY_TYPE_LABELS[type];
}

/** A lesson with no title is still a lesson, and it is called one. */
export function lessonTitle(lesson: ReportLesson): string {
  return lesson.title ?? "Buổi học";
}

/** "Thứ Bảy, 29/08/2026" — on the class's clock, per §7. */
export function lessonDateText(zone: string, lesson: ReportLesson): string {
  return formatZonedDate(zone, lesson.startsAt);
}

/** "19:00 – 21:00", 24-hour, per §7. */
export function lessonTimeText(zone: string, lesson: ReportLesson): string {
  return `${formatZonedTime(zone, lesson.startsAt)} – ${formatZonedTime(zone, lesson.endsAt)}`;
}

const DAY = new Intl.DateTimeFormat("vi-VN", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * A bare `date` column as `dd/MM/yyyy`.
 *
 * Read at UTC midnight and never reinterpreted: `lesson_date`,
 * `recorded_on`, `due_date` and `assigned_on` are calendar squares the teacher
 * already resolved on the class's clock when they were written, so applying a
 * zone to them a second time would move some of them a day. The same rule
 * `components/student/score-trend.tsx` follows.
 */
export function dayText(calendarDate: string | null): string {
  if (calendarDate === null) return EM_DASH;
  return DAY.format(new Date(`${calendarDate}T00:00:00Z`));
}

/** "Đọc: 5.5 → 6.0 (+0.5)" — the arithmetic, spelled out, never a claim. */
export function movementText(movement: BandMovement): string {
  const delta = movement.to - movement.from;
  const sign = delta > 0 ? "+" : "";

  return `${bandFieldLabel(movement.field)}: ${bandText(movement.from)} → ${bandText(movement.to)} (${sign}${delta.toFixed(1)})`;
}

/** The identity line under the student's name, in every format. */
export function subtitleText(report: MonthlyStudentReport): string {
  return [
    report.className,
    courseLabel(report.courseType, report.courseTypeOther),
    report.monthLabel,
  ].join(" · ");
}

export function documentTitle(report: MonthlyStudentReport): string {
  return `Báo cáo tiến bộ ${report.monthLabel} — ${report.studentName ?? "Học viên"}`;
}

/**
 * The name a downloaded file arrives under.
 *
 * ASCII only, and deliberately so: `Content-Disposition` carries a `filename`
 * parameter that older clients read as latin-1, and a Vietnamese name round
 * -trips through it as mojibake. The diacritics are folded rather than dropped,
 * so "Nguyễn Minh Anh" becomes `nguyen-minh-anh` and stays recognisable, and
 * the month keeps the file sortable in a folder of them.
 */
export function exportFileName(
  report: MonthlyStudentReport,
  extension: "pdf" | "docx" | "xlsx",
): string {
  const student = asciiSlug(report.studentName ?? "hoc-vien");
  return `bao-cao-${student}-${report.month}.${extension}`;
}

export function classExportFileName(
  className: string,
  month: string,
  extension: "xlsx",
): string {
  return `bao-cao-lop-${asciiSlug(className)}-${month}.${extension}`;
}

/**
 * Vietnamese folded to a filename-safe ASCII slug.
 *
 * NFD splits a letter from its accents, the combining marks are removed, and
 * đ/Đ is handled on its own because it is a distinct letter rather than a
 * d with a diacritic and so survives decomposition.
 */
function asciiSlug(value: string): string {
  const folded = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, (match) => (match === "đ" ? "d" : "D"));

  const slug = folded
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

  return slug === "" ? "hoc-vien" : slug;
}
