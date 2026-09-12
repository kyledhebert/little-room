import type { APIRoute } from "astro";
import { oauthClient } from "../lib/admin-auth";

export const prerender = false;

export const GET: APIRoute = () => Response.json(oauthClient().clientMetadata, {
  headers: { "Cache-Control": "public, max-age=3600" },
});
