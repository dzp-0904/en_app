import Link from "next/link";

import { Card } from "@/components/ui/card";
import { PendingTint } from "@/components/ui/pending-tint";
import { formatBand } from "@/lib/score";
import type { StudentScoreEntry } from "@/lib/student";
import { cn } from "@/lib/utils";

/**
 * "Score Over Time" — the Figma's one chart, drawn without a charting library.
 *
 * `pages/student/Dashboard.tsx` renders a recharts `LineChart`: a dashed
 * `CartesianGrid` on `#F0EFE9`, a `#4466EE` line at `strokeWidth 2` with `r=3`
 * dots, 10px axis ticks, `height={150}`, and a row of five filter buttons that
 * switch the plotted series between overall and the four skills.
 *
 * WHY THIS IS SVG AND NOT RECHARTS. Decision **Q** stands — no charting
 * library — and it is not a stylistic preference: recharts is a client-side
 * renderer, so importing it would make the student's main screen a client
 * component, ship a chart runtime to every visitor, and draw nothing at all
 * with JavaScript disabled, which §12 of the project's own rules forbids. M22
 * honoured the rule by rendering the rows as a list and losing the picture.
 * There is a third option, and this is it: a polyline is a line chart. Five
 * elements of arithmetic and an `<svg>` produce the same drawing on the server,
 * with no dependency, no client boundary and no blank panel without JS.
 *
 * WHAT IS THE FIGMA'S AND WHAT IS NOT.
 *
 *   - Kept: the card, the heading, the filter row, the dashed grid, the line
 *     colour and weight, the dot radius, the 150px plot, the 10px ticks.
 *   - Changed: the Figma pins `YAxis domain={[4, 9]}` because its mock student
 *     never scores below 4. `public.band` is every half point from 0.0 to 9.0,
 *     and a real 3.5 plotted against a floor of 4 is a point drawn outside its
 *     own chart. The domain is computed from the rows and padded, so every
 *     recorded band is inside the picture.
 *   - Changed: the Figma's filters are single capitals — O, R, L, W, S. In
 *     Vietnamese "Nghe" and "Nói" both begin with N, so one letter stops being
 *     a name. The short words are used instead, which also means every control
 *     here is named without a `sr-only` crutch.
 *
 * ACCESSIBILITY. The drawing is `aria-hidden` and the same numbers follow it as
 * a real list, visually hidden. A polyline has nothing an assistive technology
 * can read, and a chart that announces only "image" is worse than one that
 * announces its rows.
 *
 * A server component: props in, path arithmetic, markup out.
 */

/** The Figma's `height={150}` plot, plus room for the two axes. */
const W = 480;
const H = 180;
const PAD = { top: 8, right: 8, bottom: 22, left: 30 };

const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

/**
 * Horizontal rules, as the Figma's `CartesianGrid` draws them — placed on real
 * band values rather than on an even division of the window. Dividing a 2.5
 * band window into five equal parts labels the axis 7.0 / 6.4 / 5.8 / 5.1 /
 * 4.5, and 6.4 is not a band `public.band` admits. The step is half a point,
 * which is the domain's own granularity, and widens to a whole point when a
 * long journey would otherwise draw a dozen rules.
 */
const ROW_STEPS = [0.5, 1] as const;

/** Never draw more rules than this, whatever the step. */
const MAX_ROWS = 8;

/** At most this many date ticks, so the labels never collide. */
const TICKS = 5;

/** Below this the card scrolls the chart rather than shrinking its labels. */
const MIN_W = 360;

export type ScoreSeries = "overall" | "reading" | "listening" | "writing" | "speaking";

export type TrendFilter = {
  label: string;
  href: string;
  series: ScoreSeries;
  current: boolean;
};

type Point = { label: string; value: number; x: number; y: number };

const DAY = new Intl.DateTimeFormat("vi-VN", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "UTC",
});

/**
 * `recorded_on` is a `date` — a calendar square the teacher already resolved on
 * the class's clock — so it is read at UTC midnight and never reinterpreted in
 * the reader's zone. The same rule the rest of this route follows.
 */
function dayLabel(recordedOn: string): string {
  return DAY.format(new Date(`${recordedOn}T00:00:00Z`));
}

/**
 * The vertical window: the recorded bands, padded half a point either side and
 * clamped to the domain `public.band` actually allows. A single entry, or
 * several that never moved, would otherwise ask for a zero-height axis.
 */
function domainOf(values: number[]): { min: number; max: number } {
  const low = Math.min(...values);
  const high = Math.max(...values);

  let min = Math.max(0, low - 0.5);
  let max = Math.min(9, high + 0.5);

  if (max - min < 1) {
    min = Math.max(0, Math.min(min, high - 0.5));
    max = Math.min(9, Math.max(max, low + 0.5));
    if (max - min < 1) max = Math.min(9, min + 1);
    if (max - min < 1) min = Math.max(0, max - 1);
  }

  return { min, max };
}

export function ScoreTrend({
  entries,
  series,
  filters,
}: {
  /** Oldest first — the order `loadStudentScoreHistory` returns. */
  entries: StudentScoreEntry[];
  series: ScoreSeries;
  filters: TrendFilter[];
}) {
  // An entry that recorded Writing alone has no Reading band, and a gap is not
  // a zero — it is left out of the series entirely, which is the same rule the
  // band lists on this page follow.
  const values = entries
    .map((entry) => ({ label: dayLabel(entry.recordedOn), value: entry[series] }))
    .filter((row): row is { label: string; value: number } => row.value !== null);

  return (
    <Panel filters={filters}>
      {values.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Chưa ghi nhận band nào cho kỹ năng này.
        </p>
      ) : (
        <Chart values={values} />
      )}
    </Panel>
  );
}

/** The card and its filter row — drawn whether or not there is a line inside. */
function Panel({
  filters,
  children,
}: {
  filters: TrendFilter[];
  children: React.ReactNode;
}) {
  return (
    <Card variant="list">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className="text-sm font-semibold text-foreground">
          Điểm theo thời gian
        </h2>

        {/* Links, not buttons: the selected series lives in the URL like every
            other piece of state in this application, so it survives a refresh,
            the back button and a switched-off JavaScript engine. */}
        <nav aria-label="Kỹ năng" className="min-w-0">
          <ul className="flex flex-wrap gap-1">
            {filters.map((filter) => (
              <li key={filter.series}>
                <Link
                  href={filter.href}
                  aria-current={filter.current ? "page" : undefined}
                  className={cn(
                    "relative block rounded px-1.5 py-0.5 text-[10px] transition-colors outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    filter.current
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {filter.label}
                  <PendingTint />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      {children}
    </Card>
  );
}

function Chart({ values }: { values: { label: string; value: number }[] }) {
  const { min, max } = domainOf(values.map((row) => row.value));
  const span = max - min;

  const points: Point[] = values.map((row, index) => ({
    ...row,
    // A lone entry sits in the middle rather than hard against the axis.
    x:
      values.length === 1
        ? PAD.left + PLOT_W / 2
        : PAD.left + (index / (values.length - 1)) * PLOT_W,
    y: PAD.top + (1 - (row.value - min) / span) * PLOT_H,
  }));

  const step =
    ROW_STEPS.find((candidate) => span / candidate + 1 <= MAX_ROWS) ??
    ROW_STEPS[ROW_STEPS.length - 1];

  // Top down, so the labels read the way the axis does.
  const rows = Array.from(
    { length: Math.floor(span / step) + 1 },
    (_, index) => {
      const value = max - index * step;
      return { value, y: PAD.top + ((max - value) / span) * PLOT_H };
    },
  );

  // Every point gets a tick when there is room; past that, an evenly spaced
  // sample including the first and the last, so the axis stays legible.
  const tickStep = Math.max(1, Math.ceil(points.length / TICKS));
  const ticks = points.filter(
    (_, index) => index % tickStep === 0 || index === points.length - 1,
  );

  return (
    <>
      {/* A viewBox scales the drawing to the card, which is what makes it
          responsive without measuring anything — but it scales the 10px axis
          labels with it, and inside a 230px card at 320px they land at about
          5px and stop being readable. Below `MIN_W` the chart keeps its size
          and the card scrolls it, which is the treatment `components/ui/
          table.tsx` and the M25 calendar already use: the region is a labelled
          tab stop, and the page itself never gains a horizontal scrollbar. */}
      <div
        tabIndex={0}
        role="region"
        aria-label="Biểu đồ điểm theo thời gian"
        className="overflow-x-auto outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      >
        <svg
          aria-hidden
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full"
          style={{ minWidth: MIN_W }}
          role="presentation"
        >
          {rows.map((row) => (
            <g key={row.value}>
              <line
                x1={PAD.left}
                y1={row.y}
                x2={W - PAD.right}
                y2={row.y}
                stroke="var(--track)"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              <text
                x={PAD.left - 6}
                y={row.y + 3}
                textAnchor="end"
                fontSize={10}
                fill="var(--muted-foreground)"
              >
                {row.value.toFixed(1)}
              </text>
            </g>
          ))}

          {points.length > 1 ? (
            <polyline
              fill="none"
              stroke="var(--primary)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              points={points.map((point) => `${point.x},${point.y}`).join(" ")}
            />
          ) : null}

          {points.map((point) => (
            <circle
              key={`${point.label}-${point.x}`}
              cx={point.x}
              cy={point.y}
              r={3}
              fill="var(--primary)"
            />
          ))}

          {ticks.map((tick, index) => (
            <text
              key={`tick-${tick.x}`}
              x={tick.x}
              y={H - 6}
              // The end labels are anchored to their own edge rather than
              // centred: a centred label on the last point hangs half its width
              // outside the viewBox and is clipped mid-date.
              textAnchor={
                index === 0
                  ? "start"
                  : index === ticks.length - 1
                    ? "end"
                    : "middle"
              }
              fontSize={10}
              fill="var(--muted-foreground)"
            >
              {tick.label}
            </text>
          ))}
        </svg>
      </div>

      {/* The drawing above says nothing out loud. This does. */}
      <ul className="sr-only">
        {points.map((point) => (
          <li key={`sr-${point.label}-${point.value}`}>
            {point.label}: band {formatBand(point.value)}
          </li>
        ))}
      </ul>
    </>
  );
}
