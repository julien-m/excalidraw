import { useId, useRef, useState } from "react";

import { CloseIcon, Icon, MoreIcon } from "../ui/icons";
import { t } from "../ui/messages";

import { BlockIconPicker } from "./block-icon-picker";
import {
  diagramShapePath,
  diagramShapes,
  readDiagramShape,
} from "./diagram-shapes";
import { selectionIcon, selectionNote } from "./selection-edit";

import type { Arrowhead } from "@local/excalidraw-sdk/element/types";
import type { KeyboardEvent, ReactElement } from "react";

import type { BlockProjection } from "./block-controls";
import type { DiagramShape } from "./diagram-shapes";
import type { SelectionEdit } from "./selection-edit";

const colors = [
  "#233348",
  "#6b7280",
  "#ffffff",
  "#d9e8ff",
  "#cdeee6",
  "#fff0bd",
  "#e9ddff",
  "#ffc9c9",
  "#4263eb",
  "#0c8599",
  "#2f9e44",
  "#e8590c",
];
interface ShapeOption {
  id:
    | "rectangle"
    | "softRectangle"
    | "roundedRectangle"
    | "ellipse"
    | "circle"
    | "diamond"
    | DiagramShape;
  type: "rectangle" | "ellipse" | "diamond";
  path: string;
  radius?: number;
  outline?: DiagramShape;
  circle?: boolean;
}

const shapeOptions: ShapeOption[] = [
  { id: "rectangle", type: "rectangle", path: "M4 6h16v12H4z", radius: 0 },
  {
    id: "softRectangle",
    type: "rectangle",
    path: "M6 6h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z",
    radius: 5,
  },
  {
    id: "roundedRectangle",
    type: "rectangle",
    path: "M8 6h8a4 4 0 0 1 4 4v4a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-4a4 4 0 0 1 4-4z",
    radius: 16,
  },
  {
    id: "ellipse",
    type: "ellipse",
    path: "M21 12a9 7 0 1 1-18 0 9 7 0 0 1 18 0Z",
    radius: 0,
  },
  {
    id: "circle",
    type: "ellipse",
    path: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
    circle: true,
  },
  {
    id: "diamond",
    type: "diamond",
    path: "m12 3 9 9-9 9-9-9z",
    radius: 0,
  },
  ...diagramShapes.map(
    (outline): ShapeOption => ({
      id: outline,
      type: "rectangle",
      path: diagramShapePath(outline, 18, 14, 3, 5),
      outline,
    }),
  ),
];

const appearanceTools = [
  { id: "filled", name: "selection.filled" },
  { id: "outline", name: "selection.outline" },
  { id: "dashed", name: "selection.dashedOutline" },
] as const;

const arrowheads: { value: Arrowhead | ""; label: string }[] = [
  { value: "", label: "Aucune" },
  { value: "arrow", label: "Ouverte" },
  { value: "triangle", label: "Triangle plein" },
  { value: "triangle_outline", label: "Triangle vide" },
  { value: "dot", label: "Point" },
  { value: "circle_outline", label: "Cercle" },
  { value: "diamond", label: "Losange" },
  { value: "bar", label: "Barre" },
];

type Section = "text" | "shape" | "colors" | "line" | "symbols" | "note";

export const SelectionToolbar = ({
  selection,
  label,
  advanced,
  below,
  onAdvanced,
  onDuplicate,
  onDelete,
  menuOpen,
  onContextMenu,
  onEdit,
}: {
  selection: BlockProjection;
  label?: string;
  advanced: boolean;
  below: boolean;
  onAdvanced: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  menuOpen: boolean;
  onContextMenu: (trigger: HTMLButtonElement) => void;
  onEdit: (edit: SelectionEdit) => boolean;
}): ReactElement => {
  const { element, canExtend, mindMap } = selection;
  const id = useId();
  const buttons = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<Section | null>(null);
  const [tabStop, setTabStop] = useState<string>();
  const [value, setValue] = useState("");
  const canEditText = label !== undefined || canExtend;
  const arrow = element.type === "arrow" ? element : null;
  const activeSection = advanced ? null : open;
  const appearance =
    element.backgroundColor !== "transparent"
      ? "filled"
      : element.strokeStyle === "dashed"
      ? "dashed"
      : "outline";
  const selectedRadius = element.roundness ? element.roundness.value ?? 16 : 0;
  const nativeRectangle =
    selectedRadius === 0
      ? "rectangle"
      : selectedRadius <= 8
      ? "softRectangle"
      : "roundedRectangle";
  const nativeShape =
    element.type === "rectangle"
      ? nativeRectangle
      : element.type === "ellipse" &&
        Math.abs(element.width - element.height) < 0.01
      ? "circle"
      : element.type;
  const currentShape = readDiagramShape(element) ?? nativeShape;
  const panelAbove = below
    ? selection.viewportHeight - selection.bottom < 264
    : selection.top >= 288;
  const press = (section: Section): void => {
    if (advanced) {
      onAdvanced();
    }
    setOpen(activeSection === section ? null : section);
    setValue(
      section === "note"
        ? selectionNote(element)
        : section === "text"
        ? label ?? ""
        : "",
    );
  };
  const closePanel = (): void => {
    if (activeSection) {
      buttons.current
        ?.querySelector<HTMLButtonElement>(`[data-section="${activeSection}"]`)
        ?.focus();
    }
    setOpen(null);
  };
  const navigate = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      return;
    }
    const items = Array.from(event.currentTarget.querySelectorAll("button"));
    const index = items.findIndex((item) => item === event.target);
    if (index === -1) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
        ? items.length - 1
        : (index + (event.key === "ArrowLeft" ? -1 : 1) + items.length) %
          items.length;
    items[next]?.focus();
  };
  const button = (
    section: Section,
    title: string,
    content: ReactElement | string,
  ): ReactElement => (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-expanded={activeSection === section}
      aria-controls={activeSection === section ? id : undefined}
      data-section={section}
      tabIndex={
        tabStop === section ||
        (!tabStop && section === (canEditText ? "text" : "colors"))
          ? 0
          : -1
      }
      onFocus={() => setTabStop(section)}
      onClick={() => press(section)}
    >
      {content}
    </button>
  );
  const swatches = (
    property: "stroke" | "fill",
    name: string,
  ): ReactElement => {
    const current =
      property === "stroke" ? element.strokeColor : element.backgroundColor;
    return (
      <fieldset>
        <legend>{name}</legend>
        <div className="selection-swatches">
          {colors.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={`${name} ${color}`}
              title={color}
              aria-pressed={color === current}
              style={{ backgroundColor: color }}
              onClick={() => onEdit({ kind: property, value: color })}
            />
          ))}
        </div>
        <div className="selection-custom-color">
          <label>
            {t("selection.customColor")}
            <input
              aria-label={`${name} · ${t("selection.customColor")}`}
              type="color"
              value={/^#[0-9a-f]{6}$/i.test(current) ? current : "#ffffff"}
              onChange={(event) =>
                onEdit({ kind: property, value: event.currentTarget.value })
              }
            />
          </label>
          {property === "fill" && (
            <button
              type="button"
              onClick={() => onEdit({ kind: "fill", value: "transparent" })}
            >
              {t("selection.noFill")}
            </button>
          )}
        </div>
      </fieldset>
    );
  };
  const editableKind =
    activeSection === "text" || activeSection === "note" ? activeSection : null;

  return (
    <div
      className="selection-toolbar"
      data-theme={selection.theme}
      data-below={below}
      data-panel-above={panelAbove}
    >
      <div
        className="selection-buttons"
        role="toolbar"
        aria-label={t("selection.toolbar")}
        ref={buttons}
        onKeyDown={navigate}
      >
        <div
          className="selection-group"
          role="group"
          aria-label={t("selection.contentGroup")}
        >
          {canEditText &&
            button(
              "text",
              t("selection.text"),
              <Icon path="M4 6V4h16v2M12 4v16m-4 0h8" />,
            )}
          {canExtend &&
            !mindMap &&
            button(
              "shape",
              t("selection.shape"),
              <Icon path="M4 5h8v7H4zm13-1 4 4-4 4-4-4zm0 10a4 4 0 1 0 0 8 4 4 0 1 0 0-8z" />,
            )}
          {button(
            "colors",
            t("selection.colors"),
            <span
              className="selection-color-dot"
              style={{ backgroundColor: element.strokeColor }}
            />,
          )}
        </div>
        {canExtend && (
          <div
            className="selection-appearance"
            role="group"
            aria-label={t("selection.appearanceGroup")}
          >
            {appearanceTools.map(({ id: style, name }) => (
              <button
                key={style}
                type="button"
                aria-label={t(name)}
                title={t(name)}
                aria-pressed={appearance === style}
                tabIndex={tabStop === style ? 0 : -1}
                onFocus={() => setTabStop(style)}
                onClick={() => onEdit({ kind: "appearance", value: style })}
              >
                <span
                  className="selection-fill-icon"
                  data-appearance={style}
                  aria-hidden="true"
                />
              </button>
            ))}
          </div>
        )}
        <div
          className="selection-group"
          role="group"
          aria-label={t("selection.actionsGroup")}
        >
          {button("line", t("selection.line"), <Icon path="m5 19 14-14" />)}
          {canEditText &&
            button(
              "symbols",
              t("selection.symbols"),
              <Icon path="m12 2 2.6 7.4L22 12l-7.4 2.6L12 22l-2.6-7.4L2 12l7.4-2.6z" />,
            )}
          <button
            type="button"
            aria-label={t("selection.duplicate")}
            title={t("selection.duplicate")}
            tabIndex={tabStop === "duplicate" ? 0 : -1}
            onFocus={() => setTabStop("duplicate")}
            onClick={onDuplicate}
          >
            <Icon path="M8 8V4h12v12h-4M4 8h12v12H4z" />
          </button>
          {button(
            "note",
            t("selection.note"),
            <Icon
              path={
                selectionNote(element)
                  ? "M4 5h16v11H10l-6 4zm4 4h8m-8 3h6"
                  : "M4 5h16v11H10l-6 4z"
              }
            />,
          )}
          <button
            type="button"
            aria-label={t("selection.delete")}
            title={t("selection.delete")}
            data-selection-danger
            tabIndex={tabStop === "delete" ? 0 : -1}
            onFocus={() => setTabStop("delete")}
            onClick={onDelete}
          >
            <Icon path="M4 6h16M9 6V4h6v2M6 6l1 14h10l1-14M10 9v7m4-7v7" />
          </button>
          <button
            type="button"
            aria-label={t("selection.properties")}
            title={t("selection.properties")}
            aria-expanded={advanced}
            tabIndex={tabStop === "properties" ? 0 : -1}
            onFocus={() => setTabStop("properties")}
            onClick={() => {
              setOpen(null);
              onAdvanced();
            }}
          >
            <Icon path="M4 6h16M4 12h16M4 18h16M8 4v4m8 2v4m-5 2v4" />
          </button>
          <button
            type="button"
            aria-label={t("selection.actions")}
            title={t("selection.actions")}
            aria-expanded={menuOpen}
            data-testid="selection-object-menu"
            tabIndex={tabStop === "actions" ? 0 : -1}
            onFocus={() => setTabStop("actions")}
            onPointerDown={(event) => {
              if (menuOpen) {
                event.stopPropagation();
              }
            }}
            onClick={(event) => {
              setOpen(null);
              if (advanced) {
                onAdvanced();
              }
              onContextMenu(event.currentTarget);
            }}
          >
            <MoreIcon />
          </button>
        </div>
      </div>
      {activeSection && (
        <section
          id={id}
          className="selection-popover"
          data-section={activeSection}
          aria-label={t(`selection.${activeSection}`)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              closePanel();
            }
          }}
        >
          <header>
            <strong>{t(`selection.${activeSection}`)}</strong>
            <button
              type="button"
              title={t("selection.close")}
              aria-label={t("selection.close")}
              onClick={closePanel}
            >
              <CloseIcon />
            </button>
          </header>
          {activeSection === "colors" && (
            <>
              {swatches("stroke", t("selection.stroke"))}
              {canExtend && swatches("fill", t("selection.fill"))}
              <label>
                {element.opacity} %
                <input
                  type="range"
                  aria-label={t("selection.opacity")}
                  min="0"
                  max="100"
                  step="5"
                  value={element.opacity}
                  onChange={(event) =>
                    onEdit({
                      kind: "opacity",
                      value: event.currentTarget.valueAsNumber,
                    })
                  }
                />
              </label>
            </>
          )}
          {activeSection === "shape" && (
            <div className="selection-shapes">
              {shapeOptions.map(
                ({ id: option, type, path, radius, outline, circle }) => {
                  return (
                    <button
                      type="button"
                      key={option}
                      aria-label={t(`selection.${option}`)}
                      title={t(`selection.${option}`)}
                      aria-pressed={currentShape === option}
                      onClick={() => {
                        if (
                          onEdit({
                            kind: "shape",
                            value: type,
                            radius,
                            outline,
                            circle,
                          })
                        ) {
                          closePanel();
                        }
                      }}
                    >
                      <Icon path={path} />
                    </button>
                  );
                },
              )}
            </div>
          )}
          {activeSection === "line" && (
            <>
              <div className="selection-options">
                {(["solid", "dashed", "dotted"] as const).map((style) => (
                  <button
                    type="button"
                    key={style}
                    aria-pressed={element.strokeStyle === style}
                    onClick={() =>
                      onEdit({ kind: "strokeStyle", value: style })
                    }
                  >
                    {t(`selection.${style}`)}
                  </button>
                ))}
              </div>
              <div
                className="selection-options"
                aria-label={t("selection.strokeWidth")}
              >
                {[1, 2, 4].map((width) => (
                  <button
                    type="button"
                    key={width}
                    aria-label={`${t("selection.strokeWidth")} ${width}`}
                    aria-pressed={element.strokeWidth === width}
                    onClick={() =>
                      onEdit({ kind: "strokeWidth", value: width })
                    }
                  >
                    {width}
                  </button>
                ))}
              </div>
              {canExtend && (
                <button
                  type="button"
                  aria-pressed={Boolean(element.roundness)}
                  onClick={() =>
                    onEdit({ kind: "rounded", value: !element.roundness })
                  }
                >
                  {t("selection.rounded")}
                </button>
              )}
              {canExtend && (
                <button
                  type="button"
                  onClick={() => {
                    if (onEdit({ kind: "rotate" })) {
                      closePanel();
                    }
                  }}
                >
                  {t("selection.rotate")}
                </button>
              )}
              {arrow &&
                (["startArrowhead", "endArrowhead"] as const).map((end) => (
                  <label key={end}>
                    {t(`selection.${end}`)}
                    <select
                      value={arrow[end] ?? ""}
                      onChange={(event) =>
                        onEdit({
                          kind: end,
                          value: (event.currentTarget.value ||
                            null) as Arrowhead | null,
                        })
                      }
                    >
                      {arrowheads.map(({ value: option, label: name }) => (
                        <option key={option} value={option}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
            </>
          )}
          {activeSection === "symbols" && (
            <BlockIconPicker
              value={selectionIcon(element)}
              onSelect={(symbol) => onEdit({ kind: "icon", value: symbol })}
            />
          )}
          {activeSection === "text" && label !== undefined && (
            <button
              type="button"
              onClick={() => onEdit({ kind: "typography" })}
            >
              {t("selection.typography")}
            </button>
          )}
          {editableKind && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (onEdit({ kind: editableKind, value })) {
                  closePanel();
                }
              }}
            >
              <textarea
                aria-label={t(`selection.${editableKind}`)}
                rows={3}
                maxLength={4000}
                value={value}
                onChange={(event) => setValue(event.currentTarget.value)}
              />
              <button type="submit">{t("selection.apply")}</button>
            </form>
          )}
        </section>
      )}
    </div>
  );
};
