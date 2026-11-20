/** Board page: the Excalidraw canvas with the local toolbar, actions menu and history panel. */
import {
  Button,
  Excalidraw,
  useHandleLibrary,
  viewportCoordsToSceneCoords,
} from "@local/excalidraw-sdk";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { CloseIcon, Icon } from "../ui/icons";
import { formatDate, t } from "../ui/messages";

import { BoardMenu } from "./board-menu";
import { BoardSession } from "./board-session";
import {
  BlockControls,
  BlockLabelInput,
  mindBranchKey,
  projectSelection,
  sameProjection,
} from "./block-controls";
import { request } from "./client";
import { createLibraryAdapter } from "./library-adapter";
import { DrawingTools, getDrawingTool } from "./drawing-tools";
import { SelectionToolbar } from "./selection-toolbar";

import type {
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
  ExcalidrawProps,
} from "@local/excalidraw-sdk/types";
import type {
  CSSProperties,
  KeyboardEvent,
  MouseEvent,
  ReactElement,
} from "react";

import type { Board, Checkpoint } from "../board/scene";
import type { BoardMenuItem } from "./board-menu";
import type { BoardTemplate } from "./board-templates";
import type { BlockProjection } from "./block-controls";
import type { DrawingTool } from "./drawing-tools";
import type { Direction } from "./linked-block";
import type { BlockIds, MindMapSubject } from "./mind-map";
import type { SelectionEdit } from "./selection-edit";

const templates: readonly BoardTemplate[] = [
  "architecture",
  "wireframes",
  "note",
  "overview",
];

const ui = {
  canvasActions: { loadScene: false, saveToActiveFile: false, export: false },
} as const;

interface BoardEditorProps {
  board: Board;
  /** Address the libraries gallery sends installs back to: this board's own URL. */
  libraryReturnUrl: string;
  onClose: (notice?: string) => void;
  onOpen: (board: Board) => void;
}

const download = (value: unknown, name: string): void => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
};

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : t("app.genericError");

/** Mounts the reusable Excalidraw editor using the local board service. */
export const BoardEditor = ({
  board,
  libraryReturnUrl,
  onClose,
  onOpen,
}: BoardEditorProps): ReactElement => {
  const [status, setStatus] = useState(() => t("editor.saved"));
  const [history, setHistory] = useState(board.history);
  const [historyOpen, setHistoryOpen] = useState(false);
  const actionsTrigger = useRef<HTMLButtonElement>(null);
  const restoreMenuFocus = useRef<HTMLButtonElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [block, setBlock] = useState<BlockProjection | null>(null);
  const [toolbarRoot, setToolbarRoot] = useState<Element | null>(null);
  const [nativeMenuOpen, setNativeMenuOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<{
    right: number;
    y: number;
    room: number;
    above: boolean;
  } | null>(null);
  const [advancedId, setAdvancedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ id: string; mindMap: boolean } | null>(
    null,
  );
  const activeDraft = useRef<string | null>(null);
  const draftId = draft?.id;
  const [session] = useState(() => new BoardSession(board, setStatus));
  const [libraryAdapter] = useState(() =>
    createLibraryAdapter((error) => setStatus(errorText(error))),
  );
  const initialData = useMemo(
    () => board.scene as unknown as ExcalidrawInitialDataState,
    [board.scene],
  );
  const [theme, setTheme] = useState(
    () => initialData.appState?.theme ?? "light",
  );

  // Loads and persists the shape library, and installs libraries returned by the
  // gallery through `#addLibrary=` (default SDK URL validation).
  useHandleLibrary({ excalidrawAPI: api, adapter: libraryAdapter });

  useEffect(() => {
    if (busy) {
      return;
    }
    const trigger = restoreMenuFocus.current;
    restoreMenuFocus.current = null;
    if (
      trigger &&
      trigger.ownerDocument.activeElement === trigger.ownerDocument.body
    ) {
      trigger.focus();
    }
  }, [busy]);

  useEffect(() => session.start(), [session]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent): void => {
      if (session.hasPending()) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [session]);
  const page = useRef<HTMLElement>(null);
  const editor = useRef<HTMLElement>(null);
  const [drawingTool, setDrawingTool] = useState<DrawingTool | null>(null);
  useEffect(() => {
    const owner = page.current?.ownerDocument.defaultView;
    if (!owner) {
      return;
    }
    // The gallery opens its "Add to Excalidraw" link in the window named in its URL.
    // Naming this tab per board brings installs back here instead of a new tab.
    const previous = owner.name;
    owner.name = `excalidraw-board-${board.id}`;
    return () => {
      owner.name = previous;
    };
  }, [board.id]);

  const attach = (instance: ExcalidrawImperativeAPI): void => {
    session.attach(instance);
    setApi(instance);
  };

  useEffect(() => {
    if (api) {
      setToolbarRoot(editor.current?.querySelector(".excalidraw") ?? null);
    }
  }, [api]);

  const changed = useCallback<NonNullable<ExcalidrawProps["onChange"]>>(
    (elements, state, files) => {
      session.changed(elements, state, files);
      setTheme(state.theme);
      setNativeMenuOpen(Boolean(state.contextMenu));
      setDrawingTool(getDrawingTool(state.activeTool));
      const selected = projectSelection(elements, state);
      setBlock((previous) =>
        sameProjection(previous, selected) ? previous : selected,
      );
    },
    [session],
  );

  const startLabel = (
    mindMap: boolean,
    begin: (ids: BlockIds) => void,
  ): boolean => {
    const owner = page.current?.ownerDocument.defaultView;
    if (!owner || busy || activeDraft.current) {
      return false;
    }
    const blockId = owner.crypto.randomUUID();
    try {
      begin({
        blockId,
        labelId: owner.crypto.randomUUID(),
        arrowId: owner.crypto.randomUUID(),
      });
      activeDraft.current = blockId;
      setDraft({ id: blockId, mindMap });
      return true;
    } catch (error) {
      setStatus(errorText(error));
      return false;
    }
  };

  const startMind = (subject: MindMapSubject): boolean =>
    startLabel(true, (ids) => session.beginMindMap(ids, subject));

  const placeDrawing = (
    tool: DrawingTool,
    position: { x: number; y: number },
  ): void => {
    api?.setActiveTool({ type: "selection" });
    if (tool === "mind-map") {
      startMind({ position });
      return;
    }
    startLabel(false, (ids) => session.beginDiagram(ids, position));
  };

  const selectDrawingTool = (tool: DrawingTool): void => {
    if (!api) {
      return;
    }
    api.setActiveTool(
      drawingTool === tool
        ? { type: "selection" }
        : { type: "custom", customType: tool },
    );
    editor.current
      ?.querySelector<HTMLElement>(".excalidraw")
      ?.focus({ preventScroll: true });
  };

  const placeDrawingOnPointerUp: NonNullable<ExcalidrawProps["onPointerUp"]> = (
    tool,
    { origin },
  ) => {
    const placement = getDrawingTool(tool);
    if (placement) {
      // Let the native pointer interaction complete before selecting the new subject.
      editor.current?.ownerDocument.defaultView?.queueMicrotask(() =>
        placeDrawing(placement, origin),
      );
    }
  };

  const extendBlock = (direction: Direction): void => {
    if (!block?.canExtend) {
      return;
    }
    if (block.mindMap) {
      startMind({ sourceId: block.id, relation: "child" });
      return;
    }
    startLabel(false, (ids) =>
      session.beginLinkedBlock(block.id, direction, ids),
    );
  };

  const finishLabel = (text: string, id = draftId): boolean => {
    if (id !== activeDraft.current) {
      return false;
    }
    try {
      session.finishLinkedBlock(text);
      activeDraft.current = null;
      setDraft(null);
      return true;
    } catch (error) {
      setStatus(errorText(error));
      return false;
    }
  };

  const handleCanvasKey = (event: KeyboardEvent<HTMLElement>): void => {
    if (
      draftId ||
      busy ||
      event.shiftKey ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.nativeEvent.isComposing ||
      !(event.target as Element).classList?.contains("excalidraw")
    ) {
      return;
    }
    if (
      api &&
      drawingTool &&
      (event.key === "Enter" || event.key === "Escape")
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        api.setActiveTool({ type: "selection" });
        return;
      }
      const state = api.getAppState();
      const position = viewportCoordsToSceneCoords(
        {
          clientX: state.offsetLeft + state.width / 2,
          clientY: state.offsetTop + state.height / 2,
        },
        state,
      );
      placeDrawing(drawingTool, position);
      return;
    }
    const relation = mindBranchKey(event.key);
    if (
      block?.mindMap &&
      relation &&
      startMind({ sourceId: block.id, relation })
    ) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const finishLabelBeforeAction = (event: MouseEvent<HTMLElement>): void => {
    if (!draftId) {
      return;
    }
    const field =
      event.currentTarget.querySelector<HTMLTextAreaElement>(".diagram-label");
    if (
      field &&
      !field.contains(event.target as Node) &&
      !finishLabel(field.value)
    ) {
      event.preventDefault();
      event.stopPropagation();
      field.focus({ preventScroll: true });
    }
  };

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      setStatus(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const handleHistory = (): void => {
    if (historyOpen) {
      setHistoryOpen(false);
      return;
    }
    void run(async () => {
      const latest = await request<Board>(`boards/${board.id}`);
      setHistory(latest.history);
      setHistoryOpen(true);
    });
  };
  const handleArchive = (): void => {
    void run(async () => {
      const checkpoint = await session.archive();
      setHistory((items) => [checkpoint, ...items]);
      setStatus(t("editor.archived"));
    });
  };
  const handleCopy = (): void => {
    void run(async () => {
      await session.copy();
      onClose();
    });
  };
  const handleClose = (): void => {
    setLeaving(true);
    void run(async () => {
      try {
        const recovered = await session.leave();
        onClose(
          recovered
            ? t("editor.recoverySaved", { name: recovered })
            : undefined,
        );
      } finally {
        setLeaving(false);
      }
    });
  };
  const handleExport = (): void => {
    void run(async () => {
      const scene = session.exportScene();
      download(
        {
          type: "excalidraw",
          version: 2,
          source: "excalidraw-local",
          ...scene,
        },
        `${board.name}.excalidraw`,
      );
    });
  };
  const handleDuplicate = (checkpoint: Checkpoint): void => {
    void run(async () => {
      await session.flush();
      const copy = await request<Board>(
        `boards/${board.id}/duplicate`,
        "POST",
        {
          // Keep the suffixed name within the 180-character label limit.
          name: t("editor.copySuffix", { name: board.name.slice(0, 171) }),
          checkpointId: checkpoint.id,
        },
      );
      onOpen(copy);
    });
  };

  const selection =
    block && !draftId && !busy && !block.resizing ? block : null;
  const showAdvanced = selection
    ? selection.id === advancedId
    : advancedId === "" && !draftId && !busy;
  const selectionBelow = Boolean(
    selection &&
      selection.top < 164 &&
      selection.bottom + 120 < selection.viewportHeight,
  );
  const selectionStyle = selection
    ? ({
        "--selection-x": `${(selection.left + selection.right) / 2}px`,
        "--selection-toolbar-y": `${
          selectionBelow
            ? selection.bottom + 32
            : selection.top - (selection.canExtend ? 24 : 12)
        }px`,
      } as CSSProperties)
    : showAdvanced
    ? ({
        "--selection-x": "12rem",
        "--selection-toolbar-y": "3.5rem",
      } as CSSProperties)
    : undefined;
  const applySelectionEdit = (edit: SelectionEdit): boolean => {
    const owner = editor.current?.ownerDocument.defaultView;
    if (!selection || !owner) {
      return false;
    }
    try {
      session.updateSelection(selection.id, edit, () =>
        owner.crypto.randomUUID(),
      );
      return true;
    } catch (error) {
      setStatus(errorText(error));
      return false;
    }
  };
  const runNativeSelectionAction = (
    action: "Dupliquer" | "Supprimer",
  ): void => {
    // Both actions preserve Excalidraw's native selection and undo semantics.
    editor.current
      ?.querySelector<HTMLButtonElement>(
        `.selected-shape-actions button[aria-label="${action}"], .App-toolbar-content button[aria-label="${action}"]`,
      )
      ?.click();
  };

  const openSelectionMenu = (trigger: HTMLButtonElement): void => {
    const view = editor.current;
    const owner = view?.ownerDocument.defaultView;
    const canvas = view?.querySelector(".excalidraw__canvas.interactive");
    const rect = view?.getBoundingClientRect();
    if (!selection || !canvas || !owner || !rect) {
      return;
    }
    if (api?.getAppState().contextMenu) {
      api.updateScene({ appState: { contextMenu: null } });
      return;
    }
    const button = trigger.getBoundingClientRect();
    const aboveRoom = button.top - rect.top - 12;
    const belowRoom = rect.bottom - button.bottom - 12;
    const above = belowRoom < 300 && aboveRoom > belowRoom;
    setMenuAnchor({
      right: button.right - rect.left,
      y: (above ? button.top - 6 : button.bottom + 6) - rect.top,
      room: above ? aboveRoom : belowRoom,
      above,
    });
    // Use the canvas's own menu so commands keep their native eligibility and undo.
    canvas.dispatchEvent(
      new owner.MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: rect.left + (selection.left + selection.right) / 2,
        clientY: rect.top + (selection.top + selection.bottom) / 2,
      }),
    );
  };

  const handleEditorKey = (event: KeyboardEvent<HTMLElement>): void => {
    const target = event.target as Element;
    const menu = event.currentTarget.querySelector(".context-menu");
    if (
      !nativeMenuOpen ||
      !menuAnchor ||
      !menu?.parentElement?.contains(target)
    ) {
      handleCanvasKey(event);
      return;
    }
    const trigger = (): HTMLButtonElement | null =>
      editor.current?.querySelector('[data-testid="selection-object-menu"]') ??
      null;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      api?.updateScene({ appState: { contextMenu: null } });
      target.ownerDocument.defaultView?.requestAnimationFrame(() =>
        trigger()?.focus(),
      );
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      return;
    }
    const buttons = Array.from(
      menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
    );
    const index = buttons.findIndex((button) => button === target);
    const last = buttons.length - 1;
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
        ? last
        : event.key === "ArrowUp"
        ? index <= 0
          ? last
          : index - 1
        : (index + 1) % buttons.length;
    event.preventDefault();
    event.stopPropagation();
    buttons[next]?.focus();
  };

  const menuItems: BoardMenuItem[] = [
    {
      id: "history",
      label: t(historyOpen ? "editor.hideHistory" : "editor.showHistory"),
      checked: historyOpen,
      onSelect: handleHistory,
    },
    { id: "archive", label: t("editor.archive"), onSelect: handleArchive },
    { id: "export", label: t("editor.export"), onSelect: handleExport },
  ];

  return (
    <main
      className="board-page"
      ref={page}
      onPointerDownCapture={finishLabelBeforeAction}
      onClickCapture={(event) => {
        if (event.detail === 0) {
          finishLabelBeforeAction(event);
        }
      }}
    >
      <header className={`toolbar excalidraw theme--${theme}`}>
        <div className="toolbar-start">
          <Button
            onSelect={handleClose}
            disabled={busy}
            data-testid="editor-back-btn"
          >
            {t("editor.back")}
          </Button>
          <h1 className="board-name" title={board.name}>
            {board.name}
          </h1>
        </div>
        <div className="toolbar-end">
          <output aria-live="polite" data-testid="editor-status">
            {status}
          </output>
          <BoardMenu
            label={t("editor.templates")}
            items={templates.map((template) => ({
              id: template,
              label: t(`template.${template}`),
              onSelect: (trigger) => {
                restoreMenuFocus.current = trigger;
                void run(() => session.insertTemplate(template));
              },
            }))}
            disabled={busy || !api}
            scope="templates"
          />
          <BoardMenu
            label={t("editor.actions")}
            items={menuItems}
            disabled={busy}
            triggerRef={actionsTrigger}
          />
          <Button
            className="toolbar-primary"
            onSelect={handleCopy}
            disabled={busy}
            data-testid="editor-copy-close-btn"
          >
            {t("editor.copyClose")}
          </Button>
        </div>
      </header>
      <div className="board-body">
        {historyOpen && (
          <aside
            className="history"
            aria-labelledby="history-title"
            data-testid="editor-history"
          >
            <header className="history-header">
              <h2 id="history-title">{t("editor.historyTitle")}</h2>
              <button
                type="button"
                className="icon-button"
                aria-label={t("editor.closeHistory")}
                onClick={() => {
                  setHistoryOpen(false);
                  if (busy) {
                    restoreMenuFocus.current = actionsTrigger.current;
                  } else {
                    actionsTrigger.current?.focus();
                  }
                }}
                data-testid="editor-history-close"
              >
                <CloseIcon />
              </button>
            </header>
            <p className="history-help">{t("editor.historyHelp")}</p>
            {history.length === 0 ? (
              <p>{t("editor.historyEmpty")}</p>
            ) : (
              <ul>
                {history.map((entry) => (
                  <li key={entry.id}>
                    <strong>{entry.name}</strong>
                    <time dateTime={entry.savedAt}>
                      {formatDate(entry.savedAt)}
                    </time>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleDuplicate(entry)}
                    >
                      {t("editor.openCopy")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        )}
        <section
          className="editor"
          data-context-tools={Boolean(selection)}
          data-context-below={selectionBelow}
          data-context-advanced={showAdvanced}
          data-object-menu={Boolean(menuAnchor)}
          data-object-menu-above={menuAnchor?.above}
          style={
            {
              ...selectionStyle,
              ...(menuAnchor && {
                "--object-menu-right": `${menuAnchor.right}px`,
                "--object-menu-y": `${menuAnchor.y}px`,
                "--object-menu-room": `${menuAnchor.room}px`,
              }),
            } as CSSProperties
          }
          ref={editor}
          aria-label={t("editor.canvas")}
          inert={leaving}
          onKeyDownCapture={handleEditorKey}
          onPointerDownCapture={(event) => {
            if (
              (event.target as Element).matches(
                ".excalidraw__canvas.interactive",
              )
            ) {
              setAdvancedId(null);
              setMenuAnchor(null);
            }
            session.setGesture(true);
          }}
        >
          <Excalidraw
            initialData={initialData}
            excalidrawAPI={attach}
            onChange={changed}
            onPointerUp={placeDrawingOnPointerUp}
            langCode="fr-FR"
            UIOptions={ui}
            validateEmbeddable={false}
            libraryReturnUrl={libraryReturnUrl}
          />
          <DrawingTools
            editor={editor}
            active={drawingTool}
            disabled={busy || Boolean(draftId)}
            onSelect={selectDrawingTool}
          />
          {!selection && !draftId && !busy && (
            <button
              type="button"
              className="native-inspector-toggle icon-button"
              aria-label={t("selection.more")}
              aria-expanded={showAdvanced}
              title={t("selection.more")}
              onClick={() => setAdvancedId(showAdvanced ? null : "")}
            >
              <Icon path="M4 6h16M4 12h16M4 18h16M8 4v4m8 2v4m-5 2v4" />
            </button>
          )}
          {selection &&
            toolbarRoot &&
            createPortal(
              <SelectionToolbar
                key={`format-${selection.id}`}
                selection={selection}
                label={selection.text}
                advanced={showAdvanced}
                below={selectionBelow}
                onAdvanced={() => {
                  if (editor.current?.querySelector(".App-toolbar--mobile")) {
                    api?.updateScene({ appState: { openMenu: "shape" } });
                  } else {
                    setAdvancedId(showAdvanced ? null : selection.id);
                  }
                }}
                onDuplicate={() => runNativeSelectionAction("Dupliquer")}
                onDelete={() => runNativeSelectionAction("Supprimer")}
                menuOpen={Boolean(menuAnchor && nativeMenuOpen)}
                onContextMenu={openSelectionMenu}
                onEdit={applySelectionEdit}
              />,
              toolbarRoot,
            )}
          {draftId ? (
            <BlockLabelInput
              key={draftId}
              onBranch={
                draft?.mindMap
                  ? (text, relation) => {
                      if (!finishLabel(text, draftId)) {
                        return false;
                      }
                      if (!startMind({ sourceId: draftId, relation })) {
                        page.current
                          ?.querySelector<HTMLElement>(".excalidraw")
                          ?.focus({ preventScroll: true });
                      }
                      return true;
                    }
                  : undefined
              }
              block={block?.id === draftId ? block : null}
              onFinish={finishLabel}
            />
          ) : block?.canExtend && !busy ? (
            <BlockControls
              key={`directions-${block.id}`}
              block={block}
              onExtend={extendBlock}
            />
          ) : null}
        </section>
      </div>
    </main>
  );
};
