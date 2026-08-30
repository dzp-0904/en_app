import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * The Figma uses four button treatments and no others:
 *
 *   default  primary CTA        indigo fill, semibold, full width
 *   outline  Google / secondary white fill, hairline border, medium weight
 *   link     inline text link   indigo, underline on hover
 *   ghost    de-emphasised      grey, darkens on hover
 *
 * Sizing follows the Figma's `py-2.5` rather than a fixed height, so a button
 * and an input of the same padding line up exactly.
 *
 * Focus rings are an addition: the Figma specifies no focus state at all. An
 * outline is used rather than a ring so the indicator follows the border radius
 * and does not depend on knowing the colour of whatever sits behind it.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-lg text-sm transition-colors outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-60",
  {
    variants: {
      variant: {
        default:
          "bg-primary font-semibold text-primary-foreground hover:bg-primary-hover",
        outline:
          "border border-input bg-card font-medium text-foreground hover:bg-background",
        link: "font-medium text-primary underline-offset-2 hover:underline",
        ghost: "text-muted-foreground hover:text-foreground",
      },
      size: {
        default: "px-4 py-2.5",
        sm: "px-3 py-2 text-xs",
        inline: "p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
