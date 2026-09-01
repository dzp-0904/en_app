import { notFound, redirect } from "next/navigation";

import { loadMaterial, signedMaterialUrl } from "@/lib/materials";
import { loadUserState } from "@/lib/onboarding";
import { createClient } from "@/lib/supabase/server";
import { loadEditableClass } from "@/lib/teacher";

/**
 * Handing one curriculum file back to the teacher who uploaded it.
 *
 * ## Why a Route Handler and not a button
 *
 * The same reason `app/teacher/reports/export/route.ts` is one (decision
 * **AB**): a route can be the `href` of a plain anchor, so the file opens with
 * a click, a middle-click, a keyboard, and with JavaScript switched off. A
 * Server Action could not be any of those things, and a file the teacher cannot
 * fetch without JavaScript is a file this application has quietly locked away.
 *
 * ## Why it redirects instead of streaming
 *
 * The bucket is private. Reading the bytes here and re-sending them would put
 * every megabyte of every download through the Node process for no benefit, so
 * the handler asks the object store for a URL signed for *this* teacher's own
 * token and 302s to it. `createSignedUrl` is issued by a client carrying the
 * session's JWT, so `class_materials_objects_teacher_select` is what decides
 * whether a URL exists at all — there is no service-role key anywhere in this
 * path, and none in the application at all.
 *
 * Sixty seconds, and `?download=` so the store sends the teacher's original
 * filename as an attachment. A link that leaks out of a history or a proxy log
 * has expired long before anyone can try it, and it was only ever a link to one
 * file rather than to the bucket.
 *
 * ## The authorization chain, in the order it runs
 *
 * teacher → owned class → material row in that class → signed URL. `classId`
 * and `materialId` both arrive from the URL and neither is trusted: the class
 * is resolved through `loadEditableClass`'s `teacher_id` filter, the row is
 * found only with both `id` and `class_id` in the WHERE clause and only when
 * `class_materials_teacher_all` admits it, and the storage path comes back
 * *from that row* rather than from the request — so a crafted path cannot reach
 * the store at all. Every refusal is the same 404, so the response says nothing
 * about which materials exist or who owns them.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ classId: string; materialId: string }> },
) {
  const { classId, materialId } = await params;

  const state = await loadUserState();

  // Anonymous is sent to sign in, as on every other teacher route; a student or
  // an unplaceable account gets the 404 everything else here gets.
  if (state.kind === "anonymous") {
    redirect("/auth/login");
  }
  if (state.kind !== "teacher") {
    notFound();
  }

  const supabase = await createClient();
  const owned = await loadEditableClass(supabase, state.teacher.userId, classId);

  if (owned.kind !== "ok") {
    notFound();
  }

  const material = await loadMaterial(supabase, classId, materialId);

  if (!material) {
    notFound();
  }

  const url = await signedMaterialUrl(
    supabase,
    material.storagePath,
    material.fileName,
  );

  if (!url) {
    notFound();
  }

  redirect(url);
}
