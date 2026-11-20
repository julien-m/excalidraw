import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import {
  boardId,
  boardSchema,
  emptyScene,
  trashedBoardSchema,
} from "../board/scene";

import type {
  Board,
  BoardSummary,
  Checkpoint,
  Scene,
  TrashedBoard,
  TrashedBoardSummary,
} from "../board/scene";

export class BoardError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const isMissing = (error: unknown): boolean =>
  (error as NodeJS.ErrnoException).code === "ENOENT" ||
  (error instanceof BoardError && error.status === 404);

/**
 * Stores the current editable scene and its immutable checkpoints in one atomic record per board.
 * Deleted boards move whole, history included, to a separate trash directory and can be restored.
 */
export class BoardStore {
  private readonly writers = new Map<string, Promise<unknown>>();

  constructor(
    private readonly directory: string,
    private readonly trashDirectory: string,
  ) {}

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
      try {
        const { name, revision, updatedAt, tracepinId, history } =
          await this.read(id);
        boards.push({
          id,
          name,
          revision,
          updatedAt,
          tracepinId,
          versions: history.length,
        });
      } catch (error) {
        // A board deleted between readdir and read is no longer part of the library.
        if (!isMissing(error)) {
          throw error;
        }
      }
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

  /**
   * Tracepin page identities make repeated imports safe while preserving edits to the first import.
   * Returns null when the user moved that page to the trash: a reimport must not resurrect it.
   */
  async importBoard(
    tracepinId: string,
    name: string,
    scene: Scene,
    archivedAt?: string,
  ): Promise<Board | null> {
    return this.serial(tracepinId, async () => {
      // The live board wins over any trash copy left by an older version of this store.
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
      if (await this.exists(this.trashPath(tracepinId))) {
        return null;
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

  /**
   * Moves a board and its whole history to the trash.
   * @throws BoardError 404 when the board is absent, 409 when it changed since `expectedRevision`.
   */
  async remove(
    id: string,
    expectedRevision: number,
  ): Promise<TrashedBoardSummary> {
    return this.serial(id, async () => {
      const board = await this.readAtRevision(id, expectedRevision);
      await mkdir(this.trashDirectory, { recursive: true, mode: 0o700 });
      // Both directories sit in the same data profile, so rename is one atomic move:
      // the record is live or trashed, never both or neither.
      await rename(this.path(id), this.trashPath(id));
      const trashed: TrashedBoard = {
        ...board,
        deletedAt: new Date().toISOString(),
      };
      // Recording the date is a second atomic replace. If it is interrupted, the
      // trash entry falls back to the board's last update time.
      await this.writeRecord(
        this.trashPath(id),
        trashedBoardSchema.parse(trashed),
        this.trashDirectory,
      );
      return this.trashSummary(trashed);
    });
  }

  /**
   * Moves a trashed board back to the library with its revision and history.
   * @throws BoardError 404 when it is not in the trash, 409 when a board with that id exists.
   */
  async restore(id: string): Promise<Board> {
    return this.serial(id, async () => {
      if (await this.exists(this.path(id))) {
        throw new BoardError(
          409,
          "Un tableau avec cet identifiant existe déjà.",
        );
      }
      // boardSchema strips the trash-only deletedAt field.
      const board = boardSchema.parse(await this.readTrashed(id));
      // Atomic move back first; rewriting without deletedAt only tidies the record
      // (read() ignores that field if the rewrite is interrupted).
      await rename(this.trashPath(id), this.path(id));
      await this.write(board);
      return board;
    });
  }

  async listTrash(): Promise<TrashedBoardSummary[]> {
    await mkdir(this.trashDirectory, { recursive: true, mode: 0o700 });
    const entries = await readdir(this.trashDirectory, { withFileTypes: true });
    const trashed: TrashedBoardSummary[] = [];
    for (const entry of entries) {
      const id = entry.name.slice(0, -5);
      if (
        !entry.isFile() ||
        !entry.name.endsWith(".json") ||
        !boardId.safeParse(id).success ||
        // A live board with the same id wins: a stale copy is not offered for restore.
        (await this.exists(this.path(id)))
      ) {
        continue;
      }
      try {
        trashed.push(this.trashSummary(await this.readTrashed(id)));
      } catch (error) {
        // A board restored between readdir and read is no longer in the trash.
        if (!isMissing(error)) {
          throw error;
        }
      }
    }
    return trashed.sort((left, right) =>
      right.deletedAt.localeCompare(left.deletedAt),
    );
  }

  private async readTrashed(id: string): Promise<TrashedBoard> {
    try {
      const board = trashedBoardSchema.parse(
        JSON.parse(await readFile(this.trashPath(id), "utf8")),
      );
      if (board.id !== id) {
        throw new BoardError(500, "Identité du tableau incohérente.");
      }
      return board;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new BoardError(404, "Tableau absent de la corbeille.");
      }
      throw error;
    }
  }

  private trashSummary(board: TrashedBoard): TrashedBoardSummary {
    const { id, name, deletedAt, updatedAt, tracepinId, history } = board;
    return {
      id,
      name,
      deletedAt: deletedAt ?? updatedAt,
      tracepinId,
      versions: history.length,
    };
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return false;
      }
      throw error;
    }
  }

  private trashPath(id: string): string {
    return join(this.trashDirectory, `${boardId.parse(id)}.json`);
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
    await this.writeRecord(
      this.path(board.id),
      boardSchema.parse(board),
      this.directory,
    );
  }

  /** Writes a validated record through a staging file and an atomic rename. */
  private async writeRecord(
    path: string,
    record: Board | TrashedBoard,
    directory: string,
  ): Promise<void> {
    const staging = `${path}.${randomUUID()}.tmp`;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      await writeFile(staging, JSON.stringify(record), {
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
