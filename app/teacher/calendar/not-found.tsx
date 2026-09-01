import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * Reached by `notFound()` in this segment, which today means one thing: a
 * session id under `/teacher/calendar/session/` that `loadTeacherSession`
 * could not resolve.
 *
 * It covers three cases and answers them identically — an id that names
 * nothing, one that names a lesson in another teacher's class, and one that
 * names a lesson in a class this teacher has archived. A 404 that distinguished
 * between them would let anyone with a uuid learn whether it belongs to
 * somebody, which is the reason `/teacher/[classId]` answers the same way about
 * classes.
 *
 * It is shaped like `app/teacher/[classId]/not-found.tsx` on purpose: the same
 * centred card in the same shell, so the two 404s a teacher can reach read as
 * one thing the product does rather than two. The way out is the calendar,
 * because that is the section this page sits in.
 */
export default function SessionNotFound() {
  return (
    <main className="flex flex-1 justify-center bg-background p-8">
      <div className="w-full max-w-lg">
        <Card>
          <h1 className="mb-2 text-xl font-semibold text-foreground">
            Không tìm thấy buổi học đó
          </h1>
          <p className="mb-6 text-sm text-muted-foreground">
            Có thể liên kết không đúng, buổi học đã bị xóa, hoặc lớp học chứa
            buổi học này đã được lưu trữ. Lịch dạy hiển thị tất cả buổi học của
            bạn theo tuần.
          </p>

          <Button asChild variant="outline">
            <Link href="/teacher/calendar">Quay lại Lịch dạy</Link>
          </Button>
        </Card>
      </div>
    </main>
  );
}
