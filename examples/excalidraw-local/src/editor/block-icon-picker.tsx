import { useState } from "react";

import { t } from "../ui/messages";

import type { ReactElement } from "react";

const icons = [
  ["✓", "icon.check", "icon.status"],
  ["⚠", "icon.warning", "icon.status"],
  ["✕", "icon.cross", "icon.status"],
  ["★", "icon.star", "icon.status"],
  ["⚑", "icon.flag", "icon.status"],
  ["☁", "icon.cloud", "icon.systems"],
  ["⌘", "icon.command", "icon.systems"],
  ["⚙", "icon.settings", "icon.systems"],
  ["🔗", "icon.link", "icon.systems"],
  ["🔒", "icon.lock", "icon.systems"],
  ["🌱", "icon.plant", "icon.environment"],
  ["☀", "icon.sun", "icon.environment"],
  ["⚡", "icon.energy", "icon.environment"],
  ["♻", "icon.recycle", "icon.environment"],
  ["💧", "icon.water", "icon.environment"],
] as const;

const normalize = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

export const BlockIconPicker = ({
  value,
  onSelect,
}: {
  value: string;
  onSelect: (value: string) => void;
}): ReactElement => {
  const [query, setQuery] = useState("");
  const search = normalize(query.trim());
  const visible = icons.filter(([, label, group]) =>
    normalize(`${t(label)} ${t(group)}`).includes(search),
  );
  return (
    <>
      <input
        type="search"
        value={query}
        placeholder={t("icon.search")}
        aria-label={t("icon.search")}
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
      {visible.length ? (
        <div className="selection-shapes selection-icon-grid">
          {visible.map(([symbol, label]) => (
            <button
              key={label}
              type="button"
              aria-pressed={value === symbol}
              title={t(label)}
              aria-label={t(label)}
              onClick={() => onSelect(symbol)}
            >
              {symbol}
            </button>
          ))}
        </div>
      ) : (
        <p role="status">{t("icon.empty")}</p>
      )}
      {value && (
        <button type="button" onClick={() => onSelect("")}>
          {t("icon.remove")}
        </button>
      )}
    </>
  );
};
