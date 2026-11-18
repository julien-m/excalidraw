import "@atlas/excalidraw-sdk/index.css";
import { lazy, StrictMode, Suspense, useState } from "react";

import { createRoot } from "react-dom/client";

import { sceneSchema } from "./board/scene";

import { request } from "./editor/client";

import "./style.css";

import type { ChangeEvent, FormEvent, ReactElement } from "react";
import type { Board, BoardSummary } from "./board/scene";
import type { TracepinArchive } from "./tracepin/archive";

const BoardEditor = lazy(async () => ({
  default: (await import("./editor/board-editor")).BoardEditor,
}));

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : "Impossible d’ouvrir le tableau.";

interface LibraryProps {
  initial: BoardSummary[];
  onOpen: (board: Board) => void;
}

const BoardLibrary = ({ initial, onOpen }: LibraryProps): ReactElement => {
  const [boards, setBoards] = useState(initial);
  const [name, setName] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setNotice("");
    try {
      await action();
    } catch (error) {
      setNotice(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = (event: FormEvent): void => {
    event.preventDefault();
    void run(async () =>
      onOpen(await request<Board>("boards", "POST", { name })),
    );
  };
  const handleOpen = (id: string): void => {
    void run(async () => onOpen(await request<Board>(`boards/${id}`)));
  };
  const handleTracepin = (): void => {
    void run(async () => {
      const archive = await request<TracepinArchive>("tracepin");
      const { convertArchive } = await import("./tracepin/convert-archive");
      const pages = convertArchive(archive);
      const ids = await request<string[]>("tracepin", "POST", { pages });
      setBoards(await request("boards"));
      setNotice(`${ids.length} tableaux Tracepin disponibles.`);
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
      const title = file.name.replace(/\.excalidraw$/i, "").slice(0, 180);
      onOpen(await request<Board>("boards", "POST", { name: title, scene }));
    });
  };

  return (
    <main className="library">
      <header className="library-header">
        <h1>Atlas Board</h1>
        <div className="toolbar-group">
          <button type="button" disabled={busy} onClick={handleTracepin}>
            Importer Tracepin
          </button>
          <label className="file-button">
            Ouvrir un fichier
            <input
              type="file"
              accept=".excalidraw,application/json"
              onChange={handleImport}
              disabled={busy}
            />
          </label>
        </div>
      </header>
      <form className="toolbar-group" onSubmit={handleCreate}>
        <input
          aria-label="Nom du tableau"
          placeholder="Nom du tableau"
          value={name}
          maxLength={180}
          onChange={(event) => setName(event.target.value)}
          required
        />
        <button
          type="submit"
          className="primary"
          disabled={busy || !name.trim()}
        >
          Créer un tableau
        </button>
      </form>
      <output aria-live="polite">{notice}</output>
      <section className="board-list" aria-label="Tableaux">
        {boards.length === 0 ? (
          <p>Aucun tableau.</p>
        ) : (
          <ul>
            {boards.map((board) => (
              <li key={board.id}>
                <button
                  type="button"
                  onClick={() => handleOpen(board.id)}
                  disabled={busy}
                >
                  <strong>{board.name}</strong>
                  <time dateTime={board.updatedAt}>
                    {new Date(board.updatedAt).toLocaleString("fr-FR")}
                  </time>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
};

const App = ({ initial }: { initial: BoardSummary[] }): ReactElement => {
  const [active, setActive] = useState<Board | null>(null);
  const [boards, setBoards] = useState(initial);
  const [failure, setFailure] = useState("");
  const handleClose = async (): Promise<void> => {
    try {
      setBoards(await request("boards"));
      setActive(null);
      setFailure("");
    } catch (error) {
      setFailure(errorText(error));
    }
  };
  return active ? (
    <>
      <BoardEditor
        key={active.id}
        board={active}
        onOpen={setActive}
        onClose={() => void handleClose()}
      />
      {failure && <p role="alert">{failure}</p>}
    </>
  ) : (
    <BoardLibrary initial={boards} onOpen={setActive} />
  );
};

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Atlas Board root missing.");
}
const root = createRoot(rootElement);
try {
  const initial = await request<BoardSummary[]>("boards");
  root.render(
    <StrictMode>
      <Suspense fallback={<p role="status">Ouverture du tableau…</p>}>
        <App initial={initial} />
      </Suspense>
    </StrictMode>,
  );
} catch (error) {
  root.render(
    <main className="library">
      <h1>Atlas Board</h1>
      <p role="alert">{errorText(error)}</p>
    </main>,
  );
}
