/**
 * The document a monthly report *is*, before anything decides how to draw it.
 *
 * §10 asks for one canonical dataset behind the preview and the three
 * downloads, and `lib/monthly-report.ts` provides it. This is the second half
 * of the same argument, applied to the documents: the PDF and the Word file are
 * not two reports that happen to resemble each other, they are one block list
 * rendered twice. `lib/export/report-document.ts` decides what the report says
 * and in what order; `pdf.ts` and `docx.ts` decide only what a heading looks
 * like on a page. A section added to one is a section added to both, and a
 * section can no longer be quietly missing from one of them.
 *
 * The spreadsheet is deliberately not built from these blocks. A `.xlsx` is a
 * grid a teacher sorts and filters, not a document they read top to bottom, and
 * forcing prose into it would produce exactly the "raw database dump" §5 warns
 * against. It reads the same `MonthlyStudentReport` through the same
 * `lib/report-text.ts` formatters, which is what keeps its numbers identical.
 */

export type Block =
  /** The report's identity. Drawn once, at the top. */
  | { kind: "title"; text: string; subtitle?: string }
  | { kind: "heading"; level: 1 | 2; text: string }
  | { kind: "paragraph"; text: string; italic?: boolean; muted?: boolean }
  | { kind: "bullet"; text: string }
  /** A row of headline figures — the bands, the attendance, the standing. */
  | { kind: "stats"; items: { label: string; value: string }[] }
  /**
   * `widths` are proportions, not measurements: each renderer scales them to
   * whatever its own content width happens to be.
   */
  | { kind: "table"; header: string[]; rows: string[][]; widths?: number[] };
