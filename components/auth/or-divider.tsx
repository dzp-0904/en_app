import { cn } from "@/lib/utils";

/**
 * A hairline rule with the label knocked out of its middle — the Figma's
 * separator between the password form and the Google button.
 *
 * The rule is drawn as an absolutely positioned line behind the label, so the
 * label's cream background masks it. That means the component only works on the
 * page ground, which is the only place the design uses it.
 */
export function OrDivider({
  label = "hoặc",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <div className="absolute inset-0 flex items-center" aria-hidden="true">
        <span className="w-full border-t border-border" />
      </div>

      <div className="relative flex justify-center">
        <span className="bg-background px-3 text-xs text-muted-foreground">
          {label}
        </span>
      </div>
    </div>
  );
}
