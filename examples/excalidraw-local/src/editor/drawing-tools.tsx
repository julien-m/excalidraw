import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";

import { t } from "../ui/messages";

import type { AppState } from "@local/excalidraw-sdk/types";
import type { ReactElement, RefObject } from "react";

export type DrawingTool = "mind-map" | "quick-diagram";

const tools = [
  { id: "mind-map", label: "mind.tool", instructions: "mind.place" },
  { id: "quick-diagram", label: "diagram.tool", instructions: "diagram.place" },
] as const;

export const getDrawingTool = (
  tool: AppState["activeTool"],
): DrawingTool | null =>
  tool.type === "custom"
    ? tools.find(({ id }) => id === tool.customType)?.id ?? null
    : null;

export const DrawingTools = ({
  editor,
  active,
  disabled,
  onSelect,
}: {
  editor: RefObject<HTMLElement | null>;
  active: DrawingTool | null;
  disabled: boolean;
  onSelect: (tool: DrawingTool) => void;
}): ReactElement | null => {
  const [row, setRow] = useState<Element | null>(null);
  const instructionsId = useId();
  useEffect(() => {
    const container = editor.current;
    const owner = container?.ownerDocument.defaultView;
    if (!container || !owner) {
      return;
    }
    // SDK 0.18.1 renders a new row when switching between desktop and mobile.
    const findRow = (): void => {
      setRow(
        container.querySelector(
          ".App-toolbar-container .App-toolbar > .Stack_horizontal",
        ),
      );
    };
    findRow();
    const observer = new owner.MutationObserver(findRow);
    observer.observe(container, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [editor]);

  return row
    ? createPortal(
        tools.map(({ id, label, instructions }) => (
          <button
            key={id}
            type="button"
            className="ToolIcon ToolIcon_type_button local-drawing-tool"
            aria-label={t(label)}
            title={t(label)}
            aria-describedby={`${instructionsId}-${id}`}
            aria-pressed={active === id}
            disabled={disabled}
            data-testid={`toolbar-${id}`}
            onClick={() => onSelect(id)}
          >
            <span className="ToolIcon__icon">
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {id === "mind-map" ? (
                  <>
                    <path d="M8.5 12h1.25c3.5 0 2-6 5.75-6m-7 6h1.25c3.5 0 2 6 5.75 6" />
                    <rect x="2.5" y="9" width="6" height="6" rx="3" />
                    <rect x="15.5" y="3.5" width="6" height="5" rx="2.5" />
                    <rect x="15.5" y="15.5" width="6" height="5" rx="2.5" />
                  </>
                ) : (
                  <>
                    <rect x="2.5" y="3" width="8" height="6" />
                    <path d="M6.5 9v9h5m-2-2 2 2-2 2" />
                    <rect x="14" y="15" width="7.5" height="6" />
                  </>
                )}
              </svg>
            </span>
            <span className="visually-hidden" id={`${instructionsId}-${id}`}>
              {t(instructions)}
            </span>
          </button>
        )),
        row,
      )
    : null;
};
