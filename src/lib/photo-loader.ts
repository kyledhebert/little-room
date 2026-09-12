import type { Loader } from "astro/loaders";
import { z } from "astro/zod";

const PHOTO_COLLECTION = "net.kylehebert.photo";

type PhotoRecord = {
  uri: string;
  value: {
    $type?: string;
    image?: { ref?: { $link?: string }; mimeType?: string; size?: number };
    alt?: string;
    caption?: string;
    createdAt?: string;
    aspectRatio?: { width?: number; height?: number };
    syndication?: { bluesky?: string; instagram?: string };
  };
};

type PhotoLoaderOptions = { repo?: string; service?: string };

const schema = z.object({
  imageUrl: z.string().url(),
  alt: z.string(),
  caption: z.string().optional(),
  createdAt: z.coerce.date(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  atUri: z.string(),
  blueskyUri: z.string().optional(),
  instagramId: z.string().optional(),
});

export const photoLoader = (options: PhotoLoaderOptions = {}): Loader => ({
  name: "atproto-photo-loader",
  schema,
  async load({ store, logger, parseData, generateDigest }) {
    store.clear();
    if (!options.repo) {
      logger.warn("ATPROTO_REPO is unset; the photo feed will be empty.");
      return;
    }

    const service = (options.service ?? "https://bsky.social").replace(/\/+$/, "");
    let cursor: string | undefined;
    let count = 0;
    do {
      const url = new URL(`${service}/xrpc/com.atproto.repo.listRecords`);
      url.searchParams.set("repo", options.repo);
      url.searchParams.set("collection", PHOTO_COLLECTION);
      url.searchParams.set("limit", "100");
      if (cursor) url.searchParams.set("cursor", cursor);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Unable to load photos: ${response.status} ${response.statusText}`);
      const payload = await response.json() as { cursor?: string; records?: PhotoRecord[] };

      for (const record of payload.records ?? []) {
        const value = record.value;
        const cid = value.image?.ref?.$link;
        if (value.$type !== PHOTO_COLLECTION || !cid || !value.alt || !value.createdAt) {
          logger.warn(`Skipping invalid ${PHOTO_COLLECTION} record: ${record.uri}`);
          continue;
        }
        const imageUrl = new URL(`${service}/xrpc/com.atproto.sync.getBlob`);
        imageUrl.searchParams.set("did", record.uri.split("/")[2]);
        imageUrl.searchParams.set("cid", cid);
        const id = record.uri.split("/").pop()!;
        const data = await parseData({ id, data: {
          imageUrl: imageUrl.toString(),
          alt: value.alt,
          caption: value.caption,
          createdAt: value.createdAt,
          width: value.aspectRatio?.width,
          height: value.aspectRatio?.height,
          atUri: record.uri,
          blueskyUri: value.syndication?.bluesky,
          instagramId: value.syndication?.instagram,
        }});
        store.set({ id, data, digest: generateDigest(record.value) });
        count += 1;
      }
      cursor = payload.cursor;
    } while (cursor);

    logger.info(`Loaded ${count} photo${count === 1 ? "" : "s"} from the PDS.`);
  },
});
