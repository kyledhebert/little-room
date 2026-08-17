import rss from '@astrojs/rss';
import { getSortedBlogPosts } from '../lib/blog';

export async function GET(context) {
  const posts = await getSortedBlogPosts();
  return rss({
    title: 'The Little Room',
    description: 'The personal web log of Kyle Hebert',
    site: context.site,
    items: posts.map((post) => ({
      title: post.data.title,
      pubDate: post.data.pubDate,
      description: post.data.description,
      link: `/posts/${post.id}/`,
    })),
    customData: `<language>en-us</language>`,
  })
}
