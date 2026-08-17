import { publicationUri } from "../../lib/site-standard";

export function GET() {
  const uri = publicationUri();

  if (!uri) {
    return new Response("ATPROTO_PUBLICATION_URI is not configured\n", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return new Response(`${uri}\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
