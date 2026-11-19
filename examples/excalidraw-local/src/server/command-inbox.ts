import { randomUUID } from "node:crypto";

import { BoardError } from "./board-store";

import type { BoardStore } from "./board-store";

import type { CommandBatch, PendingCommand } from "../board/commands";
import type { Scene } from "../board/scene";

interface Job {
  command: PendingCommand;
  timer: ReturnType<typeof setTimeout>;
  resolve: (result: CommandResult) => void;
  reject: (error: BoardError) => void;
  committing: boolean;
}

interface CommandResult {
  revision: number;
  objectIds: string[];
}

/** Keeps one pending operation per board until an open editor saves its revision. */
export class CommandInbox {
  private readonly jobs = new Map<string, Job>();

  constructor(
    private readonly store: BoardStore,
    private readonly timeout = 12_000,
  ) {}

  async submit(batch: CommandBatch): Promise<CommandResult> {
    const board = await this.store.read(batch.boardId);
    if (board.revision !== batch.expectedRevision) {
      throw new BoardError(409, "Relisez le tableau avant de réessayer.");
    }
    if (this.jobs.has(batch.boardId)) {
      throw new BoardError(
        409,
        "Une commande est déjà en cours sur ce tableau.",
      );
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.jobs.delete(batch.boardId);
        reject(
          new BoardError(
            408,
            "Ouvrez le tableau dans Excalidraw pour appliquer la commande.",
          ),
        );
      }, this.timeout);
      this.jobs.set(batch.boardId, {
        command: { ...batch, id: randomUUID() },
        timer,
        resolve,
        reject,
        committing: false,
      });
    });
  }

  peek(boardId: string): PendingCommand | null {
    const job = this.jobs.get(boardId);
    return job && !job.committing ? job.command : null;
  }

  async commit(
    boardId: string,
    jobId: string,
    scene: Scene,
    objectIds: string[],
  ): Promise<CommandResult> {
    const job = this.jobs.get(boardId);
    if (!job || job.command.id !== jobId || job.committing) {
      throw new BoardError(409, "Commande expirée ou déjà traitée.");
    }
    job.committing = true;
    clearTimeout(job.timer);
    try {
      const board = await this.store.save(
        boardId,
        job.command.expectedRevision,
        scene,
      );
      const result = { revision: board.revision, objectIds };
      job.resolve(result);
      return result;
    } catch (error) {
      job.reject(
        error instanceof BoardError
          ? error
          : new BoardError(500, "Échec de sauvegarde."),
      );
      throw error;
    } finally {
      this.jobs.delete(boardId);
    }
  }

  reject(boardId: string, jobId: string, message: string): void {
    const job = this.jobs.get(boardId);
    if (!job || job.command.id !== jobId || job.committing) {
      return;
    }
    clearTimeout(job.timer);
    this.jobs.delete(boardId);
    job.reject(new BoardError(409, message));
  }
}
