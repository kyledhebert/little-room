export const stripPostCaptions = (html: string) =>
  html
    .replace(/<p[^>]*class="post-caption"[^>]*>[\s\S]*?<\/p>/g, "")
    .replace(/<p>\s*<img[^>]*>\s*<\/p>/g, "")
    .replace(/<p>\s*<\/p>/g, "");
