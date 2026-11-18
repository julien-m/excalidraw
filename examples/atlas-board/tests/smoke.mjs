import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { chromium } from "playwright";

const origin = process.env.ATLAS_BOARD_TEST_URL ?? "http://127.0.0.1:4320";
const profile = process.env.ATLAS_BOARD_DATA_DIR;
const archive = process.env.ATLAS_TRACEPIN_BOARDS_DIR;
assert.ok(
  profile && archive,
  "Use the isolated verification service and copied Tracepin archive.",
);
const original = JSON.parse(
  await readFile(join(archive, "boards.json"), "utf8"),
);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const client = new Client({ name: "atlas-board-smoke", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["--import", "tsx", "src/mcp/main.ts"],
  cwd: new URL("../", import.meta.url).pathname,
  env: { ATLAS_BOARD_DATA_DIR: profile },
});
const tool = async (name, args = {}) => {
  const result = await client.callTool({ name, arguments: args });
  const { content } = result;
  assert.ok(content[0]?.text);
  return {
    error: result.isError,
    value: result.isError ? content[0].text : JSON.parse(content[0].text),
  };
};
const until = async (probe) => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await probe();
    if (result !== undefined) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("State did not become visible");
};

try {
  const context = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  const errors = [];
  const outbound = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (!request.url().startsWith(origin) && /^https?:/.test(request.url())) {
      outbound.push(new URL(request.url()).origin);
    }
  });
  await page.goto(origin, { waitUntil: "networkidle" });
  await client.connect(transport);
  const exposed = await client.listTools();
  assert.ok(exposed.tools.some(({ name }) => name === "draw"));
  await page.getByRole("button", { name: "Importer Tracepin" }).click();
  await page
    .getByText("tableaux Tracepin disponibles.", { exact: false })
    .waitFor({ timeout: 8_000 });
  const known = (await tool("list_boards")).value;
  const oldPages = original.collection.history.map((row) => row.page);
  let objects = 0;
  let images = 0;
  let imageDataURL;
  for (const source of oldPages) {
    const match = known.find((item) => item.tracepinId === source.id);
    assert.ok(match, "Every source history entry must be imported");
    const saved = JSON.parse(
      await readFile(join(profile, "boards", `${match.id}.json`), "utf8"),
    );
    assert.equal(saved.name, source.name);
    const archivedAt = original.collection.history.find(
      (entry) => entry.page.id === source.id,
    ).archivedAt;
    const date =
      typeof archivedAt === "number"
        ? new Date(Date.UTC(2001, 0, 1) + archivedAt * 1000).toISOString()
        : archivedAt;
    assert.equal(saved.history[0].savedAt, date);
    assert.equal(saved.scene.elements.length, source.document.items.length);
    assert.deepEqual(
      saved.scene.elements.map((item) => item.id),
      source.document.items.map((item) => item.id.rawValue),
    );
    for (const item of saved.scene.elements) {
      if (item.type === "image") {
        const image = Buffer.from(
          saved.scene.files[item.fileId].dataURL.split(",")[1],
          "base64",
        );
        assert.deepEqual(
          image,
          await readFile(join(archive, "assets", item.fileId)),
        );
        images += 1;
        imageDataURL ??= saved.scene.files[item.fileId].dataURL;
      }
    }
    objects += saved.scene.elements.length;
  }
  process.stdout.write(
    `Tracepin import: ${oldPages.length} history entries, ${objects} editable objects, ${images} byte-identical images\n`,
  );

  const boardName = `MCP smoke ${Date.now()}`;
  await page.getByRole("textbox", { name: "Nom du tableau" }).fill(boardName);
  await page.getByRole("button", { name: "Créer un tableau" }).click();
  await page.getByRole("heading", { name: boardName, exact: true }).waitFor();
  const board = (await tool("list_boards")).value.find(
    (item) => item.name === boardName,
  );
  const state = () => tool("read_board", { board_id: board.id });
  const draw = await tool("draw", {
    boardId: board.id,
    expectedRevision: board.revision,
    commands: [
      {
        kind: "shape",
        id: "draft",
        shape: "rectangle",
        text: "Brouillon",
        x: 160,
        y: 180,
      },
      {
        kind: "shape",
        id: "review",
        shape: "diamond",
        text: "Relecture",
        relativeTo: "draft",
        direction: "right",
        gap: 64,
      },
      {
        kind: "connect",
        id: "flow",
        from: "draft",
        to: "review",
        text: "Valider",
      },
      ...(imageDataURL
        ? [
            {
              kind: "image",
              id: "reference",
              dataURL: imageDataURL,
              relativeTo: "review",
              direction: "right",
              width: 240,
            },
          ]
        : []),
    ],
  });
  assert.equal(draw.error, undefined, String(draw.value));
  const first = (await state()).value;
  assert.equal(first.objects.find((item) => item.id === "review").x, 416);
  if (imageDataURL) {
    assert.equal(
      first.objects.find((item) => item.id === "reference").type,
      "image",
    );
  }
  const arrow = first.objects.find((item) => item.id === "flow");
  assert.equal(arrow.startBinding.elementId, "draft");
  assert.equal(arrow.endBinding.elementId, "review");
  const canvas = page.locator(".excalidraw__canvas.interactive");
  const bounds = await canvas.boundingBox();
  assert.ok(bounds);
  await page.mouse.move(bounds.x + 240, bounds.y + 210);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 260, bounds.y + 330, { steps: 8 });
  await page.mouse.up();
  const manual = await until(async () => {
    const current = (await state()).value;
    return current.revision > draw.value.revision &&
      current.objects.find((item) => item.id === "draft").y > 200
      ? current
      : undefined;
  });
  const stale = await tool("draw", {
    boardId: board.id,
    expectedRevision: draw.value.revision,
    commands: [{ kind: "move", ids: ["draft"], dx: 99, dy: 99 }],
  });
  assert.equal(stale.error, true);
  const edit = await tool("draw", {
    boardId: board.id,
    expectedRevision: manual.revision,
    commands: [
      {
        kind: "shape",
        id: "next",
        shape: "rectangle",
        text: "Suite",
        relativeTo: "draft",
        direction: "below",
      },
    ],
  });
  assert.equal(edit.error, undefined, String(edit.value));
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+z" : "Control+z",
  );
  await until(async () => {
    const current = (await state()).value;
    return current.revision > edit.value.revision &&
      !current.objects.some((item) => item.id === "next")
      ? current
      : undefined;
  });
  await page.getByRole("button", { name: "Copier et fermer" }).click();
  await page
    .getByRole("heading", { name: "Atlas Board", exact: true })
    .waitFor({ timeout: 8_000 });
  const copied = await page.evaluate(async () =>
    (await navigator.clipboard.read()).flatMap((item) => [...item.types]),
  );
  assert.ok(copied.includes("image/png"));
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: new RegExp(boardName) }).click();
  await page.getByRole("button", { name: "Historique", exact: true }).click();
  await page.getByRole("button", { name: "Ouvrir une copie" }).click();
  await page
    .getByRole("heading", { name: `${boardName} (copie)`, exact: true })
    .waitFor();
  const copy = (await tool("list_boards")).value.find(
    (item) => item.name === `${boardName} (copie)`,
  );
  assert.notEqual(copy.id, board.id);
  const originalState = (await state()).value;
  const copiedState = (await tool("read_board", { board_id: copy.id })).value;
  assert.deepEqual(originalState.objects, copiedState.objects);
  assert.deepEqual(errors, []);
  assert.deepEqual(outbound, []);
  process.stdout.write(
    "Live proof: MCP draw → mouse move → stale rejection → MCP edit → undo → PNG clipboard → archive → editable copy after reload\n",
  );
} finally {
  await client.close();
  await browser.close();
}
