import { createHmac, timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { ADMIN_SESSION_SECRET, ATPROTO_ADMIN_DID, LOCAL_PUBLIC_URL, PUBLIC_URL } from "astro:env/server";
import {
  NodeOAuthClient,
  type NodeSavedSession,
  type NodeSavedState,
} from "@atproto/oauth-client-node";

const siteUrl = (
  import.meta.env.DEV
    ? LOCAL_PUBLIC_URL ?? "http://127.0.0.1:4321"
    : PUBLIC_URL ?? "https://kylehebert.net"
).replace(/\/+$/, "");
const oauthScope = "atproto repo:net.kylehebert.photo?action=create&action=update blob:*/* repo:app.bsky.feed.post?action=create";
const callbackUrl = `${siteUrl}/admin/photos/callback`;
const localClientId = `http://localhost?redirect_uri=${encodeURIComponent(callbackUrl)}&scope=${encodeURIComponent(oauthScope)}`;
const memoryState = new Map<string, NodeSavedState>();
const memorySessions = new Map<string, NodeSavedSession>();

const persistentStore = () => {
  if (import.meta.env.DEV) return undefined;
  return getStore({ name: "photo-admin-oauth", consistency: "strong" });
};

const jsonStore = <T>(prefix: string, fallback: Map<string, T>) => ({
  async set(key: string, value: T) {
    const store = persistentStore();
    if (store) await store.setJSON(`${prefix}/${key}`, value);
    else fallback.set(key, value);
  },
  async get(key: string) {
    const store = persistentStore();
    return store
      ? await store.get(`${prefix}/${key}`, { type: "json" }) as T | null ?? undefined
      : fallback.get(key);
  },
  async del(key: string) {
    const store = persistentStore();
    if (store) await store.delete(`${prefix}/${key}`);
    else fallback.delete(key);
  },
});

let client: NodeOAuthClient | undefined;

export const oauthClient = () => {
  client ??= new NodeOAuthClient({
    clientMetadata: {
      client_id: import.meta.env.DEV ? localClientId : `${siteUrl}/oauth-client-metadata.json`,
      client_name: "The Little Room photo admin",
      client_uri: import.meta.env.DEV ? "http://localhost" : siteUrl,
      redirect_uris: [callbackUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      application_type: import.meta.env.DEV ? "native" : "web",
      token_endpoint_auth_method: "none",
      dpop_bound_access_tokens: true,
      scope: oauthScope,
    },
    stateStore: jsonStore("state", memoryState),
    sessionStore: jsonStore("session", memorySessions),
  });
  return client;
};

export const ownerDid = () => ATPROTO_ADMIN_DID;

export const adminConfigured = () => Boolean(ownerDid() && ADMIN_SESSION_SECRET);

const signature = (did: string) => {
  const secret = ADMIN_SESSION_SECRET;
  if (!secret) return undefined;
  return createHmac("sha256", secret).update(did).digest("base64url");
};

export const createAdminCookie = (did: string) => `${did}.${signature(did)}`;

export const verifyAdminCookie = (value?: string) => {
  if (!value) return undefined;
  const separator = value.lastIndexOf(".");
  const did = value.slice(0, separator);
  const supplied = value.slice(separator + 1);
  const expected = signature(did);
  if (!expected || supplied.length !== expected.length) return undefined;
  if (!timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return undefined;
  return did === ownerDid() ? did : undefined;
};

export const assertSameOrigin = (request: Request) => {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new Error("Invalid request origin.");
};
