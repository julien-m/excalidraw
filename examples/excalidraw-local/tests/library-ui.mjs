// Browser checks for the board library (delete, undo, trash, focus) and the editor actions menu.
// Run only against an isolated service and data profile.
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { chromium } from "playwright";

const origin = process.env.EXCALIDRAW_LOCAL_TEST_URL;
const profile = process.env.EXCALIDRAW_LOCAL_DATA_DIR;
assert.ok(
  origin && profile && !origin.endsWith(":4320"),
  "Use an isolated verification service.",
);

const headers = {
  "X-Excalidraw-Local": "1",
  "Content-Type": "application/json",
};
const trashFiles = async () =>
  (await readdir(join(profile, "trash")).catch(() => [])).filter((name) =>
    name.endsWith(".json"),
  );

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

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const api = (path, method = "GET", body) =>
    page.evaluate(
      async ([path, method, body, headers]) => {
        const response = await fetch(`/api/${path}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        return { status: response.status, body: await response.json() };
      },
      [path, method, body, headers],
    );
  const boot = await page.goto(origin, { waitUntil: "networkidle" });
  assert.equal(boot?.headers()["cache-control"], "no-store");

  // Fixture boards created through the same API as the UI.
  const stamp = Date.now();
  const names = [`UI A ${stamp}`, `UI B ${stamp}`, `UI C ${stamp}`];
  for (const name of names) {
    assert.equal((await api("boards", "POST", { name })).status, 201);
  }
  assert.equal(await page.getByTestId("library-import-tracepin").count(), 0);
  await page.reload({ waitUntil: "networkidle" });
  const boards = (await api("boards")).body;
  const byName = (name) => boards.find((board) => board.name === name);
  const [a, b, c] = names.map(byName);

  // 1. Keyboard: open the dialog, Cancel has focus, Escape returns focus to the trigger.
  const actions = (id) => page.getByTestId(`board-actions-${id}`);
  const chooseDelete = async (id) => {
    await actions(id).click();
    await page.getByTestId(`board-delete-${id}`).click();
  };
  const deleteB = actions(b.id);
  await deleteB.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.getByTestId("board-delete-dialog").waitFor();
  assert.equal(
    await page.evaluate(() => document.activeElement?.dataset.testid),
    "board-delete-cancel",
  );
  // A native modal dialog makes the page inert: Tab reaches the dialog buttons or the
  // browser UI (activeElement = body), never page content behind it.
  for (let step = 0; step < 4; step += 1) {
    await page.keyboard.press("Tab");
    const outside = await page.evaluate(() => {
      const active = document.activeElement;
      return active !== document.body && !active?.closest("dialog");
    });
    assert.equal(
      outside,
      false,
      "Focus stays out of the page behind the dialog",
    );
  }
  await page.getByTestId("board-delete-cancel").focus();
  await page.keyboard.press("Escape");
  await page.getByTestId("board-delete-dialog").waitFor({ state: "detached" });
  assert.equal(
    await page.evaluate(() => document.activeElement?.dataset.testid),
    `board-actions-${b.id}`,
  );
  assert.equal(await page.getByTestId(`board-card-${b.id}`).count(), 1);

  // 2. Confirm with a double click: one deletion, focus on a neighbour card.
  let deletes = 0;
  page.on("request", (request) => {
    if (request.method() === "DELETE") {
      deletes += 1;
    }
  });
  await chooseDelete(b.id);
  await page.getByTestId("board-delete-confirm").dblclick();
  await page.getByTestId(`board-card-${b.id}`).waitFor({ state: "detached" });
  await page.getByTestId("library-undo-delete").waitFor();
  assert.equal(deletes, 1);
  await page.waitForFunction(() =>
    document.activeElement?.dataset.testid?.startsWith("board-open-"),
  );
  assert.deepEqual(await trashFiles(), [`${b.id}.json`]);
  assert.equal((await api(`boards/${b.id}`)).status, 404);

  // 3. Undo restores the board with its revision.
  await page.getByTestId("library-undo-delete").click();
  await page.getByTestId(`board-card-${b.id}`).waitFor();
  assert.equal((await api(`boards/${b.id}`)).body.revision, b.revision);
  assert.deepEqual(await trashFiles(), []);

  // 4. Trash section restores after the notice is gone.
  await chooseDelete(c.id);
  await page.getByTestId("board-delete-confirm").click();
  await page.getByTestId(`board-card-${c.id}`).waitFor({ state: "detached" });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByTestId("library-trash").locator("summary").click();
  await page.getByTestId(`trash-restore-${c.id}`).click();
  await page.getByTestId(`board-card-${c.id}`).waitFor();

  // 5. A board edited elsewhere after the list loaded is not deleted.
  await chooseDelete(a.id);
  const current = (await api(`boards/${a.id}`)).body;
  assert.equal(
    (
      await api(`boards/${a.id}`, "PUT", {
        expectedRevision: current.revision,
        scene: current.scene,
      })
    ).status,
    200,
  );
  await page.getByTestId("board-delete-confirm").click();
  await page.getByTestId("board-delete-dialog").waitFor({ state: "detached" });
  await page.getByText("Le tableau a changé", { exact: false }).waitFor();
  assert.equal((await api(`boards/${a.id}`)).status, 200);
  assert.deepEqual(await trashFiles(), []);

  // 7. Editor menu: keyboard use never moves or deselects the selected shape.
  await page.getByTestId(`board-open-${a.id}`).click();
  await page.locator(".editor .excalidraw").waitFor();
  const canvas = page.locator(".excalidraw__canvas.interactive");
  const box = await canvas.boundingBox();
  await page.locator('label:has([data-testid="toolbar-rectangle"])').click();
  await page.mouse.move(box.x + 500, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 620, box.y + 380, { steps: 6 });
  await page.mouse.up();
  const before = await until(async () => {
    const saved = (await api(`boards/${a.id}`)).body;
    return saved.scene.elements.some((item) => item.type === "rectangle")
      ? saved
      : undefined;
  });
  const shape = before.scene.elements.find((item) => item.type === "rectangle");
  await page.getByTestId("editor-actions-btn").focus();
  await page.keyboard.press("ArrowDown");
  await page.getByTestId("editor-actions-menu").waitFor();
  assert.equal(
    await page.evaluate(() => document.activeElement?.dataset.testid),
    "editor-action-history",
  );
  for (const key of ["ArrowDown", "ArrowDown", "ArrowUp", "End", "Home"]) {
    await page.keyboard.press(key);
  }
  assert.equal(
    await page.evaluate(() => document.activeElement?.dataset.testid),
    "editor-action-history",
  );
  await page.keyboard.press("Escape");
  await page.getByTestId("editor-actions-menu").waitFor({ state: "detached" });
  assert.equal(
    await page.evaluate(() => document.activeElement?.dataset.testid),
    "editor-actions-btn",
  );
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.getByTestId("editor-history").waitFor();
  await page.waitForTimeout(800);
  const after = (await api(`boards/${a.id}`)).body;
  assert.equal(
    after.revision,
    before.revision,
    "menu keys left the scene unchanged",
  );
  assert.deepEqual(
    after.scene.elements.find((item) => item.id === shape.id),
    shape,
  );
  // Archive from the menu, then reopen it with the pointer and close it outside.
  await page.getByTestId("editor-actions-btn").click();
  await page.getByTestId("editor-action-archive").click();
  await page
    .getByTestId("editor-status")
    .getByText("Version archivée")
    .waitFor();
  await page
    .getByTestId("editor-history")
    .getByRole("button", { name: "Ouvrir une copie" })
    .waitFor();
  await page.getByTestId("editor-actions-btn").click();
  await page.mouse.click(box.x + 600, box.y + 500);
  await page.getByTestId("editor-actions-menu").waitFor({ state: "detached" });
  assert.equal((await api(`boards/${a.id}`)).body.history.length, 1);
  await page.getByTestId("editor-history-close").click();
  await page.getByTestId("editor-history").waitFor({ state: "detached" });
  assert.equal(
    await page.evaluate(() => document.activeElement?.dataset.testid),
    "editor-actions-btn",
  );
  const archiveRoute = `**/api/boards/${a.id}/archive`;
  const archiveStarted = Promise.withResolvers();
  const archiveRelease = Promise.withResolvers();
  await page.route(archiveRoute, async (route) => {
    archiveStarted.resolve();
    await archiveRelease.promise;
    await route.continue();
  });
  await page.getByTestId("editor-actions-btn").click();
  await page.getByTestId("editor-action-history").click();
  await page.getByTestId("editor-history").waitFor();
  await page.getByTestId("editor-actions-btn").click();
  await page.getByTestId("editor-action-archive").click();
  try {
    await archiveStarted.promise;
    assert.equal(
      await page.getByTestId("editor-actions-btn").isEnabled(),
      false,
    );
    await page.getByTestId("editor-history-close").click();
    await page.getByTestId("editor-history").waitFor({ state: "detached" });
  } finally {
    archiveRelease.resolve();
  }
  await page.waitForFunction(
    () => document.activeElement?.dataset.testid === "editor-actions-btn",
  );
  await page.unroute(archiveRoute);
  // The open board survives a reload through ?board=.
  assert.equal(new URL(page.url()).searchParams.get("board"), a.id);
  // The editor polls for MCP commands, so the network never idles on a board page.
  await page.reload({ waitUntil: "load" });
  await page.getByRole("heading", { name: names[0], exact: true }).waitFor();
  await page.getByTestId("editor-back-btn").click();
  await page.getByTestId("library").waitFor();
  assert.equal(new URL(page.url()).search, "");

  const duplicateRoute = `**/api/boards/${a.id}/duplicate`;
  await page.route(duplicateRoute, (route) =>
    route.fulfill({
      status: 500,
      json: { error: "Duplication indisponible" },
    }),
  );
  await actions(a.id).click();
  await page.getByTestId(`board-duplicate-${a.id}`).click();
  await page.getByText("Duplication indisponible", { exact: true }).waitFor();
  await page.waitForFunction(
    (id) => document.activeElement?.dataset.testid === id,
    `board-actions-${a.id}`,
  );
  await page.unroute(duplicateRoute);
  await actions(a.id).click();
  await page.getByTestId(`board-duplicate-${a.id}`).click();
  await page
    .getByRole("button", { name: `${names[0]} (copie)`, exact: true })
    .waitFor();
  const copy = (await api("boards")).body.find(
    ({ name }) => name === `${names[0]} (copie)`,
  );
  assert.notEqual(copy.id, a.id);
  const source = (await api(`boards/${a.id}`)).body;
  assert.deepEqual((await api(`boards/${copy.id}`)).body.scene, source.scene);
  assert.equal((await api(`boards/${copy.id}`)).body.history.length, 0);
  const fileName = `Ouvrir ${stamp}`;
  await page.getByTestId("library-open-file").setInputFiles({
    name: `${fileName}.excalidraw`,
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({ type: "excalidraw", version: 2, ...source.scene }),
    ),
  });
  await page.getByRole("heading", { name: fileName, exact: true }).waitFor();
  const importedId = new URL(page.url()).searchParams.get("board");
  assert.notEqual(importedId, a.id);
  assert.deepEqual(
    (await api(`boards/${importedId}`)).body.scene,
    source.scene,
  );

  const imported = (await api(`boards/${importedId}`)).body;
  const remoteScene = {
    ...imported.scene,
    appState: { ...imported.scene.appState, viewBackgroundColor: "#f4f6fa" },
  };
  assert.equal(
    (
      await api(`boards/${importedId}`, "PUT", {
        expectedRevision: imported.revision,
        scene: remoteScene,
      })
    ).status,
    200,
  );
  await page.getByTestId("templates-actions-btn").click();
  await page.getByTestId("templates-action-note").click();
  await page
    .getByTestId("editor-status")
    .getByText(/Le tableau a changé/)
    .waitFor();
  const recoveryRoute = "**/api/boards";
  await page.route(recoveryRoute, (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 500, json: { error: "Copie indisponible" } })
      : route.continue(),
  );
  await page.getByTestId("editor-back-btn").click();
  await page
    .getByTestId("editor-status")
    .getByText("Copie indisponible")
    .waitFor();
  assert.equal(new URL(page.url()).searchParams.get("board"), importedId);
  assert.equal(
    (await api("boards")).body.some(
      ({ name }) => name === `${fileName} (récupéré)`,
    ),
    false,
  );
  await page.unroute(recoveryRoute);
  await page.getByTestId("editor-back-btn").click();
  await page.getByTestId("library").waitFor({ timeout: 4_000 });
  assert.equal(new URL(page.url()).search, "");
  const recovered = (await api("boards")).body.find(
    ({ name }) => name === `${fileName} (récupéré)`,
  );
  assert.ok(recovered);
  assert.notEqual(recovered.id, importedId);
  assert.deepEqual((await api(`boards/${importedId}`)).body.scene, remoteScene);
  const localScene = (await api(`boards/${recovered.id}`)).body.scene;
  assert.ok(
    localScene.elements.some(({ text }) =>
      text?.includes("Prévoir l’état vide"),
    ),
  );
  assert.equal(
    localScene.appState.viewBackgroundColor,
    imported.scene.appState.viewBackgroundColor,
  );

  assert.deepEqual(errors, []);
  process.stdout.write(
    "Library UI: keyboard dialog, trash and undo, editor actions, download-free board import, and conflict recovery on return to boards\n",
  );
} finally {
  await browser.close();
}
