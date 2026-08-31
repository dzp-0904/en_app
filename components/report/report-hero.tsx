import type { MonthlyStudentReport } from "@/lib/monthly-report";
import { bandText, courseLabel, dayText, statusLabel } from "@/lib/report-text";
import { BAND_FIELD_LABELS, BAND_SKILLS, formatBand } from "@/lib/score";

/**
 * The report's identity header and "IELTS Progress" block.
 *
 * This is the Figma Reports screen's navy card: who the report is about, the
 * class, the month and the teacher, then the start — rail — current row with
 * the target on the right, then the four skill tiles carrying each skill's
 * current band and its signed change since the baseline.
 *
 * WHY THIS IS NOT `components/student/band-progress.tsx`. That component draws
 * the same geometry, and this one is deliberately parallel to it rather than
 * built on top of it, for one reason: it speaks in the second person — "Tiến bộ
 * của tôi", "Bạn đã đi được …%" — because it sits on the student's own
 * dashboard. A monthly report is read by a parent about a named child, so every
 * line here is in the third person. Rewriting the shipped, verified student
 * screen to take a "voice" prop would put an M26 screen back in scope to serve
 * an M27 one — the same argument M26 recorded for not sharing `score-trend.tsx`.
 * The numbers are identical because both read `v_member_current_band` through
 * the same loaders; no arithmetic is repeated here, only markup.
 *
 * A percentage is drawn only when it has an answer. With no baseline, no
 * current band or no target there is no "distance covered", and an empty rail
 * would assert 0% — which is a claim, not a blank.
 */

type SkillRow = {
  key: (typeof BAND_SKILLS)[number];
  current: number | null;
  start: number | null;
};

function rowsOf(report: MonthlyStudentReport): SkillRow[] {
  const bands = report.bands;

  return [
    { key: "reading", current: bands.currentReading, start: bands.startReading },
    {
      key: "listening",
      current: bands.currentListening,
      start: bands.startListening,
    },
    { key: "writing", current: bands.currentWriting, start: bands.startWriting },
    {
      key: "speaking",
      current: bands.currentSpeaking,
      start: bands.startSpeaking,
    },
  ];
}

/** How far along the way to the target, or `null` when that has no answer. */
function progressOf(report: MonthlyStudentReport): number | null {
  const { startOverall, currentOverall, targetBand } = report.bands;

  if (startOverall === null || currentOverall === null || targetBand === null) {
    return null;
  }

  const distance = targetBand - startOverall;
  if (distance <= 0) return null;

  const covered = ((currentOverall - startOverall) / distance) * 100;
  return Math.max(0, Math.min(100, Math.round(covered)));
}

function deltaOf(row: SkillRow): number | null {
  if (row.current === null || row.start === null) return null;
  return row.current - row.start;
}

export function ReportHero({
  report,
  bandScored,
}: {
  report: MonthlyStudentReport;
  /** Only IELTS classes are band-scored — `scoringModelFor`, §6. */
  bandScored: boolean;
}) {
  const covered = progressOf(report);
  const target = formatBand(report.bands.targetBand);

  return (
    <div className="rounded-2xl bg-navy p-6 text-primary-foreground">
      <p className="text-xs tracking-wide text-primary-foreground/50 uppercase">
        Báo cáo tiến bộ {report.monthLabel}
      </p>

      {/* The student's name is the page's `h1`, set by `PageHeader` — printing
          it again here would put the same name twice at the top of one screen
          and give the document two competing titles. */}
      <p className="mt-1 text-lg font-semibold">
        {`${report.className} · ${courseLabel(report.courseType, report.courseTypeOther)}`}
      </p>

      <dl className="mt-5 grid gap-4 sm:grid-cols-3">
        <div className="min-w-0">
          <dt className="text-xs text-primary-foreground/50">Giáo viên</dt>
          <dd className="text-sm font-medium">{report.teacherName}</dd>
        </div>

        <div className="min-w-0">
          <dt className="text-xs text-primary-foreground/50">Kết quả</dt>
          <dd className="text-sm font-medium">{statusLabel(report)}</dd>
        </div>

        <div className="min-w-0">
          <dt className="text-xs text-primary-foreground/50">Học viên từ</dt>
          <dd className="text-sm font-medium">
            {dayText(
              report.joinedAt === null ? null : report.joinedAt.slice(0, 10),
            )}
          </dd>
        </div>
      </dl>

      {bandScored ? (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-primary-foreground/10 pt-6">
            <div className="shrink-0">
              <p className="mb-1 text-xs text-primary-foreground/50">Ban đầu</p>
              <p className="text-2xl font-bold text-primary-foreground/60">
                {bandText(report.bands.startOverall)}
              </p>
            </div>

            {covered === null ? null : (
              // Decorative: the sentence below names the same percentage, and
              // the two bands it sits between are printed either side of it.
              <div
                aria-hidden
                className="order-last h-2.5 w-full grow basis-32 overflow-hidden rounded-full bg-primary-foreground/10 sm:order-none sm:w-auto"
              >
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${covered}%` }}
                />
              </div>
            )}

            <div className="shrink-0">
              <p className="mb-1 text-xs text-primary-foreground/50">
                Hiện tại
              </p>
              <p className="text-2xl font-bold text-primary">
                {bandText(report.bands.currentOverall)}
              </p>
            </div>

            {target === null ? null : (
              <div className="shrink-0">
                <p className="mb-1 text-xs text-primary-foreground/50">
                  Mục tiêu
                </p>
                <p className="text-2xl font-bold text-green">{target}</p>
              </div>
            )}
          </div>

          <p className="mt-3 text-sm text-primary-foreground/70">
            {covered === null
              ? "Band được cập nhật sau mỗi lần giáo viên ghi nhận điểm."
              : `Đã đi được ${covered}% quãng đường tới band mục tiêu.`}
          </p>

          <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {rowsOf(report).map((row) => {
              const delta = deltaOf(row);

              return (
                <li
                  key={row.key}
                  className="min-w-0 rounded-xl bg-primary-foreground/5 p-3 text-center"
                >
                  <p className="text-[10px] text-primary-foreground/40">
                    {BAND_FIELD_LABELS[row.key]}
                  </p>

                  <p className="text-lg font-bold text-primary-foreground">
                    {formatBand(row.current) ?? "Chưa có"}
                  </p>

                  {delta === null ? null : (
                    <p
                      className={
                        delta > 0
                          ? "text-[10px] font-medium text-green"
                          : delta < 0
                            ? "text-[10px] font-medium text-orange"
                            : "text-[10px] font-medium text-primary-foreground/50"
                      }
                    >
                      {delta > 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1)}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </div>
  );
}
