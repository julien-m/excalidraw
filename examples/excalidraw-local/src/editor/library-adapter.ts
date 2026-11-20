/** Connects the SDK shape library to the profile-wide `library.json` kept by the local service. */
import { restoreLibraryItems } from "@local/excalidraw-sdk";

import { request } from "./client";

import type { LibraryPersistenceAdapter } from "@local/excalidraw-sdk/data/library";
import type { LibraryItems } from "@local/excalidraw-sdk/types";

import type { Library, LibraryChanges } from "../board/scene";

const fingerprint = (items: LibraryItems): Map<string, string> =>
  new Map(items.map((item) => [item.id, JSON.stringify(item)]));

/**
 * Diff strategy: the SDK saves the full list it built from the result of its last
 * `load({ source: "save" })`. Comparing that list with the same load, restored the way the SDK
 * restores it, yields exactly this editor's additions, edits and removals. The server applies
 * them to its latest library, so another editor's concurrent installs or removals survive.
 */
const diffLibrary = (
  base: ReadonlyMap<string, string>,
  next: LibraryItems,
): LibraryChanges => {
  const nextIds = new Set(next.map((item) => item.id));
  return {
    // SDK library items satisfy the looser wire schema; the server validates them again.
    upsert: next.filter(
      (item) => base.get(item.id) !== JSON.stringify(item),
    ) as unknown as LibraryChanges["upsert"],
    remove: [...base.keys()].filter((id) => !nextIds.has(id)),
  };
};

/**
 * Builds the adapter given to `useHandleLibrary`. The SDK queues its adapter calls, so a
 * save always follows the load that serves as its diff base.
 * @param report Shows a failed save in the editor status; the error is rethrown for the SDK.
 */
export const createLibraryAdapter = (
  report: (error: unknown) => void,
): LibraryPersistenceAdapter => {
  let base = new Map<string, string>();
  return {
    load: async () => {
      const library = await request<Library | null>("library");
      // The SDK validates and normalizes items with this same function after load.
      base = fingerprint(
        restoreLibraryItems(
          // Stored items were written by this SDK; restore re-validates them as it does on load.
          (library?.libraryItems ?? []) as unknown as LibraryItems,
          "published",
        ),
      );
      return library as Awaited<ReturnType<LibraryPersistenceAdapter["load"]>>;
    },
    save: async ({ libraryItems }) => {
      const changes = diffLibrary(base, libraryItems);
      if (changes.upsert.length === 0 && changes.remove.length === 0) {
        return;
      }
      try {
        await request("library", "PATCH", changes);
        base = fingerprint(libraryItems);
      } catch (error) {
        report(error);
        throw error;
      }
    },
  };
};
