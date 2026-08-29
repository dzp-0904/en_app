import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Field styling transcribed from the Figma: white fill, hairline border, 8px
 * radius, 14px/3.5–2.5 padding, and a focus state that swaps the border to
 * indigo behind a soft tinted ring.
 *
 * That border swap is itself the focus indicator — #4466EE against white is
 * 4.79:1, comfortably past the 3:1 that WCAG 2.2 asks of a focus appearance —
 * so the ring can stay as quiet as the Figma draws it.
 *
 * `:user-invalid` colours a field red only after the person has actually tried
 * to submit it, which is what makes native constraint validation usable on a
 * form that carries no JavaScript. Browsers without it simply skip the rule.
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "block w-full rounded-lg border border-input bg-card px-3.5 py-2.5 text-sm text-foreground transition-colors",
        "placeholder:text-placeholder",
        "focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none",
        "[&:user-invalid]:border-destructive [&:user-invalid]:focus:ring-destructive/20",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
