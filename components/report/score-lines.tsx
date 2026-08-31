import type { ReportScore } from "@/lib/monthly-report";
import { BAND_FIELDS, BAND_FIELD_LABELS, formatBand } from "@/lib/score";
import { dayText } from "@/lib/report-text";

/**
 * "Score Progress" — the Figma's recharts `LineChart`, drawn as an SVG.
 *
 * `pages/teacher/Reports.tsx` renders a `LineChart` with three `Line`s over a
 * `mockScoreHistory` array, `CartesianGrid strokeDasharray="3 3"`, a 0–9
 * `YAxis` and 11px ticks. This draws the same figure over the month's real
 * `score_entries`, oldest first, exactly as `loadMonthlyStudentReport`
 * returned them.
 *
 * Decision **Q** / **Z** again, and the precedent is this repository's own
 * `components/student/score-trend.tsx`: a hand-authored `<svg>` over real rows,
 * inside a labelled `overflow-x-auto` region so a narrow screen scrolls the
 * chart rather than the page, with the numbers repeated in an `sr-only` list
 * because a polyline announces nothing. That file is the student's single-skill
 * chart and is deliberately left untouched; this one is the report's
 * all-series chart, and the two do not share code because sharing it would
 * mean changing a shipped, verified student screen to serve a new one.
 *
 * FIVE SERIES, NOT THREE. The mock plots three because its fixture has three
 * columns. `score_entries` carries overall plus the four skills, and a series
 * is drawn only when the month actually recorded at least two values for it —
 * one point is a dot, not a trend, and zero points must not become a flat line
 * along the axis, since 0.0 is a real band.
 *
 * A Server Component. Numbers in, geometry out.
 */

/** Room for five series and a date axis; `MIN_WIDTH` is where it scrolls. */
const WIDTH = 560;
const HEIGHT = 200;
const MIN_WIDTH = 360;
const PAD = { top: 10, right: 10, bottom: 26, left: 34 };

/** `public.band` is 0.0–9.0, so the domain can never leave that. */
const BAND_MIN = 0;
const BAND_MAX = 9;

/** Half a band of air either side, the same padding `score-trend` uses. */
const DOMAIN_PAD = 0.5;

/** Horizontal grid lines, matching the mock's `CartesianGrid`. */
const ROWS = 4;

/**
 * One colour per series. `--decorative` is documented as reserved for
 * decorative marks — a chart line is exactly that here, because the accessible
 * copy of every number sits in the list underneath.
 */
const STROKES: Record<(typeof BAND_FIELDS)[number], string> = {
  overall: "var(--primary)",
  reading: "var(--green)",
  listening: "var(--orange)",
  writing: "var(--navy)",
  speaking: "var(--decorative)",
};

type Series = {
  field: (typeof BAND_FIELDS)[number];
  points: { x: number; value: number }[];
};

export function ScoreLines({ scores }: { scores: ReportScore[] }) {
  const series = BAND_FIELDS.map((field) => ({
    field,
    points: scores
      .map((score, index) => ({ x: index, value: score[field] }))
      .filter(
        (point): point is { x: number; value: number } => point.value !== null,
      ),
  })).filter((entry) => entry.points.length >= 2);

  if (series.length === 0) return null;

  const values = series.flatMap((entry) =>
    entry.points.map((point) => point.value),
  );
  const low = Math.max(BAND_MIN, Math.min(...values) - DOMAIN_PAD);
  const high = Math.min(BAND_MAX, Math.max(...values) + DOMAIN_PAD);
  const span = high - low || 1;

  const plot = {
    width: WIDTH - PAD.left - PAD.right,
    height: HEIGHT - PAD.top - PAD.bottom,
  };
  const steps = Math.max(1, scores.length - 1);

  const xOf = (index: number) => PAD.left + (index / steps) * plot.width;
  const yOf = (value: number) =>
    PAD.top + plot.height - ((value - low) / span) * plot.height;

  const path = (entry: Series) =>
    entry.points
      .map((point) => `${xOf(point.x).toFixed(2)},${yOf(point.value).toFixed(2)}`)
      .join(" ");

  return (
    <div>
      <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1">
        {series.map((entry) => (
          <li
            key={entry.field}
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            <span
              aria-hidden
              className="h-0.5 w-4 rounded-full"
              style={{ backgroundColor: STROKES[entry.field] }}
            />
            {BAND_FIELD_LABELS[entry.field]}
          </li>
        ))}
      </ul>

      <div
        tabIndex={0}
        role="region"
        aria-label="Biểu đồ điểm số trong tháng"
        className="overflow-x-auto focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <svg
          aria-hidden
          role="presentation"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-auto w-full"
          style={{ minWidth: MIN_WIDTH }}
        >
          {Array.from({ length: ROWS + 1 }, (_, row) => {
            const value = low + (span * row) / ROWS;
            const y = yOf(value);

            return (
              <g key={row}>
                <line
                  x1={PAD.left}
                  y1={y}
                  x2={WIDTH - PAD.right}
                  y2={y}
                  stroke="var(--track)"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
                <text
                  x={PAD.left - 6}
                  y={y + 3}
                  textAnchor="end"
                  fontSize={10}
                  fill="var(--muted-foreground)"
                >
                  {value.toFixed(1)}
                </text>
              </g>
            );
          })}

          {series.map((entry) => (
            <polyline
              key={entry.field}
              points={path(entry)}
              fill="none"
              stroke={STROKES[entry.field]}
              strokeWidth={entry.field === "overall" ? 2 : 1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}

          {series.map((entry) =>
            entry.points.map((point) => (
              <circle
                key={`${entry.field}-${point.x}`}
                cx={xOf(point.x)}
                cy={yOf(point.value)}
                r={2.5}
                fill={STROKES[entry.field]}
              />
            )),
          )}

          {scores.map((score, index) =>
            index === 0 || index === scores.length - 1 || scores.length <= 6 ? (
              <text
                key={score.entryId}
                x={xOf(index)}
                y={HEIGHT - 8}
                textAnchor={
                  index === 0
                    ? "start"
                    : index === scores.length - 1
                      ? "end"
                      : "middle"
                }
                fontSize={10}
                fill="var(--muted-foreground)"
              >
                {dayText(score.recordedOn)}
              </text>
            ) : null,
          )}
        </svg>
      </div>

      <ul className="sr-only">
        {scores.map((score) => (
          <li key={score.entryId}>
            {dayText(score.recordedOn)}:{" "}
            {BAND_FIELDS.map(
              (field) =>
                `${BAND_FIELD_LABELS[field]} ${
                  formatBand(score[field]) ?? "chưa ghi nhận"
                }`,
            ).join(", ")}
          </li>
        ))}
      </ul>
    </div>
  );
}
