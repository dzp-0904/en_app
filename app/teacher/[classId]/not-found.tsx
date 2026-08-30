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
            Không tìm thấy lớp học đó
          </h1>
          <p className="mb-6 text-sm text-muted-foreground">
            Có thể liên kết không đúng, hoặc lớp học đã được lưu trữ. Tất cả lớp
            học của bạn đều được liệt kê trên trang chính.
          </p>

          <Button asChild variant="outline">
            <Link href="/teacher">Quay lại danh sách lớp</Link>
          </Button>
        </Card>
      </div>
    </main>
  );
}
