import {
  convertToExcalidrawElements,
  FONT_FAMILY,
  newElementWith,
  restoreElements,
} from "@local/excalidraw-sdk";

import type {
  ExcalidrawElement,
  OrderedExcalidrawElement,
  ExcalidrawLinearElement,
  ExcalidrawArrowElement,
  ExcalidrawElbowArrowElement,
} from "@local/excalidraw-sdk/element/types";
import type { BinaryFiles } from "@local/excalidraw-sdk/types";

import type { BoardCommand } from "../board/commands";

type Skeleton = NonNullable<
  Parameters<typeof convertToExcalidrawElements>[0]
>[number];
type Point = readonly [number, number];
type BindingPort = NonNullable<
  ExcalidrawElbowArrowElement["startBinding"]
>["fixedPoint"];
type Connection = Extract<BoardCommand, { kind: "connect" }>;
interface Delta {
  x: number;
  y: number;
}
interface CommandResult {
  elements: readonly OrderedExcalidrawElement[];
  files: BinaryFiles;
  objectIds: string[];
}

const layout = {
  width: 192,
  height: 96,
  gap: 48,
  textWidth: 240,
  textHeight: 32,
} as const;
const stroke = "#233348";

/** Returns the native connector path relative to its first binding. */
export const elbowPoints = (
  dx: number,
  dy: number,
  horizontal: boolean,
): Point[] => {
  if (!dx || !dy) {
    return [
      [0, 0],
      [dx, dy],
    ];
  }
  return horizontal
    ? [
        [0, 0],
        [dx / 2, 0],
        [dx / 2, dy],
        [dx, dy],
      ]
    : [
        [0, 0],
        [0, dy / 2],
        [dx, dy / 2],
        [dx, dy],
      ];
};

type BlockBounds = Pick<ExcalidrawElement, "x" | "y" | "width" | "height">;

/** Finds opposing ports for a pair of flowchart blocks. */
export const connectionPorts = (
  from: BlockBounds,
  to: BlockBounds,
  horizontal = Math.abs(to.x - from.x) >= Math.abs(to.y - from.y),
) => {
  const ahead = horizontal ? to.x >= from.x : to.y >= from.y;
  const port = (side: number): BindingPort =>
    (horizontal ? [side, 0.5] : [0.5, side]) as BindingPort;
  const startPort = port(ahead ? 1 : 0);
  const endPort = port(ahead ? 0 : 1);
  const start: Point = [
    from.x + from.width * startPort[0],
    from.y + from.height * startPort[1],
  ];
  const end: Point = [
    to.x + to.width * endPort[0],
    to.y + to.height * endPort[1],
  ];
  return { start, end, startPort, endPort, horizontal };
};

const getElement = (
  elements: readonly ExcalidrawElement[],
  id: string,
): ExcalidrawElement => {
  const item = elements.find(
    (element) => !element.isDeleted && element.id === id,
  );
  if (!item) {
    throw new Error(`Objet introuvable (${id}).`);
  }
  return item;
};

const position = (
  elements: readonly ExcalidrawElement[],
  command: Extract<BoardCommand, { kind: "shape" | "text" | "image" }>,
  width: number,
  height: number,
): Delta => {
  if (!command.relativeTo) {
    return { x: command.x ?? 0, y: command.y ?? 0 };
  }
  if (command.x !== undefined || command.y !== undefined) {
    throw new Error("Choisissez des coordonnées ou un placement relatif.");
  }
  const item = getElement(elements, command.relativeTo);
  const gap = command.gap ?? layout.gap;
  switch (command.direction ?? "right") {
    case "left":
      return { x: item.x - width - gap, y: item.y };
    case "above":
      return { x: item.x, y: item.y - height - gap };
    case "below":
      return { x: item.x, y: item.y + item.height + gap };
    case "right":
      return { x: item.x + item.width + gap, y: item.y };
  }
};

const translateArrow = (
  arrow: ExcalidrawArrowElement | ExcalidrawLinearElement,
  moves: ReadonlyMap<string, Delta>,
  elements: ReadonlyMap<string, ExcalidrawElement>,
): ExcalidrawArrowElement | ExcalidrawLinearElement => {
  const from = (arrow.startBinding &&
    moves.get(arrow.startBinding.elementId)) || { x: 0, y: 0 };
  const to = (arrow.endBinding && moves.get(arrow.endBinding.elementId)) || {
    x: 0,
    y: 0,
  };
  if (!from.x && !from.y && !to.x && !to.y) {
    return arrow;
  }
  if (from.x === to.x && from.y === to.y) {
    return newElementWith(arrow, { x: arrow.x + from.x, y: arrow.y + from.y });
  }
  const elbowed = "elbowed" in arrow && arrow.elbowed;
  if (elbowed && arrow.startBinding && arrow.endBinding) {
    const startShape = elements.get(arrow.startBinding.elementId);
    const endShape = elements.get(arrow.endBinding.elementId);
    if (startShape && endShape) {
      const { start, end, startPort, endPort, horizontal } = connectionPorts(
        startShape,
        endShape,
      );
      const dx = end[0] - start[0];
      const dy = end[1] - start[1];
      return newElementWith(arrow as ExcalidrawElbowArrowElement, {
        x: start[0],
        y: start[1],
        width: Math.abs(dx),
        height: Math.abs(dy),
        points: elbowPoints(
          dx,
          dy,
          horizontal,
        ) as unknown as typeof arrow.points,
        startBinding: { ...arrow.startBinding, fixedPoint: startPort },
        endBinding: { ...arrow.endBinding, fixedPoint: endPort },
        fixedSegments: null,
        startIsSpecial: null,
        endIsSpecial: null,
      });
    }
  }
  const first = arrow.points[0];
  const last = arrow.points.at(-1);
  if (!first || !last) {
    return arrow;
  }
  const endX = last[0] + to.x - from.x;
  const endY = last[1] + to.y - from.y;
  const points = elbowed
    ? (elbowPoints(
        endX,
        endY,
        arrow.points[1]?.[1] === first[1],
      ) as unknown as typeof arrow.points)
    : arrow.points.map((point, index) => {
        const progress = index / (arrow.points.length - 1);
        return [
          point[0] + (to.x - from.x) * progress,
          point[1] + (to.y - from.y) * progress,
        ] as unknown as typeof point;
      });
  return newElementWith(arrow, {
    x: arrow.x + from.x,
    y: arrow.y + from.y,
    points,
    width: Math.abs(endX - first[0]),
    height: Math.abs(endY - first[1]),
    ...(elbowed ? { fixedSegments: null } : {}),
  });
};

export const relocate = (
  elements: readonly ExcalidrawElement[],
  moves: ReadonlyMap<string, Delta>,
): ExcalidrawElement[] => {
  const translated = elements.map((item) => {
    if (item.isDeleted) {
      return item;
    }
    const inherited =
      item.type === "text" && item.containerId
        ? moves.get(item.containerId)
        : undefined;
    const delta = moves.get(item.id) ?? inherited;
    if (delta) {
      return newElementWith(item, { x: item.x + delta.x, y: item.y + delta.y });
    }
    return item;
  });
  const byId = new Map(translated.map((item) => [item.id, item]));
  return translated.map((item) =>
    item.type === "arrow" && !item.isDeleted
      ? translateArrow(item, moves, byId)
      : item,
  );
};

/** Appends an SDK arrow and writes the reciprocal bindings on both endpoint shapes. */
export const bindArrow = (
  elements: readonly ExcalidrawElement[],
  id: string,
  {
    from: fromId,
    to: toId,
    text,
    color,
    routing,
    arrowhead,
    head,
  }: Connection & { head?: ExcalidrawArrowElement["endArrowhead"] },
  horizontalRoute?: boolean,
): ExcalidrawElement[] => {
  const from = getElement(elements, fromId);
  const to = getElement(elements, toId);
  const shape = (item: ExcalidrawElement): Skeleton => {
    if (
      item.type !== "rectangle" &&
      item.type !== "ellipse" &&
      item.type !== "diamond"
    ) {
      throw new Error("Reliez deux rectangles, losanges ou ellipses.");
    }
    const { type, id: elementId, x, y, width, height, angle } = item;
    return { type, id: elementId, x, y, width, height, angle };
  };
  if (from.id === to.id) {
    throw new Error("Choisissez deux blocs distincts.");
  }
  const { start, end, startPort, endPort, horizontal } = connectionPorts(
    from,
    to,
    horizontalRoute,
  );
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const elbowed = routing === "elbow";
  const generated = convertToExcalidrawElements(
    [
      shape(from),
      shape(to),
      {
        id,
        type: "arrow",
        x: start[0],
        y: start[1],
        roughness: 0,
        strokeColor: color ?? stroke,
        points: (elbowed
          ? elbowPoints(dx, dy, horizontal)
          : [
              [0, 0],
              [dx, dy],
            ]) as never,
        start: { id: from.id },
        end: { id: to.id },
        label: text ? { text, fontFamily: FONT_FAMILY.Helvetica } : undefined,
      },
    ],
    { regenerateIds: false },
  );
  const next = elements.map((item) => {
    if (item.id !== fromId && item.id !== toId) {
      return item;
    }
    return newElementWith(item, {
      boundElements: [...(item.boundElements ?? []), { id, type: "arrow" }],
    });
  });
  return next.concat(
    generated
      .filter((item) => item.id !== fromId && item.id !== toId)
      .map((item) => {
        if (item.type !== "arrow") {
          return item;
        }
        const endArrowhead =
          arrowhead === false ? null : head ?? item.endArrowhead;
        if (!elbowed || !item.startBinding || !item.endBinding) {
          return newElementWith(item, { endArrowhead });
        }
        // SDK 0.18 converts the bound skeleton as a straight arrow. Supply
        // the native elbow binding ports explicitly, in coordinates of each shape.
        const arrow: ExcalidrawElbowArrowElement = {
          ...item,
          type: "arrow",
          elbowed: true,
          endArrowhead,
          startBinding: {
            ...item.startBinding,
            fixedPoint: startPort,
          },
          endBinding: { ...item.endBinding, fixedPoint: endPort },
          fixedSegments: null,
          startIsSpecial: null,
          endIsSpecial: null,
        };
        return arrow;
      }),
  );
};

const addImage = async (
  dataURL: string,
): Promise<{ width: number; height: number }> => {
  const separator = dataURL.indexOf(",");
  const bytes = Uint8Array.from(
    atob(dataURL.slice(separator + 1)),
    (character) => character.charCodeAt(0),
  );
  const blob = new Blob([bytes], {
    type: dataURL.slice(5, dataURL.indexOf(";")),
  });
  const image = await createImageBitmap(blob);
  const size = { width: image.width, height: image.height };
  image.close();
  return size;
};

/** Compiles one validated command batch using the editor SDK and preserves existing scene identities. */
export const applyCommands = async (
  original: readonly ExcalidrawElement[],
  imageFiles: BinaryFiles,
  commands: readonly BoardCommand[],
): Promise<CommandResult> => {
  let elements = [...original];
  const files = { ...imageFiles };
  const ids = new Set<string>();
  for (const command of commands) {
    if (command.kind === "move" || command.kind === "arrange") {
      const current = elements;
      const selected = [...new Set(command.ids)].map((id) =>
        getElement(current, id),
      );
      if (
        selected.some(
          (item) =>
            item.locked ||
            item.type === "arrow" ||
            (item.type === "text" && item.containerId),
        )
      ) {
        throw new Error(
          "Sélectionnez des objets déverrouillés qui ne dépendent pas d’un autre bloc.",
        );
      }
      const moves = new Map<string, Delta>();
      let x = Math.min(...selected.map((item) => item.x));
      let y = Math.min(...selected.map((item) => item.y));
      for (const item of selected) {
        const delta =
          command.kind === "move"
            ? { x: command.dx, y: command.dy }
            : { x: x - item.x, y: y - item.y };
        moves.set(item.id, delta);
        ids.add(item.id);
        if (command.kind === "arrange") {
          const gap = command.gap ?? layout.gap;
          if (command.axis === "horizontal") {
            x += item.width + gap;
          } else {
            y += item.height + gap;
          }
        }
      }
      elements = relocate(elements, moves);
      continue;
    }
    if (command.kind === "setText") {
      const target = getElement(elements, command.id);
      const textId =
        target.type === "text"
          ? target.id
          : target.boundElements?.find((item) => item.type === "text")?.id;
      if (!textId || target.locked) {
        throw new Error(
          "L’objet doit avoir un libellé éditable et être déverrouillé.",
        );
      }
      elements = elements.map((item) =>
        item.id === textId && item.type === "text"
          ? newElementWith(item, {
              text: command.text,
              originalText: command.text,
            })
          : item,
      );
      ids.add(target.id);
      continue;
    }
    const id = command.id ?? crypto.randomUUID();
    if (elements.some((item) => item.id === id)) {
      throw new Error(`Cet identifiant est déjà utilisé (${id}).`);
    }
    ids.add(id);
    if (command.kind === "connect") {
      elements = bindArrow(elements, id, command);
      continue;
    }
    let skeleton: Skeleton;
    if (command.kind === "image") {
      const size = await addImage(command.dataURL);
      const width = command.width ?? Math.min(size.width, 640);
      const height = command.height ?? (width * size.height) / size.width;
      const fileId = crypto.randomUUID() as keyof BinaryFiles &
        import("@local/excalidraw-sdk/element/types").FileId;
      files[fileId] = {
        id: fileId,
        dataURL: command.dataURL as BinaryFiles[string]["dataURL"],
        mimeType: command.dataURL.slice(
          5,
          command.dataURL.indexOf(";"),
        ) as BinaryFiles[string]["mimeType"],
        created: Date.now(),
      };
      skeleton = {
        type: "image",
        id,
        fileId,
        status: "saved",
        width,
        height,
        ...position(elements, command, width, height),
      };
    } else if (command.kind === "shape") {
      const width = command.width ?? layout.width;
      const height = command.height ?? layout.height;
      skeleton = {
        type: command.shape,
        id,
        width,
        height,
        roughness: 0,
        strokeColor: command.color ?? stroke,
        backgroundColor: command.fill,
        fillStyle: command.fill ? "solid" : undefined,
        label: command.text
          ? { text: command.text, fontFamily: FONT_FAMILY.Helvetica }
          : undefined,
        ...position(elements, command, width, height),
      };
    } else {
      skeleton = {
        type: "text",
        id,
        text: command.text,
        fontFamily: FONT_FAMILY.Helvetica,
        strokeColor: command.color ?? stroke,
        ...position(
          elements,
          command,
          command.width ?? layout.textWidth,
          command.height ?? layout.textHeight,
        ),
      };
    }
    elements.push(
      ...convertToExcalidrawElements([skeleton], { regenerateIds: false }),
    );
  }
  // Incoming elements each have their own indices; normalize them once in final stacking order.
  const restored = restoreElements(
    elements.map((item) => ({ ...item, index: null })),
    null,
    { repairBindings: true, refreshDimensions: true },
  );
  return { elements: restored, files, objectIds: [...ids] };
};
