import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import fontkit from "@pdf-lib/fontkit";
import {
  PDFDocument,
  PDFFont,
  PDFPage,
  rgb,
  type RGB,
} from "pdf-lib";

import type { Block } from "@/lib/export/blocks";

/**
 * The parent-facing PDF: a laid-out document, not a screenshot.
 *
 * ## Why a font is bundled
 *
 * A PDF's fourteen standard fonts are WinAnsi-encoded. WinAnsi has no ế, no ữ
 * and no ạ, so a report generated with them prints a Vietnamese student's name
 * as gibberish or drops it entirely — which for this application is every
 * report. Drawing Vietnamese requires an embedded font addressed through a CID
 * encoding, and that is the whole reason `pdf-lib` and `@pdf-lib/fontkit` are
 * the milestone's only new dependencies: fontkit parses the TTF and subsets it
 * to the glyphs actually used, so a report carries a few tens of kilobytes of
 * font rather than the whole 56 KB face twice over.
 *
 * The bundled face is **Public Sans**, under the SIL Open Font License
 * (`assets/fonts/OFL.txt`). It is not an arbitrary choice: it is already this
 * application's UI typeface, loaded by `app/layout.tsx` through
 * `next/font/google` with the `vietnamese` subset, so the downloaded document
 * and the screen it was previewed on are set in the same letters.
 *
 * Embedding is done with `{ subset: true }`, and the resulting font carries a
 * `ToUnicode` CMap — which means the text in these files is selectable,
 * searchable, and extractable by a script. That last property is what makes
 * §15's "inspect generated files programmatically rather than relying only on
 * HTTP 200" possible at all.
 *
 * ## Why the layout is hand-run
 *
 * There is no HTML-to-PDF step and no headless browser. §6 asks for
 * deterministic server-side generation and warns against depending on the
 * browser's print dialog; a Chromium in the container to lay out one A4 page
 * would be two orders of magnitude more machinery than the drawing below, and
 * it would put the report's appearance at the mercy of a print stylesheet
 * nobody looks at. So this is a small typesetter: a cursor down the page, a
 * measured word-wrap against the real embedded font, and a page break when the
 * next block will not fit.
 *
 * The one rule the layout keeps everywhere: **nothing is drawn that cannot be
 * measured first.** Every block computes its height before it claims space, so
 * a long teacher's note breaks across pages instead of running off the bottom.
 */

/** A4 in points, and a margin that leaves a comfortable measure. */
const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 48;
const CONTENT_WIDTH = PAGE.width - MARGIN * 2;

const SIZE = {
  title: 20,
  subtitle: 10,
  h1: 14,
  h2: 11,
  body: 9.5,
  small: 8.5,
  stat: 15,
};

const LEADING = 1.35;

/** The application's palette, so the document and the screen match. */
const INK = hex("#1B2036");
const MUTED = hex("#4A5170");
const PRIMARY = hex("#4466EE");
const RULE = hex("#E8E6DE");
const TINT = hex("#EDF0FF");
const SURFACE = hex("#F7F6F1");
const PAPER = hex("#FFFFFF");

const FONT_DIR = path.join(process.cwd(), "assets", "fonts");

type Fonts = { regular: PDFFont; bold: PDFFont };

/**
 * A cursor over a growing pile of pages.
 *
 * `y` is the baseline-independent top of the next block, measured down from the
 * top of the page as PDF coordinates count up from the bottom — so the whole
 * layout works in "distance from the top" and converts once, at the draw call.
 */
class Layout {
  private page: PDFPage;
  private top: number;

  constructor(
    private readonly doc: PDFDocument,
    private readonly fonts: Fonts,
  ) {
    this.page = doc.addPage([PAGE.width, PAGE.height]);
    this.top = MARGIN;
  }

  /** Room left on the current page. */
  get remaining(): number {
    return PAGE.height - MARGIN - this.top;
  }

  /** Start a new page when `height` will not fit on this one. */
  reserve(height: number): void {
    if (height <= this.remaining) return;
    this.page = this.doc.addPage([PAGE.width, PAGE.height]);
    this.top = MARGIN;
  }

  advance(height: number): void {
    this.top += height;
  }

  get cursor(): number {
    return this.top;
  }

  get sheet(): PDFPage {
    return this.page;
  }

  /** Convert "distance from the top" to the PDF's own y axis. */
  yOf(fromTop: number): number {
    return PAGE.height - fromTop;
  }

  font(bold: boolean): PDFFont {
    return bold ? this.fonts.bold : this.fonts.regular;
  }
}

export async function reportPdf(blocks: Block[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);

  const [regular, bold] = await Promise.all([
    readFile(path.join(FONT_DIR, "PublicSans-400.ttf")),
    readFile(path.join(FONT_DIR, "PublicSans-600.ttf")),
  ]);

  const fonts: Fonts = {
    regular: await doc.embedFont(regular, { subset: true }),
    bold: await doc.embedFont(bold, { subset: true }),
  };

  const layout = new Layout(doc, fonts);

  for (const item of blocks) draw(layout, item);

  doc.setTitle(titleOf(blocks));
  doc.setCreator("EduTrack");
  doc.setProducer("EduTrack");

  return Buffer.from(await doc.save());
}

function titleOf(blocks: Block[]): string {
  const title = blocks.find((item) => item.kind === "title");
  return title === undefined ? "Báo cáo tiến bộ" : title.text;
}

function draw(layout: Layout, item: Block): void {
  switch (item.kind) {
    case "title":
      return drawTitle(layout, item.text, item.subtitle);
    case "heading":
      return drawHeading(layout, item.level, item.text);
    case "paragraph":
      return drawParagraph(layout, item.text, item.muted === true);
    case "bullet":
      return drawBullet(layout, item.text);
    case "stats":
      return drawStats(layout, item.items);
    case "table":
      return drawTable(layout, item.header, item.rows, item.widths);
  }
}

/**
 * The navy identity band.
 *
 * The Figma's report card opens on a `#1B2036` header carrying the student's
 * name and the class · month · teacher line, and that is the one piece of the
 * design that translates to paper unchanged: a parent opening this should see
 * at a glance whose report it is and which month it covers, before any number.
 */
function drawTitle(layout: Layout, title: string, subtitle?: string): void {
  const titleLines = wrap(
    layout.font(true),
    SIZE.title,
    title,
    CONTENT_WIDTH - 32,
  );
  const subtitleLines =
    subtitle === undefined
      ? []
      : wrap(layout.font(false), SIZE.subtitle, subtitle, CONTENT_WIDTH - 32);

  const height =
    24 +
    titleLines.length * SIZE.title * LEADING +
    (subtitleLines.length === 0
      ? 0
      : 6 + subtitleLines.length * SIZE.subtitle * LEADING) +
    24;

  layout.reserve(height);

  layout.sheet.drawRectangle({
    x: MARGIN,
    y: layout.yOf(layout.cursor + height),
    width: CONTENT_WIDTH,
    height,
    color: INK,
  });

  let y = layout.cursor + 24;

  for (const line of titleLines) {
    layout.sheet.drawText(line, {
      x: MARGIN + 16,
      y: layout.yOf(y + SIZE.title),
      size: SIZE.title,
      font: layout.font(true),
      color: PAPER,
    });
    y += SIZE.title * LEADING;
  }

  if (subtitleLines.length > 0) {
    y += 6;
    for (const line of subtitleLines) {
      layout.sheet.drawText(line, {
        x: MARGIN + 16,
        y: layout.yOf(y + SIZE.subtitle),
        size: SIZE.subtitle,
        font: layout.font(false),
        // The band is dark, so the muted tone is a lightened white rather than
        // the grey used on paper — same role, legible ground.
        color: rgb(0.78, 0.8, 0.88),
      });
      y += SIZE.subtitle * LEADING;
    }
  }

  layout.advance(height + 18);
}

function drawHeading(layout: Layout, level: 1 | 2, value: string): void {
  const size = level === 1 ? SIZE.h1 : SIZE.h2;
  const before = level === 1 ? 10 : 8;
  const after = 6;

  const lines = wrap(layout.font(true), size, value, CONTENT_WIDTH);
  const height = before + lines.length * size * LEADING + after;

  // A heading that lands at the foot of a page with nothing under it is worse
  // than a slightly short page: it takes the next block with it.
  layout.reserve(height + size * 3);

  let y = layout.cursor + before;
  for (const line of lines) {
    layout.sheet.drawText(line, {
      x: MARGIN,
      y: layout.yOf(y + size),
      size,
      font: layout.font(true),
      color: level === 1 ? INK : PRIMARY,
    });
    y += size * LEADING;
  }

  if (level === 1) {
    layout.sheet.drawLine({
      start: { x: MARGIN, y: layout.yOf(y + 3) },
      end: { x: MARGIN + CONTENT_WIDTH, y: layout.yOf(y + 3) },
      thickness: 1,
      color: RULE,
    });
  }

  layout.advance(height);
}

function drawParagraph(layout: Layout, value: string, muted: boolean): void {
  // A teacher's note keeps its own line breaks; each one is then wrapped.
  const lines = value
    .split("\n")
    .flatMap((line) =>
      line.trim() === ""
        ? [""]
        : wrap(layout.font(false), SIZE.body, line, CONTENT_WIDTH),
    );

  drawLines(layout, lines, MARGIN, SIZE.body, muted ? MUTED : INK, 4);
}

function drawBullet(layout: Layout, value: string): void {
  const indent = 14;
  const lines = wrap(
    layout.font(false),
    SIZE.body,
    value,
    CONTENT_WIDTH - indent,
  );

  const height = lines.length * SIZE.body * LEADING + 3;
  layout.reserve(height);

  layout.sheet.drawText("•", {
    x: MARGIN,
    y: layout.yOf(layout.cursor + SIZE.body),
    size: SIZE.body,
    font: layout.font(false),
    color: PRIMARY,
  });

  drawLines(layout, lines, MARGIN + indent, SIZE.body, INK, 3);
}

/**
 * The headline figures, as tinted tiles.
 *
 * The Figma's "IELTS Progress" row is three large numbers with small labels
 * under them, and its skill row is four tinted squares. Both are the same
 * shape, so this draws one: an even row of boxes on `#F7F6F1` with the label
 * above the value. Six across is the most that stays legible on A4; past that
 * it wraps to a second row rather than shrinking the type.
 */
function drawStats(
  layout: Layout,
  items: { label: string; value: string }[],
): void {
  if (items.length === 0) return;

  const perRow = Math.min(items.length, 4);
  const gap = 8;
  const boxWidth = (CONTENT_WIDTH - gap * (perRow - 1)) / perRow;
  const boxHeight = 46;

  for (let start = 0; start < items.length; start += perRow) {
    const row = items.slice(start, start + perRow);

    layout.reserve(boxHeight + gap);
    const top = layout.cursor;

    row.forEach((entry, index) => {
      const x = MARGIN + index * (boxWidth + gap);

      layout.sheet.drawRectangle({
        x,
        y: layout.yOf(top + boxHeight),
        width: boxWidth,
        height: boxHeight,
        color: SURFACE,
      });

      const label = clip(
        layout.font(false),
        SIZE.small,
        entry.label,
        boxWidth - 16,
      );
      const value = clip(layout.font(true), SIZE.stat, entry.value, boxWidth - 16);

      layout.sheet.drawText(label, {
        x: x + 8,
        y: layout.yOf(top + 8 + SIZE.small),
        size: SIZE.small,
        font: layout.font(false),
        color: MUTED,
      });

      layout.sheet.drawText(value, {
        x: x + 8,
        y: layout.yOf(top + boxHeight - 10),
        size: SIZE.stat,
        font: layout.font(true),
        color: INK,
      });
    });

    layout.advance(boxHeight + gap);
  }

  layout.advance(4);
}

/**
 * A table whose rows are as tall as their tallest wrapped cell.
 *
 * Every cell is measured against the real font before anything is drawn, so a
 * three-line teacher's note lengthens its row instead of overprinting the row
 * below. A row that will not fit starts a new page and the header is redrawn
 * there, which is what makes a long lesson table readable on paper.
 */
function drawTable(
  layout: Layout,
  header: string[],
  rows: string[][],
  proportions?: number[],
): void {
  const columns = Math.max(header.length, 1);
  const weights =
    proportions ?? Array.from({ length: columns }, () => 1 / columns);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const widths = weights.map((weight) => (CONTENT_WIDTH * weight) / total);

  const padding = 5;
  const lineHeight = SIZE.small * LEADING;

  const cellLines = (value: string, column: number, bold: boolean): string[] =>
    value
      .split("\n")
      .flatMap((line) =>
        line.trim() === ""
          ? [""]
          : wrap(
              layout.font(bold),
              SIZE.small,
              line,
              widths[column] - padding * 2,
            ),
      );

  const headerLines = header.map((label, index) =>
    cellLines(label, index, true),
  );
  const headerHeight =
    Math.max(...headerLines.map((lines) => lines.length), 1) * lineHeight +
    padding * 2;

  const paint = (
    lines: string[][],
    height: number,
    bold: boolean,
    fill: RGB | undefined,
  ): void => {
    const top = layout.cursor;

    if (fill !== undefined) {
      layout.sheet.drawRectangle({
        x: MARGIN,
        y: layout.yOf(top + height),
        width: CONTENT_WIDTH,
        height,
        color: fill,
      });
    }

    let x = MARGIN;
    lines.forEach((cell, column) => {
      let y = top + padding;
      for (const line of cell) {
        layout.sheet.drawText(line, {
          x: x + padding,
          y: layout.yOf(y + SIZE.small),
          size: SIZE.small,
          font: layout.font(bold),
          color: bold ? INK : MUTED,
        });
        y += lineHeight;
      }
      x += widths[column];
    });

    layout.sheet.drawLine({
      start: { x: MARGIN, y: layout.yOf(top + height) },
      end: { x: MARGIN + CONTENT_WIDTH, y: layout.yOf(top + height) },
      thickness: 0.5,
      color: RULE,
    });

    layout.advance(height);
  };

  const drawHeaderRow = (): void => {
    layout.reserve(headerHeight);
    paint(headerLines, headerHeight, true, TINT);
  };

  drawHeaderRow();

  for (const row of rows) {
    const lines = Array.from({ length: columns }, (_, column) =>
      cellLines(row[column] ?? "", column, false),
    );
    const height =
      Math.max(...lines.map((cell) => cell.length), 1) * lineHeight +
      padding * 2;

    if (height > layout.remaining) {
      layout.reserve(height + headerHeight);
      drawHeaderRow();
    }

    paint(lines, height, false, undefined);
  }

  layout.advance(10);
}

/** Draw pre-wrapped lines, breaking pages between them. */
function drawLines(
  layout: Layout,
  lines: string[],
  x: number,
  size: number,
  color: RGB,
  after: number,
): void {
  const lineHeight = size * LEADING;

  for (const line of lines) {
    layout.reserve(lineHeight);
    if (line !== "") {
      layout.sheet.drawText(line, {
        x,
        y: layout.yOf(layout.cursor + size),
        size,
        font: layout.font(false),
        color,
      });
    }
    layout.advance(lineHeight);
  }

  layout.advance(after);
}

/**
 * Word wrap measured against the embedded font.
 *
 * Vietnamese is written with spaces between syllables, so word wrapping works
 * exactly as it does in English and no syllable-level breaking is needed. A
 * single token longer than the column — a URL, an unspaced string — is broken
 * character by character rather than allowed to run past the margin.
 */
function wrap(
  font: PDFFont,
  size: number,
  value: string,
  width: number,
): string[] {
  const words = value.split(/\s+/).filter((word) => word !== "");
  if (words.length === 0) return [""];

  const lines: string[] = [];
  let current = "";

  const widthOf = (candidate: string): number =>
    font.widthOfTextAtSize(candidate, size);

  for (const word of words) {
    const candidate = current === "" ? word : `${current} ${word}`;

    if (widthOf(candidate) <= width) {
      current = candidate;
      continue;
    }

    if (current !== "") {
      lines.push(current);
      current = "";
    }

    if (widthOf(word) <= width) {
      current = word;
      continue;
    }

    let chunk = "";
    for (const character of word) {
      if (widthOf(chunk + character) > width && chunk !== "") {
        lines.push(chunk);
        chunk = character;
      } else {
        chunk += character;
      }
    }
    current = chunk;
  }

  if (current !== "") lines.push(current);

  return lines.length === 0 ? [""] : lines;
}

/** One line, truncated with an ellipsis when it will not fit its box. */
function clip(
  font: PDFFont,
  size: number,
  value: string,
  width: number,
): string {
  if (font.widthOfTextAtSize(value, size) <= width) return value;

  let text = value;
  while (
    text.length > 1 &&
    font.widthOfTextAtSize(`${text}…`, size) > width
  ) {
    text = text.slice(0, -1);
  }

  return `${text}…`;
}

function hex(value: string): RGB {
  const int = parseInt(value.slice(1), 16);
  return rgb(
    ((int >> 16) & 255) / 255,
    ((int >> 8) & 255) / 255,
    (int & 255) / 255,
  );
}
