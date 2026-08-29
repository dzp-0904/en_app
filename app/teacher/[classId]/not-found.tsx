import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * Reached by `notFound()` in this segment, which covers two cases on purpose: a
 * class id that names nothing, and one that names a class belonging to another
 * teacher. They are answered identically, so nobody can use a 404 to enumerate
 * what other teachers run.
 */
export default function ClassNotFound() {
  return (
    <main className="flex flex-1 justify-center bg-background p-8">
      <div className="w-full max-w-lg">
        <Card>
          <h1 className="mb-2 text-xl font-semibold text-foreground">
            We couldn&apos;t find that class
          </h1>
          <p className="mb-6 text-sm text-muted-foreground">
            The link may be wrong, or the class may have been archived. Your own
            classes are all listed on your home page.
          </p>

          <Button asChild variant="outline">
            <Link href="/teacher">Back to classes</Link>
          </Button>
        </Card>
      </div>
    </main>
  );
}
