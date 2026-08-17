import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "@astrojs/markdown-remark";
import type { Loader } from "astro/loaders";
import { z } from "astro/zod";

const DOCUMENT_COLLECTION = "site.standard.document";
const MARKDOWN_CONTENT_TYPE = "net.kylehebert.blog.markdown";
const PUBLIC_IMAGE_DIRECTORY = "images";

type BlogSource = "local" | "pds";

type SiteStandardDocumentRecord = {
  uri: string;
  value: {
    $type?: string;
    site?: string;
    path?: string;
    title?: string;
    description?: string;
    publishedAt?: string;
    updatedAt?: string;
    textContent?: string;
    content?: {
      $type?: string;
      markdown?: string;
    };
    image?: {
      url: string;
      alt: string;
    };
    author?: string;
    published?: boolean;
  };
};

type LoaderOptions = {
  source?: BlogSource;
  localBase?: string;
  repo?: string;
  service?: string;
  publicationUri?: string;
  siteUrl?: string;
};

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const slugFromPath = (documentPath?: string, uri?: string) => {
  if (documentPath) {
    const segments = documentPath.split("/").filter(Boolean);
    return segments[segments.length - 1] ?? "";
  }

  return uri?.split("/").pop() ?? "";
};

const plainTextToMarkdown = (text: string) =>
  text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .join("\n\n");

const renderableImagePath = (imagePath: string, siteUrl?: string) => {
  if (/^(data:|blob:)/i.test(imagePath)) return imagePath;

  if (/^https?:\/\//i.test(imagePath)) {
    if (siteUrl) {
      const imageUrl = new URL(imagePath);
      const canonicalSiteUrl = new URL(siteUrl);
      if (
        imageUrl.origin === canonicalSiteUrl.origin &&
        imageUrl.pathname.startsWith(`/${PUBLIC_IMAGE_DIRECTORY}/`)
      ) {
        return imageUrl.pathname;
      }
    }

    return imagePath;
  }

  const imageName = imagePath.split(/[\\/]/).pop();
  if (!imageName) return imagePath;

  const imageBase = imageName.replace(/\.[^.]+$/, "");
  const publicPath = `/${PUBLIC_IMAGE_DIRECTORY}/${imageBase}.webp`;
  if (existsSync(path.join("public", PUBLIC_IMAGE_DIRECTORY, `${imageBase}.webp`))) {
    return publicPath;
  }

  return imagePath;
};

const rewriteRenderableMarkdownImages = (markdown: string, siteUrl?: string) =>
  markdown
    .replace(
      /(!\[[^\]]*\]\()([^)\s]+)(\))/g,
      (_match, prefix: string, imagePath: string, suffix: string) =>
        `${prefix}${renderableImagePath(imagePath, siteUrl)}${suffix}`
    )
    .replace(
      /(<img\b[^>]*\bsrc=["'])([^"']+)(["'][^>]*>)/gi,
      (_match, prefix: string, imagePath: string, suffix: string) =>
        `${prefix}${renderableImagePath(imagePath, siteUrl)}${suffix}`
    );

const renderableImage = (
  image: SiteStandardDocumentRecord["value"]["image"],
  siteUrl?: string
) => {
  if (!image?.url) return image;

  return {
    ...image,
    url: renderableImagePath(image.url, siteUrl),
  };
};

const schema = z.object({
  title: z.string(),
  published: z.boolean().default(true),
  pubDate: z.coerce.date(),
  description: z.string().optional(),
  author: z.string().optional(),
  image: z
    .object({
      url: z.string(),
      alt: z.string(),
    })
    .optional(),
  atUri: z.string().optional(),
  textContent: z.string(),
  updatedAt: z.coerce.date().optional(),
});

export const siteStandardDocumentLoader = (options: LoaderOptions = {}): Loader => {
  const source = options.source;
  const localBase = options.localBase ?? "src/blog";
  const service = trimTrailingSlash(options.service ?? "https://bsky.social");
  const repo = options.repo;
  const publicationUri = options.publicationUri;
  const siteUrl = options.siteUrl ? trimTrailingSlash(options.siteUrl) : undefined;

  return {
    name: "site-standard-document-loader",
    schema,
    async load({ store, logger, parseData, renderMarkdown, generateDigest, config }) {
      const selectedSource =
        source ?? (process.env.NETLIFY || process.env.CI ? undefined : "local");

      if (selectedSource !== "local" && selectedSource !== "pds") {
        throw new Error(
          'BLOG_SOURCE must be set to either "local" or "pds" before loading blog content.'
        );
      }

      store.clear();

      if (selectedSource === "local") {
        logger.warn(
          source
            ? "Loading blog content from local Markdown migration source."
            : "BLOG_SOURCE is unset; defaulting to local Markdown source in development."
        );
        const rootPath = path.resolve(fileURLToPath(config.root), localBase);
        const entries = await readdir(rootPath);
        const markdownFiles = entries.filter((entry) => entry.endsWith(".md")).sort();

        for (const file of markdownFiles) {
          const filePath = path.join(rootPath, file);
          const sourceText = await readFile(filePath, "utf8");
          const parsed = parseFrontmatter(sourceText);
          const markdown = rewriteRenderableMarkdownImages(parsed.content.trim(), siteUrl);
          const frontmatter = parsed.frontmatter;
          const id = slugify(path.basename(file, path.extname(file)));
          const pubDate = frontmatter.pubDate ?? frontmatter.publishedAt;

          const data = await parseData({
            id,
            filePath,
            data: {
              title: frontmatter.title,
              published: frontmatter.published === true,
              pubDate,
              description: frontmatter.description,
              author: frontmatter.author,
              image: frontmatter.image,
              textContent: markdown,
            },
          });
          const rendered = await renderMarkdown(markdown);

          store.set({
            id,
            data,
            body: markdown,
            filePath,
            digest: generateDigest(sourceText),
            rendered,
          });
        }
        return;
      }

      if (!repo || !publicationUri) {
        throw new Error(
          "BLOG_SOURCE=pds requires ATPROTO_REPO and ATPROTO_PUBLICATION_URI."
        );
      }

      const records = await listDocumentRecords({ service, repo });
      let loadedCount = 0;

      for (const record of records) {
        const value = record.value;
        if (value.$type !== DOCUMENT_COLLECTION) continue;

        const recordSite = value.site ? trimTrailingSlash(value.site) : "";
        const expectedSites = [publicationUri, siteUrl].filter(Boolean);
        if (!expectedSites.includes(recordSite)) continue;

        const id = slugFromPath(value.path, record.uri);
        const storedMarkdown =
          value.content?.$type === MARKDOWN_CONTENT_TYPE && value.content.markdown
            ? value.content.markdown
            : plainTextToMarkdown(value.textContent ?? "");
        const markdown = rewriteRenderableMarkdownImages(storedMarkdown, siteUrl);

        if (!id || !value.title || !value.publishedAt || !markdown) {
          logger.warn(`Skipping invalid ${DOCUMENT_COLLECTION} record: ${record.uri}`);
          continue;
        }

        const data = await parseData({
          id,
          data: {
            title: value.title,
            published: value.published !== false,
            pubDate: value.publishedAt,
            description: value.description,
            author: value.author,
            image: renderableImage(value.image, siteUrl),
            atUri: record.uri,
            textContent: value.textContent ?? markdown,
            updatedAt: value.updatedAt,
          },
        });
        const rendered = await renderMarkdown(markdown);

        store.set({
          id,
          data,
          body: markdown,
          digest: generateDigest(record.value),
          rendered,
        });
        loadedCount += 1;
      }

      if (loadedCount === 0) {
        throw new Error(`BLOG_SOURCE=pds loaded no valid ${DOCUMENT_COLLECTION} records.`);
      }
    },
  };
};

const listDocumentRecords = async ({
  service,
  repo,
}: {
  service: string;
  repo: string;
}) => {
  const records: SiteStandardDocumentRecord[] = [];
  let cursor: string | undefined;

  do {
    const url = new URL(`${service}/xrpc/com.atproto.repo.listRecords`);
    url.searchParams.set("repo", repo);
    url.searchParams.set("collection", DOCUMENT_COLLECTION);
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Unable to load ${DOCUMENT_COLLECTION}: ${response.status} ${response.statusText}`
      );
    }

    const payload = (await response.json()) as {
      cursor?: string;
      records?: SiteStandardDocumentRecord[];
    };
    records.push(...(payload.records ?? []));
    cursor = payload.cursor;
  } while (cursor);

  return records;
};
