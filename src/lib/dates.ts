const MS_PER_DAY = 24 * 60 * 60 * 1000;

const toLocalDateFromUTC = (date: Date) =>
  new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12);

export const formatPubDate = (pubDate: Date): string =>
  toLocalDateFromUTC(pubDate).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

export const getRelativeDate = (pubDate: Date): string => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  const postDate = toLocalDateFromUTC(pubDate);
  const differenceInDays = Math.floor((today.getTime() - postDate.getTime()) / MS_PER_DAY);

  if (differenceInDays <= 0) return "today";
  if (differenceInDays === 1) return "yesterday";
  if (differenceInDays < 7) return "a few days ago";
  if (differenceInDays < 14) return "last week";
  if (differenceInDays < 28) return "a few weeks ago";
  if (differenceInDays < 60) return "last month";

  return`on ${formatPubDate(pubDate)}`;
};
