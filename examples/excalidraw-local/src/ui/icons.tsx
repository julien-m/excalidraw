/** Decorative stroke icons sized by the surrounding font; the owning control carries the label. */
import type { ReactElement } from "react";

export const Icon = ({ path }: { path: string }): ReactElement => (
  <svg
    className="icon"
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d={path} />
  </svg>
);

export const MoreIcon = (): ReactElement => (
  <Icon path="M5 12h.01M12 12h.01M19 12h.01" />
);

export const ChevronDownIcon = (): ReactElement => <Icon path="m6 9 6 6 6-6" />;

export const PlusIcon = (): ReactElement => <Icon path="M12 5v14M5 12h14" />;

export const CloseIcon = (): ReactElement => (
  <Icon path="M6 6l12 12M18 6 6 18" />
);
