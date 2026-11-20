import { randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { emptyScene } from "../board/scene";

import { BoardError, BoardStore } from "./board-store";
import { LibraryStore } from "./library-store";

let profile: string;
const openStore = (): BoardStore =>
  new BoardStore(join(profile, "boards"), join(profile, "trash"));
const recolor = (viewBackgroundColor: string) => ({
  ...emptyScene,
  appState: { viewBackgroundColor },
});
const rejection = async (action: Promise<unknown>): Promise<number> => {
  const error = await action.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(BoardError);
  return (error as BoardError).status;
};

beforeEach(async () => {
  profile = await mkdtemp(join(tmpdir(), "excalidraw-store-"));
});
afterEach(async () => {
  await rm(profile, { recursive: true, force: true });
});

describe("BoardStore", () => {
  it("should serialize concurrent edits and preserve independent archived copies", async () => {
    const store = openStore();
    const board = await store.create("Flow");
    const [first, second] = await Promise.allSettled([
      store.save(board.id, board.revision, recolor("#ccddee")),
      store.save(board.id, board.revision, recolor("#ddccbb")),
    ]);
    expect(first.status).toBe("fulfilled");
    expect(second.status).toBe("rejected");
    const saved = await store.read(board.id);
    const checkpoint = await store.archive(
      board.id,
      saved.revision,
      "Version client",
    );
    const copy = await store.duplicate(
      board.id,
      "Version client (copie)",
      checkpoint.id,
    );
    await store.save(copy.id, copy.revision, recolor("#ffffff"));
    const reopened = await openStore().read(board.id);
    expect(reopened.history[0].scene).toEqual(saved.scene);
    expect(reopened.scene).toEqual(saved.scene);
  });

  it("should move a board with its history to the trash and restore it unchanged", async () => {
    const store = openStore();
    const board = await store.create("Roadmap");
    const saved = await store.save(board.id, 0, recolor("#eeeeee"));
    await store.archive(board.id, saved.revision, "Roadmap");
    const before = await store.read(board.id);

    const trashed = await store.remove(board.id, before.revision);

    expect(trashed).toMatchObject({ id: board.id, versions: 1 });
    expect(await store.list()).toEqual([]);
    expect(await store.listTrash()).toEqual([trashed]);
    expect(await store.restore(board.id)).toEqual(before);
    expect(await openStore().read(board.id)).toEqual(before);
    expect(await store.listTrash()).toEqual([]);
  });

  it("should reject a stale or repeated delete without touching the trash", async () => {
    const store = openStore();
    const board = await store.create("Plan");
    await store.save(board.id, 0, recolor("#eeeeee"));

    expect(await rejection(store.remove(board.id, 0))).toBe(409);
    expect(await store.listTrash()).toEqual([]);

    const results = await Promise.allSettled([
      store.remove(board.id, 1),
      store.remove(board.id, 1),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect(await store.listTrash()).toHaveLength(1);
  });

  it("should refuse edits, copies and archives on a trashed board", async () => {
    const store = openStore();
    const board = await store.create("Sketch");
    await store.remove(board.id, 0);

    expect(await rejection(store.save(board.id, 0, emptyScene))).toBe(404);
    expect(await rejection(store.archive(board.id, 0, "Sketch"))).toBe(404);
    expect(await rejection(store.duplicate(board.id, "Copie"))).toBe(404);
    expect(await rejection(store.read(board.id))).toBe(404);
  });

  it("should let the live board win over a stale trash copy from an interrupted delete", async () => {
    const store = openStore();
    const tracepinId = randomUUID();
    const live = await store.importBoard(tracepinId, "Live", emptyScene);
    // State left by the previous write-then-remove protocol: the record in both directories.
    await mkdir(join(profile, "trash"), { recursive: true });
    await copyFile(
      join(profile, "boards", `${tracepinId}.json`),
      join(profile, "trash", `${tracepinId}.json`),
    );
    const saved = await store.save(tracepinId, 0, recolor("#eeeeee"));

    expect((await store.list()).map(({ id }) => id)).toEqual([tracepinId]);
    expect(await store.listTrash()).toEqual([]);
    expect(await store.importBoard(tracepinId, "Live", emptyScene)).toEqual(
      saved,
    );
    expect(await rejection(store.restore(tracepinId))).toBe(409);
    expect(await store.remove(tracepinId, saved.revision)).toMatchObject({
      id: tracepinId,
    });
    expect(await store.list()).toEqual([]);
    expect((await store.restore(tracepinId)).scene).toEqual(saved.scene);
    expect(live?.id).toBe(tracepinId);
  });

  it("should recover a delete interrupted before its date was recorded", async () => {
    const store = openStore();
    const board = await store.create("Interrupted");
    const saved = await store.save(board.id, 0, recolor("#eeeeee"));
    await store.archive(board.id, saved.revision, "Interrupted");
    const before = await store.read(board.id);
    // The atomic move happened; the follow-up write of deletedAt did not.
    await mkdir(join(profile, "trash"), { recursive: true });
    await rename(
      join(profile, "boards", `${board.id}.json`),
      join(profile, "trash", `${board.id}.json`),
    );

    expect(await store.list()).toEqual([]);
    expect(await store.listTrash()).toEqual([
      expect.objectContaining({
        id: board.id,
        deletedAt: before.updatedAt,
        versions: 1,
      }),
    ]);
    expect(await store.restore(board.id)).toEqual(before);
    expect(await store.listTrash()).toEqual([]);
    expect(await readdir(join(profile, "trash"))).toEqual([]);
  });

  it("should list the remaining boards while one is being deleted", async () => {
    const store = openStore();
    const boards = await Promise.all(
      ["A", "B", "C"].map((name) => store.create(name)),
    );
    const [listed] = await Promise.all([
      store.list(),
      store.remove(boards[1].id, 0),
    ]);
    expect(listed.map(({ id }) => id)).not.toContain(undefined);
    expect((await store.list()).map(({ name }) => name).sort()).toEqual([
      "A",
      "C",
    ]);
  });

  it("should not resurrect a trashed Tracepin page on reimport", async () => {
    const store = openStore();
    const tracepinId = randomUUID();
    await store.importBoard(tracepinId, "Tracepin", emptyScene);
    await store.remove(tracepinId, 0);

    expect(await store.importBoard(tracepinId, "Tracepin", emptyScene)).toBe(
      null,
    );
    expect(await store.list()).toEqual([]);
    const restored = await store.restore(tracepinId);
    expect(restored.tracepinId).toBe(tracepinId);
  });
});

const libraryItem = (id: string, color = "#1e1e1e") => ({
  id,
  status: "published" as const,
  created: 1,
  elements: [{ id: `${id}-shape`, type: "rectangle", strokeColor: color }],
});

describe("LibraryStore", () => {
  it("should return null before the first change and keep unknown item fields", async () => {
    const library = new LibraryStore(join(profile, "library.json"));
    expect(await library.read()).toBe(null);
    const item = { ...libraryItem("android"), name: "Android" };
    await library.apply({ upsert: [item], remove: [] });
    expect(await library.read()).toEqual({ libraryItems: [item] });
  });

  it("should keep independent installs and removals made from the same base", async () => {
    const library = new LibraryStore(join(profile, "library.json"));
    await library.apply({
      upsert: [libraryItem("shared"), libraryItem("old")],
      remove: [],
    });
    // Two editors loaded [shared, old]; one installs "a" and drops "old", the other installs "b".
    await Promise.all([
      library.apply({ upsert: [libraryItem("a")], remove: ["old"] }),
      library.apply({ upsert: [libraryItem("b")], remove: [] }),
    ]);
    expect(
      (
        await new LibraryStore(join(profile, "library.json")).read()
      )?.libraryItems.map(({ id }) => id),
    ).toEqual(["b", "a", "shared"]);
  });

  it("should keep the last change when two editors update the same item", async () => {
    const library = new LibraryStore(join(profile, "library.json"));
    await library.apply({ upsert: [libraryItem("shared")], remove: [] });
    await Promise.all([
      library.apply({ upsert: [libraryItem("shared", "#e03131")], remove: [] }),
      library.apply({ upsert: [libraryItem("shared", "#2f9e44")], remove: [] }),
    ]);
    expect(await library.read()).toEqual({
      libraryItems: [libraryItem("shared", "#2f9e44")],
    });
  });
});
