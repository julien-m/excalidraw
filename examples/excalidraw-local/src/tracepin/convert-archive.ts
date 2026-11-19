import {
  convertToExcalidrawElements,
  FONT_FAMILY,
  restoreElements,
} from "@local/excalidraw-sdk";

import { sceneSchema } from "../board/scene";

import type {
  ExcalidrawFreeDrawElement,
  ExcalidrawElement,
  FileId,
} from "@local/excalidraw-sdk/element/types";

import type { Scene } from "../board/scene";
import type {
  TracepinArchive,
  TracepinColor,
  TracepinPage,
  TracepinRect,
} from "./archive";

type Skeleton = NonNullable<
  Parameters<typeof convertToExcalidrawElements>[0]
>[number];

const hex = (color: TracepinColor): string =>
  `#${[color.red, color.green, color.blue]
    .map((value) =>
      Math.round(value * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

const frame = ({ origin, size }: TracepinRect) => ({ ...origin, ...size });

const importedShape = (
  item: TracepinPage["document"]["items"][number],
): ExcalidrawElement[] => {
  const {
    shape,
    style,
    id: { rawValue: id },
  } = item;
  const base = {
    id,
    strokeColor: hex(style.gradientStops?.[0] ?? style.color),
    opacity: Math.round(style.opacity * style.color.alpha * 100),
    strokeWidth: style.lineWidth,
    roughness: 0,
    angle: (((item.rotationDegrees ?? 0) * Math.PI) /
      180) as ExcalidrawElement["angle"],
    customData: { tracepin: item },
  };
  let skeleton: Skeleton;
  if ("rectangle" in shape || "ellipse" in shape) {
    const box = "rectangle" in shape ? shape.rectangle._0 : shape.ellipse._0;
    const alpha = Math.round((style.fillOpacity ?? 0) * 255)
      .toString(16)
      .padStart(2, "0");
    skeleton = {
      ...base,
      ...frame(box),
      type: "rectangle" in shape ? "rectangle" : "ellipse",
      fillStyle: "solid",
      backgroundColor: hex(style.color) + alpha,
    };
  } else if ("textBlock" in shape || "text" in shape) {
    const text = "textBlock" in shape ? shape.textBlock._0 : shape.text._0;
    const geometry = "frame" in text ? frame(text.frame) : text.origin;
    skeleton = {
      ...base,
      ...geometry,
      type: "text",
      text: text.string,
      fontSize: text.fontSize,
      fontFamily: FONT_FAMILY.Helvetica,
    };
  } else if ("image" in shape) {
    skeleton = {
      ...base,
      ...frame(shape.image._0.frame),
      type: "image",
      status: "saved",
      fileId: shape.image._0.assetID as FileId,
    };
  } else if ("freehand" in shape) {
    const first = shape.freehand.points[0];
    if (shape.freehand.points.length === 1) {
      // Excalidraw drops one-point freehand objects on restore; a filled dot preserves the click.
      const size = style.lineWidth;
      return convertToExcalidrawElements(
        [
          {
            ...base,
            type: "ellipse",
            x: first.x - size / 2,
            y: first.y - size / 2,
            width: size,
            height: size,
            backgroundColor: base.strokeColor,
            fillStyle: "solid",
            strokeWidth: 0,
          },
        ],
        { regenerateIds: false },
      );
    }
    const points = shape.freehand.points.map(
      ({ x, y }) =>
        [
          x - first.x,
          y - first.y,
        ] as unknown as ExcalidrawFreeDrawElement["points"][number],
    );
    const bounds = points.reduce(
      ({ minX, maxX, minY, maxY }, [x, y]) => ({
        minX: Math.min(minX, x),
        maxX: Math.max(maxX, x),
        minY: Math.min(minY, y),
        maxY: Math.max(maxY, y),
      }),
      { minX: 0, maxX: 0, minY: 0, maxY: 0 },
    );
    const [defaults] = convertToExcalidrawElements(
      [{ type: "rectangle", x: first.x, y: first.y, ...base }],
      { regenerateIds: false },
    );
    const stroke: ExcalidrawFreeDrawElement = {
      ...defaults,
      type: "freedraw",
      width: bounds.maxX - bounds.minX,
      height: bounds.maxY - bounds.minY,
      points,
      pressures: [],
      simulatePressure: true,
      lastCommittedPoint: null,
    };
    return [stroke];
  } else if ("line" in shape || "arrow" in shape) {
    const { start, end } =
      "line" in shape
        ? shape.line
        : { start: shape.arrow.tail, end: shape.arrow.head };
    skeleton = {
      ...base,
      ...start,
      type: "line" in shape ? "line" : "arrow",
      points: [
        [0, 0],
        [end.x - start.x, end.y - start.y],
      ] as never,
    };
  } else if ("pin" in shape) {
    const pin = shape.pin._0;
    skeleton = {
      ...base,
      ...pin.labelPosition,
      type: "text",
      text: `${pin.number}. ${pin.comment}`,
      fontFamily: FONT_FAMILY.Helvetica,
    };
  } else {
    const comment = shape.callout._0;
    skeleton = {
      ...base,
      ...comment.anchor,
      type: "text",
      text: comment.text || "Commentaire",
      fontSize: comment.fontSize,
      fontFamily: FONT_FAMILY.Helvetica,
    };
  }
  return convertToExcalidrawElements([skeleton], { regenerateIds: false });
};

/** Imports independent copies. Tracepin-specific appearance and anchors are retained in object metadata. */
export const convertArchive = (
  archive: TracepinArchive,
): { tracepinId: string; name: string; archivedAt?: string; scene: Scene }[] =>
  archive.pages.map(({ page, archivedAt }) => {
    const elements = restoreElements(
      page.document.items
        .flatMap(importedShape)
        .map((value) => ({ ...value, index: null })),
      null,
      { repairBindings: true },
    );
    const files: Scene["files"] = {};
    for (const item of elements) {
      if (item.type !== "image" || !item.fileId) {
        continue;
      }
      const image = archive.assets[item.fileId];
      if (!image) {
        throw new Error("Image Tracepin manquante.");
      }
      files[item.fileId] = {
        id: item.fileId,
        ...image,
        created: archivedAt ? Date.parse(archivedAt) : Date.now(),
      };
    }
    const background =
      "dark" in page.background
        ? "#1c1c1f"
        : "custom" in page.background
        ? hex(page.background.custom._0)
        : "#ffffff";
    return {
      tracepinId: page.id,
      name: page.name,
      archivedAt,
      scene: sceneSchema.parse({
        elements,
        files,
        appState: { viewBackgroundColor: background },
      }),
    };
  });
