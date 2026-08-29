"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

type CopyState = "idle" | "copied" | "failed";

/**
 * The invitation link panel: the URL, and a button that puts it on the clipboard.
 *
 * One of the few client components in the flow, because copying is inherently a
 * browser capability. It degrades rather than breaks: `navigator.clipboard` needs
 * a secure context and can be refused by permissions policy, so a failure selects
 * the link instead and says to press Ctrl+C. The link is always visible and
 * selectable regardless, so the panel is useful even with JavaScript disabled —
 * it is rendered by the server, and only the button depends on hydration.
 */
export function CopyField({ label, value }: { label: string; value: string }) {
  const [state, setState] = useState<CopyState>("idle");
  const codeRef = useRef<HTMLElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function flash(next: CopyState) {
    setState(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  }

  function selectLink() {
    const node = codeRef.current;
    if (!node) return;

    const range = document.createRange();
    range.selectNodeContents(node);

    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      flash("copied");
    } catch {
      // Not a failure worth an error dialog — the person can still copy by hand,
      // so put the text under their cursor and tell them how.
      selectLink();
      flash("failed");
    }
  }

  return (
    <div className="mb-5 rounded-xl bg-background p-4">
      <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>

      <div className="flex items-center gap-2">
        <code
          ref={codeRef}
          className="flex-1 truncate rounded-lg border border-border bg-card px-3 py-2 text-sm text-primary"
        >
          {value}
        </code>

        <Button type="button" variant="outline" size="sm" onClick={copy}>
          {state === "copied" ? "Copied!" : "Copy"}
        </Button>
      </div>

      {/* Announced on change; empty the rest of the time so it takes no space. */}
      <p
        aria-live="polite"
        className="mt-2 text-sm text-muted-foreground empty:hidden"
      >
        {state === "copied" ? "Link copied to clipboard." : null}
        {state === "failed"
          ? "Could not reach the clipboard. The link is selected — press Ctrl+C to copy it."
          : null}
      </p>
    </div>
  );
}
