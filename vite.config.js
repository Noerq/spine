import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// GitHub Pages serves the app under /spine/
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/spine/" : "/",
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Spine – Meine Bücher",
        short_name: "Spine",
        description: "Deine Bücher, schnell erfasst.",
        lang: "de",
        start_url: ".",
        scope: ".",
        display: "standalone",
        background_color: "#f6f1e9",
        theme_color: "#f6f1e9",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,wasm,png,svg}"],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          {
            // Cover images: cache once, show offline afterwards
            urlPattern: ({ url }) =>
              url.href.startsWith("https://books.google.com/books/content") ||
              url.hostname === "covers.openlibrary.org",
            handler: "CacheFirst",
            options: {
              cacheName: "covers",
              expiration: { maxEntries: 3000 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
}));
