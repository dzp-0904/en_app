import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",

  /**
   * The PDF export reads two font files from `assets/fonts/` at request time.
   *
   * `output: "standalone"` copies only what Next's tracer can see, and a
   * `readFile(path.join(process.cwd(), "assets", "fonts", …))` is invisible to
   * it — the path is assembled at runtime, so nothing links the route to the
   * files. Without this the export route type-checks, builds, works in `dev`,
   * and then throws ENOENT in production, which is the worst of the four.
   *
   * Naming the route rather than using a global include keeps the two ~55 kB
   * files out of every other route's trace. `pdf-lib` subsets the font at
   * embed time, so the size lands in the generated PDF, not in the bundle.
   */
  outputFileTracingIncludes: {
    "/teacher/reports/export": ["./assets/fonts/**"],
  },
};

export default nextConfig;
