/** Keeps connectors with deleted endpoints out of the scene, and restores them on canvas undo. */
import { newElementWith } from "@local/excalidraw-sdk";

import type { OrderedExcalidrawElement } from "@local/excalidraw-sdk/element/types";

type Arrow = Extract<OrderedExcalidrawElement, { type: "arrow" }>;
const isArrow = (element: OrderedExcalidrawElement): element is Arrow =>
  element.type === "arrow";
const endpoints = (arrow: Arrow): string[] =>
  [arrow.startBinding?.elementId, arrow.endBinding?.elementId].filter(
    (id): id is string => !!id,
  );

export class BoundArrowDeletion {
  private active = new Map<string, Arrow>();
  private hidden = new Map<string, Arrow>();

  reconcile = (
    elements: readonly OrderedExcalidrawElement[],
  ): readonly OrderedExcalidrawElement[] => {
    const live = new Map(
      elements.filter((el) => !el.isDeleted).map((el) => [el.id, el]),
    );
    const updates = new Map<string, OrderedExcalidrawElement>();
    const removed = new Set<string>();
    const restored = new Map<string, string[]>();

    for (const element of elements) {
      if (!isArrow(element)) {
        continue;
      }
      const before = this.active.get(element.id);
      const hidden = this.hidden.get(element.id);
      if (
        !hidden &&
        before &&
        !element.isDeleted &&
        endpoints(before).some((id) => !live.has(id))
      ) {
        this.hidden.set(element.id, before);
        removed.add(element.id);
        updates.set(element.id, newElementWith(element, { isDeleted: true }));
      } else if (hidden && endpoints(hidden).every((id) => live.has(id))) {
        this.hidden.delete(element.id);
        updates.set(
          element.id,
          newElementWith(element, {
            isDeleted: false,
            startBinding: hidden.startBinding,
            endBinding: hidden.endBinding,
            boundElements: hidden.boundElements,
          }),
        );
        for (const id of new Set(endpoints(hidden))) {
          restored.set(id, [...(restored.get(id) ?? []), element.id]);
        }
      }
    }

    const result =
      updates.size === 0
        ? elements
        : elements.map((element) => {
            const replacement = updates.get(element.id);
            if (replacement) {
              return replacement;
            }
            if (element.type === "text" && element.containerId) {
              if (removed.has(element.containerId)) {
                return newElementWith(element, { isDeleted: true });
              }
              if (
                updates
                  .get(element.containerId)
                  ?.boundElements?.some(({ id }) => id === element.id)
              ) {
                return newElementWith(element, { isDeleted: false });
              }
            }
            const added = restored.get(element.id);
            const bindings = element.boundElements ?? [];
            if (added || bindings.some(({ id }) => removed.has(id))) {
              return newElementWith(element, {
                boundElements: [
                  ...bindings.filter(
                    ({ id }) => !removed.has(id) && !added?.includes(id),
                  ),
                  ...(added ?? []).map((id) => ({
                    id,
                    type: "arrow" as const,
                  })),
                ],
              });
            }
            return element;
          });

    // The SDK can unbind an endpoint in place before emitting its deletion.
    this.active.clear();
    for (const element of result) {
      if (isArrow(element) && !element.isDeleted) {
        const ids = endpoints(element);
        if (ids.length && ids.every((id) => live.has(id))) {
          this.active.set(element.id, { ...element });
        }
      }
    }
    return result;
  };
}
