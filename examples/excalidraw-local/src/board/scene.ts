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
    elements: z.array(element).max(10_000),
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

export type Board = z.infer<typeof boardSchema>;
export type Checkpoint = z.infer<typeof checkpointSchema>;
export type BoardSummary = Pick<
  Board,
  "id" | "name" | "revision" | "updatedAt" | "tracepinId"
>;
