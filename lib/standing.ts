import { SKILLS, SKILL_LABELS } from "@/lib/lesson-log";

/**
 * How many strengths or focus areas one student may carry, and how long each
 * one may be.
 *
 * `class_members.strengths` and `class_members.focus_areas` are plain
 * `text[] not null default '{}'`. The migration puts no length, no count and no
 * vocabulary constraint on either, and no view narrows them — so the limits
 * below are application limits, chosen rather than discovered, and they are the
 * only ones that exist. Nothing downstream will catch a value that gets past
 * them, which is the reason they are enforced on the server and not only in the
 * editor.
 *
 * Ten is well above what a teacher writes about a real student and well below
 * anything that would distort a roster card. Eighty characters holds a full
 * phrase — "Linking ideas across paragraphs" is thirty-one — while still
 * refusing a pasted paragraph.
 */
export const MAX_TAGS = 10;
export const MAX_TAG_LENGTH = 80;

/**
 * The vocabulary offered as suggestions, taken from `public.skill`.
 *
 * These two columns are deliberately `text[]` and not `skill[]`: the schema
 * comment calls `focus_areas` "Teacher-curated current focus", and a teacher's
 * real note is usually narrower than an enum value — "Past perfect", "Task 2
 * structure". So this list is a datalist and nothing more. It constrains
 * nothing and is never validated against; it exists so the common answers are
 * one keystroke away rather than retyped for every student.
 *
 * `general` is left out. It is the lesson-log catch-all for a note that covers
 * no single skill, which is not something a student is good or bad at.
 */
export const TAG_SUGGESTIONS: readonly string[] = SKILLS.filter(
  (skill) => skill !== "general",
).map((skill) => SKILL_LABELS[skill]);

/** Why a submitted list was refused. One reason, the first one found. */
export type TagRejection =
  | { kind: "shape" }
  | { kind: "blank" }
  | { kind: "too-long" }
  | { kind: "duplicate"; value: string }
  | { kind: "too-many" };

export type TagsResult =
  | { ok: true; tags: string[] }
  | { ok: false; rejection: TagRejection };

/**
 * Validates one submitted list into the array the column will store.
 *
 * Refuses rather than repairs. An overlong tag is rejected instead of truncated
 * and a repeated tag is rejected instead of quietly dropped, because both are
 * things the teacher typed: silently storing something they did not write is
 * worse than telling them what went wrong. Whitespace is the sole exception —
 * trimming " Speaking " to "Speaking" changes nothing they meant.
 *
 * Order is preserved exactly as submitted. `text[]` is ordered, the editor
 * shows the tags in that order, and nothing here sorts or reorders them.
 *
 * Duplicates are compared case-folded but stored as typed. That is the only
 * normalisation beyond trimming: "speaking" and "Speaking" are the same tag and
 * a card should not carry both, yet whichever capitalisation the teacher chose
 * is the one that gets written.
 *
 * The input is `unknown[]` because it comes from `FormData.getAll`, which
 * returns files as readily as strings. A non-string entry is a forged request,
 * not a typo, and is refused on shape before anything else looks at it.
 */
export function readTags(submitted: readonly unknown[]): TagsResult {
  const tags: string[] = [];
  const seen = new Set<string>();

  for (const raw of submitted) {
    if (typeof raw !== "string") {
      return { ok: false, rejection: { kind: "shape" } };
    }

    const value = raw.trim();

    if (value === "") {
      return { ok: false, rejection: { kind: "blank" } };
    }

    if (value.length > MAX_TAG_LENGTH) {
      return { ok: false, rejection: { kind: "too-long" } };
    }

    const key = value.toLocaleLowerCase();

    if (seen.has(key)) {
      return { ok: false, rejection: { kind: "duplicate", value } };
    }

    seen.add(key);
    tags.push(value);
  }

  // Counted after the loop rather than inside it, so an eleventh tag reads as
  // "too many" instead of whatever happened to be wrong with that one.
  if (tags.length > MAX_TAGS) {
    return { ok: false, rejection: { kind: "too-many" } };
  }

  return { ok: true, tags };
}
