import { randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";

import { join, resolve, sep, extname } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { commandBatch } from "../board/commands";
import {
  boardId,
  label,
  maxRequestBytes,
  objectId,
  revision,
  sceneSchema,
} from "../board/scene";
import { readTracepinArchive } from "../tracepin/read-archive";

import { BoardError, BoardStore } from "./board-store";
import { CommandInbox } from "./command-inbox";
import { dataDirectory, runtimePath } from "./config";

import type { IncomingMessage, ServerResponse } from "node:http";

const host = "127.0.0.1";
const port = z.coerce
  .number()
  .int()
  .min(1024)
  .max(65535)
  .parse(process.env.EXCALIDRAW_LOCAL_PORT ?? "4320");
const authority = `${host}:${port}`;
const origin = `http://${authority}`;
const distribution = fileURLToPath(new URL("../../dist/", import.meta.url));
const token = randomBytes(32).toString("hex");
const store = new BoardStore(join(dataDirectory, "boards"));
const inbox = new CommandInbox(store);
const snapshotBody = z.object({
  expectedRevision: revision,
  scene: sceneSchema,
});

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const respond = (
  response: ServerResponse,
  value: unknown,
  status = 200,
): void => {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(value));
};

const requestBody = async (request: IncomingMessage): Promise<unknown> => {
  if (request.headers["content-type"]?.split(";")[0] !== "application/json") {
    throw new BoardError(415, "JSON attendu.");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > maxRequestBytes) {
      throw new BoardError(413, "Le tableau dépasse la taille acceptée.");
    }
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

const isMcp = (request: IncomingMessage): boolean => {
  const provided = request.headers.authorization;
  const expected = `Bearer ${token}`;
  return (
    typeof provided === "string" &&
    Buffer.byteLength(provided) === Buffer.byteLength(expected) &&
    timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  );
};

const routeApi = async (
  request: IncomingMessage,
  response: ServerResponse,
  path: string[],
): Promise<void> => {
  const mcp = isMcp(request);
  if (
    !mcp &&
    (request.headers["sec-fetch-site"] !== "same-origin" ||
      request.headers["x-excalidraw-local"] !== "1")
  ) {
    throw new BoardError(403, "Requête locale non autorisée.");
  }
  const [resource, id, action, jobId] = path;
  const method = request.method;
  if (resource === "tracepin" && method === "GET" && !mcp) {
    respond(response, await readTracepinArchive());
    return;
  }
  if (resource === "tracepin" && method === "POST" && !mcp) {
    const input = z
      .object({
        pages: z
          .array(
            z.object({
              tracepinId: boardId,
              name: label,
              scene: sceneSchema,
              archivedAt: z.iso.datetime().optional(),
            }),
          )
          .max(500),
      })
      .parse(await requestBody(request));
    const imported: string[] = [];
    for (const page of input.pages) {
      imported.push(
        (
          await store.importBoard(
            page.tracepinId,
            page.name,
            page.scene,
            page.archivedAt,
          )
        ).id,
      );
    }
    respond(response, imported);
    return;
  }
  if (resource === "commands" && method === "POST" && mcp) {
    respond(
      response,
      await inbox.submit(commandBatch.parse(await requestBody(request))),
    );
    return;
  }
  if (resource !== "boards") {
    throw new BoardError(404, "Route introuvable.");
  }
  if (!id && method === "GET") {
    respond(response, await store.list());
    return;
  }
  if (!id && method === "POST") {
    const input = z
      .object({ name: label, scene: sceneSchema.optional() })
      .parse(await requestBody(request));
    respond(response, await store.create(input.name, input.scene), 201);
    return;
  }
  const board = boardId.parse(id);
  if (!action && method === "GET") {
    respond(response, await store.read(board));
    return;
  }
  if (!action && method === "PUT" && !mcp) {
    const body = snapshotBody.parse(await requestBody(request));
    const saved = await store.save(board, body.expectedRevision, body.scene);
    respond(response, { revision: saved.revision });
    return;
  }
  if (action === "archive" && method === "POST") {
    const body = z
      .object({ name: label, expectedRevision: revision })
      .parse(await requestBody(request));
    respond(
      response,
      await store.archive(board, body.expectedRevision, body.name),
    );
    return;
  }
  if (action === "duplicate" && method === "POST") {
    const body = z
      .object({ name: label, checkpointId: boardId.optional() })
      .parse(await requestBody(request));
    respond(
      response,
      await store.duplicate(board, body.name, body.checkpointId),
      201,
    );
    return;
  }
  if (action === "commands" && !mcp && method === "GET" && !jobId) {
    respond(response, inbox.peek(board));
    return;
  }
  if (action === "commands" && !mcp && method === "POST" && jobId) {
    const body = z
      .discriminatedUnion("ok", [
        z.object({
          ok: z.literal(true),
          scene: sceneSchema,
          objectIds: z.array(objectId).max(1_000),
        }),
        z.object({ ok: z.literal(false), message: z.string().max(300) }),
      ])
      .parse(await requestBody(request));
    if (body.ok) {
      respond(
        response,
        await inbox.commit(board, jobId, body.scene, body.objectIds),
      );
    } else {
      inbox.reject(board, jobId, body.message);
      respond(response, { ok: true });
    }
    return;
  }
  throw new BoardError(404, "Route introuvable.");
};

const serve = async (
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> => {
  if (
    request.headers.host !== authority ||
    (request.headers.origin && request.headers.origin !== origin)
  ) {
    throw new BoardError(403, "Adresse locale attendue.");
  }
  const { pathname } = new URL(request.url ?? "/", origin);
  if (pathname.startsWith("/api/")) {
    await routeApi(request, response, pathname.slice(5).split("/"));
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    throw new BoardError(405, "Méthode non autorisée.");
  }
  const root = resolve(distribution);
  const file = resolve(
    root,
    `.${pathname === "/" ? "/index.html" : decodeURIComponent(pathname)}`,
  );
  if (!file.startsWith(root + sep)) {
    throw new BoardError(404, "Fichier introuvable.");
  }
  const metadata = await stat(file).catch(() => null);
  if (!metadata?.isFile()) {
    throw new BoardError(
      404,
      "Fichier introuvable. Lancez d’abord le build Excalidraw.",
    );
  }
  response.writeHead(200, {
    "Content-Type": contentTypes[extname(file)] ?? "application/octet-stream",
    "Content-Length": metadata.size,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  });
  if (request.method === "HEAD") {
    response.end();
  } else {
    createReadStream(file)
      .on("error", () => response.destroy())
      .pipe(response);
  }
};

await readFile(join(distribution, "index.html"));
await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
const server = createServer((request, response) => {
  void (async () => {
    try {
      await serve(request, response);
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      if (error instanceof BoardError) {
        respond(response, { error: error.message }, error.status);
      } else if (error instanceof z.ZodError || error instanceof SyntaxError) {
        respond(
          response,
          { error: "Données invalides ou non prises en charge." },
          400,
        );
      } else {
        console.error(
          JSON.stringify({
            event: "board_request_failed",
            code: (error as NodeJS.ErrnoException).code ?? "unknown",
          }),
        );
        respond(
          response,
          { error: "Impossible de lire ou de sauvegarder le tableau." },
          500,
        );
      }
    }
  })();
});
server.requestTimeout = 30_000;
server.once("error", (error: NodeJS.ErrnoException) => {
  console.error(
    JSON.stringify({ event: "board_listen_failed", code: error.code }),
  );
  process.exitCode = 1;
});
server.listen(port, host, () => {
  void (async () => {
    try {
      const staging = `${runtimePath}.${process.pid}.tmp`;
      await writeFile(staging, JSON.stringify({ origin, token }), {
        mode: 0o600,
        flag: "wx",
      });
      await rename(staging, runtimePath);
      process.stdout.write(`Excalidraw · ${origin}\n`);
    } catch {
      console.error(JSON.stringify({ event: "board_runtime_failed" }));
      server.close();
      process.exitCode = 1;
    }
  })();
});
