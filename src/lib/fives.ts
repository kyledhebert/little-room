import { getCollection, type CollectionEntry } from "astro:content";

export type Five = CollectionEntry<"fives">;

const sortByDateDesc = (fives: Five[]) =>
  fives.slice().sort((a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime());

export const getSortedFives = async () => {
  const fives = await getCollection(
    "fives",
    ({ data }) => import.meta.env.DEV || data.published === true
  );

  return sortByDateDesc(fives);
};

