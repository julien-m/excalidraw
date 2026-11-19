import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { maxRequestBytes } from "../board/scene";

import { parseTracepinArchive } from "./archive";

import type { TracepinArchive } from "./archive";

const formats: Readonly<Record<string, string>> = {
  "public.png": "image/png",
  "public.jpeg": "image/jpeg",
  "com.compuserve.gif": "image/gif",
  "org.webmproject.webp": "image/webp",
};

/** Reads the selected Tracepin directory and checks source image hashes before returning a portable copy. */
export const readTracepinArchive = async (): Promise<TracepinArchive> => {
  const directory =
    process.env.EXCALIDRAW_LOCAL_TRACEPIN_BOARDS_DIR ??
    join(homedir(), "Library", "Application Support", "Tracepin", "Boards");
  const manifest = join(directory, "boards.json");
  let sourceBytes = (await stat(manifest)).size;
  if (sourceBytes > maxRequestBytes / 2) {
    throw new Error("Archive Tracepin trop volumineuse.");
  }
  const archive = parseTracepinArchive(
    JSON.parse(await readFile(manifest, "utf8")),
  );
  const pages: TracepinArchive["pages"] = archive.collection.history.map(
    ({ page, archivedAt }) => ({ page, archivedAt }),
  );
  pages.push(
    ...archive.collection.pages
      .filter((page) => page.document.items.length > 0)
      .map((page) => ({ page })),
  );
  const ids = new Set(
    pages.flatMap(({ page }) =>
      page.document.items.flatMap(({ shape }) =>
        "image" in shape ? [shape.image._0.assetID] : [],
      ),
    ),
  );
  const assets: TracepinArchive["assets"] = {};
  for (const id of ids) {
    const record = archive.assets[id];
    const mimeType = formats[record?.typeIdentifier];
    if (!mimeType) {
      throw new Error("Format d’image Tracepin non pris en charge.");
    }
    const path = join(directory, "assets", id);
    sourceBytes += (await stat(path)).size;
    if (sourceBytes > maxRequestBytes / 2) {
      throw new Error("Archive Tracepin trop volumineuse.");
    }
    const data = await readFile(path);
    if (createHash("sha256").update(data).digest("hex") !== id) {
      throw new Error("L’image Tracepin ne correspond pas à son empreinte.");
    }
    assets[id] = {
      dataURL: `data:${mimeType};base64,${data.toString("base64")}`,
      mimeType,
    };
  }
  return { pages, assets };
};
