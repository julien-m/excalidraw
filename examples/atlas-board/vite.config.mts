import { cp } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve, sep } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const sdk = dirname(
  createRequire(import.meta.url).resolve("@atlas/excalidraw-sdk"),
);
const fontFallback =
  /"ASSETS_FALLBACK_URL",`https:\/\/esm\.sh\/[^\n]+?\/dist\/prod\/`/;

export default defineConfig({
  plugins: [
    react(),
    {
      name: "bundle-excalidraw-fonts",
      apply: "build",
      enforce: "pre",
      transform(code, id) {
        if (!id.startsWith(sdk + sep) || !fontFallback.test(code)) {
          return;
        }
        // The pinned SDK adds a CDN fallback even with EXCALIDRAW_ASSET_PATH set.
        // Replace that fallback at build time so exports work fully offline.
        return code.replace(
          fontFallback,
          '"ASSETS_FALLBACK_URL",new URL("/",window.location.origin).href',
        );
      },
      async closeBundle() {
        await cp(resolve(sdk, "fonts"), resolve("dist/fonts"), {
          recursive: true,
        });
      },
    },
  ],
  resolve: {
    alias: { "@excalidraw/laser-pointer": "@atlas/excalidraw-laser" },
  },
  build: { target: "es2022" },
});
