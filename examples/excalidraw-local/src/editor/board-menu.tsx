/** Disclosure menu grouping the secondary board actions of the editor toolbar. */
import { useEffect, useId, useRef, useState } from "react";

import { ChevronDownIcon, MoreIcon } from "../ui/icons";

import type { KeyboardEvent, ReactElement, RefObject } from "react";

export interface BoardMenuItem {
  id: string;
  label: string;
  onSelect: (trigger: HTMLButtonElement) => void;
  /** Set for toggles such as the history panel; rendered as a checkable item. */
  checked?: boolean;
}

const itemButtons = (menu: HTMLElement | null): HTMLButtonElement[] =>
  Array.from(
    menu?.querySelectorAll<HTMLButtonElement>("[role^=menuitem]") ?? [],
  );

interface BoardMenuProps {
  label: string;
  items: readonly BoardMenuItem[];
  disabled: boolean;
  cardId?: string;
  triggerRef?: RefObject<HTMLButtonElement | null>;
  scope?: "editor" | "templates";
}

/**
 * Follows the WAI-ARIA menu button pattern: Enter, Space or arrows open it, arrows, Home
 * and End move between items, Escape closes it and returns focus to the trigger.
 * Key events stop here so the Excalidraw canvas never moves or deselects shapes meanwhile.
 */
export const BoardMenu = ({
  label,
  items,
  disabled,
  cardId,
  triggerRef,
  scope = "editor",
}: BoardMenuProps): ReactElement => {
  const [open, setOpen] = useState(false);
  const localTrigger = useRef<HTMLButtonElement>(null);
  const trigger = triggerRef ?? localTrigger;
  const menu = useRef<HTMLUListElement>(null);
  const focusOnOpen = useRef<"first" | "last">("first");
  const menuId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }
    const buttons = itemButtons(menu.current);
    (focusOnOpen.current === "first"
      ? buttons[0]
      : buttons[buttons.length - 1]
    )?.focus();
    const owner = trigger.current?.ownerDocument;
    const close = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (
        !menu.current?.contains(target) &&
        !trigger.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    owner?.addEventListener("pointerdown", close, true);
    return () => owner?.removeEventListener("pointerdown", close, true);
  }, [open, trigger]);

  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

  const show = (focus: "first" | "last"): void => {
    focusOnOpen.current = focus;
    setOpen(true);
  };
  const hide = (): void => {
    setOpen(false);
    trigger.current?.focus();
  };

  const handleTriggerKey = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      show(event.key === "ArrowDown" ? "first" : "last");
    }
  };
  const handleMenuKey = (event: KeyboardEvent<HTMLUListElement>): void => {
    event.stopPropagation();
    const buttons = itemButtons(menu.current);
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    const focusAt = (next: number): void => {
      event.preventDefault();
      buttons[(next + buttons.length) % buttons.length]?.focus();
    };
    switch (event.key) {
      case "ArrowDown":
        focusAt(index + 1);
        break;
      case "ArrowUp":
        focusAt(index - 1);
        break;
      case "Home":
        focusAt(0);
        break;
      case "End":
        focusAt(buttons.length - 1);
        break;
      case "Escape":
        event.preventDefault();
        hide();
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  };
  const handleSelect = (item: BoardMenuItem): void => {
    hide();
    if (trigger.current) {
      item.onSelect(trigger.current);
    }
  };

  return (
    <div className={cardId ? "menu card-menu" : "menu"}>
      <button
        ref={trigger}
        type="button"
        className={cardId ? "icon-button" : "excalidraw-button"}
        aria-label={cardId ? label : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show("first"))}
        onKeyDown={handleTriggerKey}
        data-testid={
          cardId ? `board-actions-${cardId}` : `${scope}-actions-btn`
        }
      >
        {cardId ? (
          <MoreIcon />
        ) : (
          <>
            {label}
            <ChevronDownIcon />
          </>
        )}
      </button>
      {open && (
        <ul
          ref={menu}
          id={menuId}
          role="menu"
          aria-label={label}
          className="menu-list"
          onKeyDown={handleMenuKey}
          data-testid={
            cardId ? `board-menu-${cardId}` : `${scope}-actions-menu`
          }
        >
          {items.map((item) => (
            <li key={item.id} role="none">
              <button
                type="button"
                role={
                  item.checked === undefined ? "menuitem" : "menuitemcheckbox"
                }
                aria-checked={item.checked}
                tabIndex={-1}
                onClick={() => handleSelect(item)}
                data-testid={
                  cardId
                    ? `board-${item.id}-${cardId}`
                    : `${scope}-action-${item.id}`
                }
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
