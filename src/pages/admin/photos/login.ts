import type { APIRoute } from "astro";
import { assertSameOrigin, oauthClient } from "../../../lib/admin-auth";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    assertSameOrigin(request);
    const form = await request.formData();
    const handle = String(form.get("handle") ?? "").trim().replace(/^@/, "");
    if (!handle) return new Response("Enter your AT Protocol handle.", { status: 400 });
    const url = await oauthClient().authorize(handle, { state: crypto.randomUUID() });
    return Response.redirect(url, 303);
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Unable to start login.", { status: 400 });
  }
};
