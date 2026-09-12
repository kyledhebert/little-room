import { getCollection, type CollectionEntry } from "astro:content";

export type Photo = CollectionEntry<"photos">;

export const getPhotos = async () => {
  const photos = await getCollection("photos");
  return photos.sort((a, b) => b.data.createdAt.getTime() - a.data.createdAt.getTime());
};
