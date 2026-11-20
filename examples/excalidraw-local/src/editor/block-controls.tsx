/** Projects diagram controls from scene units into the editor's local viewport. */
import {
  getCommonBounds,
  sceneCoordsToViewportCoords,
} from "@local/excalidraw-sdk";

import { useId, useLayoutEffect, useRef, useState } from "react";

import { PlusIcon } from "../ui/icons";
import { t } from "../ui/messages";

import { isBlock } from "./linked-block";
import { mindNode } from "./mind-map";
import { selectionLabel, selectionText } from "./selection-edit";

import type { ExcalidrawElement } from "@local/excalidraw-sdk/element/types";
import type { AppState } from "@local/excalidraw-sdk/types";
import type { CSSProperties, KeyboardEvent, ReactElement } from "react";

import type { Direction } from "./linked-block";
import type { BranchRelation } from "./mind-map";

export interface BlockProjection {
  id: string;
  element: ExcalidrawElement;
  version: number;
  text?: string;
  canExtend: boolean;
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  viewportHeight: number;
  resizing: boolean;
  mindMap: boolean;
  theme: AppState["theme"];
}

export const projectSelection = (
  elements: readonly ExcalidrawElement[],
  state: AppState,
): BlockProjection | null => {
  if (
    state.activeTool.type !== "selection" ||
    state.viewModeEnabled ||
    state.editingTextElement ||
    state.selectedElementsAreBeingDragged ||
    state.selectionElement ||
    state.isRotating ||
    state.openMenu
  ) {
    return null;
  }
  const selected = Object.keys(state.selectedElementIds).filter(
    (id) => state.selectedElementIds[id],
  );
  const item =
    selected.length === 1
      ? elements.find(({ id }) => id === selected[0])
      : undefined;
  if (!item || item.isDeleted || item.locked) {
    return null;
  }
  const [left, top, right, bottom] = getCommonBounds([item]);
  const viewport = { ...state, offsetLeft: 0, offsetTop: 0 };
  const start = sceneCoordsToViewportCoords(
    { sceneX: left, sceneY: top },
    viewport,
  );
  const end = sceneCoordsToViewportCoords(
    { sceneX: right, sceneY: bottom },
    viewport,
  );
  if (
    end.x < 0 ||
    end.y < 0 ||
    start.x > state.width ||
    start.y > state.height
  ) {
    return null;
  }
  const label = selectionLabel(elements, item);
  return {
    id: item.id,
    element: item,
    version: item.version,
    text:
      label?.type === "text"
        ? selectionText(item, label.originalText)
        : undefined,
    canExtend: isBlock(item),
    left: start.x,
    top: start.y,
    right: end.x,
    bottom: end.y,
    width: Math.round(item.width),
    height: Math.round(item.height),
    viewportHeight: state.height,
    resizing: state.isResizing,
    mindMap: Boolean(mindNode(item)),
    theme: state.theme,
  };
};

export const sameProjection = (
  a: BlockProjection | null,
  b: BlockProjection | null,
): boolean =>
  a === b ||
  (!!a &&
    !!b &&
    a.id === b.id &&
    a.version === b.version &&
    a.text === b.text &&
    a.canExtend === b.canExtend &&
    a.left === b.left &&
    a.top === b.top &&
    a.right === b.right &&
    a.bottom === b.bottom &&
    a.width === b.width &&
    a.height === b.height &&
    a.viewportHeight === b.viewportHeight &&
    a.resizing === b.resizing &&
    a.mindMap === b.mindMap &&
    a.theme === b.theme);

const actions = ["up", "left", "down", "right"] as const;

const directionKeys: Readonly<Record<string, Direction | undefined>> = {
  ArrowUp: "up",
  ArrowLeft: "left",
  ArrowDown: "down",
  ArrowRight: "right",
  Home: "up",
  End: "right",
};

export const BlockControls = ({
  block,
  onExtend,
}: {
  block: BlockProjection;
  onExtend: (direction: Direction) => void;
}): ReactElement => {
  const [tabStop, setTabStop] = useState<Direction>("right");

  const navigate = (event: KeyboardEvent<HTMLDivElement>): void => {
    const direction = directionKeys[event.key];
    if (!direction || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    event.preventDefault();
    event.currentTarget
      .querySelector<HTMLButtonElement>(`[data-side="${direction}"]`)
      ?.focus({ preventScroll: true });
  };

  return (
    <div
      className="diagram-controls"
      data-theme={block.theme}
      data-mind-map={block.mindMap}
      role={block.resizing ? undefined : "toolbar"}
      aria-label={t("diagram.controls")}
      onKeyDown={navigate}
      style={
        {
          "--diagram-left": `${block.left}px`,
          "--diagram-right": `${block.right}px`,
          "--diagram-top": `${block.top}px`,
          "--diagram-bottom": `${block.bottom}px`,
          "--diagram-center": `${(block.left + block.right) / 2}px`,
          "--diagram-middle": `${(block.top + block.bottom) / 2}px`,
        } as CSSProperties
      }
    >
      <output
        className="diagram-dimensions"
        aria-label={t("diagram.dimensions")}
        aria-live="off"
      >
        {block.width} × {block.height}
      </output>
      {!block.resizing &&
        actions
          .filter((direction) => !block.mindMap || direction === "right")
          .map((direction) => (
            <button
              key={direction}
              type="button"
              className="diagram-add"
              data-side={direction}
              aria-label={t(
                block.mindMap ? "mind.addChild" : `diagram.add.${direction}`,
              )}
              tabIndex={direction === tabStop ? 0 : -1}
              onFocus={() => setTabStop(direction)}
              onClick={() => onExtend(direction)}
            >
              <span>
                <PlusIcon />
              </span>
            </button>
          ))}
    </div>
  );
};

export const mindBranchKey = (key: string): BranchRelation | undefined =>
  key === "Tab" ? "child" : key === "Enter" ? "sibling" : undefined;

export const BlockLabelInput = ({
  block,
  onFinish,
  onBranch,
}: {
  block: BlockProjection | null;
  onFinish: (text: string) => boolean;
  onBranch?: (text: string, relation: BranchRelation) => boolean;
}): ReactElement => {
  const input = useRef<HTMLTextAreaElement>(null);
  const instructionsId = useId();
  useLayoutEffect(() => {
    input.current?.focus({ preventScroll: true });
  }, []);

  const finishFromKeyboard = (
    event: KeyboardEvent<HTMLTextAreaElement>,
  ): void => {
    if (event.nativeEvent.isComposing) {
      return;
    }
    const unmodified =
      !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;
    const relation = unmodified ? mindBranchKey(event.key) : undefined;
    if (onBranch && relation) {
      event.preventDefault();
      event.stopPropagation();
      onBranch(event.currentTarget.value, relation);
      return;
    }
    if (event.key === "Escape" || (event.key === "Enter" && unmodified)) {
      event.preventDefault();
      const field = event.currentTarget;
      const canvas = field
        .closest(".editor")
        ?.querySelector<HTMLElement>(".excalidraw");
      if (onFinish(event.key === "Escape" && !onBranch ? "" : field.value)) {
        canvas?.focus({ preventScroll: true });
      }
    }
  };

  const left = block ? (block.left + block.right) / 2 : undefined;
  const top = block ? (block.top + block.bottom) / 2 : undefined;
  const width = block ? Math.max(52, block.right - block.left - 12) : undefined;
  return (
    <>
      {onBranch && (
        <span className="visually-hidden" id={instructionsId}>
          {t("mind.keys")}
        </span>
      )}
      <textarea
        ref={input}
        className="diagram-label"
        data-theme={block?.theme}
        style={
          block
            ? ({
                "--diagram-center": `${left}px`,
                "--diagram-middle": `${top}px`,
                "--diagram-label-width": `${width}px`,
              } as CSSProperties)
            : undefined
        }
        rows={1}
        maxLength={4000}
        aria-label={t(onBranch ? "mind.label" : "diagram.label")}
        aria-describedby={onBranch ? instructionsId : undefined}
        placeholder={t("diagram.labelPlaceholder")}
        onKeyDown={finishFromKeyboard}
        onBlur={(event) => onFinish(event.currentTarget.value)}
      />
    </>
  );
};
