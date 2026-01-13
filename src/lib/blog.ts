import { getCollection, type CollectionEntry } from "astro:content";

let cachedPosts: Promise<CollectionEntry<"blog">[]> | null = null;

const getAllBlogPosts = () => {
  if (!cachedPosts) {
    cachedPosts = getCollection("blog");
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
