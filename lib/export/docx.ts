import "server-only";

import type { Block } from "@/lib/export/blocks";
import { XML_DECLARATION, xmlEscape, zip } from "@/lib/export/zip";

/**
 * A real `.docx` — WordprocessingML over the ZIP container in `zip.ts`.
 *
 * §6 asks for "a real Word document with structured headings/tables/sections
 * rather than an HTML dump", and that distinction is the whole design of this
 * module. An HTML file renamed `.docx` opens in Word, which is exactly why the
 * milestone rules it out: it arrives with no outline, no navigation pane, no
 * styles a teacher can restyle, and no table structure a school office can
 * paste into anything else. What is written here is the real format —
 * `w:pStyle` headings that populate Word's navigation pane, `w:tbl` tables with
 * declared grids and header rows that repeat across a page break, and a
 * `styles.xml` that names them.
 *
 * The parts:
 *
 *   `[Content_Types].xml`          what every part is
 *   `_rels/.rels`                  the package points at the document
 *   `word/document.xml`            the body
 *   `word/_rels/document.xml.rels` the document points at the styles
 *   `word/styles.xml`              Title / Heading1 / Heading2 / Normal / table
 *
 * Measurements are in the units the format uses and they are unforgiving:
 * twips (1/20 pt) for page geometry and table widths, half-points for font
 * sizes, eighths of a point for borders. A4 with 2cm margins is written out
 * below in twips rather than computed, so the arithmetic is visible.
 */

/** A4 is 11906 × 16838 twips; 2cm is 1134. */
const PAGE = {
  width: 11906,
  height: 16838,
  margin: 1134,
};

/** The usable column, which every table is sized against. */
const CONTENT_WIDTH = PAGE.width - PAGE.margin * 2;

export function docx(blocks: Block[]): Buffer {
  return zip([
    {
      path: "[Content_Types].xml",
      data: text(
        XML_DECLARATION +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
          "</Types>",
      ),
    },
    {
      path: "_rels/.rels",
      data: text(
        XML_DECLARATION +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
          "</Relationships>",
      ),
    },
    {
      path: "word/_rels/document.xml.rels",
      data: text(
        XML_DECLARATION +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
          "</Relationships>",
      ),
    },
    { path: "word/styles.xml", data: text(STYLES) },
    { path: "word/document.xml", data: text(document(blocks)) },
  ]);
}

function text(value: string): Buffer {
  return Buffer.from(value, "utf8");
}

const W_NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function document(blocks: Block[]): string {
  return (
    XML_DECLARATION +
    `<w:document ${W_NS}><w:body>` +
    blocks.map(block).join("") +
    `<w:sectPr>` +
    `<w:pgSz w:w="${PAGE.width}" w:h="${PAGE.height}"/>` +
    `<w:pgMar w:top="${PAGE.margin}" w:right="${PAGE.margin}" w:bottom="${PAGE.margin}" w:left="${PAGE.margin}" w:header="708" w:footer="708" w:gutter="0"/>` +
    `</w:sectPr>` +
    "</w:body></w:document>"
  );
}

function block(item: Block): string {
  switch (item.kind) {
    case "title":
      return (
        paragraph(item.text, { style: "Title" }) +
        (item.subtitle === undefined
          ? ""
          : paragraph(item.subtitle, { style: "Subtitle" }))
      );

    case "heading":
      return paragraph(item.text, {
        style: item.level === 1 ? "Heading1" : "Heading2",
      });

    case "paragraph":
      return paragraph(item.text, {
        italic: item.italic,
        muted: item.muted,
      });

    case "bullet":
      // A literal bullet character rather than a `numbering.xml` list.
      // Word's list machinery needs a whole extra part, a relationship and an
      // abstract-numbering definition to draw the same glyph at the same
      // indent, and none of that survives a paste into another editor any
      // better than this does.
      return paragraph(`• ${item.text}`, { indent: 284 });

    case "stats":
      // A one-row table whose cells stack the label over the value: the same
      // reading order as the tinted tiles the PDF and the web preview draw,
      // in the only layout primitive Word gives without a floating frame.
      return table({
        header: item.items.map((entry) => entry.label),
        rows: [item.items.map((entry) => entry.value)],
      });

    case "table":
      return table(item);
  }
}

function paragraph(
  value: string,
  options: {
    style?: string;
    italic?: boolean;
    muted?: boolean;
    indent?: number;
  } = {},
): string {
  const properties =
    "<w:pPr>" +
    (options.style === undefined ? "" : `<w:pStyle w:val="${options.style}"/>`) +
    (options.indent === undefined
      ? ""
      : `<w:ind w:left="${options.indent}"/>`) +
    "</w:pPr>";

  return `<w:p>${properties}${run(value, options)}</w:p>`;
}

function run(
  value: string,
  options: { italic?: boolean; muted?: boolean; bold?: boolean } = {},
): string {
  const properties =
    "<w:rPr>" +
    (options.bold === true ? "<w:b/>" : "") +
    (options.italic === true ? "<w:i/>" : "") +
    (options.muted === true ? '<w:color w:val="4A5170"/>' : "") +
    "</w:rPr>";

  // The text is split on newlines so a teacher's multi-line note keeps its
  // shape: `w:br` is the only way a single paragraph carries a line break, and
  // a raw newline inside `w:t` is collapsed to a space by every reader.
  const lines = value.split("\n");
  const content = lines
    .map(
      (line, index) =>
        (index === 0 ? "" : "<w:br/>") +
        `<w:t xml:space="preserve">${xmlEscape(line)}</w:t>`,
    )
    .join("");

  return `<w:r>${properties}${content}</w:r>`;
}

function table(item: {
  header: string[];
  rows: string[][];
  widths?: number[];
}): string {
  const columns = Math.max(item.header.length, 1);

  // Proportions in, twips out — so a caller says "this column is twice that
  // one" and the table still fits the page whatever the margins are.
  const weights =
    item.widths ?? Array.from({ length: columns }, () => 1 / columns);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const widths = weights.map((weight) =>
    Math.round((CONTENT_WIDTH * weight) / total),
  );

  const grid =
    "<w:tblGrid>" +
    widths.map((width) => `<w:gridCol w:w="${width}"/>`).join("") +
    "</w:tblGrid>";

  const header =
    "<w:tr>" +
    // `tblHeader` repeats this row at the top of every page the table spills
    // onto, which is the difference between a printed report and a puzzle.
    '<w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>' +
    item.header
      .map((label, index) => cell(label, widths[index], true))
      .join("") +
    "</w:tr>";

  const body = item.rows
    .map(
      (row) =>
        "<w:tr>" +
        Array.from({ length: columns }, (_, index) =>
          cell(row[index] ?? "", widths[index], false),
        ).join("") +
        "</w:tr>",
    )
    .join("");

  return (
    "<w:tbl><w:tblPr>" +
    '<w:tblStyle w:val="ReportTable"/>' +
    `<w:tblW w:w="${CONTENT_WIDTH}" w:type="dxa"/>` +
    '<w:tblLayout w:type="fixed"/>' +
    "</w:tblPr>" +
    grid +
    header +
    body +
    "</w:tbl>" +
    // Word requires a paragraph after a table; without it two adjacent tables
    // merge into one and the document ends malformed.
    "<w:p/>"
  );
}

function cell(value: string, width: number, header: boolean): string {
  const shading = header
    ? '<w:shd w:val="clear" w:color="auto" w:fill="EDF0FF"/>'
    : "";

  return (
    "<w:tc><w:tcPr>" +
    `<w:tcW w:w="${width}" w:type="dxa"/>` +
    shading +
    "</w:tcPr>" +
    `<w:p><w:pPr><w:spacing w:before="40" w:after="40"/></w:pPr>${run(value, { bold: header })}</w:p>` +
    "</w:tc>"
  );
}

/**
 * The five styles the report uses, and the table border set.
 *
 * Sizes are half-points: `w:sz w:val="48"` is 24pt. The palette is the
 * application's own — `#1B2036` for headings, `#4466EE` for the title,
 * `#E8E6DE` for rules — so a printed report and the screen it came from are
 * recognisably the same document.
 *
 * `Heading1` and `Heading2` carry `w:outlineLvl`, which is what puts them in
 * Word's navigation pane and in a generated table of contents. That is the
 * "structured headings" §6 asks for; a bold paragraph would look identical and
 * navigate to nothing.
 */
const STYLES =
  XML_DECLARATION +
  `<w:styles ${W_NS}>` +
  "<w:docDefaults><w:rPrDefault><w:rPr>" +
  '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>' +
  '<w:sz w:val="20"/><w:szCs w:val="20"/>' +
  '<w:color w:val="1B2036"/>' +
  "</w:rPr></w:rPrDefault>" +
  '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault>' +
  "</w:docDefaults>" +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/>' +
  '<w:pPr><w:spacing w:after="40"/></w:pPr>' +
  '<w:rPr><w:b/><w:sz w:val="40"/><w:color w:val="1B2036"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/>' +
  '<w:pPr><w:spacing w:after="240"/></w:pPr>' +
  '<w:rPr><w:sz w:val="20"/><w:color w:val="4A5170"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>' +
  '<w:pPr><w:outlineLvl w:val="0"/><w:spacing w:before="320" w:after="120"/></w:pPr>' +
  '<w:rPr><w:b/><w:sz w:val="26"/><w:color w:val="1B2036"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/>' +
  '<w:pPr><w:outlineLvl w:val="1"/><w:spacing w:before="240" w:after="80"/></w:pPr>' +
  '<w:rPr><w:b/><w:sz w:val="22"/><w:color w:val="4466EE"/></w:rPr></w:style>' +
  '<w:style w:type="table" w:styleId="ReportTable"><w:name w:val="Report Table"/>' +
  "<w:tblPr><w:tblBorders>" +
  '<w:top w:val="single" w:sz="4" w:color="E8E6DE"/>' +
  '<w:left w:val="single" w:sz="4" w:color="E8E6DE"/>' +
  '<w:bottom w:val="single" w:sz="4" w:color="E8E6DE"/>' +
  '<w:right w:val="single" w:sz="4" w:color="E8E6DE"/>' +
  '<w:insideH w:val="single" w:sz="4" w:color="E8E6DE"/>' +
  '<w:insideV w:val="single" w:sz="4" w:color="E8E6DE"/>' +
  "</w:tblBorders>" +
  '<w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar>' +
  "</w:tblPr></w:style>" +
  "</w:styles>";
