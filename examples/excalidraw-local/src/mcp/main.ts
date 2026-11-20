import { readFile } from "node:fs/promises";

import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";

import { commandBatch } from "../board/commands";
import {
  boardId,
  label,
  objectId,
  revision,
  boardSchema,
} from "../board/scene";
import { runtimePath } from "../server/config";

const runtimeSchema = z.object({
  origin: z.string().regex(/^http:\/\/127\.0\.0\.1:\d{1,5}$/),
  token: z.string().regex(/^[a-f0-9]{64}$/),
});

const call = async (
  path: string,
  method = "GET",
  body?: unknown,
): Promise<unknown> => {
  let runtime: z.infer<typeof runtimeSchema>;
  try {
    runtime = runtimeSchema.parse(
      JSON.parse(await readFile(runtimePath, "utf8")),
    );
  } catch {
    throw new Error("Démarrez d’abord le service local Excalidraw.");
  }
  const response = await fetch(`${runtime.origin}/api/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${runtime.token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(18_000),
  });
  const value: unknown = await response.json();
  if (!response.ok) {
    const error = z.object({ error: z.string() }).parse(value);
    throw new Error(error.error);
  }
  return value;
};

const result = async (action: () => Promise<unknown>) => {
  try {
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(await action()) },
      ],
    };
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "La commande a échoué.";
    return {
      isError: true,
      content: [{ type: "text" as const, text: detail }],
    };
  }
};

const server = new McpServer(
  { name: "excalidraw", version: "0.1.0" },
  {
    instructions:
      "Read a board before mutating it. Draw edits an existing open Excalidraw window. Use the revision returned by read_board or draw. A stale revision is a conflict: read again and rebase by object ID. Coordinates are canvas units; x grows rightward and y downward. Prefer relative placement, stable object IDs and one batch per user request.",
  },
);

server.registerTool(
  "list_boards",
  {
    description:
      "List local Excalidraw boards, including copies imported from Tracepin.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
  },
  () => result(() => call("boards")),
);

server.registerTool(
  "create_board",
  {
    description:
      "Create a local Excalidraw board. Open it in Excalidraw before drawing.",
    inputSchema: z.object({ name: label }),
    annotations: { destructiveHint: false },
  },
  ({ name }) =>
    result(async () => {
      const board = boardSchema.parse(await call("boards", "POST", { name }));
      return { id: board.id, name: board.name, revision: board.revision };
    }),
);

server.registerTool(
  "read_board",
  {
    description:
      "Read the revision and editable objects with their IDs, bounds, text and connections. Use object_ids to scope the read.",
    inputSchema: z.object({
      board_id: boardId,
      object_ids: z.array(objectId).max(200).optional(),
      offset: z.number().int().nonnegative().default(0),
      limit: z.number().int().min(1).max(200).default(80),
    }),
    annotations: { readOnlyHint: true },
  },
  ({ board_id, object_ids, offset, limit }) =>
    result(async () => {
      const board = boardSchema.parse(await call(`boards/${board_id}`));
      const ids = object_ids ? new Set(object_ids) : undefined;
      const active = board.scene.elements.filter(
        (item) => !item.isDeleted && (!ids || ids.has(item.id)),
      );
      const objects = active.slice(offset, offset + limit).map((item) => ({
        id: item.id,
        type: item.type,
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        strokeColor: item.strokeColor,
        backgroundColor: item.backgroundColor,
        elbowed: item.elbowed,
        endArrowhead: item.endArrowhead,
        text: item.text,
        containerId: item.containerId,
        boundElements: item.boundElements,
        startBinding: item.startBinding,
        endBinding: item.endBinding,
        locked: item.locked,
      }));
      return {
        id: board.id,
        name: board.name,
        revision: board.revision,
        objects,
        nextOffset: offset + limit < active.length ? offset + limit : null,
        history: board.history.map(({ id, name, revision, savedAt }) => ({
          id,
          name,
          revision,
          savedAt,
        })),
      };
    }),
);

server.registerTool(
  "draw",
  {
    description:
      "Apply an undoable, atomic batch in the open native Excalidraw editor. Add labeled shapes with solid fill, free text and inline images. Connect block IDs with straight or elbow arrows, or use arrowhead:false for mind-map branches. Move sets, align/space in rows or columns and edit labels. Placement accepts world coordinates or relativeTo plus direction and gap. ID references can target objects created earlier in the same batch.",
    inputSchema: commandBatch,
    annotations: { destructiveHint: false },
  },
  (input) => result(() => call("commands", "POST", input)),
);

server.registerTool(
  "archive_board",
  {
    description:
      "Create an immutable checkpoint of the saved revision in the local history.",
    inputSchema: z.object({
      board_id: boardId,
      name: label,
      expected_revision: revision,
    }),
    annotations: { destructiveHint: false },
  },
  ({ board_id, name, expected_revision }) =>
    result(async () => {
      const value = await call(`boards/${board_id}/archive`, "POST", {
        name,
        expectedRevision: expected_revision,
      });
      return z
        .object({
          id: boardId,
          name: label,
          revision,
          savedAt: z.iso.datetime(),
        })
        .parse(value);
    }),
);

server.registerTool(
  "copy_board",
  {
    description:
      "Create an independent editable copy of a board or its archived checkpoint. The original and its images are preserved.",
    inputSchema: z.object({
      board_id: boardId,
      name: label,
      checkpoint_id: boardId.optional(),
    }),
    annotations: { destructiveHint: false },
  },
  ({ board_id, name, checkpoint_id }) =>
    result(async () => {
      const copied = boardSchema.parse(
        await call(`boards/${board_id}/duplicate`, "POST", {
          name,
          checkpointId: checkpoint_id,
        }),
      );
      return { id: copied.id, name: copied.name, revision: copied.revision };
    }),
);

await serveStdio(() => server);
