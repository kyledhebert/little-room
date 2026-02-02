import { getCollection, type CollectionEntry } from "astro:content";

let cachedPosts: Promise<CollectionEntry<"blog">[]> | null = null;

const getAllBlogPosts = () => {
  if (!cachedPosts) {
    const isProd = import.meta.env.PROD;
    cachedPosts = getCollection("blog", ({ data }) => !isProd || data.published === true);
  }

  return cachedPosts;
};

const sortByDateDesc = (posts: CollectionEntry<"blog">[]) =>
  posts
    .slice()
    .sort((a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime());

export const getSortedBlogPosts = async () => sortByDateDesc(await getAllBlogPosts());

export const getLatestBlogPost = async () => {
  const posts = await getSortedBlogPosts();
  return posts[0] ?? null;
};

export const splitRecentBlogPosts = async (count: number) => {
  const posts = await getSortedBlogPosts();
  return {
    recent: posts.slice(0, count),
    older: posts.slice(count),
  };
};

export const getRelativeDate = (pubDate: Date): string => {
  const MS_PER_DAY = 24 * 60 * 60 * 1000
  const now = new Date()
  const differenceInDays = Math.floor((now.getTime() - pubDate.getTime()) / MS_PER_DAY )

  if (differenceInDays <= 0) return "today"
  if (differenceInDays === 1) return "yesterday"
  if (differenceInDays < 7) return "a few days ago"
  if (differenceInDays < 14) return "last week"
  if (differenceInDays <28 ) return "a few weeks ago"
  if (differenceInDays < 60 ) return "last month"

    return pubDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}
