import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A plain `<label>`. Radix's Label primitive exists to forward clicks on
 * non-native controls, which nothing here has — every field in the auth flow is
 * a real `<input>`, where `htmlFor` already does that work.
 */
function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn("block text-sm font-medium text-foreground", className)}
      {...props}
    />
  );
}

export { Label };
