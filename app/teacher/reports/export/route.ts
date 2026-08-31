import { docx } from "@/lib/export/docx";
import { reportPdf } from "@/lib/export/pdf";
import {
  classSheets,
  reportBlocks,
  reportSheets,
} from "@/lib/export/report-document";
import { xlsx } from "@/lib/export/xlsx";
import {
  loadMonthlyClassSummary,
  loadMonthlyStudentReport,
} from "@/lib/monthly-report";
import { loadUserState } from "@/lib/onboarding";
import { currentMonth, parseMonth } from "@/lib/report-period";
import { classExportFileName, exportFileName } from "@/lib/report-text";
import { createClient } from "@/lib/supabase/server";

/**
 * `GET /teacher/reports/export?class=&month=&student=&format=`
 *
 * The one route M27 adds, and the reason it is a Route Handler rather than a
 * Server Action: a download is a response with its own `Content-Type` and
 * `Content-Disposition`, and a Server Action returns a value into a React tree.
 * A handler also means every export control on the page is a plain `<a href>` —
 * so downloading a report works with JavaScript disabled, like everything else
 * in this application (§12).
 *
 * ## Authorization
 *
 * A Route Handler sits outside `app/teacher/layout.tsx`, so it does its own
 * checking and does all of it here:
 *
 *   1. `loadUserState()` — the session cookie decides who is asking. Anonymous
 *      is sent to the login page.
 *   2. Not a teacher → **404**. Not a redirect: this endpoint answers with a
 *      file or with nothing, and a student who guesses the URL learns exactly
 *      what someone guessing a class id learns, which is nothing.
 *   3. The class must be one of `state.teacher.classes` — the list
 *      `readUserState` built from `classes` filtered by this teacher's own id.
 *      A class that is not in it is 404, whoever owns it, which is the same
 *      answer `/teacher/[classId]` gives and for the same reason.
 *   4. The membership is settled inside `loadMonthlyStudentReport`, against the
 *      class id from step 3. Nothing the URL says can widen that.
 *
 * Everything below reads under RLS as the signed-in teacher; no service role,
 * no `SUPABASE_SECRET_KEY`, no policy is bypassed.
 *
 * ## Why the whole file is built in memory
 *
 * A monthly report is tens of kilobytes. Streaming it would add a generator, a
 * back-pressure story and a partially-written file on an error, in exchange for
 * memory nobody is short of. `Buffer` in, one `Response` out — and an error
 * before the first byte is a clean 500 rather than a truncated download.
 */

const FORMATS = ["pdf", "docx", "xlsx"] as const;
type Format = (typeof FORMATS)[number];

const CONTENT_TYPES: Record<Format, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function isFormat(value: string | null): value is Format {
  return value !== null && (FORMATS as readonly string[]).includes(value);
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;

  const format = params.get("format");
  if (!isFormat(format)) return notFound();

  const state = await loadUserState();

  if (state.kind === "anonymous") {
    return new Response(null, {
      status: 307,
      headers: { Location: "/auth/login" },
    });
  }

  if (state.kind !== "teacher") return notFound();

  const requested = params.get("class");
  const classFields = state.teacher.classes.find(
    (entry) => entry.classId === requested,
  );
  if (classFields === undefined) return notFound();

  const month =
    parseMonth(params.get("month")) ?? currentMonth(classFields.timezone);

  const supabase = await createClient();
  const membershipId = params.get("student");

  // No student named: the whole-class workbook. Only `xlsx` — a roster is a
  // grid, and a fifty-page PDF of everyone is not the thing anybody asked for.
  if (membershipId === null) {
    if (format !== "xlsx") return notFound();

    const summary = await loadMonthlyClassSummary(supabase, classFields, month);
    if (summary === null) return failed();

    return file(
      xlsx(classSheets(summary)),
      "xlsx",
      classExportFileName(summary.className, month, "xlsx"),
    );
  }

  const result = await loadMonthlyStudentReport(
    supabase,
    classFields,
    { fullName: state.teacher.fullName, email: state.teacher.email },
    membershipId,
    month,
  );

  if (result.kind === "not-found") return notFound();
  if (result.kind === "error") return failed();

  const report = result.report;
  const name = exportFileName(report, format);

  switch (format) {
    case "pdf":
      return file(await reportPdf(reportBlocks(report)), "pdf", name);
    case "docx":
      return file(docx(reportBlocks(report)), "docx", name);
    case "xlsx":
      return file(xlsx(reportSheets(report)), "xlsx", name);
  }
}

function file(data: Buffer, format: Format, name: string): Response {
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": CONTENT_TYPES[format],
      // `exportFileName` folds the name to ASCII precisely so this header does
      // not need an RFC 5987 escape hatch that older clients mangle.
      "Content-Disposition": `attachment; filename="${name}"`,
      "Content-Length": String(data.length),
      // A report is one teacher's view of one student. Nothing caches it.
      "Cache-Control": "private, no-store",
    },
  });
}

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

/**
 * A read failed. The teacher gets a sentence, and the reason stays in the
 * server log where `logDbError` already put it — §8's rule about never
 * rendering a raw Postgres error applies to a downloaded file too.
 */
function failed(): Response {
  return new Response(
    "Không tải được dữ liệu báo cáo. Vui lòng thử lại.",
    { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } },
  );
}
