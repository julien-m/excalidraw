import { cp } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const sdk = dirname(
  createRequire(import.meta.url).resolve("@local/excalidraw-sdk"),
);
const fontFallback =
  /"ASSETS_FALLBACK_URL",`https:\/\/esm\.sh\/[^\n]+?\/dist\/prod\/`/;

// The pinned SDK samples cached text as a bitmap when drawing to the canvas.
const textCacheBranch =
  /(case"rectangle":case"diamond":case"ellipse":case"line":case"arrow":case"image":case"text":case"iframe":case"embeddable":\{if\(\w+\.generateElementShape\((\w+),(\w+)\),)\3\.isExporting\)/;
const shapeBranch =
  /(case"rectangle":case"iframe":case"embeddable":\{)(let \w+;if\((\w+)\.roundness\)\{[\s\S]+?=)(\w+)\.path\(`[\s\S]+?`,(\w+)\((\w+)\(\3,(\w+),(\w+)\),!0\)\)/;
const shapeModule = fileURLToPath(
  new URL("./src/editor/diagram-shapes.ts", import.meta.url),
);
let directTextRendering = false;
let customShapeRendering = false;

export default defineConfig({
  plugins: [
    react(),
    {
      name: "configure-excalidraw-renderer",
      apply: "build",
      enforce: "pre",
      buildStart() {
        directTextRendering = false;
        customShapeRendering = false;
      },
      transform(code, id) {
        if (!id.startsWith(sdk + sep)) {
          return;
        }
        // Use the existing direct drawing path for glyphs, including on the
        // interactive canvas. Shapes still use the SDK bitmap cache.
        const directText = code.replace(
          textCacheBranch,
          (_match, start: string, element: string, config: string) => {
            directTextRendering = true;
            return `${start}${element}.type==="text"||${config}.isExporting)`;
          },
        );
        // Both the native canvas and SVG exporter consume this rough shape.
        const next = directText.replace(
          shapeBranch,
          (
            match,
            start,
            _rest,
            element,
            generator,
            options,
            adapt,
            exporting,
            embeds,
          ) => {
            customShapeRendering = true;
            return `${start}const localShape=readLocalDiagramShape(${element});if(localShape){const shapeOptions=${options}(${adapt}(${element},${exporting},${embeds}),!0);if(localShape==="brace")delete shapeOptions.fill;return ${generator}.path(localDiagramShapePath(localShape,${element}.width,${element}.height),shapeOptions)}${match.slice(
              start.length,
            )}`;
          },
        );
        const renderer =
          next === directText
            ? next
            : `import {readDiagramShape as readLocalDiagramShape, diagramShapePath as localDiagramShapePath} from ${JSON.stringify(
                shapeModule,
              )};
${next}`;
        // The pinned SDK adds a CDN fallback even with EXCALIDRAW_ASSET_PATH set.
        const bundled = renderer.replace(
          fontFallback,
          '"ASSETS_FALLBACK_URL",new URL("/",window.location.origin).href',
        );
        return bundled !== code ? bundled : undefined;
      },
      buildEnd(error) {
        if (!error && !customShapeRendering) {
          this.error(
            "The pinned Excalidraw shape renderer no longer matches the outline rule.",
          );
        }
        if (!error && !directTextRendering) {
          this.error(
            "The pinned Excalidraw text renderer no longer matches the direct-drawing rule.",
          );
        }
      },
      async closeBundle() {
        await cp(resolve(sdk, "fonts"), resolve("dist/fonts"), {
          recursive: true,
        });
      },
    },
  ],
  resolve: {
    alias: { "@excalidraw/laser-pointer": "@local/excalidraw-laser" },
  },
  build: { target: "es2022" },
});
