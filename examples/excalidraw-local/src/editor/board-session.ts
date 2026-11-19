import {
  CaptureUpdateAction,
  exportToBlob,
  hashElementsVersion,
} from "@local/excalidraw-sdk";

import { applyCommands } from "./apply-commands";

import { request } from "./client";

import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from "@local/excalidraw-sdk/types";
import type { OrderedExcalidrawElement } from "@local/excalidraw-sdk/element/types";

import type { PendingCommand } from "../board/commands";
import type { Board, Checkpoint, Scene } from "../board/scene";

const debounceMs = 350;
const pollMs = 450;

type Report = (text: string) => void;

const asScene = (
  elements: readonly OrderedExcalidrawElement[],
  state: AppState,
  files: BinaryFiles,
): Scene => {
  const referenced = new Set(
    elements.flatMap((item) =>
      item.type === "image" && !item.isDeleted && item.fileId
        ? [item.fileId]
        : [],
    ),
  );
  return {
    elements: elements.flatMap((item) =>
      item.type === "selection" ? [] : [{ ...item }],
    ),
    appState: {
      viewBackgroundColor: state.viewBackgroundColor,
      scrollX: state.scrollX,
      scrollY: state.scrollY,
      zoom: { value: state.zoom.value },
    },
    files: Object.fromEntries(
      Object.entries(files).filter(([, value]) => referenced.has(value.id)),
    ),
  };
};

const fingerprint = (
  elements: readonly OrderedExcalidrawElement[],
  state: AppState,
  files: BinaryFiles,
): string =>
  `${hashElementsVersion(elements)}:${state.viewBackgroundColor}:${Object.keys(
    files,
  ).join(",")}`;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "La commande a échoué.";

/** Coordinates one mounted editor with the durable revision and the command transport. */
export class BoardSession {
  private api?: ExcalidrawImperativeAPI;
  private revision: number;
  private next?: Scene;
  private saving?: Promise<void>;
  private lastKey?: string;
  private saveTimer?: number;
  private pollTimer?: number;
  private importing = false;
  private polling = false;
  private gesture = false;
  private stopped = false;

  constructor(private readonly board: Board, private readonly report: Report) {
    this.revision = board.revision;
  }

  attach = (api: ExcalidrawImperativeAPI): void => {
    this.api = api;
  };

  private get path(): string {
    return `boards/${this.board.id}`;
  }

  changed = (
    elements: readonly OrderedExcalidrawElement[],
    state: AppState,
    files: BinaryFiles,
  ): void => {
    const key = fingerprint(elements, state, files);
    if (this.lastKey === undefined || this.importing) {
      this.lastKey = key;
      return;
    }
    if (this.lastKey === key) {
      return;
    }
    this.lastKey = key;
    this.next = asScene(elements, state, files);
    this.report("Modifications en attente");
    this.scheduleSave();
  };

  setGesture = (active: boolean): void => {
    this.gesture = active;
    if (!active && this.next) {
      this.scheduleSave();
    }
  };

  start = (): (() => void) => {
    this.stopped = false;
    const release = (): void => this.setGesture(false);
    window.addEventListener("pointerup", release, true);
    window.addEventListener("pointercancel", release, true);
    window.addEventListener("blur", release);
    this.pollTimer = window.setInterval(() => {
      void this.poll();
    }, pollMs);
    return () => {
      this.stopped = true;
      window.removeEventListener("pointerup", release, true);
      window.removeEventListener("pointercancel", release, true);
      window.removeEventListener("blur", release);
      window.clearInterval(this.pollTimer);
      window.clearTimeout(this.saveTimer);
    };
  };

  private scheduleSave(): void {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      if (!this.gesture && !this.importing) {
        void this.flush().catch((error) => this.report(errorMessage(error)));
      }
    }, debounceMs);
  }

  /** Commits any browser edits before a board switch, archive or MCP change. */
  flush = async (): Promise<void> => {
    window.clearTimeout(this.saveTimer);
    if (this.saving) {
      await this.saving;
    }
    while (this.next) {
      if (this.saving) {
        await this.saving;
        continue;
      }
      const scene = this.next;
      this.next = undefined;
      this.saving = (async () => {
        try {
          const result = await request<{ revision: number }>(this.path, "PUT", {
            expectedRevision: this.revision,
            scene,
          });
          this.revision = result.revision;
          this.report("Enregistré");
        } catch (error) {
          this.next ??= scene;
          throw error;
        } finally {
          this.saving = undefined;
        }
      })();
      await this.saving;
    }
  };

  hasPending = (): boolean =>
    Boolean(this.next || this.saving || this.importing);

  archive = async (): Promise<Checkpoint> => {
    if (this.importing) {
      throw new Error("Une commande est en cours.");
    }
    await this.flush();
    return request(`${this.path}/archive`, "POST", {
      name: this.board.name,
      expectedRevision: this.revision,
    });
  };

  exportScene = (): Scene => {
    const api = this.requireEditor();
    return asScene(api.getSceneElements(), api.getAppState(), api.getFiles());
  };

  copy = async (): Promise<Checkpoint> => {
    const api = this.requireEditor();
    if (
      this.importing ||
      this.gesture ||
      api.getAppState().editingTextElement
    ) {
      throw new Error("Terminez l’édition avant de copier le tableau.");
    }
    const elements = api.getSceneElements();
    if (elements.length === 0) {
      throw new Error("Le tableau est vide.");
    }
    const files = api.getFiles();
    const scene = asScene(elements, api.getAppState(), files);
    this.importing = true;
    api.updateScene({
      appState: { viewModeEnabled: true },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    try {
      const blob = exportToBlob({
        elements,
        files,
        appState: {
          viewBackgroundColor: scene.appState.viewBackgroundColor,
          exportBackground: true,
        },
        maxWidthOrHeight: 8192,
      });
      // Start the clipboard write during the button gesture, then archive those same objects and files.
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ]);
      this.next = scene;
      await this.flush();
      return await request(`${this.path}/archive`, "POST", {
        name: this.board.name,
        expectedRevision: this.revision,
      });
    } finally {
      api.updateScene({
        appState: { viewModeEnabled: false },
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      this.importing = false;
      if (this.next) {
        this.scheduleSave();
      }
    }
  };

  private requireEditor(): ExcalidrawImperativeAPI {
    if (!this.api) {
      throw new Error("Le tableau est en cours d’ouverture.");
    }
    return this.api;
  }

  private async poll(): Promise<void> {
    if (
      !this.api ||
      this.stopped ||
      this.polling ||
      this.importing ||
      this.gesture
    ) {
      return;
    }
    if (this.api.getAppState().editingTextElement) {
      return;
    }
    this.polling = true;
    let locked = false;
    let job: PendingCommand | null = null;
    try {
      job = await request<PendingCommand | null>(`${this.path}/commands`);
      if (
        !job ||
        this.stopped ||
        this.importing ||
        this.gesture ||
        this.api.getAppState().editingTextElement
      ) {
        return;
      }
      await this.flush();
      const api = this.api;
      if (
        this.stopped ||
        this.importing ||
        this.gesture ||
        api.getAppState().editingTextElement
      ) {
        return;
      }
      if (job.expectedRevision !== this.revision) {
        throw new Error("Le tableau a changé. Relisez-le avant de réessayer.");
      }
      const version = fingerprint(
        api.getSceneElementsIncludingDeleted(),
        api.getAppState(),
        api.getFiles(),
      );
      const next = await applyCommands(
        api.getSceneElementsIncludingDeleted(),
        api.getFiles(),
        job.commands,
      );
      if (
        this.stopped ||
        this.importing ||
        this.gesture ||
        this.next ||
        version !==
          fingerprint(
            api.getSceneElementsIncludingDeleted(),
            api.getAppState(),
            api.getFiles(),
          )
      ) {
        throw new Error(
          "Une édition locale est en cours. Relisez le tableau avant de réessayer.",
        );
      }
      this.importing = true;
      locked = true;
      // Lock pointer input before awaiting the write. The onChange callback still captures changes after unlocking.
      api.updateScene({
        appState: { viewModeEnabled: true },
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      const result = await request<{ revision: number }>(
        `${this.path}/commands/${job.id}`,
        "POST",
        {
          ok: true,
          scene: asScene(next.elements, api.getAppState(), next.files),
          objectIds: next.objectIds,
        },
      );
      this.revision = result.revision;
      api.addFiles(Object.values(next.files));
      api.updateScene({
        elements: next.elements,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      this.report("Commande MCP enregistrée");
    } catch (error) {
      const message = errorMessage(error);
      if (job) {
        try {
          await request(`${this.path}/commands/${job.id}`, "POST", {
            ok: false,
            message: message.slice(0, 300),
          });
        } catch {
          /* The original error is shown in the editor. */
        }
      }
      this.report(message);
    } finally {
      if (locked) {
        this.api?.updateScene({
          appState: { viewModeEnabled: false },
          captureUpdate: CaptureUpdateAction.NEVER,
        });
      }
      if (locked) {
        this.importing = false;
      }
      this.polling = false;
      if (this.next) {
        this.scheduleSave();
      }
    }
  }
}
