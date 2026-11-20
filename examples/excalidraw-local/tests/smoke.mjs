import assert from "node:assert/strict";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { chromium } from "playwright";

const origin = process.env.EXCALIDRAW_LOCAL_TEST_URL ?? "http://127.0.0.1:4320";
const profile = process.env.EXCALIDRAW_LOCAL_DATA_DIR;
assert.ok(
  profile && !origin.endsWith(":4320"),
  "Use an isolated verification service.",
);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const client = new Client({ name: "excalidraw-local-smoke", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["--import", "tsx", "src/mcp/main.ts"],
  cwd: new URL("../", import.meta.url).pathname,
  env: { EXCALIDRAW_LOCAL_DATA_DIR: profile },
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
  await page.addInitScript(() => {
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    window.__directTextRendererProbe = new Map();
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      if (
        this.canvas.isConnected &&
        this.canvas.classList.contains("excalidraw__canvas")
      ) {
        window.__directTextRendererProbe.set(text, this.font);
      }
      return fillText.call(this, text, ...args);
    };
  });
  await page.goto(origin, { waitUntil: "networkidle" });
  await client.connect(transport);
  const exposed = await client.listTools();
  assert.ok(exposed.tools.some(({ name }) => name === "draw"));
  const imageDataURL = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 16;
    const context = canvas.getContext("2d");
    context.fillStyle = "#2052b2";
    context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL();
  });

  const boardName = `MCP smoke ${Date.now()}`;
  await page
    .getByRole("textbox", { name: "Nom du nouveau tableau" })
    .fill(boardName);
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
  const sourceBlock = first.objects.find(({ id }) => id === "draft");
  await page.mouse.click(
    bounds.x + sourceBlock.x + sourceBlock.width / 2,
    bounds.y + sourceBlock.y + sourceBlock.height / 2,
  );
  const selection = page.getByRole("toolbar", {
    name: "Commandes du bloc sélectionné",
  });
  const shortcutHint = page.locator(".editor .HintViewer").first();
  await shortcutHint.waitFor({ state: "attached", timeout: 5_000 });
  assert.equal(await shortcutHint.isVisible(), false);
  assert.equal(
    await selection.getByLabel("Dimensions du bloc").textContent(),
    `${sourceBlock.width} × ${sourceBlock.height}`,
  );
  const dimensions = await selection
    .getByLabel("Dimensions du bloc")
    .boundingBox();
  assert.ok(dimensions);
  const topOfBlock = bounds.y + sourceBlock.y;
  const bottomOfBlock = topOfBlock + sourceBlock.height;
  assert.ok(
    dimensions.y >= bottomOfBlock,
    "Dimensions must be below the selected block",
  );
  const sides = [
    "Ajouter un bloc au-dessus",
    "Ajouter un bloc à gauche",
    "Ajouter un bloc en dessous",
    "Ajouter un bloc à droite",
  ].map((name) => selection.getByRole("button", { name, exact: true }));
  const glyphs = selection.locator("button .icon");
  const shown = () =>
    glyphs.evaluateAll((nodes) =>
      nodes.map((node) => getComputedStyle(node).display !== "none"),
    );
  assert.deepEqual(await shown(), [false, false, false, false]);
  for (const side of sides) {
    await side.hover();
    assert.equal(await side.locator(".icon").isVisible(), true);
    assert.equal((await shown()).filter(Boolean).length, 1);
  }
  await page
    .getByTestId("editor-status")
    .getByText(/^(Enregistré|Commande MCP enregistrée)$/)
    .waitFor({ timeout: 5_000 });
  const beforeExtension = (await state()).value;
  await selection
    .getByRole("button", { name: "Ajouter un bloc à droite" })
    .click();
  const label = page.getByRole("textbox", { name: "Texte du nouveau bloc" });
  await label.waitFor({ timeout: 5_000 });
  assert.equal(
    await label.evaluate((node) => node.ownerDocument.activeElement === node),
    true,
  );
  assert.deepEqual((await state()).value, beforeExtension);
  await label.pressSequentially("Controle qualite");
  await label.press("Enter");
  const extended = await until(async () => {
    const current = (await state()).value;
    return current.objects.some(({ text }) => text === "Controle qualite")
      ? current
      : undefined;
  });
  const childLabel = extended.objects.find(
    ({ text }) => text === "Controle qualite",
  );
  const child = extended.objects.find(
    ({ id }) => id === childLabel.containerId,
  );
  assert.equal(child.type, sourceBlock.type);
  assert.equal(child.width, sourceBlock.width);
  assert.equal(child.height, sourceBlock.height);
  const obstruction = first.objects.find(({ id }) => id === "review");
  assert.ok(child.x > sourceBlock.x + sourceBlock.width);
  assert.ok(
    child.y >= obstruction.y + obstruction.height ||
      child.y + child.height <= obstruction.y,
  );
  const linked = extended.objects.find(
    ({ endBinding }) => endBinding?.elementId === child.id,
  );
  assert.equal(linked.startBinding.elementId, sourceBlock.id);
  const savedBoard = await page.evaluate(async (id) => {
    const response = await fetch(`/api/boards/${id}`, {
      headers: { "X-Excalidraw-Local": "1" },
    });
    if (!response.ok) {
      throw new Error(`Board read failed (${response.status})`);
    }
    return response.json();
  }, board.id);
  const wire = savedBoard.scene.elements.find(({ id }) => id === linked.id);
  for (const [index, [x, y]] of wire.points.slice(1).entries()) {
    const [prevX, prevY] = wire.points[index];
    assert.ok(
      wire.x + Math.max(x, prevX) < obstruction.x ||
        wire.x + Math.min(x, prevX) > obstruction.x + obstruction.width ||
        wire.y + Math.max(y, prevY) < obstruction.y ||
        wire.y + Math.min(y, prevY) > obstruction.y + obstruction.height,
      "The connector must go around the existing block.",
    );
  }
  const shortcut = process.platform === "darwin" ? "Meta+z" : "Control+z";
  await page.keyboard.press("Backspace");
  const deleted = await until(async () => {
    const current = (await state()).value;
    return !current.objects.some(({ id }) => id === child.id)
      ? current
      : undefined;
  });
  assert.ok(deleted.objects.some(({ id }) => id === sourceBlock.id));
  for (const key of [linked.id, childLabel.id]) {
    assert.ok(!deleted.objects.some(({ id }) => id === key));
  }
  await page.keyboard.press(shortcut);
  await until(async () => {
    const current = (await state()).value;
    const restored = current.objects.find(({ id }) => id === linked.id);
    return current.objects.some(({ id }) => id === child.id) &&
      restored?.startBinding?.elementId === sourceBlock.id &&
      restored.endBinding?.elementId === child.id
      ? current
      : undefined;
  });
  await page.keyboard.press(shortcut);
  const afterExtensionUndo = await until(async () => {
    const current = (await state()).value;
    return current.revision > extended.revision &&
      current.objects.length === first.objects.length
      ? current
      : undefined;
  });
  // Excalidraw recalculates the anchor of an existing bound arrow on undo.
  const restoredArrow = afterExtensionUndo.objects.find(
    ({ id }) => id === arrow.id,
  );
  assert.ok(Math.abs(restoredArrow.x - arrow.x) < 1);
  assert.ok(Math.abs(restoredArrow.width - arrow.width) < 1);
  assert.deepEqual(
    afterExtensionUndo.objects.map((item) =>
      item.id === arrow.id ? { ...item, x: arrow.x, width: arrow.width } : item,
    ),
    first.objects,
  );
  process.stdout.write(
    "Context controls: dimensions, collision avoidance, focused label, native binding and single undo verified\n",
  );

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
    .getByRole("heading", { name: "Excalidraw", exact: true })
    .waitFor({ timeout: 8_000 });
  const copied = await page.evaluate(async () =>
    (await navigator.clipboard.read()).flatMap((item) => [...item.types]),
  );
  assert.ok(copied.includes("image/png"));
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: boardName, exact: true }).click();
  await page.getByRole("button", { name: "Actions", exact: true }).click();
  await page
    .getByRole("menuitemcheckbox", { name: "Afficher l’historique" })
    .click();
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

  // Templates append native objects, survive a reload and remain editable via MCP.
  await page.getByTestId("templates-actions-btn").click();
  await page.getByTestId("templates-action-overview").click();
  const readCopy = async () =>
    (await tool("read_board", { board_id: copy.id, limit: 200 })).value;
  const withTemplate = await until(async () => {
    const current = await readCopy();
    return current.objects.some(
      ({ text }) => text === "Maquettes web et mobile",
    )
      ? current
      : undefined;
  });
  const priorIds = new Set(copiedState.objects.map(({ id }) => id));
  const inserted = withTemplate.objects.filter(({ id }) => !priorIds.has(id));
  for (const caption of [
    "Architecture du service",
    "Carte mentale",
    "Maquettes web et mobile",
  ]) {
    assert.ok(
      inserted.some(({ text }) => text === caption),
      caption,
    );
  }
  assert.ok(
    inserted.some(
      ({ type, backgroundColor }) =>
        type === "rectangle" && backgroundColor === "#fff0bd",
    ),
  );
  const connector = inserted.find(
    ({ type, elbowed, endArrowhead }) =>
      type === "arrow" && elbowed && endArrowhead,
  );
  assert.ok(connector?.startBinding && connector.endBinding);
  assert.ok(
    inserted.some(
      ({ type, endArrowhead }) => type === "arrow" && endArrowhead === null,
    ),
  );
  await page.reload({ waitUntil: "load" });
  await page.getByTestId("templates-actions-btn").waitFor();
  assert.deepEqual((await readCopy()).objects, withTemplate.objects);
  const source = inserted.find(
    ({ id }) => id === connector.startBinding.elementId,
  );
  const target = inserted.find(
    ({ id }) => id === connector.endBinding.elementId,
  );
  const dx = source.x - target.x - target.width - 80;
  const dy = source.y - target.y + 16;
  const edited = await tool("draw", {
    boardId: copy.id,
    expectedRevision: withTemplate.revision,
    commands: [{ kind: "move", ids: [target.id], dx, dy }],
  });
  assert.equal(edited.error, undefined, String(edited.value));
  const arrowAfter = (await readCopy()).objects.find(
    ({ id }) => id === connector.id,
  );
  assert.equal(arrowAfter.endBinding.elementId, connector.endBinding.elementId);
  assert.equal(arrowAfter.startBinding.fixedPoint[0], 0);
  assert.equal(arrowAfter.endBinding.fixedPoint[0], 1);
  const beforeNote = await readCopy();
  const templatesButton = page.getByTestId("templates-actions-btn");
  await templatesButton.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await until(async () => {
    const current = await readCopy();
    return current.objects.length > beforeNote.objects.length
      ? current
      : undefined;
  });
  await page.waitForFunction(
    () =>
      document.activeElement?.getAttribute("data-testid") ===
      "templates-actions-btn",
  );
  const editorBounds = await canvas.boundingBox();
  assert.ok(editorBounds);
  await page.mouse.click(
    editorBounds.x + 30,
    editorBounds.y + editorBounds.height - 80,
  );
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+z" : "Control+z",
  );
  await until(async () => {
    const current = await readCopy();
    return current.objects.length === beforeNote.objects.length
      ? current
      : undefined;
  });
  assert.deepEqual((await readCopy()).objects, beforeNote.objects);
  process.stdout.write(
    "Editable templates: styled shapes, native elbows, reload, MCP move, keyboard focus and undo verified\n",
  );
  const beforeMindMap = new Set((await readCopy()).objects.map(({ id }) => id));
  const mindTool = page
    .locator(".App-toolbar")
    .getByRole("button", { name: "Carte mentale", exact: true });
  await mindTool.press("Enter");
  assert.equal(await mindTool.getAttribute("aria-pressed"), "true");
  await page.keyboard.press("Escape");
  assert.equal(await mindTool.getAttribute("aria-pressed"), "false");
  await mindTool.click();
  const workArea = await canvas.boundingBox();
  assert.ok(workArea);
  const originPoint = {
    x: workArea.x + workArea.width * 0.6,
    y: workArea.y + workArea.height * 0.45,
  };
  await page.mouse.click(originPoint.x, originPoint.y);
  const subject = page.getByRole("textbox", { name: "Texte du sujet" });
  const typeSubject = async (text, key) => {
    await subject.waitFor({ timeout: 5000 });
    assert.ok(
      await subject.evaluate(
        (node) => node.ownerDocument.activeElement === node,
      ),
    );
    await subject.fill(text);
    await subject.press(key);
  };
  await subject.waitFor({ timeout: 5000 });
  assert.equal(await mindTool.getAttribute("aria-pressed"), "false");
  const rootInput = await subject.boundingBox();
  assert.ok(rootInput);
  assert.ok(Math.abs(rootInput.x + rootInput.width / 2 - originPoint.x) < 3);
  assert.ok(Math.abs(rootInput.y + rootInput.height / 2 - originPoint.y) < 3);
  await typeSubject("Projet carte", "Tab");
  await typeSubject("Interface", "Enter");
  await typeSubject("Architecture", "Tab");
  await typeSubject("Données", "Escape");
  const branchButton = page.getByRole("button", {
    name: "Ajouter une branche",
  });
  await branchButton.hover();
  await branchButton.click();
  await typeSubject("Notes", "Escape");

  const mind = await until(async () => {
    const current = await readCopy();
    return current.objects.some(({ text }) => text === "Notes")
      ? current
      : undefined;
  });
  const node = (text) => {
    const label = mind.objects.find(
      (item) => !beforeMindMap.has(item.id) && item.text === text,
    );
    assert.ok(label?.containerId, text);
    return mind.objects.find(({ id }) => id === label.containerId);
  };
  const root = node("Projet carte");
  const ui = node("Interface");
  const architecture = node("Architecture");
  const data = node("Données");
  const notes = node("Notes");
  assert.equal(ui.x, architecture.x);
  assert.ok(ui.x > root.x && ui.y + ui.height < architecture.y);
  assert.ok(notes.x > data.x && data.x > architecture.x);
  for (const [parent, child] of [
    [root, ui],
    [root, architecture],
    [architecture, data],
    [data, notes],
  ]) {
    assert.ok(
      mind.objects.some(
        ({ type, startBinding, endBinding, endArrowhead }) =>
          type === "arrow" &&
          endArrowhead === null &&
          startBinding?.elementId === parent.id &&
          endBinding?.elementId === child.id,
      ),
      `Missing branch from ${parent.id} to ${child.id}`,
    );
  }
  await page.locator(".editor .excalidraw").press("Shift+1");
  const projection = await page
    .locator(".diagram-controls")
    .evaluate((controls) => ({
      center: Number.parseFloat(
        controls.style.getPropertyValue("--diagram-center"),
      ),
      left: Number.parseFloat(
        controls.style.getPropertyValue("--diagram-left"),
      ),
      right: Number.parseFloat(
        controls.style.getPropertyValue("--diagram-right"),
      ),
      middle: Number.parseFloat(
        controls.style.getPropertyValue("--diagram-middle"),
      ),
    }));
  const canvasView = await page.locator(".editor").boundingBox();
  assert.ok(canvasView);
  const scale = (projection.right - projection.left) / notes.width;
  await page.mouse.click(
    canvasView.x + projection.center + (data.x - notes.x) * scale,
    canvasView.y + projection.middle + (data.y - notes.y) * scale,
  );
  await page.keyboard.press("Backspace");
  await until(async () => {
    const current = await readCopy();
    return !current.objects.some(({ id }) => id === data.id)
      ? current
      : undefined;
  });
  await page.mouse.click(
    canvasView.x + projection.center,
    canvasView.y + projection.middle,
  );
  await page.keyboard.press("Tab");
  await typeSubject("Notes de suivi", "Escape");
  const detached = await until(async () => {
    const current = await readCopy();
    return current.objects.some(({ text }) => text === "Notes de suivi")
      ? current
      : undefined;
  });
  const followUp = detached.objects.find(
    ({ text }) => text === "Notes de suivi",
  );
  assert.ok(
    detached.objects.some(
      ({ startBinding, endBinding }) =>
        startBinding?.elementId === notes.id &&
        endBinding?.elementId === followUp.containerId,
    ),
  );
  const followUpView = await page
    .locator(".diagram-controls")
    .evaluate((controls) => ({
      x: Number.parseFloat(controls.style.getPropertyValue("--diagram-center")),
      y: Number.parseFloat(controls.style.getPropertyValue("--diagram-middle")),
    }));
  const external = await tool("draw", {
    boardId: copy.id,
    expectedRevision: detached.revision,
    commands: [
      {
        kind: "connect",
        from: ui.id,
        to: followUp.containerId,
        routing: "straight",
      },
    ],
  });
  assert.equal(external.error, undefined, String(external.value));
  const externalEdge = (await readCopy()).objects.find(
    ({ startBinding, endBinding }) =>
      startBinding?.elementId === ui.id &&
      endBinding?.elementId === followUp.containerId,
  );
  assert.ok(externalEdge);
  await page
    .locator(".editor .excalidraw:not(.excalidraw--view-mode)")
    .waitFor({ timeout: 5000 });
  await page.mouse.click(
    canvasView.x + followUpView.x,
    canvasView.y + followUpView.y,
  );
  await branchButton.waitFor({ timeout: 5000 });
  await page.keyboard.press("Enter");
  await typeSubject("Questions", "Escape");
  const expanded = await until(async () => {
    const current = await readCopy();
    return current.objects.some(({ text }) => text === "Questions")
      ? current
      : undefined;
  });
  const movedFollowUp = expanded.objects.find(
    ({ id }) => id === followUp.containerId,
  );
  const movedExternalEdge = expanded.objects.find(
    ({ id }) => id === externalEdge.id,
  );
  assert.notEqual(
    movedFollowUp.y,
    detached.objects.find(({ id }) => id === followUp.containerId).y,
  );
  assert.notEqual(movedExternalEdge.height, externalEdge.height);
  await page.reload({ waitUntil: "load" });
  await templatesButton.waitFor();
  assert.deepEqual((await readCopy()).objects, expanded.objects);
  process.stdout.write(
    "Mind map: Tab, Enter, mouse branch, automatic layout, detached subtree and reload verified\n",
  );
  const readScene = (id) =>
    page.evaluate(async (boardId) => {
      const response = await fetch(`/api/boards/${boardId}`, {
        headers: { "X-Excalidraw-Local": "1" },
      });
      if (!response.ok)
        throw new Error(`Board read failed (${response.status})`);
      return (await response.json()).scene.elements;
    }, id);
  const savedMindMap = await readScene(copy.id);
  assert.ok(savedMindMap.find(({ id }) => id === root.id).roundness);

  await page.getByRole("button", { name: "Tableaux", exact: true }).click();
  const quickName = `Diagramme rapide ${Date.now()}`;
  await page
    .getByRole("textbox", { name: "Nom du nouveau tableau" })
    .fill(quickName);
  await page.getByRole("button", { name: "Créer un tableau" }).click();
  await page.getByRole("heading", { name: quickName, exact: true }).waitFor();
  const quickBoard = (await tool("list_boards")).value.find(
    ({ name }) => name === quickName,
  );
  await page.evaluate(() => {
    const probe = { frames: 0, flashes: 0, stopped: false };
    window.__selectionInspectorProbe = probe;
    const sample = () => {
      const panel = document.querySelector(
        ".selected-shape-actions .App-menu__left",
      );
      probe.frames += 1;
      if (panel?.getClientRects().length) probe.flashes += 1;
    };
    const mutation = new MutationObserver(sample);
    mutation.observe(document.querySelector(".editor"), {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        "data-context-advanced",
        "data-context-tools",
        "class",
        "style",
      ],
    });
    const onFrame = () => {
      if (probe.stopped) {
        mutation.disconnect();
        return;
      }
      sample();
      requestAnimationFrame(onFrame);
    };
    requestAnimationFrame(onFrame);
  });
  const quickTool = page.getByTestId("toolbar-quick-diagram");
  await page.getByTestId("toolbar-mind-map").click();
  await quickTool.click();
  assert.equal(
    await page.getByTestId("toolbar-mind-map").getAttribute("aria-pressed"),
    "false",
  );
  assert.equal(await quickTool.getAttribute("aria-pressed"), "true");
  const quickArea = await canvas.boundingBox();
  assert.ok(quickArea);
  const quickCenter = {
    x: quickArea.x + quickArea.width / 2,
    y: quickArea.y + quickArea.height / 2,
  };
  await page.mouse.click(quickCenter.x, quickCenter.y);

  const diagramLabel = page.getByRole("textbox", {
    name: "Texte du nouveau bloc",
  });
  const nameBlock = async (text) => {
    await diagramLabel.waitFor({ timeout: 5000 });
    assert.ok(
      await diagramLabel.evaluate(
        (input) => input === input.ownerDocument.activeElement,
      ),
    );
    await diagramLabel.fill(text);
    await diagramLabel.press("Enter");
  };
  await nameBlock("Parcours");
  await page
    .getByRole("button", { name: "Ajouter un bloc en dessous" })
    .click();
  await nameBlock("Arrivée");
  await page.mouse.click(quickCenter.x, quickCenter.y);
  const up = page.getByRole("button", { name: "Ajouter un bloc au-dessus" });
  await up.waitFor();
  await page.mouse.move(quickCenter.x, quickCenter.y);
  assert.equal(await up.locator(".icon").isVisible(), false);
  await up.hover();
  assert.equal(await up.locator(".icon").isVisible(), true);
  assert.equal(
    await up.evaluate((button) => {
      const rect = button.getBoundingClientRect();
      return button.contains(
        button.ownerDocument.elementFromPoint(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2,
        ),
      );
    }),
    true,
    "the floating toolbar must leave the upper port clickable",
  );
  await up.click();
  await nameBlock("Départ");

  const diagram = await until(async () => {
    const elements = await readScene(quickBoard.id);
    return elements.some(({ text }) => text === "Départ")
      ? elements
      : undefined;
  });
  const shapeLabeled = (text) => {
    const label = diagram.find((item) => item.text === text);
    assert.ok(label?.containerId, text);
    return diagram.find(({ id }) => id === label.containerId);
  };
  const renderedFont = await page.evaluate(() =>
    window.__directTextRendererProbe.get("Parcours"),
  );
  assert.match(
    renderedFont ?? "",
    /Nunito/,
    "the label must be drawn directly in the visible canvas",
  );
  const quickRoot = shapeLabeled("Parcours");
  const above = shapeLabeled("Départ");
  const below = shapeLabeled("Arrivée");
  assert.ok(
    above.y + above.height < quickRoot.y &&
      below.y > quickRoot.y + quickRoot.height,
  );
  assert.notEqual(quickRoot.backgroundColor, "transparent");
  for (const block of [above, quickRoot, below]) {
    assert.equal(block.type, "rectangle");
    assert.equal(block.roundness.value, quickRoot.roundness.value);
    assert.equal(block.backgroundColor, quickRoot.backgroundColor);
  }
  for (const block of [above, below]) {
    assert.ok(
      diagram.some(
        ({ type, startBinding, endBinding, endArrowhead }) =>
          type === "arrow" &&
          startBinding?.elementId === quickRoot.id &&
          endBinding?.elementId === block.id &&
          endArrowhead,
      ),
    );
  }
  process.stdout.write(
    "Quick diagram: native toolbar, preset fill, immediate input, up and down arrow bindings verified\n",
  );
  const layoutProbe = await page.evaluate(() => {
    const probe = window.__selectionInspectorProbe;
    probe.stopped = true;
    return { frames: probe.frames, flashes: probe.flashes };
  });
  assert.ok(layoutProbe.frames > 0);
  assert.equal(
    layoutProbe.flashes,
    0,
    "the native left inspector must never flash during selection",
  );
  const format = page.locator(".editor .selection-toolbar > [role=toolbar]");
  const nativeSettings = page.locator(
    ".selected-shape-actions .App-menu__left",
  );
  assert.equal(await nativeSettings.isVisible(), false);
  assert.equal(await format.count(), 1);
  await format.getByRole("button", { name: "Forme", exact: true }).click();
  const shapePicker = page.getByRole("region", { name: "Forme", exact: true });
  assert.equal(
    await shapePicker
      .getByRole("button", { name: "Rectangle aux coins doux", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await shapePicker
    .getByRole("button", { name: "Rectangle arrondi", exact: true })
    .click();
  assert.equal(await shapePicker.isVisible(), false);
  await format.getByRole("button", { name: "Couleurs", exact: true }).click();
  const colorPanel = page.getByRole("region", {
    name: "Couleurs",
    exact: true,
  });
  await colorPanel.getByRole("button", { name: "Remplissage #ffc9c9" }).click();
  await colorPanel.getByRole("button", { name: "Fermer les réglages" }).click();
  await format.getByRole("button", { name: "Texte", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Texte", exact: true })
    .fill("Étape initiale");
  await page.getByRole("button", { name: "Appliquer", exact: true }).click();
  await format
    .getByRole("button", { name: "Note locale", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Note locale", exact: true })
    .fill("Contrôle de format");
  await page.getByRole("button", { name: "Appliquer", exact: true }).click();
  const more = format.getByTestId("selection-object-menu");
  const nativeMenu = page.locator(".editor .context-menu");
  await more.click();
  await nativeMenu.waitFor();
  assert.equal(await more.getAttribute("aria-expanded"), "true");
  for (const command of [
    "cut",
    "copy",
    "copyStyles",
    "pasteStyles",
    "deleteSelectedElements",
  ]) {
    assert.equal(await nativeMenu.getByTestId(command).count(), 1, command);
  }
  const menuGeometry = await nativeMenu.boundingBox();
  const triggerGeometry = await more.boundingBox();
  assert.ok(menuGeometry && triggerGeometry);
  assert.ok(menuGeometry.width <= 16 * 16 + 1);
  assert.ok(
    menuGeometry.y >= triggerGeometry.y + triggerGeometry.height ||
      menuGeometry.y + menuGeometry.height <= triggerGeometry.y,
  );
  assert.equal(
    await format.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    ),
    "rgb(255, 255, 255)",
  );
  await more.click();
  assert.equal(await nativeMenu.isVisible(), false);
  await more.click();
  await nativeMenu.waitFor();
  await page.keyboard.press("ArrowDown");
  assert.ok(
    await nativeMenu.evaluate((menu) =>
      menu.contains(menu.ownerDocument.activeElement),
    ),
  );
  await page.keyboard.press("Escape");
  assert.equal(await nativeMenu.isVisible(), false);
  await page.waitForFunction(
    () =>
      document.activeElement?.getAttribute("data-testid") ===
      "selection-object-menu",
  );

  const properties = format.getByRole("button", {
    name: "Propriétés de l’objet",
    exact: true,
  });
  await properties.click();
  await nativeSettings.waitFor({ timeout: 5000 });
  await properties.click();
  assert.equal(await nativeSettings.isVisible(), false);
  const iconPicker = format.getByRole("button", {
    name: "Icônes",
    exact: true,
  });
  await iconPicker.click();
  await page
    .getByRole("searchbox", { name: "Rechercher une icône" })
    .fill("plantule");
  await page.getByRole("button", { name: "Plantule", exact: true }).click();
  await until(async () => {
    const elements = await readScene(quickBoard.id);
    return elements.some(
      ({ originalText }) => originalText === "🌱 Étape initiale",
    )
      ? elements
      : undefined;
  });
  await page.getByRole("button", { name: "Retirer l’icône" }).click();
  await page.getByRole("button", { name: "Fermer les réglages" }).click();
  const styled = await until(async () => {
    const elements = await readScene(quickBoard.id);
    return elements.some(({ text }) => text === "Étape initiale")
      ? elements
      : undefined;
  });
  const styledBlock = styled.find(({ id }) => id === above.id);
  assert.equal(styledBlock.backgroundColor, "#ffc9c9");
  assert.ok(styledBlock.roundness);
  assert.equal(
    styledBlock.customData.excalidrawLocalNote,
    "Contrôle de format",
  );
  await format.getByRole("button", { name: "Dupliquer", exact: true }).click();
  await until(async () => {
    const elements = await readScene(quickBoard.id);
    return elements.filter(
      ({ text, isDeleted }) => !isDeleted && text === "Étape initiale",
    ).length === 2
      ? elements
      : undefined;
  });
  await page.mouse.click(
    quickCenter.x,
    quickCenter.y + (below.y - quickRoot.y) / 2,
  );
  await format
    .getByRole("button", { name: "Trait et angles", exact: true })
    .click();
  const tip = page.getByRole("combobox", { name: "Embout d’arrivée" });
  assert.equal(await tip.inputValue(), "triangle");
  await tip.selectOption("dot");
  await until(async () => {
    const elements = await readScene(quickBoard.id);
    return elements.some(
      ({ endArrowhead, endBinding }) =>
        endArrowhead === "dot" && endBinding?.elementId === below.id,
    )
      ? elements
      : undefined;
  });
  await page.getByRole("button", { name: "Fermer les réglages" }).click();
  const lowerWire = diagram.find(
    ({ endBinding }) => endBinding?.elementId === below.id,
  );
  await page.mouse.click(quickCenter.x, quickCenter.y + below.y - quickRoot.y);
  await format.getByRole("button", { name: "Supprimer", exact: true }).click();
  await until(async () => {
    const current = await readScene(quickBoard.id);
    return current.find(({ id }) => id === below.id)?.isDeleted &&
      current.find(({ id }) => id === lowerWire.id)?.isDeleted
      ? current
      : undefined;
  });
  process.stdout.write(
    "Selection toolbar: fill, label, icon search and removal, native inspector, delete and bound arrowheads verified\n",
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(outbound, []);
  process.stdout.write(
    "Live proof: MCP draw → mouse move → stale rejection → MCP edit → undo → PNG clipboard → archive → editable copy after reload\n",
  );
} finally {
  await client.close();
  await browser.close();
}
