import type { BoardCommand } from "../board/commands";

export type BoardTemplate = "architecture" | "wireframes" | "note" | "overview";

const palette = {
  blue: "#d9e8ff",
  green: "#cdeee6",
  yellow: "#fff0bd",
  purple: "#e9ddff",
  ink: "#233348",
  panel: "#f0f3f8",
  white: "#ffffff",
} as const;

/** Builds editable Excalidraw objects through the same command engine as the MCP. */
export const templateCommands = (
  template: BoardTemplate,
  prefix: string,
  origin: { x: number; y: number },
): BoardCommand[] => {
  const commands: BoardCommand[] = [];
  const id = (name: string): string => `${prefix}-${name}`;
  const block = (
    name: string,
    text: string,
    x: number,
    y: number,
    width: number,
    height: number,
    fill: string,
    shape: "rectangle" | "diamond" | "ellipse" = "rectangle",
  ): void => {
    commands.push({
      kind: "shape",
      id: id(name),
      shape,
      text,
      x: origin.x + x,
      y: origin.y + y,
      width,
      height,
      fill,
    });
  };
  const title = (text: string, x: number, y: number): void => {
    commands.push({ kind: "text", text, x: origin.x + x, y: origin.y + y });
  };
  const link = (
    from: string,
    to: string,
    arrowhead = true,
    color = palette.ink as string,
  ): void => {
    commands.push({
      kind: "connect",
      from: id(from),
      to: id(to),
      routing: "elbow",
      arrowhead,
      color,
    });
  };

  if (template === "architecture" || template === "overview") {
    title("Architecture du service", 0, 0);
    block("interface", "Interface", 0, 72, 144, 60, palette.blue);
    block("automatisation", "Automatisation", 0, 192, 144, 60, palette.blue);
    block("api", "API", 204, 132, 132, 60, palette.purple);
    block("service", "Traitement", 396, 72, 148, 60, palette.green);
    block("donnees", "Données", 396, 192, 148, 60, palette.green);
    block("controle", "Validé", 604, 72, 132, 60, palette.yellow, "diamond");
    link("interface", "api");
    link("automatisation", "api");
    link("api", "service");
    link("api", "donnees");
    link("service", "controle");
  }

  if (template === "overview") {
    const x = 816;
    title("Carte mentale", x, 0);
    block("sujet", "Objectif", x, 132, 128, 60, palette.purple);
    block("ux", "Parcours", x + 204, 55, 140, 54, palette.blue);
    block("tech", "Technique", x + 204, 136, 140, 54, palette.green);
    block("suite", "Prochaines étapes", x + 204, 217, 160, 54, palette.yellow);
    link("sujet", "ux", false, "#416bcc");
    link("sujet", "tech", false, "#157b6a");
    link("sujet", "suite", false, "#9c6516");
  }

  if (template === "wireframes" || template === "overview") {
    const y = template === "overview" ? 352 : 0;
    title("Maquettes web et mobile", 0, y);
    block("desktop", "", 0, y + 44, 520, 298, palette.white);
    block("browser-bar", "Tableau de bord", 0, y + 44, 520, 44, palette.panel);
    block(
      "sidebar",
      "Vue d’ensemble\n\nActivité\n\nParamètres",
      0,
      y + 88,
      130,
      254,
      palette.panel,
    );
    block(
      "web-card",
      "Résumé de l’activité",
      154,
      y + 112,
      340,
      62,
      palette.blue,
    );
    block("web-list", "Éléments récents", 154, y + 192, 340, 84, palette.white);
    block(
      "web-action",
      "Voir les détails",
      154,
      y + 290,
      154,
      34,
      palette.green,
    );
    block("phone", "", 584, y + 44, 200, 298, palette.white);
    block("phone-bar", "Activité", 600, y + 60, 168, 44, palette.panel);
    block("phone-card", "Résumé", 600, y + 120, 168, 62, palette.blue);
    block(
      "phone-list",
      "Éléments récents",
      600,
      y + 198,
      168,
      62,
      palette.white,
    );
    block(
      "phone-action",
      "Voir les détails",
      600,
      y + 278,
      168,
      40,
      palette.green,
    );
  }

  if (template === "note" || template === "overview") {
    const x = template === "overview" ? 854 : 0;
    const y = template === "overview" ? 426 : 0;
    block(
      "note",
      "À vérifier\n\nPrévoir l’état vide",
      x,
      y,
      206,
      152,
      palette.yellow,
    );
  }
  return commands;
};
