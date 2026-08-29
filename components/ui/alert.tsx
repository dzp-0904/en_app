import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The server actions report failure by redirecting back with `?error=`, so the
 * pages need somewhere to say what went wrong. The Figma has no banner — it
 * validates per field in client state — so this is built from the Figma's own
 * vocabulary instead: the tinted-surface-plus-hairline pattern it uses for
 * green and orange callouts, rendered in the destructive pair.
 *
 * `role="alert"` moves the message to assistive technology as soon as the page
 * lands, which matters here because the redirect means the person arrives on a
 * fresh document with focus at the top.
 */
function Alert({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      role="alert"
      data-slot="alert"
      className={cn(
        "rounded-lg border border-destructive/25 bg-destructive-light px-3.5 py-2.5 text-sm text-destructive",
        className,
      )}
      {...props}
    />
  );
}

export { Alert };
