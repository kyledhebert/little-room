import sharp from "sharp";
import { Agent } from "@atproto/api";
import {
  ATPROTO_SERVICE,
  INSTAGRAM_ACCESS_TOKEN,
  INSTAGRAM_GRAPH_URL,
  INSTAGRAM_GRAPH_VERSION,
  INSTAGRAM_USER_ID,
  NETLIFY_BUILD_HOOK,
} from "astro:env/server";

const PHOTO_COLLECTION = "net.kylehebert.photo";
const MAX_SOURCE_BYTES = 25_000_000;
const MAX_IMAGE_BYTES = 1_000_000;

const prepareImage = async (file: File) => {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  if (file.size > MAX_SOURCE_BYTES) throw new Error("The source image must be smaller than 25 MB.");
  const source = Buffer.from(await file.arrayBuffer());
  for (const quality of [88, 80, 72, 64, 56, 48]) {
    const bytes = await sharp(source).rotate().resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true }).toBuffer();
    if (bytes.byteLength <= MAX_IMAGE_BYTES) {
      const metadata = await sharp(bytes).metadata();
      return { bytes, width: metadata.width!, height: metadata.height! };
    }
  }
  throw new Error("Unable to prepare the image under one megabyte.");
};

const publishInstagram = async (imageUrl: string, caption: string) => {
  const userId = INSTAGRAM_USER_ID;
  const accessToken = INSTAGRAM_ACCESS_TOKEN;
  if (!userId || !accessToken) throw new Error("Instagram publishing is not configured.");
  const base = (INSTAGRAM_GRAPH_URL ?? "https://graph.instagram.com").replace(/\/+$/, "");
  const version = INSTAGRAM_GRAPH_VERSION ?? "v23.0";
  const call = async (endpoint: string, params: Record<string, string>) => {
    const response = await fetch(`${base}/${version}/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...params, access_token: accessToken }),
    });
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error?.message ?? "Instagram publishing failed.");
    return data;
  };
  const container = await call(`${userId}/media`, { image_url: imageUrl, caption });
  return call(`${userId}/media_publish`, { creation_id: container.id });
};

export async function publishAdminPhoto(session: any, input: {
  file: File; alt: string; caption: string; takenAt?: string; bluesky: boolean; instagram: boolean;
}) {
  const agent = new Agent(session);
  if (input.bluesky && Array.from(input.caption).length > 300) {
    throw new Error("Bluesky captions must be 300 characters or fewer.");
  }
  const image = await prepareImage(input.file);
  const createdAt = input.takenAt ? new Date(input.takenAt) : new Date();
  if (Number.isNaN(createdAt.getTime())) throw new Error("Enter a valid photo date.");
  const uploaded = await agent.com.atproto.repo.uploadBlob(image.bytes, { encoding: "image/jpeg" });
  const blob = uploaded.data.blob;
  const rkey = `photo-${blob.ref.toString()}`;
  let previous: any;
  try {
    previous = (await agent.com.atproto.repo.getRecord({
      repo: session.did, collection: PHOTO_COLLECTION, rkey,
    })).data.value;
  } catch (error: any) {
    if (error?.error !== "RecordNotFound" && error?.status !== 400) throw error;
  }
  const record: Record<string, any> = {
    $type: PHOTO_COLLECTION,
    image: blob,
    alt: input.alt,
    caption: input.caption || undefined,
    createdAt: previous?.createdAt ?? createdAt.toISOString(),
    aspectRatio: { width: image.width, height: image.height },
  };
  Object.keys(record).forEach((key) => record[key] === undefined && delete record[key]);

  const stored = await agent.com.atproto.repo.putRecord({
    repo: session.did, collection: PHOTO_COLLECTION, rkey, record, validate: false,
  });
  const syndication: Record<string, string> = { ...(previous?.syndication ?? {}) };

  if (input.bluesky && !syndication.bluesky) {
    const post = await agent.com.atproto.repo.createRecord({
      repo: session.did,
      collection: "app.bsky.feed.post",
      record: {
        $type: "app.bsky.feed.post",
        text: input.caption,
        createdAt: record.createdAt,
        embed: { $type: "app.bsky.embed.images", images: [{ alt: input.alt, image: blob, aspectRatio: record.aspectRatio }] },
      },
    });
    syndication.bluesky = post.data.uri;
    await agent.com.atproto.repo.putRecord({ repo: session.did, collection: PHOTO_COLLECTION, rkey, record: { ...record, syndication }, validate: false });
  }

  if (input.instagram && !syndication.instagram) {
    const service = (ATPROTO_SERVICE ?? "https://bsky.social").replace(/\/+$/, "");
    const cid = blob.ref.toString();
    const imageUrl = `${service}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(session.did)}&cid=${encodeURIComponent(cid)}`;
    const post = await publishInstagram(imageUrl, input.caption);
    syndication.instagram = post.id;
    await agent.com.atproto.repo.putRecord({ repo: session.did, collection: PHOTO_COLLECTION, rkey, record: { ...record, syndication }, validate: false });
  }

  if (NETLIFY_BUILD_HOOK) {
    const response = await fetch(NETLIFY_BUILD_HOOK, { method: "POST" });
    if (!response.ok) console.error(`Netlify build hook failed: ${response.status}`);
  }
  return stored.data.uri;
}
