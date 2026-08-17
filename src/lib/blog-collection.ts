import { getCollection, type CollectionEntry } from "astro:content";

export type BlogPost = CollectionEntry<"blog">;

const sortByDateDesc = (posts: BlogPost[]) =>
  posts.slice().sort((a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime());

export const getSortedBlogPosts = async () => {
  const posts = await getCollection(
    "blog",
    ({ data }) => import.meta.env.DEV || data.published === true
  );

  return sortByDateDesc(posts);
};

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
