import type { Loader } from "astro/loaders";
import { z } from "astro/zod";
import { fetchContentJson } from "./content-fetch";

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

type PhotoLoaderOptions = { repo?: string; service?: string; mocks?: boolean };

const mockPhotos = [
  { id: "mock-flower-box", imageUrl: "/images/flower-box.webp", alt: "A window flower box overflowing with colorful blooms.", caption: "Flowers catching the afternoon light.", daysAgo: 2 },
  { id: "mock-pink-peony", imageUrl: "/images/pink-peony.webp", alt: "A pink peony blossom surrounded by green leaves.", caption: "The peonies never last long enough.", daysAgo: 5 },
  { id: "mock-sand-cherry", imageUrl: "/images/sand-cherry.webp", alt: "Delicate blossoms on a sand cherry shrub.", caption: "A sure sign that spring has arrived.", daysAgo: 9 },
  { id: "mock-victoria-sponge", imageUrl: "/images/victoria-sponge.webp", alt: "A homemade Victoria sponge cake filled with cream and jam.", caption: "Weekend baking project.", daysAgo: 14 },
  { id: "mock-new-door", imageUrl: "/images/new-door.webp", alt: "A newly installed front door on a house.", caption: "A small house project with a big impact.", daysAgo: 21 },
];

const schema = z.object({
  imageUrl: z.string().min(1),
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
    const service = (options.service ?? "https://bsky.social").replace(/\/+$/, "");
    const repo = options.repo;
    let cursor: string | undefined;
    let count = 0;
    if (!repo) logger.warn("ATPROTO_REPO is unset; loading only configured photo fixtures.");

    if (repo) do {
      const url = new URL(`${service}/xrpc/com.atproto.repo.listRecords`);
      url.searchParams.set("repo", repo);
      url.searchParams.set("collection", PHOTO_COLLECTION);
      url.searchParams.set("limit", "100");
      if (cursor) url.searchParams.set("cursor", cursor);
      const payload = await fetchContentJson<{ cursor?: string; records?: PhotoRecord[] }>(url);

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

    if (options.mocks) {
      for (const mock of mockPhotos) {
        const createdAt = new Date(Date.now() - mock.daysAgo * 86_400_000);
        const data = await parseData({ id: mock.id, data: {
          imageUrl: mock.imageUrl,
          alt: mock.alt,
          caption: mock.caption,
          createdAt,
          atUri: `at://did:example:visual-test/${PHOTO_COLLECTION}/${mock.id}`,
        }});
        store.set({ id: mock.id, data, digest: generateDigest({ ...mock, createdAt }) });
        count += 1;
      }
      logger.warn("PHOTO_MOCKS is enabled; added temporary local photo fixtures.");
    }

    logger.info(`Loaded ${count} photo${count === 1 ? "" : "s"}.`);
  },
});
