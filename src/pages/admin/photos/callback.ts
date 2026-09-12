import type { APIRoute } from "astro";
import { adminConfigured, createAdminCookie, oauthClient, ownerDid } from "../../../lib/admin-auth";

export const prerender = false;

export const GET: APIRoute = async ({ request, cookies, redirect }) => {
  try {
    if (!adminConfigured()) return new Response("Photo admin is not configured.", { status: 503 });
    const { session } = await oauthClient().callback(new URL(request.url).searchParams);
    if (!ownerDid() || session.did !== ownerDid()) {
      await session.signOut();
      return new Response("This account is not authorized to manage photos.", { status: 403 });
    }
    cookies.set("photo_admin", createAdminCookie(session.did), {
      httpOnly: true,
      secure: import.meta.env.PROD,
      sameSite: "lax",
      path: "/admin/photos",
      maxAge: 60 * 60 * 24 * 30,
    });
    return redirect("/admin/photos/", 303);
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "OAuth callback failed.", { status: 400 });
  }
};
