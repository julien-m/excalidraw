# Excalidraw

This workspace in the Excalidraw fork adds local boards and MCP editing. It uses the fork's React, TypeScript, Vite, Yarn Classic and Vitest stack.

## Run locally

From the fork root with Node 24 and Yarn 1.22.22:

```sh
yarn install --frozen-lockfile
yarn workspace @local/excalidraw build
yarn workspace @local/excalidraw start
```

Open [the local editor](http://127.0.0.1:4320). The service binds to loopback. On macOS its documents are under `~/Library/Application Support/Excalidraw Local/boards/`. Set `EXCALIDRAW_LOCAL_DATA_DIR` for a separate profile, and `EXCALIDRAW_LOCAL_PORT` for a different free port. Run one service per data directory. Fonts and the editor are bundled so the canvas can run offline. Only installs from the libraries gallery reach the network (see below).

The address shows the open board as `?board=<id>`, so a reload reopens it. The **Actions** menu groups **Afficher l’historique**, **Archiver une version** and **Exporter (.excalidraw)**. **Archiver** saves an immutable version. **Ouvrir une copie** restores that version to a new editable board. The menu on each library card offers **Dupliquer**, which adds an independent copy of the current scene, and **Supprimer**, which moves the board to the trash. **Copier et fermer** copies a PNG of the scene to the clipboard, archives the editable board and goes back to the library. **Exporter** downloads the scene and image bytes in a standard `.excalidraw` document. **Ouvrir un fichier .excalidraw** opens a local file as a new editable board, leaving the source file intact.

## Delete and restore boards

Selecting **Supprimer** in a board card’s menu asks for confirmation, then moves the board with all its archived versions from `boards/` to `trash/` in the same profile. The move is one atomic rename. **Annuler** in the notice or **Restaurer** in the **Corbeille** section moves it back unchanged. Nothing is purged automatically. A board edited elsewhere since the library loaded is not deleted. A live board always wins over a stale trash copy with the same ID. Deleting an imported Tracepin board never touches the Tracepin folder, and a new Tracepin import skips boards in the trash.

## Shape libraries

The **Bibliothèque** sidebar of the canvas keeps its items in `library.json` of the profile, shared by every board and kept across restarts. Use **Parcourir les bibliothèques** to install from the [public gallery](https://libraries.excalidraw.com). The gallery returns to the board's tab through `#addLibrary=`. The menu **⋮ → Ouvrir** imports a downloaded `.excalidrawlib` file. Library files are data. The SDK validates their URL (excalidraw.com and the `excalidraw/excalidraw-libraries` repository only) and their content. The page's content security policy allows network access only to these two hosts. Each editor sends only its additions, edits and removals, which the service merges into the latest library. Concurrent installs from two tabs are both kept, and for a single item the last change wins.

## Upgrade from the preview

Stop the preview service before switching versions. To reuse the existing profile, set `EXCALIDRAW_LOCAL_DATA_DIR` to the previous value of `ATLAS_BOARD_DATA_DIR` in both the service and MCP configuration. To adopt the new default, move the whole existing profile while the service is stopped and only if the destination does not exist. The default directory changed from `Atlas Board` to `Excalidraw Local` on macOS and from `atlas-board` to `excalidraw-local` under `$XDG_DATA_HOME` (default `~/.local/share`) on Linux. Replace `ATLAS_BOARD_PORT` with `EXCALIDRAW_LOCAL_PORT` and `ATLAS_TRACEPIN_BOARDS_DIR` with `EXCALIDRAW_LOCAL_TRACEPIN_BOARDS_DIR` in any custom service configuration.

## MCP

Keep the local service running and open the board you want to edit. In the MCP client, configure a stdio server named `excalidraw` with command `/absolute/path/to/excalidraw/node_modules/.bin/tsx` and argument `/absolute/path/to/excalidraw/examples/excalidraw-local/src/mcp/main.ts`. If using a non-default data directory, pass the same `EXCALIDRAW_LOCAL_DATA_DIR` to the service and the MCP process.

Use `list_boards` and `read_board` to get the board ID, its revision and the existing shapes, text, coordinates and bindings. For example, call `draw` on that board with the observed revision and these commands:

```json
[
  {
    "kind": "shape",
    "id": "idea",
    "shape": "rectangle",
    "text": "Idée",
    "x": 180,
    "y": 180
  },
  {
    "kind": "shape",
    "id": "test",
    "shape": "diamond",
    "text": "Test",
    "relativeTo": "idea",
    "direction": "right",
    "gap": 64
  },
  { "kind": "connect", "from": "idea", "to": "test", "text": "Vérifier" }
]
```

Use `move` for offsets, `arrange` for a row or column with an explicit gap, and `setText` to edit a label. The editor applies a successful batch as one undoable action. A stale revision rejects the batch. Read the current revision and use its object IDs before retrying. Use `archive_board` to keep a checkpoint, then `copy_board` to branch it into an editable board.

## Diagram templates

Select a single unlocked rectangle, ellipse, or diamond to see its size beneath it in canvas units. Move the pointer to one of its sides to reveal the arrow that adds a connected block in that direction. With the keyboard, Tab to the controls and press an arrow key to focus that side. The new block opens with its label ready to type. Press Enter to confirm, Shift+Enter for a new line, or Escape to keep the new block empty. One undo removes the block, its connector, and its label.

If another window has saved a newer revision, **Tableaux** preserves this window’s pending edits in a separate board marked **(récupéré)** and returns to the board list. The latest revision of the original board stays available there.

Open a board and choose **Modèles**. Insert a diagram, web and mobile wireframes, a sticky note, or a project overview that combines them. Each insertion appends native Excalidraw shapes, text and connectors to the right of the existing content, and is undoable as one operation. Edit labels and move objects on the canvas, or use the MCP tools to refine them. Deleting a shape also removes arrows bound to it. Undo restores the shape and its connectors.

Choose **Diagramme rapide** in the drawing toolbar, click the canvas to place the first rectangle, then type its label. Select a block and use a directional arrow to add the next block with a connector and its label ready to type.

Select an element to open its floating toolbar. Change colors, shape, text, stroke, opacity, arrowheads and links in place. Use a **Note locale** for a note saved with the element, and **Propriétés de l’objet** for the native inspector. **Actions de l’objet** opens the native menu directly for clipboard, style, layering, frames and locking commands. Use the trash icon to delete the selected block and its attached connectors, or **Icônes** to find, add or remove a symbol.

The **Forme** picker also provides diagram outlines such as capsules, triangles, cylinders, braces, clouds, and stars. The fork keeps these outlines when reopening the board and in SVG exports. The upstream editor opens these custom blocks as editable rectangles.

Choose **Carte mentale** in the Excalidraw drawing toolbar and click the canvas to place the first subject. Press **Enter** after selecting the tool to place it at the center of the view with the keyboard. Type the subject immediately. Press **Tab** for a child or **Enter** for a sibling (a child when starting from the root). Click **+** to the right of a selected subject to add a branch with the mouse. Excalidraw places the branches automatically. **Escape** saves the subject text and returns focus to the canvas.

In `draw`, `shape.fill` sets a solid background. A `connect` command accepts `routing: "elbow"`, a stroke `color` and `arrowhead: false` for a branch without an arrowhead.

## Previously imported Tracepin boards

Previously imported boards and their archived versions are stored in Excalidraw with the other boards. The board library uses the native `.excalidraw` format for file imports.

## Reuse and verify

Use the `BoardEditor` component with the local service, or implement the same scene and command contracts in another host. Read [the scene contract](src/board/scene.ts), [the editing commands](src/board/commands.ts) and [the MCP tools](src/mcp/main.ts). Standard `.excalidraw` files provide a portable handoff for projects using a different storage system.

Run `yarn workspace @local/excalidraw typecheck`, `yarn workspace @local/excalidraw lint` and `yarn workspace @local/excalidraw test`. Run the browser tests only against a service started with an isolated data profile. They use Chrome. Set `EXCALIDRAW_LOCAL_DATA_DIR` and `EXCALIDRAW_LOCAL_TEST_URL` to that service, then run these from this workspace:

- `node tests/smoke.mjs` checks the MCP and editor flow, including mouse edits, undo, copy and history, on the same saved scene as the editor.
- `node tests/library-ui.mjs` checks deletion and restore, keyboard focus, and the editor's Actions menu.
- `node tests/shape-library.mjs` needs network access, a fresh profile, and two downloaded `.excalidrawlib` files in `EXCALIDRAW_LOCAL_LIBRARY_FILES=first,second`. It checks file import, insertion, reload, concurrent installs and the gallery return.
