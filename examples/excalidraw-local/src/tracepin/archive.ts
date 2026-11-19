import { z } from "zod";

const point = z.object({ x: z.number().finite(), y: z.number().finite() });
const rect = z.object({
  origin: point,
  size: z.object({ width: z.number().finite(), height: z.number().finite() }),
});
const rgba = z.object({
  red: z.number().min(0).max(1),
  green: z.number().min(0).max(1),
  blue: z.number().min(0).max(1),
  alpha: z.number().min(0).max(1),
});
const payload = <T extends z.ZodType>(schema: T) => z.object({ _0: schema });
const shape = z.union([
  z.strictObject({ freehand: z.object({ points: z.array(point).min(1) }) }),
  z.strictObject({ line: z.object({ start: point, end: point }) }),
  z.strictObject({ arrow: z.object({ tail: point, head: point }) }),
  z.strictObject({ rectangle: payload(rect) }),
  z.strictObject({ ellipse: payload(rect) }),
  z.strictObject({
    text: payload(
      z.object({
        origin: point,
        string: z.string(),
        fontSize: z.number().positive(),
      }),
    ),
  }),
  z.strictObject({
    textBlock: payload(
      z.object({
        frame: rect,
        string: z.string(),
        fontSize: z.number().positive(),
        fixedHeight: z.boolean().optional(),
        fontFamily: z.string().optional(),
      }),
    ),
  }),
  z.strictObject({
    image: payload(
      z.object({ frame: rect, assetID: z.string().regex(/^[a-f0-9]{64}$/) }),
    ),
  }),
  z.strictObject({
    pin: payload(
      z.object({
        number: z.number().int(),
        target: point,
        labelPosition: point,
        comment: z.string(),
      }),
    ),
  }),
  z.strictObject({
    callout: payload(
      z.object({
        anchor: point,
        bubble: rect,
        text: z.string(),
        fontSize: z.number().positive(),
      }),
    ),
  }),
]);
const page = z.object({
  id: z.uuid(),
  name: z.string(),
  background: z.union([
    z.strictObject({ white: z.object({}) }),
    z.strictObject({ dark: z.object({}) }),
    z.strictObject({ custom: payload(rgba) }),
  ]),
  document: z.object({
    items: z
      .array(
        z.object({
          id: z.object({ rawValue: z.uuid() }),
          shape,
          style: z.object({
            color: rgba,
            lineWidth: z.number().positive(),
            opacity: z.number().min(0).max(1),
            fillOpacity: z.number().min(0).max(1).optional(),
            gradientStops: z.array(rgba).optional(),
          }),
          rotationDegrees: z.number().finite().optional(),
        }),
      )
      .max(10_000),
  }),
});
// Foundation's deferred date format stores seconds since the 2001 reference date.
const archivedDate = z.union([
  z.iso.datetime({ offset: true }),
  z
    .number()
    .finite()
    .transform((seconds) =>
      new Date(Date.UTC(2001, 0, 1) + seconds * 1_000).toISOString(),
    ),
]);

const archive = z.object({
  formatVersion: z.union([z.literal(1), z.literal(2)]),
  collection: z.object({
    pages: z.array(page).max(500),
    history: z
      .array(z.object({ page, archivedAt: archivedDate }))
      .max(500)
      .default([]),
  }),
  assets: z.record(
    z.string().regex(/^[a-f0-9]{64}$/),
    z.object({ typeIdentifier: z.string() }),
  ),
});

export const parseTracepinArchive = (value: unknown): z.infer<typeof archive> =>
  archive.parse(value);
export type TracepinPage = z.infer<typeof page>;
export type TracepinColor = z.infer<typeof rgba>;
export type TracepinRect = z.infer<typeof rect>;
export interface TracepinArchive {
  pages: { page: TracepinPage; archivedAt?: string }[];
  assets: Record<string, { dataURL: string; mimeType: string }>;
}
