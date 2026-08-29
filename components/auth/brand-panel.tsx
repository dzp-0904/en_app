import { LogoMark } from "@/components/brand/logo-mark";
import { cn } from "@/lib/utils";

export type BrandPoint = {
  label: string;
  /** Present on the sign-up panel, absent on the sign-in panel. */
  description?: string;
};

/**
 * The navy column that sits beside the auth forms.
 *
 * Fixed at 420px and `hidden lg:flex`, exactly as the Figma draws it — below
 * 1024px the design is the form column alone on cream, which is also the whole
 * of its mobile treatment.
 *
 * `headline` is the one place in the product that uses Lora. Everything else,
 * here and elsewhere, is the UI sans — see `app/layout.tsx` for why that is
 * Public Sans rather than the Figma's Instrument Sans.
 *
 * White-on-navy opacities come from the Figma, with one change: point
 * descriptions were `white/40`, which measures 3.72:1 against #1B2036 at 12px.
 * They are `white/60` here (6.60:1). The other tints already pass — `white/50`
 * on the description line is 5.02:1.
 */
export function BrandPanel({
  headline,
  quoted = false,
  description,
  points,
}: {
  headline: string;
  /** Renders the headline as a pull quote, as the sign-in screen does. */
  quoted?: boolean;
  description: string;
  points: BrandPoint[];
}) {
  const detailed = points.some((point) => point.description);
  const Headline = quoted ? "blockquote" : "h2";

  return (
    <div className="hidden w-[420px] shrink-0 flex-col justify-between bg-navy p-10 text-white lg:flex">
      <div>
        <LogoMark tone="light" className="mb-16" />

        <Headline className="mb-4 font-serif text-2xl leading-relaxed text-white/90">
          {quoted ? `“${headline}”` : headline}
        </Headline>

        <p className="text-sm text-white/50">{description}</p>
      </div>

      <ul className={cn(detailed ? "space-y-4" : "space-y-3")}>
        {points.map((point) => (
          <li
            key={point.label}
            className={cn("flex gap-3", !detailed && "items-center")}
          >
            {detailed ? (
              <span
                aria-hidden="true"
                className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/20"
              >
                <span className="size-1.5 rounded-full bg-primary" />
              </span>
            ) : (
              <span
                aria-hidden="true"
                className="size-1.5 shrink-0 rounded-full bg-primary"
              />
            )}

            {point.description ? (
              <span>
                <span className="block text-sm font-medium text-white/80">
                  {point.label}
                </span>
                <span className="mt-0.5 block text-xs text-white/60">
                  {point.description}
                </span>
              </span>
            ) : (
              <span className="text-sm text-white/60">{point.label}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
