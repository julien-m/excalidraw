/** Board library: create, import, open, delete and restore local boards. */
import { useCallback, useEffect, useRef, useState } from "react";

import { sceneSchema } from "../board/scene";
import { BoardMenu } from "../editor/board-menu";
import { request } from "../editor/client";
import { CloseIcon, PlusIcon } from "../ui/icons";
import { formatDate, t } from "../ui/messages";

import { DeleteDialog } from "./delete-dialog";

import type { ChangeEvent, FormEvent, ReactElement } from "react";

import type { Board, BoardSummary, TrashedBoardSummary } from "../board/scene";

type ListState =
  | { status: "loading" }
  | { status: "failed"; message: string }
  | {
      status: "ready";
      boards: BoardSummary[];
      trash: TrashedBoardSummary[];
    };

interface Notice {
  text: string;
  /** Board that the notice's undo button restores. */
  undoId?: string;
}

interface LibraryProps {
  onOpen: (board: Board) => void;
  /** Error carried from a failed board opening, shown once on mount. */
  initialNotice?: string;
}

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : t("app.genericError");

const loadLists = async (): Promise<ListState> => {
  const [boards, trash] = await Promise.all([
    request<BoardSummary[]>("boards"),
    request<TrashedBoardSummary[]>("trash"),
  ]);
  return { status: "ready", boards, trash };
};

interface BoardCardProps {
  board: BoardSummary;
  busy: boolean;
  onOpen: (id: string) => void;
  onDuplicate: (board: BoardSummary, trigger: HTMLButtonElement) => void;
  onDelete: (board: BoardSummary, trigger: HTMLButtonElement) => void;
  registerOpen: (id: string, button: HTMLButtonElement | null) => void;
}

/** Reports whether the clamped title hides part of its text, so the full title gets a tooltip. */
const useClamped = (): [(node: HTMLElement | null) => void, boolean] => {
  const [clamped, setClamped] = useState(false);
  const observer = useRef<ResizeObserver | null>(null);
  const attach = useCallback((node: HTMLElement | null) => {
    observer.current?.disconnect();
    if (!node) {
      return;
    }
    const measure = (): void =>
      setClamped(node.scrollHeight > node.clientHeight + 1);
    observer.current = new ResizeObserver(measure);
    observer.current.observe(node);
    measure();
  }, []);
  return [attach, clamped];
};

const BoardCard = ({
  board,
  busy,
  onOpen,
  onDuplicate,
  onDelete,
  registerOpen,
}: BoardCardProps): ReactElement => {
  const metaId = `board-meta-${board.id}`;
  const [titleRef, clamped] = useClamped();
  return (
    <li className="board-card" data-testid={`board-card-${board.id}`}>
      <button
        type="button"
        className="board-open"
        ref={(button) => registerOpen(board.id, button)}
        onClick={() => onOpen(board.id)}
        disabled={busy}
        aria-describedby={metaId}
        data-tooltip={clamped ? board.name : undefined}
        data-testid={`board-open-${board.id}`}
      >
        <span className="board-title" ref={titleRef}>
          {board.name}
        </span>
      </button>
      <p className="board-meta" id={metaId}>
        <time dateTime={board.updatedAt}>
          {t("library.updated", { date: formatDate(board.updatedAt) })}
        </time>
        {(board.tracepinId || board.versions > 0) && (
          <span className="board-tags">
            {board.tracepinId && (
              <span className="tag">{t("library.tracepin")}</span>
            )}
            {board.versions > 0 && (
              <span className="tag">
                {t("library.versions", { count: board.versions })}
              </span>
            )}
          </span>
        )}
      </p>
      <BoardMenu
        cardId={board.id}
        label={t("library.actions", { name: board.name })}
        disabled={busy}
        items={[
          {
            id: "duplicate",
            label: t("library.duplicate"),
            onSelect: (trigger) => onDuplicate(board, trigger),
          },
          {
            id: "delete",
            label: t("library.delete"),
            onSelect: (trigger) => onDelete(board, trigger),
          },
        ]}
      />
    </li>
  );
};

/**
 * Lists boards as equal-size cards. Deleting asks for confirmation, moves the board to the
 * server-side trash and offers an immediate undo; the trash section restores it later.
 */
export const BoardLibrary = ({
  onOpen,
  initialNotice,
}: LibraryProps): ReactElement => {
  const [lists, setLists] = useState<ListState>({ status: "loading" });
  const [name, setName] = useState("");
  const [notice, setNotice] = useState<Notice | null>(
    initialNotice ? { text: initialNotice } : null,
  );
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<BoardSummary | null>(null);
  const deleteTrigger = useRef<HTMLButtonElement | null>(null);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const openButtons = useRef(new Map<string, HTMLButtonElement>());
  const registerOpen = useCallback(
    (id: string, button: HTMLButtonElement | null): void => {
      if (button) {
        openButtons.current.set(id, button);
      } else {
        openButtons.current.delete(id);
      }
    },
    [],
  );

  const reload = useCallback(async (): Promise<void> => {
    try {
      setLists(await loadLists());
    } catch (error) {
      setLists({ status: "failed", message: errorText(error) });
    }
  }, []);

  useEffect(() => {
    // No route loader exists in this Vite app; the library owns its first fetch.
    void reload();
  }, [reload]);

  // Focus moves only after the dialog has closed and the cards are enabled again;
  // before that the modal keeps the page inert and disabled buttons refuse focus.
  const focusAfterDialog = useRef<(() => HTMLElement | null) | null>(null);
  useEffect(() => {
    const target = focusAfterDialog.current;
    if (busy || pendingDelete || !target) {
      return;
    }
    focusAfterDialog.current = null;
    (target() ?? listHeading.current)?.focus();
  }, [busy, lists, pendingDelete]);

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      setNotice({ text: errorText(error) });
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = (event: FormEvent): void => {
    event.preventDefault();
    const title = name.trim() || t("library.untitled");
    void run(async () =>
      onOpen(await request<Board>("boards", "POST", { name: title })),
    );
  };
  const handleOpen = (id: string): void => {
    void run(async () => onOpen(await request<Board>(`boards/${id}`)));
  };
  const handleDuplicate = (
    board: BoardSummary,
    trigger: HTMLButtonElement,
  ): void => {
    focusAfterDialog.current = () => trigger;
    void run(async () => {
      const copy = await request<Board>(
        `boards/${board.id}/duplicate`,
        "POST",
        {
          name: t("editor.copySuffix", { name: board.name.slice(0, 171) }),
        },
      );
      await reload();
      setNotice({ text: t("library.duplicated", { name: copy.name }) });
      focusAfterDialog.current = () => openButtons.current.get(copy.id) ?? null;
    });
  };
  const handleImport = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    void run(async () => {
      const scene = sceneSchema.parse(JSON.parse(await file.text()));
      const title =
        file.name.replace(/\.excalidraw$/i, "").slice(0, 180) ||
        t("library.untitled");
      onOpen(await request<Board>("boards", "POST", { name: title, scene }));
    });
  };

  const handleDeleteRequest = (
    board: BoardSummary,
    trigger: HTMLButtonElement,
  ): void => {
    deleteTrigger.current = trigger;
    setPendingDelete(board);
  };
  const handleDeleteCancel = (): void => {
    focusAfterDialog.current = () => deleteTrigger.current;
    setPendingDelete(null);
  };
  const handleDeleteConfirm = (): void => {
    const board = pendingDelete;
    if (!board || busy || lists.status !== "ready") {
      return;
    }
    const index = lists.boards.findIndex(({ id }) => id === board.id);
    const next = lists.boards[index + 1] ?? lists.boards[index - 1];
    void (async () => {
      setBusy(true);
      try {
        await request(`boards/${board.id}`, "DELETE", {
          expectedRevision: board.revision,
        });
        setNotice({
          text: t("library.deleted", { name: board.name }),
          undoId: board.id,
        });
        setPendingDelete(null);
        await reload();
        // The deleted card is gone: focus its neighbour, or the list heading.
        focusAfterDialog.current = () =>
          (next && openButtons.current.get(next.id)) ?? null;
      } catch (error) {
        setPendingDelete(null);
        setNotice({ text: errorText(error) });
        await reload();
        focusAfterDialog.current = () =>
          openButtons.current.get(board.id) ?? null;
      } finally {
        setBusy(false);
      }
    })();
  };
  const handleRestore = (id: string, restoredName: string): void => {
    void run(async () => {
      await request(`trash/${id}/restore`, "POST");
      setNotice({ text: t("library.restored", { name: restoredName }) });
      await reload();
    });
  };

  const boards = lists.status === "ready" ? lists.boards : [];
  const trash = lists.status === "ready" ? lists.trash : [];
  const undoName =
    notice?.undoId && trash.find(({ id }) => id === notice.undoId)?.name;

  return (
    <main className="library" data-testid="library">
      <header className="library-header">
        <div className="library-heading">
          <h1>{t("app.title")}</h1>
          {lists.status === "ready" && (
            <p className="library-count">
              {t("library.count", { count: boards.length })}
            </p>
          )}
        </div>
        <form className="library-create" onSubmit={handleCreate}>
          <input
            aria-label={t("library.nameLabel")}
            placeholder={t("library.namePlaceholder")}
            value={name}
            maxLength={180}
            onChange={(event) => setName(event.target.value)}
            data-testid="library-create-name"
          />
          <button
            type="submit"
            className="primary"
            disabled={busy}
            data-testid="library-create-btn"
          >
            <PlusIcon />
            {t("library.create")}
          </button>
        </form>
      </header>

      <div className="library-notice" role="status" aria-live="polite">
        {notice && (
          <div className="notice" data-testid="library-notice">
            <span>{notice.text}</span>
            {notice.undoId && undoName && (
              <button
                type="button"
                className="ghost"
                disabled={busy}
                onClick={() => handleRestore(notice.undoId ?? "", undoName)}
                data-testid="library-undo-delete"
              >
                {t("library.undo")}
              </button>
            )}
            <button
              type="button"
              className="ghost icon-button"
              aria-label={t("library.dismiss")}
              data-tooltip={t("library.dismiss")}
              onClick={() => setNotice(null)}
            >
              <CloseIcon />
            </button>
          </div>
        )}
      </div>

      <section className="board-section" aria-labelledby="board-list-title">
        <div className="section-toolbar">
          <h2 id="board-list-title" ref={listHeading} tabIndex={-1}>
            {t("library.listLabel")}
          </h2>
          <div className="action-group">
            <label className="button-like" data-disabled={busy || undefined}>
              {t("library.openFile")}
              <input
                type="file"
                className="visually-hidden"
                accept=".excalidraw"
                onChange={handleImport}
                disabled={busy}
                data-testid="library-open-file"
              />
            </label>
          </div>
        </div>

        {lists.status === "loading" && (
          <p className="state" role="status" data-testid="library-loading">
            {t("library.loading")}
          </p>
        )}
        {lists.status === "failed" && (
          <div className="state state-error" role="alert">
            <p>{t("app.loadFailed")}</p>
            <p className="state-detail">{lists.message}</p>
            <button type="button" onClick={() => void reload()}>
              {t("app.retry")}
            </button>
          </div>
        )}
        {lists.status === "ready" && boards.length === 0 && (
          <div className="state" data-testid="library-empty">
            <p className="state-title">{t("library.emptyTitle")}</p>
            <p>{t("library.emptyBody")}</p>
          </div>
        )}
        {boards.length > 0 && (
          <ul className="board-grid" data-testid="library-boards">
            {boards.map((board) => (
              <BoardCard
                key={board.id}
                board={board}
                busy={busy}
                onOpen={handleOpen}
                onDuplicate={handleDuplicate}
                onDelete={handleDeleteRequest}
                registerOpen={registerOpen}
              />
            ))}
          </ul>
        )}
      </section>

      {trash.length > 0 && (
        <details className="trash" data-testid="library-trash">
          <summary>{t("trash.title", { count: trash.length })}</summary>
          <ul className="trash-list">
            {trash.map((item) => (
              <li key={item.id} className="trash-row">
                <div className="trash-text">
                  <strong>{item.name}</strong>
                  <time dateTime={item.deletedAt}>
                    {t("trash.deletedAt", { date: formatDate(item.deletedAt) })}
                  </time>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={t("trash.restore", { name: item.name })}
                  onClick={() => handleRestore(item.id, item.name)}
                  data-testid={`trash-restore-${item.id}`}
                >
                  {t("trash.restoreShort")}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {pendingDelete && (
        <DeleteDialog
          board={pendingDelete}
          busy={busy}
          onCancel={handleDeleteCancel}
          onConfirm={handleDeleteConfirm}
        />
      )}
    </main>
  );
};
