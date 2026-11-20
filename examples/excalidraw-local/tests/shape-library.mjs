// Browser checks for Excalidraw shape libraries: file import, insertion, reload, concurrent
// installs from two tabs and the real libraries gallery return. Needs network access for the gallery.
// Run only against an isolated service (EXCALIDRAW_LOCAL_TEST_URL, EXCALIDRAW_LOCAL_DATA_DIR) and
// pass two downloaded `.excalidrawlib` files: EXCALIDRAW_LOCAL_LIBRARY_FILES=first,second.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { chromium } from "playwright";

const origin = process.env.EXCALIDRAW_LOCAL_TEST_URL;
const profile = process.env.EXCALIDRAW_LOCAL_DATA_DIR;
const files = process.env.EXCALIDRAW_LOCAL_LIBRARY_FILES?.split(",") ?? [];
assert.ok(
  origin && profile && files.length === 2 && !origin.endsWith(":4320"),
  "Use the isolated verification service and two library files.",
);
const headers = {
  "X-Excalidraw-Local": "1",
  "Content-Type": "application/json",
};
const itemCount = async (file) => {
  const data = JSON.parse(await readFile(file, "utf8"));
  return (data.libraryItems ?? data.library).length;
};
const stored = async () =>
  JSON.parse(await readFile(join(profile, "library.json"), "utf8"))
    .libraryItems;
const until = async (probe, timeout = 8_000) => {
  const deadline = Date.now() + timeout;
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
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  // Playwright cannot answer the File System Access picker; the SDK's file helper then
  // falls back to <input type="file">, which Playwright drives. Users keep the native picker.
  await context.addInitScript(() => {
    delete window.showOpenFilePicker;
  });
  const errors = [];
  const openBoard = async (name) => {
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    // The SDK asks before installing a library whose token belongs to another tab.
    page.on("dialog", (dialog) => void dialog.accept());
    await page.goto(origin, { waitUntil: "networkidle" });
    const board = await page.evaluate(
      async ([name, headers]) =>
        (
          await fetch("/api/boards", {
            method: "POST",
            headers,
            body: JSON.stringify({ name }),
          })
        ).json(),
      [name, headers],
    );
    await page.goto(`${origin}/?board=${board.id}`, { waitUntil: "load" });
    await page.locator(".editor .excalidraw").waitFor();
    return { page, board };
  };
  const openSidebar = async (page) => {
    // Inserting an item closes the library sidebar; the trigger toggles it.
    if (!(await page.locator(".library-menu-browse-button").isVisible())) {
      await page.locator("label.sidebar-trigger__label-element").click();
    }
    await page.locator(".library-menu-browse-button").waitFor();
  };
  const importFile = async (page, file) => {
    await openSidebar(page);
    const patched = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/library") &&
        response.request().method() === "PATCH",
    );
    await page.locator(".sidebar [data-testid=dropdown-menu-button]").click();
    const chooser = page.waitForEvent("filechooser");
    await page.getByTestId("lib-dropdown--load").click();
    await (await chooser).setFiles(file);
    assert.equal((await patched).status(), 200);
  };
  // Version-2 files keep their item IDs: a second import into the same profile is a no-op.
  const before = (await stored().catch(() => [])).length;
  assert.equal(before, 0, "Run against a fresh data profile.");
  const [first, second] = files;
  const firstCount = await itemCount(first);
  const secondCount = await itemCount(second);

  // 1. File import persists on the server.
  const { page, board } = await openBoard(`Formes ${Date.now()}`);
  await openSidebar(page);
  await importFile(page, first);
  assert.equal((await stored()).length, before + firstCount);

  // 2. Insert an item; the board saves through the strict scene schema.
  await page.locator(".library-unit__dragger").first().click();
  const saved = await until(async () => {
    const current = await page.evaluate(
      async ([id, headers]) =>
        (await fetch(`/api/boards/${id}`, { headers })).json(),
      [board.id, headers],
    );
    return current.scene.elements.length > 0 ? current : undefined;
  });
  await page.getByTestId("editor-status").getByText("Enregistré").waitFor();
  process.stdout.write(
    `Inserted ${saved.scene.elements.length} elements (${[
      ...new Set(saved.scene.elements.map((item) => item.type)),
    ]})\n`,
  );

  // 3. Two tabs install at the same time from the same base: neither install is lost.
  const other = await openBoard(`Formes bis ${Date.now()}`);
  await openSidebar(other.page);
  let release;
  let holding = false;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/api/library", async (route) => {
    if (route.request().method() === "PATCH") {
      holding = true;
      await held;
    }
    await route.continue();
  });
  // A file chooser only opens in the foreground tab.
  await page.bringToFront();
  const slow = importFile(page, second);
  // The first tab has loaded its base and its change is now held before the server.
  await until(async () => (holding ? true : undefined), 20_000);
  // While the first tab's change waits, the second tab installs from the gallery URL.
  const galleryInstall = other.page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/library") &&
      response.request().method() === "PATCH",
  );
  const libraryUrl =
    "https://libraries.excalidraw.com/libraries/g-script/android.excalidrawlib";
  await other.page.evaluate((url) => {
    window.location.hash = `addLibrary=${encodeURIComponent(url)}&token=other`;
  }, libraryUrl);
  assert.equal((await galleryInstall).status(), 200);
  release();
  await slow;
  const ids = new Set((await stored()).map((item) => item.id));
  const afterRace = (await stored()).length;
  process.stdout.write(
    `Library items after concurrent installs: ${afterRace}\n`,
  );
  // Version-1 files such as the Android one get fresh item IDs on each install, so the
  // gallery install of that same file adds its items again. A lost install would show here.
  assert.equal(
    afterRace,
    before + firstCount + secondCount + firstCount,
    "both concurrent installs are kept",
  );
  await page.unroute("**/api/library");

  // 4. Reload: the sidebar shows every stored item.
  await page.reload({ waitUntil: "load" });
  await page.locator(".editor .excalidraw").waitFor();
  await openSidebar(page);
  await until(async () =>
    (await page.locator(".library-unit").count()) >= ids.size
      ? true
      : undefined,
  );

  // 5. Real gallery: the browse link returns to this board's tab and installs there.
  const browse = page.locator(".library-menu-browse-button");
  const href = new URL(await browse.getAttribute("href"));
  assert.equal(
    href.searchParams.get("referrer"),
    `${origin}/?board=${board.id}`,
  );
  assert.equal(href.searchParams.get("target"), `excalidraw-board-${board.id}`);
  if (process.env.EXCALIDRAW_LOCAL_SKIP_GALLERY !== "1") {
    const popup = context.waitForEvent("page");
    await browse.click();
    const gallery = await popup;
    await gallery.waitForLoadState("domcontentloaded");
    const add = gallery.locator('a[href*="addLibrary="]').first();
    await add.waitFor({ timeout: 15_000 });
    const addHref = await add.getAttribute("href");
    assert.ok(addHref.startsWith(`${origin}/?board=${board.id}#addLibrary=`));
    const installed = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/library") &&
        response.request().method() === "PATCH",
      { timeout: 20_000 },
    );
    const countBefore = (await stored()).length;
    await add.click();
    assert.equal((await installed).status(), 200);
    process.stdout.write(
      `Gallery install returned to the board tab: ${countBefore} → ${
        (await stored()).length
      } items\n`,
    );
    assert.equal(new URL(page.url()).searchParams.get("board"), board.id);
  }
  assert.deepEqual(errors, []);
  process.stdout.write(
    "Shape libraries: file import, insertion, concurrent installs, reload, gallery\n",
  );
} finally {
  await browser.close();
}
