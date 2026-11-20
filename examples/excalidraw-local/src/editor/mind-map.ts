/** Creates editable mind-map nodes and lays out the affected tree to the right of its root. */
import {
  convertToExcalidrawElements,
  newElementWith,
  ROUNDNESS,
} from "@local/excalidraw-sdk";

import { t } from "../ui/messages";

import { bindArrow, relocate } from "./apply-commands";
import { isBlock } from "./linked-block";

import type { ExcalidrawElement } from "@local/excalidraw-sdk/element/types";

import type { Block } from "./linked-block";

const dataKey = "excalidrawLocalMindNode";
const colors = ["#dee8ff", "#d4f2e8", "#f5e4fb", "#fff0cc"];
const nodeWidth = 160;
const nodeHeight = 56;
const rowGap = 28;
const columnGap = 112;

export type BranchRelation = "child" | "sibling";

export type MindMapSubject =
  | { position: { x: number; y: number } }
  | { sourceId: string; relation: BranchRelation };

export interface BlockIds {
  blockId: string;
  labelId: string;
  arrowId: string;
}

interface MindNode {
  nodeId: string;
  rootId: string;
  parentId: string | null;
  edgeId: string | null;
}

export const mindNode = (element: ExcalidrawElement): MindNode | undefined => {
  const data: unknown = element.customData?.[dataKey];
  if (!isBlock(element) || typeof data !== "object" || !data) {
    return;
  }
  const properties = data as Partial<MindNode>;
  if (
    properties.nodeId === element.id &&
    typeof properties.rootId === "string" &&
    ((properties.rootId === element.id &&
      properties.parentId === null &&
      properties.edgeId === null) ||
      (properties.rootId !== element.id &&
        typeof properties.parentId === "string" &&
        properties.parentId !== element.id &&
        typeof properties.edgeId === "string"))
  ) {
    return properties as MindNode;
  }
};

const makeNode = (
  node: MindNode,
  x: number,
  y: number,
  fill: string,
): ExcalidrawElement => {
  const [shape] = convertToExcalidrawElements(
    [
      {
        id: node.nodeId,
        type: "rectangle",
        x,
        y,
        width: nodeWidth,
        height: nodeHeight,
        strokeColor: "#354465",
        backgroundColor: fill,
        fillStyle: "solid",
        roughness: 0,
        roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS },
      },
    ],
    { regenerateIds: false },
  );
  return { ...shape, index: null, customData: { [dataKey]: node } };
};

interface Entry {
  element: Block;
  node: MindNode;
  children: Entry[];
  depth: number;
  height: number;
}

const treeEntries = (
  elements: readonly ExcalidrawElement[],
  rootId: string,
): Map<string, Entry> => {
  const entries = new Map<string, Entry>();
  for (const element of elements) {
    const node = mindNode(element);
    if (!element.isDeleted && node?.rootId === rootId && isBlock(element)) {
      entries.set(element.id, {
        element,
        node,
        children: [],
        depth: 0,
        height: element.height,
      });
    }
  }
  for (const entry of entries.values()) {
    if (entry.node.parentId) {
      entries.get(entry.node.parentId)?.children.push(entry);
    }
  }
  return entries;
};

const findTreeRoot = (
  entries: Map<string, Entry>,
  sourceId: string,
): Entry | undefined => {
  let entry = entries.get(sourceId);
  const visited = new Set<string>();
  while (entry && !visited.has(entry.element.id)) {
    const parent = entry.node.parentId
      ? entries.get(entry.node.parentId)
      : undefined;
    if (!parent) {
      return entry;
    }
    visited.add(entry.element.id);
    entry = parent;
  }
};

const positionTree = (root: Entry): Map<string, Entry> => {
  const order = [root];
  const widths: number[] = [];
  const positions = new Map<string, Entry>();
  for (const entry of order) {
    widths[entry.depth] = Math.max(
      widths[entry.depth] ?? 0,
      entry.element.width,
    );
    for (const child of entry.children) {
      child.depth = entry.depth + 1;
      order.push(child);
    }
  }
  for (const entry of [...order].reverse()) {
    const childrenHeight = entry.children.reduce(
      (sum, child) => sum + child.height,
      0,
    );
    entry.height = Math.max(
      entry.element.height,
      childrenHeight + Math.max(0, entry.children.length - 1) * rowGap,
    );
  }
  const columns = [root.element.x];
  for (const [index, width] of widths.entries()) {
    columns.push(columns[index] + width + columnGap);
  }
  for (const entry of order) {
    positions.set(entry.element.id, entry);
    const span = entry.children.reduce(
      (sum, child) => sum + child.height + rowGap,
      -rowGap,
    );
    let top = entry.element.y + (entry.element.height - span) / 2;
    for (const child of entry.children) {
      const x = columns[child.depth];
      const y = Math.round(top + (child.height - child.element.height) / 2);
      if (child.element.x !== x || child.element.y !== y) {
        child.element = newElementWith(child.element, { x, y });
      }
      top += child.height + rowGap;
    }
  }
  return positions;
};

/** Updates positions and bound edges while keeping original shape and connector IDs. */
export const layoutMindMap = (
  elements: readonly ExcalidrawElement[],
  subject: MindNode,
): readonly ExcalidrawElement[] => {
  const root = findTreeRoot(
    treeEntries(elements, subject.rootId),
    subject.nodeId,
  );
  if (!root) {
    return elements;
  }
  const positioned = positionTree(root);
  const byId = new Map(elements.map((element) => [element.id, element]));
  const additions: ExcalidrawElement[] = [];
  const replacements = new Map<string, ExcalidrawElement>();
  for (const { element: child, node } of positioned.values()) {
    const parent = node.parentId
      ? positioned.get(node.parentId)?.element
      : undefined;
    if (!parent || !node.edgeId) {
      continue;
    }
    const existing = byId.get(node.edgeId);
    if (existing?.isDeleted) {
      continue;
    }
    const [linkedParent, linkedChild, edge] = bindArrow(
      [parent, child],
      node.edgeId,
      {
        kind: "connect",
        from: parent.id,
        to: child.id,
        routing: "elbow",
        arrowhead: false,
        color: "#596ab3",
      },
      true,
    );
    for (const source of [linkedParent, linkedChild]) {
      const target = positioned.get(source.id);
      if (target && isBlock(source)) {
        const bindings = source.boundElements?.filter(
          ({ id }, i, all) => all.findIndex((other) => other.id === id) === i,
        );
        target.element = { ...source, boundElements: bindings ?? null };
      }
    }
    if (existing && existing.type === "arrow" && edge.type === "arrow") {
      replacements.set(
        existing.id,
        newElementWith(existing, {
          x: edge.x,
          y: edge.y,
          points: edge.points,
          width: edge.width,
          height: edge.height,
          startBinding: edge.startBinding,
          endBinding: edge.endBinding,
          endArrowhead: edge.endArrowhead,
        }),
      );
    } else if (!existing) {
      additions.push({ ...edge, index: null });
    }
  }
  const moves = new Map<string, { x: number; y: number }>();
  for (const { element } of positioned.values()) {
    const original = byId.get(element.id);
    if (original && (original.x !== element.x || original.y !== element.y)) {
      moves.set(element.id, {
        x: element.x - original.x,
        y: element.y - original.y,
      });
    }
  }
  const translated = moves.size ? relocate(elements, moves) : elements;
  return translated
    .map(
      (element) =>
        positioned.get(element.id)?.element ??
        replacements.get(element.id) ??
        element,
    )
    .concat(additions);
};

export const startMindMap = (
  elements: readonly ExcalidrawElement[],
  ids: BlockIds,
  position: { x: number; y: number },
): readonly ExcalidrawElement[] => [
  ...elements,
  makeNode(
    {
      nodeId: ids.blockId,
      rootId: ids.blockId,
      parentId: null,
      edgeId: null,
    },
    position.x - nodeWidth / 2,
    position.y - nodeHeight / 2,
    "#d9ddff",
  ),
];

export const addMindBranch = (
  elements: readonly ExcalidrawElement[],
  ids: BlockIds,
  sourceId: string,
  relation: BranchRelation,
): readonly ExcalidrawElement[] => {
  const source = elements.find(
    ({ id, isDeleted }) => id === sourceId && !isDeleted,
  );
  const node = source && mindNode(source);
  if (!source || !node || source.locked) {
    throw new Error(t("mind.disconnected"));
  }
  const entries = treeEntries(elements, node.rootId);
  if (!findTreeRoot(entries, sourceId)) {
    throw new Error(t("mind.disconnected"));
  }
  const parent =
    relation === "sibling" && node.parentId
      ? entries.get(node.parentId)
      : undefined;
  const parentId = parent?.element.id ?? sourceId;
  const siblings = entries.get(parentId)?.children ?? [];
  const newNode = makeNode(
    { nodeId: ids.blockId, rootId: node.rootId, parentId, edgeId: ids.arrowId },
    source.x,
    source.y,
    colors[siblings.length % colors.length],
  );
  const index = parent ? elements.indexOf(source) + 1 : elements.length;
  return layoutMindMap(
    [...elements.slice(0, index), newNode, ...elements.slice(index)],
    node,
  );
};
