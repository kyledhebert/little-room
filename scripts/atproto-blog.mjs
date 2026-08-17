import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { parseFrontmatter } from "@astrojs/markdown-remark";
import sharp from "sharp";

const DOCUMENT_COLLECTION = "site.standard.document";
const PUBLICATION_COLLECTION = "site.standard.publication";
const MARKDOWN_CONTENT_TYPE = "net.kylehebert.blog.markdown";
const DEFAULT_SERVICE = "https://bsky.social";
const DEFAULT_SITE_URL = "https://kylehebert.net";

const service = trimTrailingSlash(process.env.ATPROTO_SERVICE ?? DEFAULT_SERVICE);
const siteUrl = trimTrailingSlash(process.env.SITE ?? process.env.ATPROTO_SITE_URL ?? DEFAULT_SITE_URL);
const publicRoot = path.resolve("public");
const publicImagesRoot = path.join(publicRoot, "images");
const inlineImageWidth = Number(process.env.ATPROTO_INLINE_IMAGE_WIDTH ?? 1600);
const inlineImageQuality = Number(process.env.ATPROTO_INLINE_IMAGE_QUALITY ?? 82);
const coverImageWidth = Number(process.env.ATPROTO_COVER_IMAGE_WIDTH ?? 1200);
const coverImageMaxBytes = 1_000_000;

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function usage() {
  console.log(`Usage:
  npm run atproto:publication
  npm run atproto:post
  npm run atproto:publish -- <path-to-markdown>
  npm run atproto:import -- [directory]
  npm run atproto:import:yes -- [directory]
  npm run atproto:validate -- <path-to-markdown>

Environment:
  ATPROTO_HANDLE or ATPROTO_IDENTIFIER  PDS account handle
  ATPROTO_PASSWORD                      PDS app password
  ATPROTO_SERVICE                       PDS service URL, defaults to ${DEFAULT_SERVICE}
  ATPROTO_PUBLICATION_URI               site.standard.publication AT-URI for document records
  SITE or ATPROTO_SITE_URL              public site URL, defaults to ${DEFAULT_SITE_URL}`);
}

async function request(method, nsid, body, token, contentType = "application/json") {
  const response = await fetch(`${service}/xrpc/${nsid}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(contentType ? { "Content-Type": contentType } : {}),
    },
    body:
      contentType === "application/json" && body !== undefined
        ? JSON.stringify(body)
        : body,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const message = data.message ?? response.statusText;
    throw new Error(`${nsid} failed: ${response.status} ${message}`);
  }

  return data;
}

async function createSession() {
  const identifier = getIdentifier();
  if (!identifier) {
    throw new Error("Set ATPROTO_HANDLE or ATPROTO_IDENTIFIER before publishing.");
  }
  if (identifier.startsWith("@")) {
    throw new Error("Use a bare Bluesky handle for ATPROTO_HANDLE, without the leading @.");
  }

  const password = process.env.ATPROTO_PASSWORD || await promptHidden("ATPROTO_PASSWORD: ");

  return request("POST", "com.atproto.server.createSession", {
    identifier,
    password,
  });
}

function getIdentifier() {
  return (process.env.ATPROTO_IDENTIFIER || process.env.ATPROTO_HANDLE || "").trim();
}

async function promptHidden(prompt) {
  if (!input.isTTY || !output.isTTY) {
    throw new Error("Set ATPROTO_PASSWORD before publishing, or run from an interactive terminal.");
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
      if (char === "\u0003") {
        output.write("\n");
        throw new Error("Password prompt cancelled.");
      }
      if (char === "\u007f" || char === "\b") {
        value = value.slice(0, -1);
        continue;
      }
      value += char;
    }
  } finally {
    input.setRawMode(false);
    input.pause();
  }

  throw new Error("Password prompt ended before input was received.");
}

function slugify(title) {
  return title
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function markdownToPlainText(markdown) {
  return markdown
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`{1,3}([^`]+)`{1,3}/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }

  return date.toISOString();
}

function publicUrlForPublicPath(filePath) {
  const absolutePath = path.resolve(filePath);
  const relativeToPublic = path.relative(publicRoot, absolutePath);
  if (relativeToPublic.startsWith("..") || path.isAbsolute(relativeToPublic)) {
    throw new Error(
      `Local image "${filePath}" is not under public/. Move it into public/ before publishing.`
    );
  }
  if (!existsSync(absolutePath)) {
    throw new Error(`Local image "${filePath}" does not exist.`);
  }

  return `${siteUrl}/${relativeToPublic.replace(/\\/g, "/")}`;
}

function isRemoteUrl(value) {
  return /^https?:\/\//i.test(value);
}

async function isDerivativeCurrent(sourcePath, outputPath) {
  if (!existsSync(outputPath)) return false;

  const [sourceStats, outputStats] = await Promise.all([stat(sourcePath), stat(outputPath)]);
  return outputStats.mtimeMs >= sourceStats.mtimeMs;
}

async function optimizePublicImage(sourcePath) {
  const absoluteSource = path.resolve(sourcePath);
  if (!existsSync(absoluteSource)) {
    throw new Error(`Local image "${sourcePath}" does not exist.`);
  }

  const parsed = path.parse(absoluteSource);
  const outputPath = path.join(publicImagesRoot, `${parsed.name}.webp`);
  await mkdir(publicImagesRoot, { recursive: true });

  if (!(await isDerivativeCurrent(absoluteSource, outputPath))) {
    await sharp(absoluteSource)
      .rotate()
      .resize({ width: inlineImageWidth, withoutEnlargement: true })
      .webp({ quality: inlineImageQuality })
      .toFile(outputPath);
  }

  return {
    url: publicUrlForPublicPath(outputPath),
    localPath: absoluteSource,
    publicPath: outputPath,
  };
}

function resolveLocalImageSource(imagePath, sourceDir) {
  if (/^(data:|blob:)/i.test(imagePath)) {
    throw new Error(`Inline image "${imagePath}" is not publishable as a canonical URL.`);
  }

  if (imagePath.startsWith("/")) {
    if (imagePath.startsWith("/src/images/")) {
      const sourcePath = path.resolve(imagePath.slice(1));
      if (!existsSync(sourcePath)) {
        throw new Error(`Local source image "${imagePath}" does not exist.`);
      }
      return sourcePath;
    }

    const publicPath = path.join(publicRoot, imagePath.slice(1));
    if (!existsSync(publicPath)) {
      throw new Error(`Local image "${imagePath}" does not exist under public/.`);
    }
    return publicPath;
  }

  return path.resolve(sourceDir, imagePath);
}

async function canonicalImageReference(imagePath, sourceDir) {
  if (isRemoteUrl(imagePath)) {
    return { url: imagePath };
  }

  const localPath = resolveLocalImageSource(imagePath, sourceDir);
  return optimizePublicImage(localPath);
}

async function rewriteMarkdownImageReferences(markdown, sourceDir) {
  const markdownImagePattern = /(!\[[^\]]*\]\()([^)\s]+)(\))/g;
  const htmlImagePattern = /(<img\b[^>]*\bsrc=["'])([^"']+)(["'][^>]*>)/gi;

  let rewritten = "";
  let lastIndex = 0;
  for (const match of markdown.matchAll(markdownImagePattern)) {
    const [fullMatch, prefix, imagePath, suffix] = match;
    const index = match.index ?? 0;
    const canonical = await canonicalImageReference(imagePath, sourceDir);
    rewritten += markdown.slice(lastIndex, index);
    rewritten += `${prefix}${canonical.url}${suffix}`;
    lastIndex = index + fullMatch.length;
  }
  rewritten += markdown.slice(lastIndex);

  let htmlRewritten = "";
  lastIndex = 0;
  for (const match of rewritten.matchAll(htmlImagePattern)) {
    const [fullMatch, prefix, imagePath, suffix] = match;
    const index = match.index ?? 0;
    const canonical = await canonicalImageReference(imagePath, sourceDir);
    htmlRewritten += rewritten.slice(lastIndex, index);
    htmlRewritten += `${prefix}${canonical.url}${suffix}`;
    lastIndex = index + fullMatch.length;
  }
  htmlRewritten += rewritten.slice(lastIndex);

  assertPortableMarkdownImages(htmlRewritten);
  return htmlRewritten;
}

async function normalizePublicImage(image, sourceDir) {
  if (!image?.url) return undefined;
  if (isRemoteUrl(image.url)) return { image };

  const canonical = await canonicalImageReference(image.url, sourceDir);
  return {
    image: {
      ...image,
      url: canonical.url,
    },
    localPath: canonical.localPath,
  };
}

async function coverImageBytes(sourcePath) {
  if (!sourcePath) return undefined;

  for (const quality of [82, 72, 62, 52, 42]) {
    const bytes = await sharp(sourcePath)
      .rotate()
      .resize({ width: coverImageWidth, withoutEnlargement: true })
      .webp({ quality })
      .toBuffer();

    if (bytes.byteLength <= coverImageMaxBytes) {
      return bytes;
    }
  }

  const bytes = await sharp(sourcePath)
    .rotate()
    .resize({ width: 900, withoutEnlargement: true })
    .webp({ quality: 40 })
    .toBuffer();

  if (bytes.byteLength <= coverImageMaxBytes) {
    return bytes;
  }

  throw new Error(`Unable to create a coverImage under 1MB for ${sourcePath}.`);
}

async function uploadCoverImageBlob(sourcePath, token) {
  const bytes = await coverImageBytes(sourcePath);
  if (!bytes) return undefined;

  const payload = await request(
    "POST",
    "com.atproto.repo.uploadBlob",
    bytes,
    token,
    "image/webp"
  );

  return payload.blob;
}

function assertPortableMarkdownImages(markdown) {
  const nonPortableImagePattern =
    /!\[[^\]]*\]\((?!https?:\/\/)([^)]+)\)|<img\b[^>]*\bsrc=["'](?!https?:\/\/)([^"']+)["'][^>]*>/i;
  const match = markdown.match(nonPortableImagePattern);
  if (match) {
    throw new Error(`Published Markdown contains a non-portable image path: ${match[1] ?? match[2]}`);
  }
}

async function putRecord({ collection, rkey, record }) {
  const session = await createSession();
  const payload = await request("POST", "com.atproto.repo.putRecord", {
    repo: session.did,
    collection,
    rkey,
    record,
    validate: false,
  }, session.accessJwt);

  return payload.uri;
}

async function createPublication() {
  const record = {
    $type: PUBLICATION_COLLECTION,
    url: siteUrl,
    name: process.env.ATPROTO_PUBLICATION_NAME ?? "The Little Room",
    description: process.env.ATPROTO_PUBLICATION_DESCRIPTION ?? "The personal web log of Kyle Hebert",
    preferences: {
      showInDiscover: process.env.ATPROTO_SHOW_IN_DISCOVER !== "false",
    },
  };
  validatePublicationRecord(record);

  const uri = await putRecord({
    collection: PUBLICATION_COLLECTION,
    rkey: "main",
    record,
  });

  console.log(uri);
  console.log("Set ATPROTO_PUBLICATION_URI to this value in your local and deploy environments.");
}

async function recordFromMarkdownFile(filePath, token) {
  const absolutePath = path.resolve(filePath);
  const sourceDir = path.dirname(absolutePath);
  const source = await readFile(absolutePath, "utf8");
  const parsed = parseFrontmatter(source);
  const data = parsed.frontmatter;
  const body = await rewriteMarkdownImageReferences(parsed.content.trim(), sourceDir);
  const title = data.title;
  if (!title) throw new Error(`${filePath} is missing title frontmatter.`);
  if (data.published === false) {
    throw new Error(`${filePath} is marked published: false. Drafts must stay local.`);
  }
  if (!data.pubDate && !data.publishedAt) {
    throw new Error(`${filePath} is missing pubDate or publishedAt frontmatter.`);
  }

  const slug = slugify(path.basename(filePath, path.extname(filePath)));
  const normalizedImage = await normalizePublicImage(data.image, sourceDir);
  return buildDocumentRecord({
    slug,
    title,
    description: data.description,
    author: data.author,
    published: data.published !== false,
    publishedAt: normalizeDate(data.pubDate ?? data.publishedAt),
    markdown: body,
    image: normalizedImage?.image,
    coverImageSourcePath: normalizedImage?.localPath,
  }, token);
}

async function buildDocumentRecord({ slug, title, description, author, published, publishedAt, markdown, image, coverImageSourcePath }, token) {
  const coverImage = coverImageSourcePath && token
    ? await uploadCoverImageBlob(coverImageSourcePath, token)
    : undefined;
  const publication = process.env.ATPROTO_PUBLICATION_URI;
  if (!publication) {
    throw new Error("Set ATPROTO_PUBLICATION_URI before publishing document records.");
  }

  const record = {
    $type: DOCUMENT_COLLECTION,
    site: publication,
    path: `/posts/${slug}`,
    title,
    description,
    publishedAt,
    updatedAt: new Date().toISOString(),
    textContent: markdownToPlainText(markdown),
    content: {
      $type: MARKDOWN_CONTENT_TYPE,
      markdown,
    },
    author,
    published,
    image,
    coverImage,
  };

  Object.keys(record).forEach((key) => record[key] === undefined && delete record[key]);
  validateDocumentRecord(slug, record);

  return { slug, record };
}

function validatePublicationRecord(record) {
  const missing = [];
  if (record.$type !== PUBLICATION_COLLECTION) missing.push("$type");
  if (!record.url) missing.push("url");
  if (!record.name) missing.push("name");

  if (missing.length > 0) {
    throw new Error(`Invalid ${PUBLICATION_COLLECTION} record. Missing/invalid: ${missing.join(", ")}`);
  }
}

function validateDocumentRecord(slug, record) {
  const missing = [];
  if (!slug) missing.push("rkey/slug");
  if (record.$type !== DOCUMENT_COLLECTION) missing.push("$type");
  if (!record.site) missing.push("site");
  if (!record.path) missing.push("path");
  if (!record.title) missing.push("title");
  if (!record.publishedAt) missing.push("publishedAt");
  if (!record.textContent) missing.push("textContent");
  if (!record.content?.markdown) missing.push("content.markdown");
  if (record.published === false) missing.push("published");

  if (missing.length > 0) {
    throw new Error(`Invalid ${DOCUMENT_COLLECTION} record. Missing/invalid: ${missing.join(", ")}`);
  }
}

async function publish(filePath) {
  if (!filePath) throw new Error("Pass a Markdown file path.");
  const session = await createSession();
  const { slug, record } = await recordFromMarkdownFile(filePath, session.accessJwt);
  const uri = await putDocumentRecord(session, slug, record);
  console.log(uri);
}

async function validateMarkdownFile(filePath) {
  if (!filePath) throw new Error("Pass a Markdown file path.");
  const { slug, record } = await recordFromMarkdownFile(filePath);
  console.log(JSON.stringify({ slug, record }, null, 2));
}

async function markdownFilesFromPath(inputPath) {
  if (!inputPath) throw new Error("Pass a Markdown file or directory path.");

  const resolvedPath = path.resolve(inputPath);
  const fileStat = await stat(resolvedPath);

  if (fileStat.isDirectory()) {
    const entries = await readdir(resolvedPath);
    const markdownFiles = entries
      .filter((entry) => entry.endsWith(".md"))
      .sort()
      .map((entry) => path.join(resolvedPath, entry));

    if (markdownFiles.length === 0) {
      throw new Error(`No Markdown files found in ${inputPath}.`);
    }

    return markdownFiles;
  }

  if (!inputPath.endsWith(".md")) {
    throw new Error(`Expected a Markdown file or directory, received ${inputPath}.`);
  }

  return [resolvedPath];
}

async function validatePath(inputPath) {
  const markdownFiles = await markdownFilesFromPath(inputPath);

  if (markdownFiles.length === 1) {
    await validateMarkdownFile(markdownFiles[0]);
    return;
  }

  for (const filePath of markdownFiles) {
    const { slug } = await recordFromMarkdownFile(filePath);
    console.log(`${path.relative(process.cwd(), filePath)}: ${slug}`);
  }

  console.log(`Validated ${markdownFiles.length} Markdown posts.`);
}

async function confirmBulkImport(markdownFiles, directory) {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(
      `This will publish ${markdownFiles.length} records from ${directory} to your PDS. Continue? [y/N] `
    );
    return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
  } finally {
    rl.close();
  }
}

async function putDocumentRecord(session, slug, record) {
  const payload = await request("POST", "com.atproto.repo.putRecord", {
    repo: session.did,
    collection: DOCUMENT_COLLECTION,
    rkey: slug,
    record,
    validate: false,
  }, session.accessJwt);

  return payload.uri;
}

async function importDirectory(directory = "src/blog", { confirmed = false } = {}) {
  const markdownFiles = await markdownFilesFromPath(directory);
  if (!confirmed && !(await confirmBulkImport(markdownFiles, directory))) {
    console.log("Import cancelled.");
    return;
  }

  const session = await createSession();

  for (const file of markdownFiles) {
    const { slug, record } = await recordFromMarkdownFile(file, session.accessJwt);
    const uri = await putDocumentRecord(session, slug, record);
    console.log(`${path.basename(file)}: ${uri}`);
  }
}

async function composePost() {
  const rl = createInterface({ input, output });
  try {
    const title = await rl.question("Title: ");
    const suggestedSlug = slugify(title);
    const slug = (await rl.question(`Slug (${suggestedSlug}): `)) || suggestedSlug;
    const description = await rl.question("Description: ");
    const author = (await rl.question("Author (Kyle Hebert): ")) || "Kyle Hebert";
    const publishedAtInput = await rl.question("Published date/time (now): ");
    const publishedAt = normalizeDate(publishedAtInput || new Date());
    const bodyPath = await rl.question("Markdown body file path, or blank to paste body: ");

    let markdown;
    if (bodyPath) {
      markdown = await readFile(path.resolve(bodyPath), "utf8");
    } else {
      console.log("Paste Markdown body. End with a single line containing only a period.");
      const lines = [];
      while (true) {
        const line = await rl.question("");
        if (line === ".") break;
        lines.push(line);
      }
      markdown = lines.join("\n").trim();
    }

    const session = await createSession();
    const { slug: recordSlug, record } = await buildDocumentRecord({
      slug,
      title,
      description,
      author,
      published: true,
      publishedAt,
      markdown,
    }, session.accessJwt);
    const uri = await putDocumentRecord(session, recordSlug, record);
    console.log(uri);
  } finally {
    rl.close();
  }
}

async function main() {
  const command = process.argv[2];
  const args = process.argv.slice(3);
  const confirmed = args.includes("--yes") || args.includes("-y");
  const positionalArgs = args.filter((arg) => arg !== "--yes" && arg !== "-y");

  if (!command || command === "help") {
    usage();
    return;
  }

  if (command === "publication") {
    await createPublication();
  } else if (command === "publish") {
    await publish(positionalArgs[0]);
  } else if (command === "import") {
    await importDirectory(positionalArgs[0], { confirmed });
  } else if (command === "validate") {
    await validatePath(positionalArgs[0]);
  } else if (command === "post") {
    await composePost();
  } else {
    usage();
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
