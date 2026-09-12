import { defineCollection } from "astro:content";
import { loadEnv } from "vite";
import { siteStandardDocumentLoader } from "./lib/site-standard-loader";
import { photoLoader } from "./lib/photo-loader";

const env = {
  ...loadEnv(process.env.NODE_ENV ?? "development", process.cwd(), ""),
  ...process.env,
};

const blog = defineCollection({
  loader: siteStandardDocumentLoader({
    source: env.BLOG_SOURCE as "local" | "pds" | undefined,
    repo: env.ATPROTO_REPO,
    service: env.ATPROTO_SERVICE,
    publicationUri: env.ATPROTO_PUBLICATION_URI,
    siteUrl: env.SITE ?? "https://kylehebert.net",
  }),
});

const photos = defineCollection({
  loader: photoLoader({
    repo: env.ATPROTO_REPO,
    service: env.ATPROTO_SERVICE,
  }),
});

export const collections = { blog, photos };
