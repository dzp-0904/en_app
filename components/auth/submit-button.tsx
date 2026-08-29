"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";

/**
 * The Figma specifies a submit state for both auth forms — "Signing in…",
 * "Creating account…", the button dimmed and inert.
 *
 * `useFormStatus` is the only way to read that from inside a form driven by a
 * server action, and it requires a client component. This is the sole client
 * component in the auth flow, and it is purely additive: with JavaScript
 * disabled the button renders as a plain submit and the form posts normally.
 * Nothing about authentication depends on it.
 */
export function SubmitButton({
  children,
  pendingLabel,
  className,
}: {
  children: ReactNode;
  pendingLabel: string;
  className?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      disabled={pending}
      aria-disabled={pending || undefined}
      className={className}
    >
      {pending ? pendingLabel : children}
    </Button>
  );
}
