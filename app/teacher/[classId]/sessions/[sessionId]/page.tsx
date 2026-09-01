import { permanentRedirect } from "next/navigation";

import type { DynamicPageProps } from "@/lib/route-types";

/**
 * The workspace's old address, kept as a redirect.
 *
 * The session workspace moved to `/teacher/calendar/session/[sessionId]` so
 * that opening a lesson keeps the teacher in Lịch dạy rather than moving them
 * into Lớp học (see that page's own notes). Links to the old path are still
 * live — in bookmarks, in a browser's history, in the class page's lesson list
 * before this deploy — so the path stays a route and sends them on.
 *
 * ## It asks the database nothing, deliberately
 *
 * There is no teacher check and no lookup here, and that is the secure choice
 * rather than a shortcut. The redirect is unconditional, so it answers exactly
 * the same for a lesson that exists, one that belongs to another teacher, one
 * that was deleted and a uuid that never named anything: everyone is sent to
 * the new path, where the real check runs and produces the same 404 for all
 * three of the failing cases. A version of this that resolved the session first
 * in order to redirect "only when it exists" would have turned the redirect
 * itself into an oracle — 307 means real, 404 means not — which is precisely
 * what `loadTeacherSession` and the segment's `not-found.tsx` are arranged to
 * avoid.
 *
 * The class id in the old path is discarded rather than carried, because the
 * new route does not take one: the class is resolved *from* the session, so a
 * class id supplied by the request has nothing left to say.
 *
 * `permanentRedirect` (308) rather than `redirect` (307): the move is
 * permanent, and the method is preserved either way.
 */
export default async function MovedSessionPage({
  params,
}: DynamicPageProps<{ classId: string; sessionId: string }>) {
  const { sessionId } = await params;

  permanentRedirect(`/teacher/calendar/session/${sessionId}`);
}
