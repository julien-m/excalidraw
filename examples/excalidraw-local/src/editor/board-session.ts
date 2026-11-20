import {
  CaptureUpdateAction,
  exportToBlob,
  getCommonBounds,
  hashElementsVersion,
  sceneCoordsToViewportCoords,
} from "@local/excalidraw-sdk";

import { maxSceneElements, sceneSchema } from "../board/scene";
import { t } from "../ui/messages";

import { applyCommands } from "./apply-commands";
import { templateCommands } from "./board-templates";
import { BoundArrowDeletion } from "./bound-arrow-deletion";

import { RequestError, request } from "./client";
import {
  addBlockLabel,
  buildDiagramRoot,
  buildLinkedBlock,
  isBlock,
} from "./linked-block";
import {
  addMindBranch,
  layoutMindMap,
  mindNode,
  startMindMap,
} from "./mind-map";

import { editSelection } from "./selection-edit";

import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from "@local/excalidraw-sdk/types";
import type {
  ExcalidrawElement,
  OrderedExcalidrawElement,
} from "@local/excalidraw-sdk/element/types";

import type { PendingCommand } from "../board/commands";
import type { Board, Checkpoint, Scene } from "../board/scene";
import type { BoardTemplate } from "./board-templates";
import type { Direction } from "./linked-block";
import type { SelectionEdit } from "./selection-edit";
import type { BlockIds, MindMapSubject } from "./mind-map";

const debounceMs = 350;
const pollMs = 450;

type Report = (text: string) => void;

const asScene = (
  elements: readonly ExcalidrawElement[],
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
  private leaving = false;
  private polling = false;
  private gesture = false;
  private stopped = false;
  private readonly arrowDeletion = new BoundArrowDeletion();
  private linkedDraft?: {
    blockId: string;
    labelId: string;
    arrowId: string;
    original: readonly OrderedExcalidrawElement[];
  };

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
    if (this.linkedDraft) {
      return;
    }
    const reconciled = this.arrowDeletion.reconcile(elements);
    if (reconciled !== elements) {
      this.api?.updateScene({
        elements: reconciled,
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      elements = reconciled;
    }
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

  /** Stages a native block and arrow until the inline label is confirmed. */
  beginLinkedBlock = (
    sourceId: string,
    direction: Direction,
    ids: BlockIds,
  ): void => {
    this.stageBlock(ids, (original) => {
      const source = original.find((item) => item.id === sourceId);
      if (!source || source.isDeleted || !isBlock(source) || source.locked) {
        throw new Error(t("diagram.busy"));
      }
      return buildLinkedBlock(
        original,
        source,
        direction,
        ids.blockId,
        ids.arrowId,
      );
    });
  };

  beginDiagram = (ids: BlockIds, position: { x: number; y: number }): void => {
    this.stageBlock(ids, (original) => [
      ...original,
      buildDiagramRoot(ids.blockId, position),
    ]);
  };

  beginMindMap = (ids: BlockIds, subject: MindMapSubject): void => {
    this.stageBlock(ids, (original) =>
      "position" in subject
        ? startMindMap(original, ids, subject.position)
        : addMindBranch(original, ids, subject.sourceId, subject.relation),
    );
  };

  updateSelection = (
    id: string,
    edit: SelectionEdit,
    makeId: () => string,
  ): void => {
    const api = this.requireEditor();
    const state = api.getAppState();
    const elements = api.getSceneElementsIncludingDeleted();
    const target = elements.find(
      (element) => element.id === id && !element.isDeleted && !element.locked,
    );
    if (
      this.stopped ||
      this.importing ||
      this.linkedDraft ||
      !target ||
      !state.selectedElementIds[id]
    ) {
      throw new Error(t("diagram.busy"));
    }
    const next = editSelection(elements, target, edit, makeId);
    if (next === elements) {
      return;
    }
    if (!sceneSchema.safeParse(asScene(next, state, api.getFiles())).success) {
      throw new Error(t("diagram.noSpace"));
    }
    api.updateScene({
      elements: next,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  };

  private stageBlock(
    ids: BlockIds,
    build: (
      original: readonly OrderedExcalidrawElement[],
    ) => readonly ExcalidrawElement[],
  ): void {
    const api = this.requireEditor();
    const state = api.getAppState();
    if (
      this.stopped ||
      this.importing ||
      this.linkedDraft ||
      state.editingTextElement ||
      state.viewModeEnabled
    ) {
      throw new Error(t("diagram.busy"));
    }
    const files = api.getFiles();
    const original = api.getSceneElementsIncludingDeleted();
    if (original.length + 3 > maxSceneElements) {
      throw new Error(t("diagram.capacity"));
    }
    const elements = build(original);
    if (!sceneSchema.safeParse(asScene(elements, state, files)).success) {
      throw new Error(t("diagram.noSpace"));
    }
    this.lastKey ??= fingerprint(original, state, files);
    this.linkedDraft = { ...ids, original };
    api.updateScene({
      elements,
      appState: {
        selectedElementIds: { [ids.blockId]: true },
        selectedGroupIds: {},
      },
      captureUpdate: CaptureUpdateAction.EVENTUALLY,
    });
    const target = elements.find((element) => element.id === ids.blockId);
    if (target) {
      const viewport = { ...state, offsetLeft: 0, offsetTop: 0 };
      const { x, y } = sceneCoordsToViewportCoords(
        {
          sceneX: target.x + target.width / 2,
          sceneY: target.y + target.height / 2,
        },
        viewport,
      );
      if (x < 80 || x > state.width - 80 || y < 64 || y > state.height - 64) {
        api.scrollToContent(target, { animate: false });
      }
    }
  }

  /** Commits the pair and its bound label as one canvas undo entry. */
  finishLinkedBlock = (text: string): void => {
    const draft = this.linkedDraft;
    if (!draft) {
      return;
    }
    const api = this.requireEditor();
    const original = api.getSceneElementsIncludingDeleted();
    const target = original.find((item) => item.id === draft.blockId);
    if (!target || target.isDeleted || !isBlock(target)) {
      this.linkedDraft = undefined;
      throw new Error(t("diagram.labelFailed"));
    }
    const labeled = text.trim()
      ? addBlockLabel(original, target, text, draft.labelId, draft.arrowId)
      : original;
    const node = mindNode(target);
    const elements = node ? layoutMindMap(labeled, node) : labeled;
    if (
      !sceneSchema.safeParse(
        asScene(elements, api.getAppState(), api.getFiles()),
      ).success
    ) {
      throw new Error(t("diagram.labelFailed"));
    }
    // The SDK filters uncommitted objects out of immediate history captures.
    // Restore the pre-draft scene, then submit the whole operation synchronously.
    api.updateScene({
      elements: draft.original,
      captureUpdate: CaptureUpdateAction.EVENTUALLY,
    });
    api.updateScene({
      elements,
      appState: { selectedElementIds: { [draft.blockId]: true } },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    this.linkedDraft = undefined;
    this.changed(
      api.getSceneElementsIncludingDeleted(),
      api.getAppState(),
      api.getFiles(),
    );
  };

  /** Appends a template as one editable, undoable canvas operation. */
  insertTemplate = async (template: BoardTemplate): Promise<void> => {
    const api = this.requireEditor();
    await this.flush();
    const elements = api.getSceneElementsIncludingDeleted();
    const files = api.getFiles();
    const state = api.getAppState();
    const before = fingerprint(elements, state, files);
    const active = elements.filter((element) => !element.isDeleted);
    const [, top, right] = getCommonBounds(active);
    const x = active.length ? right + 80 : 80;
    const y = active.length ? top : 80;
    const { elements: inserted } = await applyCommands(
      [],
      {},
      templateCommands(template, crypto.randomUUID(), { x, y }),
    );
    if (
      this.stopped ||
      this.gesture ||
      this.importing ||
      this.linkedDraft ||
      api.getAppState().editingTextElement ||
      before !==
        fingerprint(
          api.getSceneElementsIncludingDeleted(),
          api.getAppState(),
          api.getFiles(),
        )
    ) {
      throw new Error("Terminez l’édition en cours, puis réessayez.");
    }
    const nextElements = [...elements, ...inserted];
    if (!sceneSchema.safeParse(asScene(nextElements, state, files)).success) {
      throw new Error(t("template.outsideBoard"));
    }
    api.updateScene({
      elements: [
        ...elements,
        ...inserted.map((element) => ({ ...element, index: null })),
      ],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    this.lastKey ??= before;
    this.changed(
      api.getSceneElementsIncludingDeleted(),
      api.getAppState(),
      files,
    );
    api.scrollToContent(inserted, {
      fitToViewport: true,
      viewportZoomFactor: 0.75,
    });
    await this.flush();
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
      if (!this.gesture && !this.importing && !this.leaving) {
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

  /** Preserves edits in a separate board when the open revision can no longer be saved. */
  leave = async (): Promise<string | undefined> => {
    if (this.importing || this.leaving) {
      throw new Error(t("diagram.busy"));
    }
    this.leaving = true;
    try {
      try {
        await this.flush();
        return undefined;
      } catch (error) {
        const scene = this.next;
        if (
          !(error instanceof RequestError) ||
          error.status !== 409 ||
          !scene
        ) {
          throw error;
        }
        const suffix = t("editor.recoverySuffix");
        const recovered = await request<Board>("boards", "POST", {
          name: `${this.board.name.slice(0, 180 - suffix.length)}${suffix}`,
          scene,
        });
        if (this.next !== scene) {
          throw new Error(
            t("editor.recoveryPending", { name: recovered.name }),
          );
        }
        this.next = undefined;
        return recovered.name;
      }
    } finally {
      this.leaving = false;
    }
  };

  hasPending = (): boolean =>
    Boolean(
      this.next ||
        this.saving ||
        this.importing ||
        this.leaving ||
        this.linkedDraft,
    );

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
      this.linkedDraft ||
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
      this.leaving ||
      this.gesture ||
      this.linkedDraft
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
        this.leaving ||
        this.gesture ||
        this.linkedDraft ||
        this.api.getAppState().editingTextElement
      ) {
        return;
      }
      await this.flush();
      const api = this.api;
      if (
        this.stopped ||
        this.importing ||
        this.leaving ||
        this.gesture ||
        this.linkedDraft ||
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
        this.leaving ||
        this.gesture ||
        this.linkedDraft ||
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
