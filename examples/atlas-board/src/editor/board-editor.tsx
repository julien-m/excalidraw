import { Excalidraw } from "@atlas/excalidraw-sdk";

import { useEffect, useMemo, useState } from "react";

import { BoardSession } from "./board-session";

import { request } from "./client";

import type { ExcalidrawInitialDataState } from "@atlas/excalidraw-sdk/types";
import type { ReactElement } from "react";

import type { Board, Checkpoint } from "../board/scene";

const ui = {
  canvasActions: { loadScene: false, saveToActiveFile: false, export: false },
} as const;

interface BoardEditorProps {
  board: Board;
  onClose: () => void;
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

const showError = (error: unknown, report: (message: string) => void): void =>
  report(
    error instanceof Error
      ? error.message
      : "Impossible d’effectuer cette action.",
  );

/** Mounts the reusable Excalidraw editor using the local board service. */
export const BoardEditor = ({
  board,
  onClose,
  onOpen,
}: BoardEditorProps): ReactElement => {
  const [status, setStatus] = useState("Enregistré");
  const [history, setHistory] = useState(board.history);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [session] = useState(() => new BoardSession(board, setStatus));
  const initialData = useMemo(
    () => board.scene as unknown as ExcalidrawInitialDataState,
    [board.scene],
  );

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

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      showError(error, setStatus);
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
      setStatus("Version archivée");
    });
  };
  const handleCopy = (): void => {
    void run(async () => {
      await session.copy();
      onClose();
    });
  };
  const handleClose = (): void => {
    void run(async () => {
      await session.flush();
      onClose();
    });
  };
  const handleExport = (): void => {
    void run(async () => {
      const scene = session.exportScene();
      download(
        { type: "excalidraw", version: 2, source: "atlas-board", ...scene },
        `${board.name}.excalidraw`,
      );
    });
  };
  const handleDuplicate = (checkpoint?: Checkpoint): void => {
    void run(async () => {
      await session.flush();
      const copy = await request<Board>(
        `boards/${board.id}/duplicate`,
        "POST",
        {
          name: `${board.name.slice(0, 171)} (copie)`,
          checkpointId: checkpoint?.id,
        },
      );
      onOpen(copy);
    });
  };
  return (
    <main className="board-page">
      <header className="toolbar">
        <div className="toolbar-group">
          <button type="button" onClick={handleClose} disabled={busy}>
            Tableaux
          </button>
          <h1>{board.name}</h1>
        </div>
        <div className="toolbar-group actions">
          <output aria-live="polite">{status}</output>
          <button
            type="button"
            onClick={handleHistory}
            disabled={busy}
            aria-expanded={historyOpen}
          >
            Historique
          </button>
          <button type="button" onClick={handleArchive} disabled={busy}>
            Archiver
          </button>
          <button
            type="button"
            onClick={() => handleDuplicate()}
            disabled={busy}
          >
            Dupliquer
          </button>
          <button type="button" onClick={handleExport} disabled={busy}>
            Exporter
          </button>
          <button
            type="button"
            className="primary"
            onClick={handleCopy}
            disabled={busy}
          >
            Copier et fermer
          </button>
        </div>
      </header>
      <div className="board-body">
        {historyOpen && (
          <aside className="history" aria-label="Historique">
            <h2>Historique</h2>
            {history.length === 0 ? (
              <p>Aucune version archivée.</p>
            ) : (
              <ul>
                {history.map((entry) => (
                  <li key={entry.id}>
                    <strong>{entry.name}</strong>
                    <time dateTime={entry.savedAt}>
                      {new Date(entry.savedAt).toLocaleString("fr-FR")}
                    </time>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleDuplicate(entry)}
                    >
                      Ouvrir une copie
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        )}
        <section
          className="editor"
          aria-label="Zone de dessin"
          onPointerDownCapture={() => session.setGesture(true)}
        >
          <Excalidraw
            initialData={initialData}
            excalidrawAPI={session.attach}
            onChange={session.changed}
            langCode="fr-FR"
            UIOptions={ui}
            validateEmbeddable={false}
          />
        </section>
      </div>
    </main>
  );
};
