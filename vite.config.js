import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "favicon-16.png", "favicon-32.png", "apple-touch-icon.png"],
      workbox: {
        // precache the build + the card art (52 small webp) + the sounds so it
        // installs and opens instantly; bump the size cap for the audio clips.
        globPatterns: ["**/*.{js,css,html,webp,png,ico,mp3,woff2}"],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      manifest: {
        name: "Ezelen — het reactiekaartspel",
        short_name: "Ezelen",
        description: "Het Nederlandse reactiekaartspel, online. Schuif door, verzamel vier dezelfde en sla op tafel.",
        lang: "nl",
        dir: "ltr",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#0c1413",
        theme_color: "#0c1413",
        categories: ["games", "entertainment"],
        icons: [
          { src: "pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "pwa-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
  server: { port: 5180, strictPort: false },
});
