import "server-only";

import type { createClient } from "@/lib/supabase/server";

/**
 * Curriculum materials (giáo trình) — the metadata half of the feature.
 *
 * ## Why this module exists at all
 *
 * M30 audited the repository for an existing storage mechanism to reuse, as the
 * milestone asked, and found none: no bucket, no upload helper, no file
 * metadata table, no download route. A read-only `select ... from
 * storage.buckets` against the hosted project returned an empty list. So this
 * is the one part of M30 that could not be built out of what was already here,
 * and `supabase/migrations/20260901000100_class_materials.sql` is the smallest
 * secure design consistent with the rest of the schema.
 *
 * ## That migration is NOT APPLIED
 *
 * The standing instruction forbids executing migrations against the hosted
 * project, so it was written and left for review. Until a human runs it, every
 * function here fails its query and returns `null`, and the Giáo trình tab
 * renders the same "we could not load this" alert every other failed read
 * renders. That is a deliberate, honest degradation and not a silent one — the
 * tab does not pretend the feature works, and nothing here creates the table or
 * the bucket on demand.
 *
 * ## Security shape
 *
 * The object store is the enforcement, not this module. The bucket is private,
 * so an object's URL is not a capability; reads are served through a
 * short-lived signed URL minted per request for a teacher the route has just
 * re-authorised; and `storage.objects`' own policies compare the first path
 * segment against `app.my_class_ids()`, so a forged class id yields no object
 * rather than another teacher's file. There is no service-role key anywhere in
 * this feature, and no client-side Supabase call: every statement below runs on
 * the server carrying the signed-in teacher's own token.
 */

/** The private bucket the migration creates. Never made public. */
export const MATERIALS_BUCKET = "class-materials";

/** 25 MB, the same ceiling `storage.buckets.file_size_limit` sets. */
export const MAX_MATERIAL_BYTES = 26_214_400;

/**
 * The document types the milestone names, and nothing else.
 *
 * Duplicated deliberately from the bucket's `allowed_mime_types`: the bucket is
 * the boundary that actually holds, and this table is what lets the form refuse
 * a file in Vietnamese before spending an upload on it. If the two ever
 * disagree the bucket wins, which is the right way round.
 *
 * The extension is what a browser's file picker filters on and what a download
 * is named with. A mime type alone is not enough — browsers disagree about
 * `.doc`, and some send `application/octet-stream` for everything.
 */
export const MATERIAL_TYPES: ReadonlyArray<{
  mime: string;
  extension: string;
  label: string;
}> = [
  { mime: "application/pdf", extension: ".pdf", label: "PDF" },
  { mime: "application/msword", extension: ".doc", label: "Word" },
  {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extension: ".docx",
    label: "Word",
  },
  { mime: "application/vnd.ms-excel", extension: ".xls", label: "Excel" },
  {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    extension: ".xlsx",
    label: "Excel",
  },
  {
    mime: "application/vnd.ms-powerpoint",
    extension: ".ppt",
    label: "PowerPoint",
  },
  {
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    extension: ".pptx",
    label: "PowerPoint",
  },
];

/** The `accept` attribute for the upload input — extensions and mime types. */
export const MATERIAL_ACCEPT = MATERIAL_TYPES.flatMap((type) => [
  type.extension,
  type.mime,
]).join(",");

export type Material = {
  materialId: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  createdAt: string;
  /** Purely for display; never used to build a URL from the browser. */
  storagePath: string;
};

function logDbError(
  operation: string,
  error: { code?: string; message?: string },
): void {
  console.error("[materials] " + operation + " failed", {
    code: error.code,
    message: error.message,
  });
}

/**
 * Whether an uploaded file's declared type is one we accept.
 *
 * Checked on both halves — the mime the browser sent and the extension the name
 * ends in — because either alone is forgeable and neither alone is reliable.
 * The bucket re-checks the mime regardless, which is the check that counts.
 */
export function isAllowedMaterial(mime: string, fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return MATERIAL_TYPES.some(
    (type) => type.mime === mime && lower.endsWith(type.extension),
  );
}

/** The short label a file's type shows as, or its extension if unrecognised. */
export function materialTypeLabel(mime: string, fileName: string): string {
  const known = MATERIAL_TYPES.find((type) => type.mime === mime);
  if (known) return known.label;

  const dot = fileName.lastIndexOf(".");
  if (dot > 0 && dot < fileName.length - 1) {
    return fileName.slice(dot + 1).toUpperCase();
  }
  return "Tệp";
}

/**
 * A size a person can read, on the Vietnamese decimal comma.
 *
 * KB/MB here are the powers of 1024 every operating system's file browser
 * shows, so the number agrees with what the teacher saw before uploading.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0).replace(".", ",")} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

/**
 * The object key a new upload is stored under: `<class_id>/<uuid>`.
 *
 * The class prefix is load-bearing — it is what `storage.objects`' policies
 * authorise on — and `class_materials_path_scoped_to_class` refuses a row whose
 * path does not start with its own class id, so the two cannot drift apart.
 *
 * The second segment is a fresh uuid rather than the file's name. A filename is
 * untrusted text: it can contain `/`, `..`, control characters, or simply
 * collide with another teacher's upload in the same class. None of that can
 * matter if the name never becomes a path component. The real name is stored in
 * a column and echoed back on download, which is where it belongs.
 */
export function materialStoragePath(classId: string): string {
  return `${classId}/${crypto.randomUUID()}`;
}

/**
 * Every material attached to one session of one class, newest first.
 *
 * Both ids are in the WHERE clause even though `class_materials_session_fk` is
 * the composite `(session_id, class_id)` and already makes disagreement
 * unstorable — the same defence-in-depth `loadSessionAttendance` and
 * `loadSessionLessonNotes` apply. `class_materials_teacher_all` is underneath
 * both, and it is the layer that cannot be talked out of its answer.
 *
 * `null` means the query failed — which today includes "the table does not
 * exist yet", because the migration has not been applied. `[]` means no
 * material has been uploaded for this session.
 */
export async function loadSessionMaterials(
  supabase: Awaited<ReturnType<typeof createClient>>,
  classId: string,
  sessionId: string,
): Promise<Material[] | null> {
  const { data, error } = await supabase
    .from("class_materials")
    .select("id, file_name, mime_type, byte_size, created_at, storage_path")
    .eq("class_id", classId)
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false });

  if (error) {
    logDbError("class_materials.select", error);
    return null;
  }

  return (data ?? []).map((row) => ({
    materialId: row.id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    byteSize: Number(row.byte_size),
    createdAt: row.created_at,
    storagePath: row.storage_path,
  }));
}

/**
 * One material, resolved from an id the browser supplied — for the download
 * route, which must never take a storage path from a request.
 *
 * The path comes back from the database rather than from the URL, and the row
 * is only found when `class_materials_teacher_all` admits it, so a teacher
 * asking for another teacher's material id gets `null` and the route answers
 * 404. Passing a path straight through would have made the object store's
 * policies the only check; making the row the lookup means there are two.
 */
export async function loadMaterial(
  supabase: Awaited<ReturnType<typeof createClient>>,
  classId: string,
  materialId: string,
): Promise<Material | null> {
  const { data, error } = await supabase
    .from("class_materials")
    .select("id, file_name, mime_type, byte_size, created_at, storage_path")
    .eq("id", materialId)
    .eq("class_id", classId)
    .maybeSingle();

  if (error) {
    logDbError("class_materials.select(one)", error);
    return null;
  }
  if (!data) return null;

  return {
    materialId: data.id,
    fileName: data.file_name,
    mimeType: data.mime_type,
    byteSize: Number(data.byte_size),
    createdAt: data.created_at,
    storagePath: data.storage_path,
  };
}

/**
 * A short-lived URL the teacher's browser can fetch the bytes from.
 *
 * Signed by the object store for a client carrying this teacher's own JWT, so
 * `class_materials_objects_teacher_select` decides whether a URL is issued at
 * all. Sixty seconds is enough for a redirect to be followed and short enough
 * that a URL copied out of a history or a proxy log is useless by the time
 * anyone tries it.
 *
 * `download` makes the object store send `Content-Disposition: attachment` with
 * the teacher's original filename, which is why the name never had to be a path
 * component.
 */
export async function signedMaterialUrl(
  supabase: Awaited<ReturnType<typeof createClient>>,
  storagePath: string,
  fileName: string,
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(MATERIALS_BUCKET)
    .createSignedUrl(storagePath, 60, { download: fileName });

  if (error) {
    console.error("[materials] createSignedUrl failed", {
      message: error.message,
    });
    return null;
  }

  return data?.signedUrl ?? null;
}
