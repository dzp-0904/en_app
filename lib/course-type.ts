import type { Database } from "./database.types";

/**
 * Course type, teaching type, and the scoring rule that ties them to the
 * database's CHECK constraints.
 *
 * Two columns are involved and they are not the same thing:
 *
 *   profiles.teaching_type  free text, teacher-only, "what I mostly teach"
 *   classes.course_type     enum, per class, "what this class is"
 *
 * `teaching_type` has no constraint at all, so it could hold anything. It stores
 * the slug rather than the display label because a label is copy — renaming
 * "General English" in the UI must not orphan existing rows. `LABELS` is the
 * single place the two are related.
 */

export type CourseType = Database["public"]["Enums"]["course_type"];
export type ScoringModel = Database["public"]["Enums"]["scoring_model"];

/**
 * The three types offered in onboarding.
 *
 * The enum also carries `other`, which is deliberately absent here: selecting it
 * would violate `classes_course_type_other_required`, which requires a non-null
 * `course_type_other` whenever `course_type = 'other'`, and the Figma has no
 * field to collect that value.
 */
export const COURSE_TYPES = [
  "ielts",
  "general_english",
  "academic_english",
] as const satisfies readonly CourseType[];

export type OfferedCourseType = (typeof COURSE_TYPES)[number];

export const LABELS: Record<OfferedCourseType, string> = {
  ielts: "IELTS",
  general_english: "General English",
  academic_english: "Academic English",
};

export function isOfferedCourseType(
  value: string | null | undefined,
): value is OfferedCourseType {
  return (COURSE_TYPES as readonly string[]).includes(value ?? "");
}

/**
 * Accepts a display label as well as a slug.
 *
 * A teacher provisioned out-of-band with `app.provision_teacher(uuid, 'IELTS')`
 * has the label stored, not the slug. Reading tolerantly means their onboarding
 * resumes with the right option pre-selected instead of appearing unanswered.
 */
export function normaliseTeachingType(
  value: string | null | undefined,
): OfferedCourseType | null {
  if (!value) return null;

  const trimmed = value.trim();
  if (isOfferedCourseType(trimmed)) return trimmed;

  const matched = COURSE_TYPES.find(
    (type) => LABELS[type].toLowerCase() === trimmed.toLowerCase(),
  );

  return matched ?? null;
}

/**
 * Only IELTS classes are scored on the band scale.
 *
 * This is what keeps `classes_no_target_band_when_unscored` satisfiable:
 * `scoring_model = 'none'` forbids a target band outright, so a General English
 * class must carry `target_band = null`. The rule lives here rather than in the
 * form so that the server enforces it whatever the browser submitted.
 */
export function scoringModelFor(courseType: OfferedCourseType): ScoringModel {
  return courseType === "ielts" ? "ielts_band" : "none";
}

/**
 * The Figma's target band list. `public.band` accepts 0.0–9.0 on the half-point
 * grid; these are the values the design offers.
 */
export const TARGET_BANDS = [
  "5.0",
  "5.5",
  "6.0",
  "6.5",
  "7.0",
  "7.5",
  "8.0",
] as const;

/**
 * The band to store, given what the form submitted.
 *
 * Returns null for every non-IELTS class regardless of what arrived, because the
 * band control stays in the DOM when CSS `:has()` is unsupported and would
 * otherwise post a value the CHECK constraint rejects.
 */
export function targetBandFor(
  courseType: OfferedCourseType,
  submitted: string | null,
): number | null {
  if (scoringModelFor(courseType) === "none") return null;
  if (!submitted) return null;

  const parsed = Number.parseFloat(submitted);
  if (!Number.isFinite(parsed)) return null;

  // Mirrors the `public.band` domain: 0-9 on half-points.
  if (parsed < 0 || parsed > 9) return null;
  if (parsed * 2 !== Math.floor(parsed * 2)) return null;

  return parsed;
}
