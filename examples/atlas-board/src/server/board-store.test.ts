import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "vitest";

import { emptyScene } from "../board/scene";

import { BoardError, BoardStore } from "./board-store";

test("serializes concurrent edits and preserves independent archived copies", async () => {
  const profile = await mkdtemp(join(tmpdir(), "atlas-store-"));
  try {
    const store = new BoardStore(profile);
    const board = await store.create("Flow");
    const recolor = (viewBackgroundColor: string) => ({
      ...emptyScene,
      appState: { viewBackgroundColor },
    });
    const [first, second] = await Promise.allSettled([
      store.save(board.id, board.revision, recolor("#ccddee")),
      store.save(board.id, board.revision, recolor("#ddccbb")),
    ]);
    expect(first.status).toBe("fulfilled");
    expect(second.status).toBe("rejected");
    if (second.status === "rejected") {
      expect(second.reason).toBeInstanceOf(BoardError);
    }
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
    const reopened = await new BoardStore(profile).read(board.id);
    expect(reopened.history[0].scene).toEqual(saved.scene);
    expect(reopened.scene).toEqual(saved.scene);
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});
