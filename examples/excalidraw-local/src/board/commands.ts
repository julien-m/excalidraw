import { z } from "zod";

import {
  boardId,
  color,
  coordinate,
  dimension,
  imageData,
  objectId,
  revision,
} from "./scene";

const text = z.string().max(4_000);
const placement = z.object({
  x: coordinate.optional(),
  y: coordinate.optional(),
  width: dimension.optional(),
  height: dimension.optional(),
  relativeTo: objectId.optional(),
  direction: z.enum(["left", "right", "above", "below"]).optional(),
  gap: z.number().min(0).max(2_000).optional(),
});

export const commandSchema = z.discriminatedUnion("kind", [
  placement.extend({
    kind: z.literal("shape"),
    id: objectId.optional(),
    shape: z.enum(["rectangle", "diamond", "ellipse"]),
    text: text.optional(),
    color: color.optional(),
  }),
  placement.extend({
    kind: z.literal("text"),
    id: objectId.optional(),
    text,
    color: color.optional(),
  }),
  placement.extend({
    kind: z.literal("image"),
    id: objectId.optional(),
    dataURL: imageData,
  }),
  z.object({
    kind: z.literal("connect"),
    id: objectId.optional(),
    from: objectId,
    to: objectId,
    text: text.optional(),
  }),
  z.object({
    kind: z.literal("move"),
    ids: z.array(objectId).nonempty().max(200),
    dx: coordinate,
    dy: coordinate,
  }),
  z.object({
    kind: z.literal("arrange"),
    ids: z.array(objectId).nonempty().max(200),
    axis: z.enum(["horizontal", "vertical"]),
    gap: z.number().min(0).max(2_000).optional(),
  }),
  z.object({ kind: z.literal("setText"), id: objectId, text }),
]);

export const commandBatch = z.object({
  boardId,
  expectedRevision: revision,
  commands: z.array(commandSchema).nonempty().max(100),
});

export type BoardCommand = z.infer<typeof commandSchema>;
export type CommandBatch = z.infer<typeof commandBatch>;

export interface PendingCommand extends CommandBatch {
  id: string;
}
