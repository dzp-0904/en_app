import {
  isOfferedCourseType,
  scoringModelFor,
  type CourseType,
} from "./course-type";
import type { Database } from "./database.types";

/**
 * `public.score_entry_type`, `public.member_status` and the `public.band`
 * domain, and what each of them is called on screen.
 *
 * Pure and shared, for the same reason `lib/attendance.ts` and
 * `lib/lesson-log.ts` are: these are mirrors of what the database already
 * declares, not either side's logic. A teacher records a band and a student
 * reads it back, and the two have to agree about which values exist and what
 * they are called.
 *
 * Nothing here is privileged, so nothing here is `server-only`.
 */

/**
 * Whether this class keeps bands at all.
 *
 * `scoringModelFor` is the existing rule and stays the only one: only IELTS
 * classes are scored, which is what makes `classes_no_target_band_when_unscored`
 * satisfiable. This wrapper exists because that function speaks
 * `OfferedCourseType` while a stored class carries `CourseType`, which also
 * admits `'other'` — a course nobody is offered and, like every non-IELTS
 * course, one with no band scale.
 *
 * Both the page and the Server Action ask this, so a section that is not on
 * screen is also a section that cannot be posted to.
 */
export function isBandScored(courseType: CourseType): boolean {
  return (
    isOfferedCourseType(courseType) &&
    scoringModelFor(courseType) === "ielts_band"
  );
}

export type ScoreEntryType = Database["public"]["Enums"]["score_entry_type"];
export type MemberStatus = Database["public"]["Enums"]["member_status"];

/** Every value `public.score_entry_type` carries, in declaration order. */
export const SCORE_ENTRY_TYPES = [
  "baseline",
  "progress",
  "mock_test",
] as const satisfies readonly ScoreEntryType[];

/**
 * What each kind of entry is called on screen.
 *
 * "Band ban đầu" rather than "cơ sở" because "starting" is the word the schema
 * itself uses for it — see the comment on `score_entries` — and the word
 * `v_member_current_band` names its columns after (`start_*` / `current_*`).
 */
export const SCORE_ENTRY_TYPE_LABELS: Record<ScoreEntryType, string> = {
  baseline: "Band ban đầu",
  progress: "Kiểm tra tiến bộ",
  mock_test: "Thi thử",
};

export function isScoreEntryType(value: string): value is ScoreEntryType {
  return (SCORE_ENTRY_TYPES as readonly string[]).includes(value);
}

/** `public.member_status`, as `v_member_performance_status` reports it. */
export const MEMBER_STATUS_LABELS: Record<MemberStatus, string> = {
  improving: "Đang tiến bộ",
  stable: "Ổn định",
  needs_attention: "Cần chú ý",
};

/**
 * The four skills a band is recorded against, plus the overall band.
 *
 * These are columns on `score_entries`, not values of `public.skill` — the
 * lesson-note enum has a fifth member (`general`) that has no column here, so
 * the two lists are deliberately not the same list.
 */
export const BAND_SKILLS = [
  "reading",
  "listening",
  "writing",
  "speaking",
] as const;

export type BandSkill = (typeof BAND_SKILLS)[number];

export const BAND_FIELD_LABELS: Record<BandSkill | "overall", string> = {
  overall: "Tổng thể",
  reading: "Đọc",
  listening: "Nghe",
  writing: "Viết",
  speaking: "Nói",
};

/** Every band field, overall first — the order they are shown and stored in. */
export const BAND_FIELDS = ["overall", ...BAND_SKILLS] as const;

/**
 * Every value the `public.band` domain admits, as the strings a `<select>`
 * offers.
 *
 * The domain is `numeric(2, 1) check (value >= 0 and value <= 9 and
 * (value * 2) = floor(value * 2))` — every half point from 0 to 9. This list is
 * that constraint written out, so the options a teacher is offered and the
 * values the database will accept are the same set by construction.
 *
 * `lib/course-type.ts` offers a narrower list for a class's *target* band, which
 * is a product decision about realistic goals. This one is the domain itself,
 * because a real result can legitimately be any band.
 */
export const BAND_VALUES: readonly string[] = Array.from(
  { length: 19 },
  (_, i) => (i / 2).toFixed(1),
);

/**
 * What a submitted band field turned out to be.
 *
 * Three outcomes rather than two, because a blank field is not a failure: an
 * entry may record speaking and nothing else, and `null` is how the schema
 * stores "not measured". Only `ok: false` means the browser sent something the
 * domain would refuse.
 */
export type BandResult = { ok: true; band: number | null } | { ok: false };

/**
 * Read one band field the way `public.band` would.
 *
 * The same three tests the domain's CHECK makes, in the same order, before the
 * value ever reaches Postgres: in range, and on a half point. A value that fails
 * is refused rather than rounded — `Number("6.7")` is a perfectly good number
 * and silently storing 6.5 or 7.0 for it would be inventing a result nobody
 * recorded.
 */
export function readBand(submitted: string): BandResult {
  const trimmed = submitted.trim();
  if (trimmed === "") return { ok: true, band: null };

  const value = Number(trimmed);
  if (!Number.isFinite(value)) return { ok: false };
  if (value < 0 || value > 9) return { ok: false };
  if (value * 2 !== Math.floor(value * 2)) return { ok: false };

  return { ok: true, band: value };
}

/**
 * How a band reads on screen.
 *
 * One decimal place always, because 6 and 6.0 are the same band and IELTS writes
 * it the second way. `null` is the caller's to handle: a missing skill is not a
 * zero, and this returns nothing that could be mistaken for one.
 */
export function formatBand(band: number | null): string | null {
  return band === null ? null : band.toFixed(1);
}

/**
 * A cap on an entry's note.
 *
 * `score_entries.note` is plain `text` with no constraint, so this number is the
 * application's rather than the database's — the same arrangement, and the same
 * limit, as `NOTE_MAX_LENGTH` in `lib/lesson-log.ts`. Nothing truncates:
 * over-long input is refused with the text still in the teacher's hands.
 */
export const SCORE_NOTE_MAX_LENGTH = 2000;
