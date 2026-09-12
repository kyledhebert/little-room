import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { stdin as input, stdout as output } from "node:process";

const PHOTO_COLLECTION = "net.kylehebert.photo";
const DEFAULT_SERVICE = "https://bsky.social";
const MAX_IMAGE_BYTES = 1_000_000;

const service = (process.env.ATPROTO_SERVICE ?? DEFAULT_SERVICE).replace(/\/+$/, "");

function usage() {
  console.log(`Usage:
  npm run atproto:publish:photo -- <image> --alt "description" [options]

Options:
  --caption "text"       Caption shown on the site and social posts
  --taken-at <ISO date>   When the photo was taken (defaults to now)
  --instagram            Also publish through the Instagram API
  --key <record-key>      Stable PDS key (defaults to the image filename)

The photo is always uploaded to the PDS first. Social flags are optional.

Instagram environment (only needed with --instagram):
  INSTAGRAM_USER_ID
  INSTAGRAM_ACCESS_TOKEN
  INSTAGRAM_GRAPH_URL     Defaults to https://graph.instagram.com
  INSTAGRAM_GRAPH_VERSION Defaults to v23.0`);
}

function parseArgs(args) {
  const options = { instagram: false };
  const positional = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--instagram") options.instagram = true;
    else if (["--alt", "--caption", "--taken-at", "--key"].includes(arg)) {
      const value = args[++index];
      if (!value) throw new Error(`${arg} requires a value.`);
      options[arg.slice(2).replace("-", "At")] = value;
    } else if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}`);
    else positional.push(arg);
  }
  return { imagePath: positional[0], ...options };
}

async function request(method, nsid, body, token, contentType = "application/json") {
  const response = await fetch(`${service}/xrpc/${nsid}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(contentType ? { "Content-Type": contentType } : {}),
    },
    body: contentType === "application/json" ? JSON.stringify(body) : body,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`${nsid} failed: ${response.status} ${data.message ?? response.statusText}`);
  return data;
}

async function createSession() {
  const identifier = (process.env.ATPROTO_IDENTIFIER || process.env.ATPROTO_HANDLE || "").trim();
  if (!identifier) throw new Error("Set ATPROTO_HANDLE (or ATPROTO_IDENTIFIER).");
  const password = process.env.ATPROTO_PASSWORD || await promptHidden("ATPROTO_PASSWORD: ");
  return request("POST", "com.atproto.server.createSession", { identifier, password });
}

async function promptHidden(prompt) {
  if (!input.isTTY || !output.isTTY) {
    throw new Error("Set ATPROTO_PASSWORD or run from an interactive terminal.");
  }
  output.write(prompt);
  input.setRawMode(true);
  input.resume();
  input.setEncoding("utf8");
  let value = "";
  try {
    for await (const char of input) {
      if (char === "\r" || char === "\n") {
        output.write("\n");
        return value;
      }
      if (char === "\u0003") throw new Error("Password prompt cancelled.");
      if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
      else value += char;
    }
  } finally {
    input.setRawMode(false);
    input.pause();
  }
  throw new Error("Password prompt ended before input was received.");
}

function recordKey(imagePath, requestedKey) {
  const raw = requestedKey ?? path.basename(imagePath, path.extname(imagePath));
  const key = raw.toLowerCase().replace(/[^a-z0-9._~-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!key) throw new Error("Could not create a record key; pass --key.");
  return key;
}

function normalizeDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid --taken-at date: ${value}`);
  return date.toISOString();
}

async function prepareImage(imagePath) {
  await readFile(imagePath);
  const source = sharp(imagePath).rotate();
  const metadata = await source.metadata();
  const width = Math.min(metadata.autoOrient.width ?? metadata.width ?? 2000, 2000);
  for (const quality of [88, 80, 72, 64, 56, 48]) {
    const bytes = await sharp(imagePath)
      .rotate()
      .resize({ width, height: 2000, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    if (bytes.byteLength <= MAX_IMAGE_BYTES) {
      const info = await sharp(bytes).metadata();
      return { bytes, width: info.width, height: info.height };
    }
  }
  throw new Error(`Unable to prepare ${imagePath} under ${MAX_IMAGE_BYTES} bytes.`);
}

async function putRecord(session, collection, rkey, record) {
  return request("POST", "com.atproto.repo.putRecord", {
    repo: session.did,
    collection,
    rkey,
    record,
    validate: false,
  }, session.accessJwt);
}

async function existingPhoto(session, rkey) {
  const url = new URL(`${service}/xrpc/com.atproto.repo.getRecord`);
  url.searchParams.set("repo", session.did);
  url.searchParams.set("collection", PHOTO_COLLECTION);
  url.searchParams.set("rkey", rkey);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${session.accessJwt}` },
  });
  const data = await response.json();
  if ((response.status === 400 || response.status === 404) && data.error === "RecordNotFound") {
    return undefined;
  }
  if (!response.ok) throw new Error(`Unable to check existing photo: ${data.message ?? response.statusText}`);
  return data.value;
}

const blobCid = (blob) => blob?.ref?.$link;

function publicBlobUrl(did, blob) {
  const url = new URL(`${service}/xrpc/com.atproto.sync.getBlob`);
  url.searchParams.set("did", did);
  url.searchParams.set("cid", blobCid(blob));
  return url.toString();
}

async function publishInstagram(imageUrl, caption) {
  const userId = process.env.INSTAGRAM_USER_ID;
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!userId || !accessToken) {
    throw new Error("--instagram requires INSTAGRAM_USER_ID and INSTAGRAM_ACCESS_TOKEN.");
  }
  const graphUrl = (process.env.INSTAGRAM_GRAPH_URL ?? "https://graph.instagram.com").replace(/\/+$/, "");
  const version = process.env.INSTAGRAM_GRAPH_VERSION ?? "v23.0";

  const call = async (endpoint, params) => {
    const response = await fetch(`${graphUrl}/${version}/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...params, access_token: accessToken }),
    });
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(`Instagram publish failed: ${data.error?.message ?? response.statusText}`);
    return data;
  };

  const container = await call(`${userId}/media`, { image_url: imageUrl, caption: caption ?? "" });
  return call(`${userId}/media_publish`, { creation_id: container.id });
}

async function publish(options) {
  if (!options.imagePath) throw new Error("Pass an image path.");
  if (!options.alt) throw new Error("Pass meaningful alt text with --alt.");
  const rkey = recordKey(options.imagePath, options.key);
  const image = await prepareImage(path.resolve(options.imagePath));
  const session = await createSession();
  const previous = await existingPhoto(session, rkey);
  const createdAt = normalizeDate(options.takenAt ?? previous?.createdAt);
  const uploaded = await request("POST", "com.atproto.repo.uploadBlob", image.bytes, session.accessJwt, "image/jpeg");

  const record = {
    $type: PHOTO_COLLECTION,
    image: uploaded.blob,
    alt: options.alt,
    caption: options.caption,
    createdAt,
    aspectRatio: { width: image.width, height: image.height },
    syndication: previous?.syndication?.instagram
      ? { instagram: previous.syndication.instagram }
      : undefined,
  };
  Object.keys(record).forEach((key) => record[key] === undefined && delete record[key]);

  const stored = await putRecord(session, PHOTO_COLLECTION, rkey, record);
  console.log(`PDS: ${stored.uri}`);

  const syndication = { ...(record.syndication ?? {}) };
  if (options.instagram && !syndication.instagram) {
    const post = await publishInstagram(publicBlobUrl(session.did, uploaded.blob), options.caption);
    syndication.instagram = post.id;
    console.log(`Instagram: ${post.id}`);
    await putRecord(session, PHOTO_COLLECTION, rkey, { ...record, syndication });
  } else if (options.instagram) {
    console.log(`Instagram: already published as ${syndication.instagram}`);
  }
}

const command = process.argv[2];
if (!command || command === "help") usage();
else if (command === "publish") publish(parseArgs(process.argv.slice(3))).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
else {
  usage();
  process.exitCode = 1;
}
