import { BAND_FIELD_LABELS, formatBand, type BandSkill } from "@/lib/score";
import type { StudentBands } from "@/lib/student";

/**
 * The student's band progress — the Figma's navy hero on `pages/student/
 * Dashboard.tsx`, the one card in the whole design that inverts the palette.
 *
 * Starting band on the left, current on the right, the target picked out in
 * green above them, and a rail between the two showing how far along the way
 * the student is. Underneath, one tile per skill with the change since the
 * baseline. All of it is the Figma's arrangement.
 *
 * EVERY NUMBER IS THE DATABASE'S. `v_member_current_band` derives the starting
 * band from the `baseline` entry and the current band from the most recent one,
 * and `class_members.target_band` is the target — the view's own comment says
 * none of it is denormalised, which is why "the number under the chart can
 * never disagree with the chart". Nothing is averaged or compared here beyond
 * the two arithmetic facts the Figma itself draws: the percentage of the
 * distance covered, and the change per skill.
 *
 * THE PERCENTAGE IS NOT ALWAYS COMPUTABLE, AND THEN IT IS NOT SHOWN. The Figma
 * computes `(current - start) / (target - start)` from mock data where all
 * three always exist and the target is always above the start. In real rows any
 * of the three can be null — a student assessed once has no baseline distinct
 * from their current band, and a class may have no target at all — and a target
 * equal to the start divides by zero. Each of those is a missing answer, not a
 * zero, so the rail and its sentence appear only when the arithmetic means
 * something. `clamp` keeps a student who has passed their target at a full bar
 * rather than an overflowing one.
 *
 * A SKILL WITH NO BASELINE SHOWS ITS BAND AND NO CHANGE. The delta is a claim
 * about movement; with one measurement there has been no movement to report,
 * and printing "+0.0" would say there had been none, which is a different
 * thing. A skill with neither reads "Chưa có" — never 0.0, which is a real band
 * in `public.band` and would be a bad mark rather than a missing one.
 *
 * No `"use client"`. Everything here is arithmetic over props.
 */

/**
 * `BAND_FIELD_LABELS` covers `overall` too; the tiles show the four skills.
 * `BandSkill` is that same set, declared once in `lib/score.ts` beside the
 * columns, so the tiles cannot drift from the domain.
 */
type SkillRow = {
  key: BandSkill;
  current: number | null;
  start: number | null;
};

function rowsOf(bands: StudentBands): SkillRow[] {
  return [
    {
      key: "reading",
      current: bands.currentReading,
      start: bands.startReading,
    },
    {
      key: "listening",
      current: bands.currentListening,
      start: bands.startListening,
    },
    {
      key: "writing",
      current: bands.currentWriting,
      start: bands.startWriting,
    },
    {
      key: "speaking",
      current: bands.currentSpeaking,
      start: bands.startSpeaking,
    },
  ];
}

/**
 * How far along the way to the target, as a percentage, or `null` when that
 * question has no answer. See the note above for each way it can have none.
 */
function progressOf(bands: StudentBands): number | null {
  const { startOverall, currentOverall, targetBand } = bands;

  if (startOverall === null || currentOverall === null || targetBand === null) {
    return null;
  }

  const distance = targetBand - startOverall;
  if (distance <= 0) return null;

  const covered = ((currentOverall - startOverall) / distance) * 100;
  return Math.max(0, Math.min(100, Math.round(covered)));
}

/** The change since the baseline, signed, or `null` when there is no baseline. */
function deltaOf(row: SkillRow): number | null {
  if (row.current === null || row.start === null) return null;
  return row.current - row.start;
}

function BandProgress({ bands }: { bands: StudentBands }) {
  const covered = progressOf(bands);

  const start = formatBand(bands.startOverall);
  const current = formatBand(bands.currentOverall);
  const target = formatBand(bands.targetBand);

  return (
    <div className="rounded-2xl bg-navy p-6 text-primary-foreground">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 grow basis-48">
          <p className="text-xs tracking-wide text-primary-foreground/50 uppercase">
            Tiến bộ của tôi
          </p>

          <p className="mt-1 text-sm text-primary-foreground/70">
            {covered === null
              ? "Band của bạn được cập nhật sau mỗi lần giáo viên ghi nhận điểm."
              : `Bạn đã đi được ${covered}% quãng đường tới band mục tiêu.`}
          </p>
        </div>

        {target === null ? null : (
          <div className="shrink-0 text-right">
            <p className="text-xs text-primary-foreground/50">Mục tiêu</p>
            <p className="text-2xl font-bold text-green">{target}</p>
          </div>
        )}
      </div>

      {/* The Figma's start — rail — current row. It wraps rather than
          squeezing: at 320px the rail drops to its own line instead of
          shrinking to nothing between two two-character numbers. */}
      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="shrink-0">
          <p className="mb-1 text-xs text-primary-foreground/50">Ban đầu</p>
          <p className="text-2xl font-bold text-primary-foreground/60">
            {start ?? "—"}
          </p>
        </div>

        {covered === null ? null : (
          // Decorative: the sentence above states the same percentage in
          // words, and the two numbers it sits between are printed either
          // side of it.
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
          <p className="mb-1 text-xs text-primary-foreground/50">Hiện tại</p>
          <p className="text-2xl font-bold text-primary">{current ?? "—"}</p>
        </div>
      </div>

      <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {rowsOf(bands).map((row) => {
          const band = formatBand(row.current);
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
                {band ?? "Chưa có"}
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
    </div>
  );
}

export { BandProgress };
