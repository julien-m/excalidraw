/** Persists the shape library shared by every board of one data profile. */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { librarySchema } from "../board/scene";

import type { Library, LibraryChanges } from "../board/scene";

/** Reads `library.json` and applies item changes through one serialized read-merge-write queue. */
export class LibraryStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly path: string) {}

  /** Returns null before the first save, which the SDK treats as an empty library. */
  async read(): Promise<Library | null> {
    try {
      return librarySchema.parse(JSON.parse(await readFile(this.path, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  /**
   * Applies one editor's changes to the latest stored library.
   * Merge: drop the removed IDs, replace changed items in place (last writer wins for one ID),
   * and put new items first in the order sent, as the SDK lists newest items first.
   * Items another editor added or removed meanwhile are preserved.
   * @returns The merged library as written.
   */
  async apply(changes: LibraryChanges): Promise<Library> {
    const task = this.queue.then(
      () => this.merge(changes),
      () => this.merge(changes),
    );
    this.queue = task;
    return task;
  }

  private async merge({ upsert, remove }: LibraryChanges): Promise<Library> {
    const current = (await this.read())?.libraryItems ?? [];
    const removed = new Set(remove);
    const updates = new Map(upsert.map((item) => [item.id, item]));
    const kept = current
      .filter((item) => !removed.has(item.id))
      .map((item) => {
        const next = updates.get(item.id);
        updates.delete(item.id);
        return next ?? item;
      });
    const library = { libraryItems: [...updates.values(), ...kept] };
    await this.write(library);
    return library;
  }

  private async write(library: Library): Promise<void> {
    const staging = `${this.path}.${randomUUID()}.tmp`;
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    try {
      await writeFile(staging, JSON.stringify(librarySchema.parse(library)), {
        flag: "wx",
        mode: 0o600,
        flush: true,
      });
      // Rename after the flushed write so readers see the old or the new library, never a partial one.
      await rename(staging, this.path);
    } finally {
      await rm(staging, { force: true });
    }
  }
}
