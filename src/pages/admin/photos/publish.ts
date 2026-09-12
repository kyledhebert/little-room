import type { APIRoute } from "astro";
import { assertSameOrigin, oauthClient, verifyAdminCookie } from "../../../lib/admin-auth";
import { publishAdminPhoto } from "../../../lib/admin-photo-publisher";

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  try {
    assertSameOrigin(request);
    const did = verifyAdminCookie(cookies.get("photo_admin")?.value);
    if (!did) return new Response("Unauthorized", { status: 401 });
    const form = await request.formData();
    const file = form.get("photo");
    const alt = String(form.get("alt") ?? "").trim();
    const caption = String(form.get("caption") ?? "").trim();
    if (!(file instanceof File) || !file.size) throw new Error("Choose a photo.");
    if (!alt) throw new Error("Alt text is required.");
    const session = await oauthClient().restore(did);
    await publishAdminPhoto(session, {
      file, alt, caption,
      takenAt: String(form.get("takenAt") ?? "") || undefined,
      bluesky: form.get("bluesky") === "on",
      instagram: form.get("instagram") === "on",
    });
    return redirect("/admin/photos/?published=1", 303);
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : "Publishing failed.";
    if (/session was deleted|session.*expired|invalid_grant/i.test(rawMessage)) {
      cookies.delete("photo_admin", { path: "/admin/photos" });
    }
    const message = encodeURIComponent(rawMessage);
    return redirect(`/admin/photos/?error=${message}`, 303);
  }
};
