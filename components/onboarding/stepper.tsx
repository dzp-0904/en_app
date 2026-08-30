import { cn } from "@/lib/utils";

import { ONBOARDING_STEPS, type OnboardingStepIndex } from "@/lib/onboarding";

/**
 * The four-dot progress indicator above the onboarding card.
 *
 * The dots are `aria-hidden`: they encode nothing that "Step 2 of 4" beside them
 * does not already say, and a screen reader announcing four unlabelled circles
 * plus a tick character is noise. The sentence is the accessible version.
 *
 * The Figma sets that sentence in #8A8FA8, which measures 2.72:1 on cream. It is
 * rendered in navy-70 here for the same reason every other secondary line in the
 * product is — see the `--muted-foreground` note in `globals.css`.
 */
export function Stepper({ step }: { step: OnboardingStepIndex }) {
  return (
    <div className="mb-6 text-center">
      <p className="mb-4 text-sm text-muted-foreground">
        Bước {step + 1} / {ONBOARDING_STEPS.length}
      </p>

      <ol aria-hidden="true" className="flex items-center justify-center">
        {ONBOARDING_STEPS.map((entry, index) => {
          const done = index < step;
          const current = index === step;

          return (
            <li key={entry.href} className="flex items-center">
              {index > 0 ? (
                <span
                  className={cn(
                    "h-0.5 w-8",
                    index <= step ? "bg-green" : "bg-cream-dark",
                  )}
                />
              ) : null}

              <span
                className={cn(
                  "flex size-7 items-center justify-center rounded-full text-xs font-semibold",
                  done && "bg-green text-white",
                  current && "bg-primary text-primary-foreground",
                  !done && !current && "bg-cream-dark text-muted-foreground",
                )}
              >
                {done ? "✓" : index + 1}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
