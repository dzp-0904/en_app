import Link from "next/link";

import { LogoMark } from "@/components/brand/logo-mark";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * Reached by `notFound()` in this segment, which covers two cases on purpose:
 * a class id that names nothing, and one that names a class this student is not
 * in. They are answered identically, so nobody can use a 404 to learn who is
 * enrolled where.
 *
 * It exists so that a wrong URL inside the student flow still looks like
 * EduTrack. Next's built-in 404 is unstyled and would read as a broken deploy
 * rather than a mistyped link.
 */
export default function ClassNotFound() {
  return (
    <main className="flex flex-1 justify-center bg-background p-8">
      <div className="w-full max-w-lg">
        <LogoMark className="mb-12" />

        <Card>
          <h1 className="mb-2 text-xl font-semibold text-foreground">
            We couldn&apos;t find that class
          </h1>
          <p className="mb-6 text-sm text-muted-foreground">
            The link may be wrong, or you may no longer be in this class. Your
            own classes are all listed on your home page.
          </p>

          <Button asChild variant="outline">
            <Link href="/student">Back to classes</Link>
          </Button>
        </Card>
      </div>
    </main>
  );
}
