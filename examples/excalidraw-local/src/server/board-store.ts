import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { boardId, boardSchema, emptyScene } from "../board/scene";

import type { Board, BoardSummary, Checkpoint, Scene } from "../board/scene";

export class BoardError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** Stores the current editable scene and its immutable checkpoints in one atomic record per board. */
export class BoardStore {
  private readonly writers = new Map<string, Promise<unknown>>();

  constructor(private readonly directory: string) {}

  async read(id: string): Promise<Board> {
    const path = this.path(id);
    try {
      const board = boardSchema.parse(JSON.parse(await readFile(path, "utf8")));
      if (board.id !== id) {
        throw new BoardError(500, "Identité du tableau incohérente.");
      }
      return board;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new BoardError(404, "Tableau introuvable.");
      }
      throw error;
    }
  }

  async list(): Promise<BoardSummary[]> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const entries = await readdir(this.directory, { withFileTypes: true });
    const ids = entries.flatMap((entry) => {
      const id = entry.name.slice(0, -5);
      return entry.isFile() &&
        entry.name.endsWith(".json") &&
        boardId.safeParse(id).success
        ? [id]
        : [];
    });
    const boards: BoardSummary[] = [];
    // Each board can include full-resolution images. Read one record at a time.
    for (const id of ids) {
      const { name, revision, updatedAt, tracepinId } = await this.read(id);
      boards.push({ id, name, revision, updatedAt, tracepinId });
    }
    return boards.sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
  }

  async create(name: string, scene: Scene = emptyScene): Promise<Board> {
    const board: Board = {
      formatVersion: 1,
      id: randomUUID(),
      name,
      revision: 0,
      updatedAt: new Date().toISOString(),
      scene,
      history: [],
    };
    await this.write(board);
    return board;
  }

  /** Tracepin page identities make repeated imports safe while preserving edits to the first import. */
  async importBoard(
    tracepinId: string,
    name: string,
    scene: Scene,
    archivedAt?: string,
  ): Promise<Board> {
    return this.serial(tracepinId, async () => {
      try {
        const existing = await this.read(tracepinId);
        if (existing.tracepinId !== tracepinId) {
          throw new BoardError(409, "Identité Tracepin déjà utilisée.");
        }
        return existing;
      } catch (error) {
        if (!(error instanceof BoardError) || error.status !== 404) {
          throw error;
        }
      }
      const board: Board = {
        formatVersion: 1,
        id: tracepinId,
        tracepinId,
        name,
        revision: 0,
        updatedAt: archivedAt ?? new Date().toISOString(),
        scene,
        history: [],
      };
      if (archivedAt) {
        board.history = [
          this.checkpoint(board, "Archive Tracepin", archivedAt),
        ];
      }
      await this.write(board);
      return board;
    });
  }

  async save(
    id: string,
    expectedRevision: number,
    scene: Scene,
  ): Promise<Board> {
    return this.serial(id, async () => {
      const board = await this.readAtRevision(id, expectedRevision);
      const saved = {
        ...board,
        scene,
        revision: board.revision + 1,
        updatedAt: new Date().toISOString(),
      };
      await this.write(saved);
      return saved;
    });
  }

  async archive(
    id: string,
    expectedRevision: number,
    name: string,
  ): Promise<Checkpoint> {
    return this.serial(id, async () => {
      const board = await this.readAtRevision(id, expectedRevision);
      const checkpoint = this.checkpoint(board, name, new Date().toISOString());
      await this.write({ ...board, history: [checkpoint, ...board.history] });
      return checkpoint;
    });
  }

  async duplicate(
    id: string,
    name: string,
    checkpointId?: string,
  ): Promise<Board> {
    const board = await this.read(id);
    const source = checkpointId
      ? board.history.find((item) => item.id === checkpointId)
      : board;
    if (!source) {
      throw new BoardError(404, "Version introuvable.");
    }
    return this.create(name, source.scene);
  }

  private async readAtRevision(
    id: string,
    expectedRevision: number,
  ): Promise<Board> {
    const board = await this.read(id);
    if (board.revision !== expectedRevision) {
      throw new BoardError(
        409,
        "Le tableau a changé. Relisez sa révision avant de modifier.",
      );
    }
    return board;
  }

  private checkpoint(board: Board, name: string, savedAt: string): Checkpoint {
    return {
      id: randomUUID(),
      name,
      savedAt,
      revision: board.revision,
      scene: board.scene,
    };
  }

  private path(id: string): string {
    return join(this.directory, `${boardId.parse(id)}.json`);
  }

  private async write(board: Board): Promise<void> {
    const path = this.path(board.id);
    const staging = `${path}.${randomUUID()}.tmp`;
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      await writeFile(staging, JSON.stringify(boardSchema.parse(board)), {
        flag: "wx",
        mode: 0o600,
        flush: true,
      });
      await rename(staging, path);
    } finally {
      await rm(staging, { force: true });
    }
  }

  private async serial<T>(id: string, action: () => Promise<T>): Promise<T> {
    const before = this.writers.get(id);
    const task = (async () => {
      if (before) {
        try {
          await before;
        } catch {
          /* The next operation reads the last committed record. */
        }
      }
      return action();
    })();
    this.writers.set(id, task);
    try {
      return await task;
    } finally {
      if (this.writers.get(id) === task) {
        this.writers.delete(id);
      }
    }
  }
}
