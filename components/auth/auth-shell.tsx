import type { ReactNode } from "react";

/**
 * The split screen shared by every auth screen: a fixed brand column that
 * disappears below `lg`, and a centred form column on cream capped at `max-w-sm`.
 *
 * `flex-1` rather than `min-h-screen` — the root layout already establishes a
 * full-height flex column on `<body>`, so the shell grows into it and the page
 * cannot end up taller than the viewport by a header's worth.
 */
export function AuthShell({
  brand,
  children,
}: {
  brand: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-1">
      {brand}

      <main className="flex flex-1 items-center justify-center bg-background p-8">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
