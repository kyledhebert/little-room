import type { APIRoute } from "astro";
import { assertSameOrigin, oauthClient, verifyAdminCookie } from "../../../lib/admin-auth";

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  assertSameOrigin(request);
  const did = verifyAdminCookie(cookies.get("photo_admin")?.value);
  if (did) {
    try {
      await (await oauthClient().restore(did)).signOut();
    } catch {
      // The local cookie must still be cleared if the remote session expired.
    }
  }
  cookies.delete("photo_admin", { path: "/admin/photos" });
  return redirect("/admin/photos/", 303);
};
