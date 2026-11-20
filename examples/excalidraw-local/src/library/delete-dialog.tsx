/** Modal confirmation shown before a board moves to the trash. */
import { useEffect, useId, useRef } from "react";

import { t } from "../ui/messages";

import type { ReactElement, SyntheticEvent } from "react";

import type { BoardSummary } from "../board/scene";

interface DeleteDialogProps {
  board: BoardSummary;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Opens as a native modal dialog, which traps focus and closes on Escape.
 * Cancel receives the initial focus so Enter never deletes by accident.
 */
export const DeleteDialog = ({
  board,
  busy,
  onCancel,
  onConfirm,
}: DeleteDialogProps): ReactElement => {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  const handleCancel = (event: SyntheticEvent<HTMLDialogElement>): void => {
    // Escape fires "cancel": keep the dialog open while the request runs.
    event.preventDefault();
    if (!busy) {
      onCancel();
    }
  };

  return (
    <dialog
      ref={dialog}
      className="dialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onCancel={handleCancel}
      data-testid="board-delete-dialog"
    >
      <div className="dialog-body">
        <h2 id={titleId}>{t("dialog.deleteTitle", { name: board.name })}</h2>
        <div id={bodyId} className="dialog-text">
          <p>{t("dialog.deleteBody")}</p>
        </div>
      </div>
      <div className="dialog-actions">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          autoFocus
          data-testid="board-delete-cancel"
        >
          {t("dialog.cancel")}
        </button>
        <button
          type="button"
          className="danger"
          onClick={onConfirm}
          disabled={busy}
          aria-busy={busy}
          data-testid="board-delete-confirm"
        >
          {t("dialog.confirmDelete")}
        </button>
      </div>
    </dialog>
  );
};
