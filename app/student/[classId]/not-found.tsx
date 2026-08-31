import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageShell } from "@/components/ui/page-shell";

/**
 * Reached by `notFound()` in this segment, which covers two cases on purpose:
 * a class id that names nothing, and one that names a class this student is not
 * in. They are answered identically, so nobody can use a 404 to learn who is
 * enrolled where.
 *
 * It exists so that a wrong URL inside the student flow still looks like
 * EduTrack. Next's built-in 404 is unstyled and would read as a broken deploy
 * rather than a mistyped link.
 *
 * It sits in `PageShell` at the same `4xl` centred width as every other student
 * screen (decision **L**), so the wrong URL lands in the same column the right
 * one would have. There is no `PageHeader` and no trail: the heading is the
 * whole message, and a breadcrumb whose last crumb is the current page cannot
 * name a page that was not found.
 */
export default function ClassNotFound() {
  return (
    <PageShell width="4xl" align="center">
      <Card>
        <h1 className="mb-2 text-xl font-semibold text-foreground">
          Không tìm thấy lớp học đó
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Có thể liên kết không đúng, hoặc bạn không còn trong lớp này nữa. Tất
          cả lớp học của bạn đều được liệt kê trên trang chính.
        </p>

        <Button asChild variant="outline">
          <Link href="/student">Quay lại danh sách lớp</Link>
        </Button>
      </Card>
    </PageShell>
  );
}
