import "server-only";

import { crc32, deflateRawSync } from "node:zlib";

/**
 * A minimal ZIP writer, because `.docx` and `.xlsx` are ZIP files.
 *
 * ## Why this is not a dependency
 *
 * Both Office formats are OOXML: a handful of XML parts inside a ZIP container
 * with a fixed directory layout. The XML is ours to write either way — a
 * library would not spare us that — so the only thing a `docx`/`xlsx` package
 * would actually contribute is the container, and Node already ships both
 * halves of it: `zlib.deflateRawSync` produces the DEFLATE stream the format
 * stores, and `zlib.crc32` produces the checksum each entry carries. Decision
 * **E** says do not add a dependency that earns nothing, and §7 of the
 * milestone says to inspect `package.json` before reaching for one. Two hundred
 * lines here replace two transitive trees, and every byte a parent's copy of
 * Word will open is one we chose deliberately.
 *
 * ## What it implements, and what it does not
 *
 * The ZIP specification is large; the subset Office readers require is small.
 * This writes local file headers, DEFLATE-compressed entry data, a central
 * directory and an end-of-central-directory record — version 2.0, method 8, no
 * encryption, no data descriptors, no ZIP64. That is sufficient because the
 * archives are a few dozen kilobytes of XML: ZIP64 exists for members past 4 GB
 * and archives past 65535 entries, and a monthly report reaches neither. If a
 * future report ever could, `zip()` throws rather than emitting a truncated
 * field — a corrupt document that opens to an error is worse than a refusal
 * the server can log.
 *
 * Every filename is stored UTF-8 with bit 11 of the general-purpose flag set,
 * which is how a modern reader is told not to guess CP437. The paths inside an
 * OOXML package are ASCII anyway, but the flag costs nothing and removes a
 * class of question.
 *
 * The DOS timestamp is fixed rather than `new Date()`. Two exports of the same
 * report then produce byte-identical files, which makes the archives
 * diffable and the verification in §15 reproducible; no reader displays these
 * fields anywhere a parent would look.
 */

export type ZipEntry = {
  /** The path inside the archive, e.g. `word/document.xml`. Forward slashes. */
  path: string;
  data: Buffer;
};

/** 1 January 2020, 00:00:00, in the DOS date/time encoding ZIP inherited. */
const DOS_TIME = 0;
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;

/** Bit 11: the filename is UTF-8, not CP437. */
const FLAG_UTF8 = 0x0800;

const METHOD_DEFLATE = 8;

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;

const MAX_UINT16 = 0xffff;
const MAX_UINT32 = 0xffffffff;

export function zip(entries: ZipEntry[]): Buffer {
  if (entries.length > MAX_UINT16) {
    throw new Error("zip: too many entries for a non-ZIP64 archive");
  }

  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.path, "utf8");
    const compressed = deflateRawSync(entry.data, { level: 9 });

    if (
      entry.data.length > MAX_UINT32 ||
      compressed.length > MAX_UINT32 ||
      offset > MAX_UINT32
    ) {
      throw new Error("zip: entry too large for a non-ZIP64 archive");
    }

    const checksum = crc32(entry.data);

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(LOCAL_SIGNATURE, 0);
    local.writeUInt16LE(20, 4); // version needed to extract: 2.0
    local.writeUInt16LE(FLAG_UTF8, 6);
    local.writeUInt16LE(METHOD_DEFLATE, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // no extra field
    name.copy(local, 30);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(CENTRAL_SIGNATURE, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed to extract
    central.writeUInt16LE(FLAG_UTF8, 8);
    central.writeUInt16LE(METHOD_DEFLATE, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra field length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal attributes
    central.writeUInt32LE(0, 38); // external attributes
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);

    locals.push(local, compressed);
    centrals.push(central);
    offset += local.length + compressed.length;
  }

  const directory = Buffer.concat(centrals);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(EOCD_SIGNATURE, 0);
  end.writeUInt16LE(0, 4); // this disk
  end.writeUInt16LE(0, 6); // disk with the central directory
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // no archive comment

  return Buffer.concat([...locals, directory, end]);
}

/**
 * Text escaped for an XML text node or attribute value.
 *
 * All five predefined entities, not the usual three: these documents carry
 * teacher-written notes and student names verbatim, and a stray `'` inside a
 * single-quoted attribute is as much a broken document as a stray `<`. The
 * C0 control characters XML 1.0 forbids outright are dropped rather than
 * escaped — there is no encoding that makes them legal, and a document Word
 * refuses to open is a worse outcome than a lost control byte nobody typed on
 * purpose.
 */
export function xmlEscape(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** The XML declaration every OOXML part begins with. */
export const XML_DECLARATION =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';
