# Atlas Board

Atlas Board is a local Excalidraw workspace for brainstorming together with an MCP client. It is a separate application workspace in the Excalidraw fork. It uses the fork's React, TypeScript, Vite, Yarn Classic and Vitest stack.

## Run locally

From the fork root with Node 24 and Yarn 1.22.22:

```sh
yarn install --frozen-lockfile
yarn workspace @atlas/board build
yarn workspace @atlas/board start
```

Open [Atlas Board locally](http://127.0.0.1:4320). The service binds to loopback. On macOS its documents are under `~/Library/Application Support/Atlas Board/boards/`. Set `ATLAS_BOARD_DATA_DIR` for a separate profile, and `ATLAS_BOARD_PORT` for a different free port. Run one service per data directory. Fonts and the editor are bundled so the canvas can run offline.

**Archiver** saves an immutable version. **Ouvrir une copie** restores that version to a new editable board. **Dupliquer** copies the current scene. **Copier et fermer** copies a PNG of the scene to the clipboard, archives the editable board and goes back to the library. **Exporter** downloads the scene and image bytes in a standard `.excalidraw` document. **Ouvrir un fichier** accepts these documents in any profile.

## MCP

Keep the local service running and open the board you want to edit. In the MCP client, configure a stdio server with command `/absolute/path/to/excalidraw/node_modules/.bin/tsx` and argument `/absolute/path/to/excalidraw/examples/atlas-board/src/mcp/main.ts`. If using a non-default data directory, pass the same `ATLAS_BOARD_DATA_DIR` to the service and the MCP process.

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

## Import from Tracepin

Select **Importer Tracepin** in the library. By default on macOS the service reads Tracepin's local board folder. To work from a backup set `ATLAS_TRACEPIN_BOARDS_DIR` to a folder containing `boards.json` and `assets/`.

The import keeps the original board IDs and history dates, checks each source image against its original hash, and keeps an editable copy of each historical snapshot. Reimporting the same IDs leaves your edits in Atlas Board intact. Fonts, gradients and some Tracepin text bounds can render differently. Pins and comments become text, with source properties kept on their objects. Keep the source archive when visual fidelity matters.

## Reuse and verify

Use the `BoardEditor` component with the local service, or implement the same scene and command contracts in another host. Read [the scene contract](src/board/scene.ts), [the editing commands](src/board/commands.ts) and [the MCP tools](src/mcp/main.ts). Standard `.excalidraw` files provide a portable handoff for projects using a different storage system.

Run `yarn workspace @atlas/board typecheck`, `yarn workspace @atlas/board lint` and `yarn workspace @atlas/board test`. Run the [browser and MCP smoke test](tests/smoke.mjs) only with an isolated data profile and a copied Tracepin archive. It uses Chrome and the same saved scene as the editor. Set `ATLAS_BOARD_DATA_DIR`, `ATLAS_TRACEPIN_BOARDS_DIR` and, for a custom test port, `ATLAS_BOARD_TEST_URL`. From this workspace, run `node tests/smoke.mjs`.
