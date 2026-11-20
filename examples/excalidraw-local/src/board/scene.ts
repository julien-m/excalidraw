import { z } from "zod";

export const objectId = z.string().min(1).max(128);
export const boardId = z.uuid();
export const revision = z.number().int().nonnegative().safe();
export const label = z.string().trim().min(1).max(180);
export const coordinate = z.number().finite().min(-1_000_000).max(1_000_000);
export const dimension = z.number().positive().max(20_000);
export const color = z.string().regex(/^#[a-f0-9]{6}$/i);
export const imageData = z
  .string()
  .regex(/^data:image\/(png|jpeg|gif|webp|avif);base64,[A-Za-z0-9+/]+={0,2}$/);
export const maxRequestBytes = 128 * 1024 * 1024;
export const maxSceneElements = 10_000;

const element = z.looseObject({
  id: objectId,
  type: z.enum([
    "rectangle",
    "diamond",
    "ellipse",
    "text",
    "line",
    "arrow",
    "freedraw",
    "image",
    "frame",
    "magicframe",
    "embeddable",
    "iframe",
  ]),
  x: coordinate,
  y: coordinate,
  width: dimension.or(z.literal(0)),
  height: dimension.or(z.literal(0)),
  isDeleted: z.boolean().optional(),
  fileId: objectId.nullable().optional(),
});

const file = z.looseObject({
  id: objectId,
  dataURL: imageData,
  mimeType: z.string(),
  created: z.number().finite(),
});

export const sceneSchema = z
  .object({
    elements: z.array(element).max(maxSceneElements),
    appState: z.object({
      viewBackgroundColor: color,
      scrollX: coordinate.optional(),
      scrollY: coordinate.optional(),
      zoom: z.object({ value: z.number().min(0.1).max(30) }).optional(),
    }),
    files: z.record(objectId, file),
  })
  .superRefine((scene, context) => {
    const ids = new Set<string>();
    for (const item of scene.elements) {
      if (ids.has(item.id)) {
        context.addIssue({
          code: "custom",
          message: "Identifiant d’objet dupliqué.",
        });
      }
      ids.add(item.id);
      if (
        item.type === "image" &&
        !item.isDeleted &&
        (!item.fileId || !Object.hasOwn(scene.files, item.fileId))
      ) {
        context.addIssue({
          code: "custom",
          message: "Image introuvable dans la scène.",
        });
      }
    }
    for (const [id, entry] of Object.entries(scene.files)) {
      if (
        id !== entry.id ||
        !entry.dataURL.startsWith(`data:${entry.mimeType};base64,`)
      ) {
        context.addIssue({
          code: "custom",
          message: "Identité ou format d’image incohérent.",
        });
      }
    }
  });

export type Scene = z.infer<typeof sceneSchema>;

export const emptyScene: Scene = {
  elements: [],
  appState: { viewBackgroundColor: "#ffffff" },
  files: {},
};

const checkpointSchema = z.object({
  id: boardId,
  name: label,
  revision,
  savedAt: z.iso.datetime(),
  scene: sceneSchema,
});

export const boardSchema = z.object({
  formatVersion: z.literal(1),
  id: boardId,
  name: label,
  revision,
  updatedAt: z.iso.datetime(),
  scene: sceneSchema,
  history: z.array(checkpointSchema),
  tracepinId: boardId.optional(),
});

/**
 * A board moved to the trash keeps its whole record, history included. The deletion time
 * is written just after the atomic move and can be missing if that write was interrupted.
 */
export const trashedBoardSchema = boardSchema.extend({
  deletedAt: z.iso.datetime().optional(),
});

// Library items come from third-party `.excalidrawlib` files. Only the fields the
// store relies on are checked; the SDK restores and normalizes the elements on load.
const libraryElement = z.looseObject({
  id: objectId,
  type: z.string().min(1).max(64),
});

// 5 000 items and 10 000 elements per item stay far above public libraries
// (the largest have a few hundred items) while bounding a corrupted file.
export const libraryItemSchema = z.looseObject({
  id: objectId,
  status: z.enum(["published", "unpublished"]),
  created: z.number().finite(),
  name: z.string().max(500).optional(),
  elements: z.array(libraryElement).min(1).max(10_000),
});

export const librarySchema = z.object({
  libraryItems: z.array(libraryItemSchema).max(5_000),
});

/** Changes one editor made relative to the library it last loaded or saved. */
export const libraryChangesSchema = z.object({
  upsert: z.array(libraryItemSchema).max(5_000),
  remove: z.array(objectId).max(5_000),
});

export type Board = z.infer<typeof boardSchema>;
export type TrashedBoard = z.infer<typeof trashedBoardSchema>;
export type Checkpoint = z.infer<typeof checkpointSchema>;
export type Library = z.infer<typeof librarySchema>;
export type LibraryChanges = z.infer<typeof libraryChangesSchema>;
export type BoardSummary = Pick<
  Board,
  "id" | "name" | "revision" | "updatedAt" | "tracepinId"
> & { versions: number };
export type TrashedBoardSummary = Pick<
  TrashedBoard,
  "id" | "name" | "tracepinId"
> & { deletedAt: string; versions: number };
