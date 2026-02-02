// @ts-check
import { defineConfig, fontProviders } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: "https://kylehebert.net/",
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
  }
});
