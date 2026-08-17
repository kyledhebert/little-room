const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

export const siteUrl = () =>
  trimTrailingSlash(import.meta.env.SITE ?? "https://kylehebert.net");

export const publicationUri = () =>
  import.meta.env.ATPROTO_PUBLICATION_URI as string | undefined;

