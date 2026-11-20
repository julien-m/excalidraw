/** Builds native scene objects for the directional controls on a selected shape. */
import {
  convertToExcalidrawElements,
  FONT_FAMILY,
  ROUNDNESS,
  getCommonBounds,
  newElementWith,
} from "@local/excalidraw-sdk";

import { coordinate } from "../board/scene";
import { t } from "../ui/messages";

import { bindArrow, connectionPorts, elbowPoints } from "./apply-commands";
import { readDiagramShape } from "./diagram-shapes";

import type { ExcalidrawElement } from "@local/excalidraw-sdk/element/types";

export type Direction = "left" | "up" | "down" | "right";
export type Block = Extract<
  ExcalidrawElement,
  { type: "rectangle" | "ellipse" | "diamond" }
>;

const gap = 72;
const directions: Record<Direction, readonly [number, number]> = {
  left: [-1, 0],
  up: [0, -1],
  down: [0, 1],
  right: [1, 0],
};

export const isBlock = (item: ExcalidrawElement): item is Block =>
  item.type === "rectangle" ||
  item.type === "ellipse" ||
  item.type === "diamond";

const findPlacement = (
  elements: readonly ExcalidrawElement[],
  source: Block,
  direction: Direction,
): { x: number; y: number } => {
  const [dx, dy] = directions[direction];
  const [left, top, right, bottom] = getCommonBounds([source]);
  const width = source.width;
  const height = source.height;
  const x0 =
    dx < 0 ? left - width : dx > 0 ? right : (left + right - width) / 2;
  const y0 =
    dy < 0 ? top - height : dy > 0 ? bottom : (top + bottom - height) / 2;
  const obstacles = elements
    .filter(
      (item) =>
        item.id !== source.id &&
        !item.isDeleted &&
        !(item.type === "text" && item.containerId) &&
        !["arrow", "line", "frame", "magicframe"].includes(item.type),
    )
    .map((item) => getCommonBounds([item]));
  // Try nearby parallel lanes first so the new arrow goes around any
  // obstruction between the selected shape and the next block.
  for (let distance = 0; distance < 5; distance++) {
    for (const lane of [0, 1, -1, 2, -2]) {
      const x =
        x0 +
        dx * (gap + distance * (width + gap)) +
        Math.abs(dy) * lane * (width + gap);
      const y =
        y0 +
        dy * (gap + distance * (height + gap)) +
        Math.abs(dx) * lane * (height + gap);
      if (
        !coordinate.safeParse(x).success ||
        !coordinate.safeParse(y).success
      ) {
        continue;
      }
      const { start, end, horizontal } = connectionPorts(source, {
        x,
        y,
        width,
        height,
      });
      if (horizontal !== (dx !== 0)) {
        continue;
      }
      const delta = [end[0] - start[0], end[1] - start[1]] as const;
      const points = source.angle
        ? [[0, 0], delta]
        : elbowPoints(...delta, horizontal);
      const regions = points.slice(1).map(([px, py], index) => {
        const [previousX, previousY] = points[index];
        return [
          start[0] + Math.min(previousX, px),
          start[1] + Math.min(previousY, py),
          start[0] + Math.max(previousX, px),
          start[1] + Math.max(previousY, py),
        ];
      });
      regions.push([x, y, x + width, y + height]);
      const overlaps = obstacles.some(([l, t, r, b]) =>
        regions.some(
          ([x1, y1, x2, y2]) =>
            x1 < r + 12 && x2 > l - 12 && y1 < b + 12 && y2 > t - 12,
        ),
      );
      if (!overlaps) {
        return { x, y };
      }
    }
  }
  throw new Error(t("diagram.noSpace"));
};

export const buildDiagramRoot = (
  id: string,
  position: { x: number; y: number },
): ExcalidrawElement => {
  const width = 152;
  const height = 60;
  const [block] = convertToExcalidrawElements(
    [
      {
        id,
        type: "rectangle",
        x: position.x - width / 2,
        y: position.y - height / 2,
        width,
        height,
        strokeColor: "#233348",
        backgroundColor: "#d9e8ff",
        fillStyle: "solid",
        roughness: 0,
        roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS, value: 5 },
      },
    ],
    { regenerateIds: false },
  );
  return { ...block, index: null };
};

export const buildLinkedBlock = (
  elements: readonly ExcalidrawElement[],
  source: Block,
  direction: Direction,
  id: string,
  arrowId: string,
): readonly ExcalidrawElement[] => {
  const { x, y } = findPlacement(elements, source, direction);
  const [block] = convertToExcalidrawElements(
    [
      {
        id,
        type: source.type,
        x,
        y,
        width: source.width,
        height: source.height,
        strokeColor: source.strokeColor,
        backgroundColor: source.backgroundColor,
        fillStyle: source.fillStyle,
        strokeStyle: source.strokeStyle,
        strokeWidth: source.strokeWidth,
        roughness: source.roughness,
        roundness: source.roundness,
        opacity: source.opacity,
      },
    ],
    { regenerateIds: false },
  );
  const outline = readDiagramShape(source);
  const nextBlock = outline
    ? { ...block, customData: { excalidrawLocalShape: outline } }
    : block;
  return bindArrow([...elements, nextBlock], arrowId, {
    kind: "connect",
    from: source.id,
    to: block.id,
    routing: source.angle ? "straight" : "elbow",
    color: source.strokeColor,
    head: "triangle",
  }).map((item) =>
    item.id === id || item.id === arrowId ? { ...item, index: null } : item,
  );
};

export const addBlockLabel = (
  elements: readonly ExcalidrawElement[],
  target: Block,
  text: string,
  labelId: string,
  arrowId: string,
): readonly ExcalidrawElement[] => {
  const [container, label] = convertToExcalidrawElements(
    [
      {
        id: target.id,
        type: target.type,
        x: target.x,
        y: target.y,
        width: target.width,
        height: target.height,
        strokeColor: target.strokeColor,
        label: { text, fontFamily: FONT_FAMILY.Nunito, fontSize: 20 },
      },
    ],
    { regenerateIds: false },
  );
  if (!label || label.type !== "text") {
    throw new Error(t("diagram.labelFailed"));
  }
  const labeled = elements
    .map((item) =>
      item.id === target.id
        ? newElementWith(item, {
            width: container.width,
            height: container.height,
            boundElements: [
              ...(item.boundElements ?? []),
              { id: labelId, type: "text" },
            ],
          })
        : item,
    )
    .concat({ ...label, id: labelId, index: null });

  if (container.width === target.width && container.height === target.height) {
    return labeled;
  }
  const arrow = labeled.find(
    (item) => item.id === arrowId && item.type === "arrow",
  );
  if (!arrow || arrow.type !== "arrow" || !arrow.startBinding) {
    return labeled;
  }
  // Rebuild the new connector against the grown label container so the tip
  // stays attached to its edge. Other connectors retain their geometry.
  const endpoints = new Set([arrow.startBinding.elementId, target.id]);
  const withoutArrow = labeled
    .filter((item) => item.id !== arrowId)
    .map((item) =>
      endpoints.has(item.id)
        ? newElementWith(item, {
            boundElements: item.boundElements?.filter(
              ({ id }) => id !== arrowId,
            ),
          })
        : item,
    );
  return bindArrow(withoutArrow, arrowId, {
    kind: "connect",
    from: arrow.startBinding.elementId,
    to: target.id,
    routing: "elbowed" in arrow && arrow.elbowed ? "elbow" : "straight",
    color: arrow.strokeColor,
    arrowhead: arrow.endArrowhead !== null,
    head: arrow.endArrowhead,
  }).map((item) =>
    item.id === arrowId ? { ...item, index: arrow.index } : item,
  );
};
