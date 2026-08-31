import { BAND_FIELD_LABELS, BAND_SKILLS, formatBand } from "@/lib/score";

/**
 * "Skill Overview" — the Figma's recharts `RadarChart`, drawn as an SVG.
 *
 * `pages/teacher/Reports.tsx` renders a `RadarChart` over the four skills with
 * `PolarGrid stroke="#E8E6DE"`, 11px tick labels, and a single `Radar` series
 * stroked `#4466EE` at `strokeWidth 2` and filled at `fillOpacity 0.15`. That
 * is exactly what this draws, in the four polar coordinates the shape needs.
 *
 * Decision **Q** and decision **Z**: no charting library. recharts renders in
 * the browser, so importing it would turn the report preview into a client
 * component, ship a chart runtime for one figure, and print nothing at all with
 * JavaScript disabled — and a report is a document, so a blank rectangle where
 * the skills should be is not a degraded experience but a wrong document.
 *
 * WHAT IT PLOTS. One polygon: the current band per skill, from
 * `v_member_current_band`. The Figma plots one series too. A skill with no band
 * recorded is a gap, not a zero — `public.band` starts at 0.0, which is a real
 * and very bad mark — so a report with any skill unmeasured draws no polygon at
 * all and says which skills are missing. Half a shape would read as a profile.
 *
 * ACCESSIBILITY. The drawing is `aria-hidden` and the same four numbers follow
 * it as a real list, visually hidden. A polygon announces nothing.
 *
 * A Server Component: props in, trigonometry, markup out.
 */

/** The Figma's `height={200}`, in a square box the four labels fit inside. */
const SIZE = 240;
const CENTRE = SIZE / 2;
const RADIUS = 74;

/** `public.band` tops out at 9.0, so that is the outer ring. */
const MAX_BAND = 9;

/** `PolarGrid` draws concentric rings; these are the bands they sit on. */
const RINGS = [3, 6, 9] as const;

/** North, east, south, west — Reading, Listening, Writing, Speaking. */
const ANGLES = [-Math.PI / 2, 0, Math.PI / 2, Math.PI];

type Point = { x: number; y: number };

function pointAt(angle: number, distance: number): Point {
  return {
    x: CENTRE + Math.cos(angle) * distance,
    y: CENTRE + Math.sin(angle) * distance,
  };
}

function polygon(distances: number[]): string {
  return distances
    .map((distance, index) => {
      const point = pointAt(ANGLES[index], distance);
      return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
    })
    .join(" ");
}

export function SkillRadar({
  bands,
}: {
  /** Current band per skill, in `BAND_SKILLS` order. `null` is unmeasured. */
  bands: (number | null)[];
}) {
  const measured = bands.filter((band): band is number => band !== null);
  const missing = BAND_SKILLS.filter((_, index) => bands[index] === null);

  // Nothing measured at all: the empty web with four axis labels and no shape
  // is a placeholder, and the table beside it already says "—" four times.
  if (measured.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Chưa ghi nhận band cho kỹ năng nào, nên chưa vẽ được biểu đồ kỹ năng.
      </p>
    );
  }

  return (
    <div>
      <div className="flex justify-center">
        <svg
          aria-hidden
          role="presentation"
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="h-auto w-full max-w-[240px]"
        >
          {RINGS.map((ring) => (
            <polygon
              key={ring}
              points={polygon(
                ANGLES.map(() => (ring / MAX_BAND) * RADIUS),
              )}
              fill="none"
              stroke="var(--border)"
              strokeWidth={1}
            />
          ))}

          {ANGLES.map((angle, index) => {
            const end = pointAt(angle, RADIUS);
            return (
              <line
                key={BAND_SKILLS[index]}
                x1={CENTRE}
                y1={CENTRE}
                x2={end.x}
                y2={end.y}
                stroke="var(--border)"
                strokeWidth={1}
              />
            );
          })}

          {measured.length === bands.length ? (
            <polygon
              points={polygon(
                bands.map((band) => ((band ?? 0) / MAX_BAND) * RADIUS),
              )}
              fill="var(--primary)"
              fillOpacity={0.15}
              stroke="var(--primary)"
              strokeWidth={2}
            />
          ) : null}

          {ANGLES.map((angle, index) => {
            const label = pointAt(angle, RADIUS + 22);
            const skill = BAND_SKILLS[index];

            return (
              <text
                key={`label-${skill}`}
                x={label.x}
                y={label.y + 4}
                textAnchor="middle"
                fontSize={11}
                fill="var(--muted-foreground)"
              >
                {BAND_FIELD_LABELS[skill]}
              </text>
            );
          })}
        </svg>
      </div>

      {missing.length > 0 ? (
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Chưa ghi nhận band cho{" "}
          {missing.map((skill) => BAND_FIELD_LABELS[skill]).join(", ")}.
        </p>
      ) : null}

      <ul className="sr-only">
        {BAND_SKILLS.map((skill, index) => (
          <li key={skill}>
            {BAND_FIELD_LABELS[skill]}:{" "}
            {formatBand(bands[index] ?? null) ?? "chưa ghi nhận"}
          </li>
        ))}
      </ul>
    </div>
  );
}
