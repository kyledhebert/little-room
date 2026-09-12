// @ts-check
import { defineConfig, envField, fontProviders } from 'astro/config';

import netlify from "@astrojs/netlify";

// https://astro.build/config
export default defineConfig({
  site: "https://kylehebert.net/",
  output: "static",
  env: {
    schema: {
      PUBLIC_URL: envField.string({ context: "server", access: "public", optional: true }),
      LOCAL_PUBLIC_URL: envField.string({ context: "server", access: "public", optional: true }),
      ATPROTO_ADMIN_DID: envField.string({ context: "server", access: "public", optional: true }),
      ADMIN_SESSION_SECRET: envField.string({ context: "server", access: "secret", optional: true }),
      ATPROTO_SERVICE: envField.string({ context: "server", access: "public", optional: true }),
      INSTAGRAM_USER_ID: envField.string({ context: "server", access: "public", optional: true }),
      INSTAGRAM_ACCESS_TOKEN: envField.string({ context: "server", access: "secret", optional: true }),
      INSTAGRAM_GRAPH_URL: envField.string({ context: "server", access: "public", optional: true }),
      INSTAGRAM_GRAPH_VERSION: envField.string({ context: "server", access: "public", optional: true }),
      NETLIFY_BUILD_HOOK: envField.string({ context: "server", access: "secret", optional: true }),
    },
  },
  experimental: {
    fonts: [{
      provider: fontProviders.bunny(),
      name: "Bungee",
      cssVariable: "--font-display"
    },
    {
      provider: fontProviders.bunny(),
      name: "Bitter",
      cssVariable: "--font-serif"
    },
    {
      provider: fontProviders.bunny(),
      name: "Barlow Condensed",
      cssVariable: "--font-sans"
    }
    ]
  },

  adapter: netlify()
});
