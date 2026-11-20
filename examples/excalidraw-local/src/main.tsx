/** Entry point: switches between the board library and one open board, mirrored in `?board=`. */
import "@local/excalidraw-sdk/index.css";
import { lazy, StrictMode, Suspense, useEffect, useState } from "react";

import { createRoot } from "react-dom/client";

import { boardId } from "./board/scene";
import { request } from "./editor/client";
import { BoardLibrary } from "./library/board-library";
import { t } from "./ui/messages";

import "./style.css";

import type { ReactElement } from "react";
import type { Board } from "./board/scene";

const BoardEditor = lazy(async () => ({
  default: (await import("./editor/board-editor")).BoardEditor,
}));

const boardParam = "board";

type View =
  | { kind: "opening"; id: string }
  | { kind: "library"; notice?: string }
  | { kind: "board"; board: Board };

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : t("app.genericError");

const requestedBoard = (view: Window): string | null => {
  const value = new URLSearchParams(view.location.search).get(boardParam);
  return value && boardId.safeParse(value).success ? value : null;
};

/**
 * Rewrites the address without a navigation. The hash survives while a board stays open:
 * it carries `#addLibrary=` installs that the lazily loaded editor reads after mounting.
 */
const showInAddress = (view: Window, id: string | null): void => {
  const url = new URL(view.location.href);
  if (id) {
    url.searchParams.set(boardParam, id);
  } else {
    url.searchParams.delete(boardParam);
    url.hash = "";
  }
  view.history.replaceState(null, "", url);
};

const returnUrlFor = (view: Window, id: string): string =>
  `${view.location.origin}${view.location.pathname}?${boardParam}=${id}`;

/** @param window The window owning the mounted root, per the fork's DOM access rule. */
const App = ({ window: owner }: { window: Window }): ReactElement => {
  const [view, setView] = useState<View>(() => {
    const id = requestedBoard(owner);
    return id ? { kind: "opening", id } : { kind: "library" };
  });

  useEffect(() => {
    if (view.kind !== "opening") {
      return;
    }
    let current = true;
    void (async () => {
      try {
        const board = await request<Board>(`boards/${view.id}`);
        if (current) {
          setView({ kind: "board", board });
        }
      } catch (error) {
        if (current) {
          showInAddress(owner, null);
          setView({ kind: "library", notice: errorText(error) });
        }
      }
    })();
    return () => {
      current = false;
    };
  }, [view, owner]);

  const handleOpen = (board: Board): void => {
    showInAddress(owner, board.id);
    setView({ kind: "board", board });
  };
  const handleClose = (notice?: string): void => {
    showInAddress(owner, null);
    setView({ kind: "library", notice });
  };

  switch (view.kind) {
    case "opening":
      return (
        <p className="page-state" role="status">
          {t("app.opening")}
        </p>
      );
    case "library":
      return <BoardLibrary onOpen={handleOpen} initialNotice={view.notice} />;
    case "board":
      return (
        <BoardEditor
          key={view.board.id}
          board={view.board}
          libraryReturnUrl={returnUrlFor(owner, view.board.id)}
          onOpen={handleOpen}
          onClose={handleClose}
        />
      );
  }
};

const rootElement = document.getElementById("root");
const ownerWindow = rootElement?.ownerDocument.defaultView;
if (!rootElement || !ownerWindow) {
  throw new Error("Excalidraw root missing.");
}
createRoot(rootElement).render(
  <StrictMode>
    <Suspense
      fallback={
        <p className="page-state" role="status">
          {t("app.opening")}
        </p>
      }
    >
      <App window={ownerWindow} />
    </Suspense>
  </StrictMode>,
);
