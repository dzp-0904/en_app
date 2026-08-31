import "server-only";

import { XML_DECLARATION, xmlEscape, zip } from "@/lib/export/zip";

/**
 * A real `.xlsx` workbook — SpreadsheetML over the ZIP container in `zip.ts`.
 *
 * ## The shape of the file
 *
 * An `.xlsx` is a ZIP of XML parts joined by relationship files:
 *
 *   `[Content_Types].xml`        what every part is
 *   `_rels/.rels`                the package points at the workbook
 *   `xl/workbook.xml`            the sheet list
 *   `xl/_rels/workbook.xml.rels` each sheet's part
 *   `xl/styles.xml`              the two formats this uses
 *   `xl/worksheets/sheetN.xml`   the cells
 *
 * Strings are written **inline** (`t="inlineStr"`) rather than through a shared
 * string table. The table exists to deduplicate text across a large workbook;
 * a monthly report is a few hundred cells, most of them distinct, and the table
 * would add a part, a content type, a relationship and an indirection for no
 * measurable saving. Every reader supports both.
 *
 * ## What makes it a spreadsheet rather than a table of pictures
 *
 * §6 asks the class export to be filterable and sortable, so numbers are
 * written as numbers — `<v>6.5</v>` with no `t` attribute — and never as
 * pre-formatted text. A band a teacher can sort by, an attendance percentage
 * they can filter on. Dates are the exception: they are written as the
 * `dd/MM/yyyy` text the rest of the report shows, because an Excel serial date
 * is a number whose meaning depends on the workbook's epoch, and a report that
 * displays 29/08/2026 in the PDF and 46264 in the spreadsheet has broken §10.
 * Sorting a `YYYY-MM-DD`-ordered column of Vietnamese-formatted dates is the
 * one thing this costs, and the sheets are already in date order.
 *
 * Each sheet carries an `autoFilter` over its header row, so the filter and
 * sort controls are present the moment the file opens.
 */

export type CellValue = string | number | null;

export type Sheet = {
  /** Excel refuses `[]:*?/\` and anything past 31 characters in a sheet name. */
  name: string;
  /** Header labels. Bold, frozen, and the range `autoFilter` covers. */
  header: string[];
  rows: CellValue[][];
  /** Column widths in Excel's character units; defaults to a readable 18. */
  widths?: number[];
};

/** Style indices into `styles.xml` below. */
const STYLE_DEFAULT = 0;
const STYLE_HEADER = 1;

export function xlsx(sheets: Sheet[]): Buffer {
  const parts = sheets.map((sheet, index) => ({
    sheet,
    id: index + 1,
    path: `xl/worksheets/sheet${index + 1}.xml`,
  }));

  return zip([
    {
      path: "[Content_Types].xml",
      data: text(
        XML_DECLARATION +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          parts
            .map(
              (part) =>
                `<Override PartName="/${part.path}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
            )
            .join("") +
          "</Types>",
      ),
    },
    {
      path: "_rels/.rels",
      data: text(
        XML_DECLARATION +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          "</Relationships>",
      ),
    },
    {
      path: "xl/workbook.xml",
      data: text(
        XML_DECLARATION +
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
          "<sheets>" +
          parts
            .map(
              (part) =>
                `<sheet name="${xmlEscape(sheetName(part.sheet.name))}" sheetId="${part.id}" r:id="rId${part.id}"/>`,
            )
            .join("") +
          "</sheets></workbook>",
      ),
    },
    {
      path: "xl/_rels/workbook.xml.rels",
      data: text(
        XML_DECLARATION +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          parts
            .map(
              (part) =>
                `<Relationship Id="rId${part.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${part.id}.xml"/>`,
            )
            .join("") +
          `<Relationship Id="rId${parts.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
          "</Relationships>",
      ),
    },
    { path: "xl/styles.xml", data: text(STYLES) },
    ...parts.map((part) => ({
      path: part.path,
      data: text(worksheet(part.sheet)),
    })),
  ]);
}

function text(value: string): Buffer {
  return Buffer.from(value, "utf8");
}

/**
 * A sheet name Excel will accept.
 *
 * The characters below are reserved for range syntax and the limit is 31. A
 * name that breaks either rule does not produce a warning — the workbook simply
 * fails to open, so it is corrected here rather than trusted to the caller.
 */
function sheetName(name: string): string {
  const cleaned = name.replace(/[[\]:*?/\\]/g, " ").slice(0, 31);
  return cleaned.trim() === "" ? "Sheet" : cleaned;
}

function worksheet(sheet: Sheet): string {
  const width = Math.max(sheet.header.length, 1);
  const lastColumn = columnName(width - 1);
  const lastRow = sheet.rows.length + 1;

  const cols =
    "<cols>" +
    Array.from({ length: width }, (_, index) => {
      const size = sheet.widths?.[index] ?? 18;
      return `<col min="${index + 1}" max="${index + 1}" width="${size}" customWidth="1"/>`;
    }).join("") +
    "</cols>";

  const header = row(1, sheet.header, STYLE_HEADER);
  const body = sheet.rows
    .map((cells, index) => row(index + 2, cells, STYLE_DEFAULT))
    .join("");

  return (
    XML_DECLARATION +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<dimension ref="A1:${lastColumn}${lastRow}"/>` +
    // The header stays put while a long roster scrolls under it.
    '<sheetViews><sheetView workbookViewId="0">' +
    '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
    "</sheetView></sheetViews>" +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    cols +
    "<sheetData>" +
    header +
    body +
    "</sheetData>" +
    `<autoFilter ref="A1:${lastColumn}${lastRow}"/>` +
    "</worksheet>"
  );
}

function row(index: number, cells: CellValue[], style: number): string {
  const written = cells
    .map((value, column) => cell(`${columnName(column)}${index}`, value, style))
    .join("");

  return `<row r="${index}">${written}</row>`;
}

function cell(reference: string, value: CellValue, style: number): string {
  const styled = style === STYLE_DEFAULT ? "" : ` s="${style}"`;

  // An empty cell rather than a zero or the string "null": the sheets carry
  // real gaps — a lesson with no note, a homework with no score — and writing
  // anything at all in that cell would be inventing a value.
  if (value === null || value === "") {
    return `<c r="${reference}"${styled}/>`;
  }

  if (typeof value === "number") {
    // Guard against a value Excel cannot store; text is better than a broken
    // workbook, and nothing in a report should ever reach here.
    if (!Number.isFinite(value)) {
      return inlineString(reference, styled, String(value));
    }
    return `<c r="${reference}"${styled}><v>${value}</v></c>`;
  }

  return inlineString(reference, styled, value);
}

function inlineString(
  reference: string,
  styled: string,
  value: string,
): string {
  // `xml:space="preserve"` so a note that begins or ends with a space keeps it.
  return (
    `<c r="${reference}"${styled} t="inlineStr">` +
    `<is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`
  );
}

/** 0 → A, 25 → Z, 26 → AA. Bijective base-26, which is what Excel uses. */
function columnName(index: number): string {
  let name = "";
  let remaining = index;

  while (remaining >= 0) {
    name = String.fromCharCode(65 + (remaining % 26)) + name;
    remaining = Math.floor(remaining / 26) - 1;
  }

  return name;
}

/**
 * Two formats: the default, and a bold header on the report's own tint.
 *
 * Deliberately minimal. Every index a sheet refers to must exist here, and a
 * styles part that declares fonts nobody uses is a part that can disagree with
 * the sheets. `#EDF0FF` is the same primary tint the application paints a
 * selected row with, so the workbook and the screen look related.
 */
const STYLES =
  XML_DECLARATION +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="2">' +
  '<font><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/><color rgb="FF1B2036"/></font>' +
  "</fonts>" +
  '<fills count="3">' +
  '<fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFEDF0FF"/><bgColor indexed="64"/></patternFill></fill>' +
  "</fills>" +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="2">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>' +
  "</cellXfs>" +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  "</styleSheet>";
