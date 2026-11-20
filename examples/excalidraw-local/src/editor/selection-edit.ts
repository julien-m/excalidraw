import {
  FONT_FAMILY,
  newElementWith,
  restoreElements,
  ROUNDNESS,
} from "@local/excalidraw-sdk";

import { addBlockLabel, isBlock } from "./linked-block";
import { mindNode } from "./mind-map";

import type { DiagramShape } from "./diagram-shapes";

import type {
  Arrowhead,
  ExcalidrawTextElement,
  ExcalidrawElement,
} from "@local/excalidraw-sdk/element/types";

export type SelectionEdit =
  | { kind: "stroke" | "fill" | "text" | "note" | "icon"; value: string }
  | { kind: "strokeStyle"; value: ExcalidrawElement["strokeStyle"] }
  | {
      kind: "shape";
      value: "rectangle" | "ellipse" | "diamond";
      radius?: number;
      outline?: DiagramShape;
      circle?: boolean;
    }
  | { kind: "opacity" | "strokeWidth"; value: number }
  | { kind: "appearance"; value: "filled" | "outline" | "dashed" }
  | { kind: "rotate" | "typography" }
  | { kind: "rounded"; value: boolean }
  | { kind: "startArrowhead" | "endArrowhead"; value: Arrowhead | null };

export const selectionLabel = (
  elements: readonly ExcalidrawElement[],
  target: ExcalidrawElement,
) =>
  elements.find(
    (item) =>
      item.type === "text" &&
      !item.isDeleted &&
      (item.id === target.id || item.containerId === target.id),
  );

export const selectionIcon = (element: ExcalidrawElement): string => {
  const value: unknown = element.customData?.excalidrawLocalIcon;
  return typeof value === "string" && value.length <= 12 ? value : "";
};

export const selectionText = (
  element: ExcalidrawElement,
  text: string,
): string => {
  const icon = selectionIcon(element);
  if (icon && text === icon) {
    return "";
  }
  return icon && text.startsWith(`${icon} `)
    ? text.slice(icon.length + 1)
    : text;
};

const textWithIcon = (text: string, icon: string): string =>
  icon ? [icon, text].filter(Boolean).join(" ") : text;

const writeLabel = (
  elements: readonly ExcalidrawElement[],
  target: ExcalidrawElement,
  text: string,
  makeId: () => string,
  fontFamily?: ExcalidrawTextElement["fontFamily"],
): readonly ExcalidrawElement[] => {
  const label = selectionLabel(elements, target);
  if (label?.type === "text") {
    const changed = newElementWith(label, {
      text,
      originalText: text,
      fontFamily: fontFamily ?? label.fontFamily,
    });
    const restored = restoreElements(
      target.id === label.id ? [changed] : [target, changed],
      null,
      { refreshDimensions: true },
    ).find(({ id }) => id === label.id);
    return elements.map((item) =>
      item.id === label.id ? restored ?? changed : item,
    );
  }
  return text.trim() && isBlock(target)
    ? addBlockLabel(elements, target, text, makeId(), "")
    : elements;
};

export const selectionNote = (element: ExcalidrawElement): string => {
  const note: unknown = element.customData?.excalidrawLocalNote;
  return typeof note === "string" ? note : "";
};

export const editSelection = (
  elements: readonly ExcalidrawElement[],
  target: ExcalidrawElement,
  edit: SelectionEdit,
  makeId: () => string,
): readonly ExcalidrawElement[] => {
  const replace = (next: ExcalidrawElement): ExcalidrawElement[] =>
    elements.map((element) => (element.id === target.id ? next : element));

  switch (edit.kind) {
    case "stroke":
      return replace(newElementWith(target, { strokeColor: edit.value }));
    case "fill":
      return replace(
        newElementWith(target, {
          backgroundColor: edit.value,
          fillStyle: "solid",
        }),
      );
    case "strokeStyle":
      return replace(newElementWith(target, { strokeStyle: edit.value }));
    case "strokeWidth":
      return replace(newElementWith(target, { strokeWidth: edit.value }));
    case "appearance":
      return replace(
        newElementWith(target, {
          fillStyle: "solid",
          strokeStyle: edit.value === "dashed" ? "dashed" : "solid",
          backgroundColor:
            edit.value === "filled"
              ? target.backgroundColor === "transparent"
                ? "#d9e8ff"
                : target.backgroundColor
              : "transparent",
        }),
      );
    case "rotate":
      return replace(
        newElementWith(target, {
          angle: ((target.angle + Math.PI / 2) %
            (Math.PI * 2)) as typeof target.angle,
        }),
      );
    case "opacity":
      return replace(newElementWith(target, { opacity: edit.value }));
    case "note":
      return replace(
        newElementWith(target, {
          customData: {
            ...target.customData,
            excalidrawLocalNote: edit.value.trim(),
          },
        }),
      );
    case "shape": {
      if (!isBlock(target) || mindNode(target)) {
        return elements;
      }
      const side = Math.min(target.width, target.height);
      const circleBounds = edit.circle
        ? {
            x: target.x + (target.width - side) / 2,
            y: target.y + (target.height - side) / 2,
            width: side,
            height: side,
          }
        : {};
      return replace({
        ...newElementWith(target, {
          ...circleBounds,
          roundness: edit.radius
            ? { type: ROUNDNESS.ADAPTIVE_RADIUS, value: edit.radius }
            : null,
          customData: {
            ...target.customData,
            excalidrawLocalShape: edit.outline,
          },
        }),
        type: edit.value,
      });
    }
    case "rounded":
      return isBlock(target)
        ? replace(
            newElementWith(target, {
              roundness: edit.value
                ? { type: ROUNDNESS.ADAPTIVE_RADIUS }
                : null,
            }),
          )
        : elements;
    case "startArrowhead":
      return target.type === "arrow"
        ? replace(newElementWith(target, { startArrowhead: edit.value }))
        : elements;
    case "endArrowhead":
      return target.type === "arrow"
        ? replace(newElementWith(target, { endArrowhead: edit.value }))
        : elements;
    case "text":
      return writeLabel(
        elements,
        target,
        textWithIcon(edit.value, selectionIcon(target)),
        makeId,
      );
    case "typography": {
      const label = selectionLabel(elements, target);
      return label?.type === "text"
        ? writeLabel(
            elements,
            target,
            label.originalText,
            makeId,
            FONT_FAMILY.Nunito,
          )
        : elements;
    }
    case "icon": {
      const existing = selectionLabel(elements, target);
      const currentText =
        existing?.type === "text" ? existing.originalText : "";
      const icon = edit.value.slice(0, 12);
      const next = newElementWith(target, {
        customData: { ...target.customData, excalidrawLocalIcon: icon },
      });
      return writeLabel(
        replace(next),
        next,
        textWithIcon(selectionText(target, currentText), icon),
        makeId,
      );
    }
  }
};
