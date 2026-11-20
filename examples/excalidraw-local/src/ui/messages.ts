/**
 * Product copy for the board library and the editor actions, keyed by stable message IDs.
 * French is the base and only shipped locale; components never inline these sentences.
 */
const fr = {
  "app.title": "Excalidraw",
  "app.loadFailed": "Impossible de charger les tableaux.",
  "app.retry": "Réessayer",
  "app.opening": "Ouverture du tableau…",
  "app.genericError": "Impossible d’effectuer cette action.",
  "library.count": { one: "{count} tableau", other: "{count} tableaux" },
  "library.loading": "Chargement des tableaux…",
  "library.namePlaceholder": "Nom du nouveau tableau",
  "library.nameLabel": "Nom du nouveau tableau",
  "library.untitled": "Tableau sans titre",
  "library.create": "Créer un tableau",
  "library.openFile": "Ouvrir un fichier .excalidraw",
  "library.listLabel": "Tableaux",
  "library.emptyTitle": "Aucun tableau pour l’instant",
  "library.emptyBody": "Créez un tableau ou ouvrez un fichier .excalidraw.",
  "library.updated": "Modifié le {date}",
  "library.versions": {
    zero: "",
    one: "{count} version",
    other: "{count} versions",
  },
  "library.tracepin": "Tracepin",
  "library.actions": "Actions pour « {name} »",
  "library.duplicate": "Dupliquer",
  "library.delete": "Supprimer",
  "library.duplicated": "« {name} » a été ajouté à la liste.",
  "library.deleted": "« {name} » a été placé dans la corbeille.",
  "library.undo": "Annuler",
  "library.dismiss": "Fermer le message",
  "library.restored": "« {name} » a été restauré.",
  "trash.title": { one: "Corbeille ({count})", other: "Corbeille ({count})" },
  "trash.deletedAt": "Supprimé le {date}",
  "trash.restore": "Restaurer « {name} »",
  "trash.restoreShort": "Restaurer",
  "dialog.deleteTitle": "Supprimer « {name} » ?",
  "dialog.deleteBody":
    "Le tableau passe dans la corbeille avec ses versions archivées. Vous pourrez le restaurer depuis la bibliothèque.",
  "dialog.cancel": "Annuler",
  "dialog.confirmDelete": "Placer dans la corbeille",
  "editor.back": "Tableaux",
  "editor.actions": "Actions",
  "editor.templates": "Modèles",
  "template.architecture": "Diagramme d’architecture",
  "template.wireframes": "Maquettes web et mobile",
  "template.note": "Note autocollante",
  "template.overview": "Tableau de projet complet",
  "template.outsideBoard": "Le modèle dépasse les limites de ce tableau.",
  "editor.showHistory": "Afficher l’historique",
  "editor.hideHistory": "Masquer l’historique",
  "editor.archive": "Archiver une version",
  "editor.export": "Exporter (.excalidraw)",
  "editor.copyClose": "Copier et fermer",
  "editor.archived": "Version archivée",
  "editor.historyTitle": "Historique du tableau",
  "editor.closeHistory": "Fermer l’historique",
  "editor.historyHelp":
    "Retrouvez les versions archivées par « Archiver une version » ou « Copier et fermer ». Ouvrez une copie pour repartir d’une de ces versions.",
  "editor.historyEmpty": "Aucune version archivée.",
  "editor.openCopy": "Ouvrir une copie",
  "editor.copySuffix": "{name} (copie)",
  "editor.recoverySuffix": " (récupéré)",
  "editor.recoverySaved":
    "Conflit de versions. Vos modifications sont dans « {name} ».",
  "editor.recoveryPending":
    "La copie « {name} » est enregistrée. Des modifications plus récentes sont encore ouvertes.",
  "editor.saved": "Enregistré",
  "editor.canvas": "Zone de dessin",
  "icon.search": "Rechercher une icône",
  "icon.empty": "Aucune icône trouvée.",
  "icon.remove": "Retirer l’icône",
  "icon.status": "Statut",
  "icon.systems": "Systèmes",
  "icon.environment": "Énergie et environnement",
  "icon.check": "Validation",
  "icon.warning": "Avertissement",
  "icon.cross": "Croix",
  "icon.star": "Étoile",
  "icon.flag": "Drapeau",
  "icon.cloud": "Nuage",
  "icon.command": "Commande",
  "icon.settings": "Réglages",
  "icon.link": "Lien",
  "icon.lock": "Cadenas",
  "icon.plant": "Plantule",
  "icon.sun": "Soleil",
  "icon.energy": "Éclair",
  "icon.recycle": "Recyclage",
  "icon.water": "Goutte d’eau",
  "selection.delete": "Supprimer",
  "selection.typography": "Appliquer la police de diagramme",
  "selection.properties": "Propriétés de l’objet",
  "selection.softRectangle": "Rectangle aux coins doux",
  "selection.toolbar": "Modifier la sélection",
  "selection.text": "Texte",
  "selection.shape": "Forme",
  "selection.colors": "Couleurs",
  "selection.line": "Trait et angles",
  "selection.opacity": "Opacité",
  "selection.symbols": "Icônes",
  "selection.note": "Note locale",
  "selection.duplicate": "Dupliquer",
  "selection.actions": "Actions de l’objet",
  "selection.more": "Réglages avancés",
  "selection.close": "Fermer les réglages",
  "selection.stroke": "Contour",
  "selection.fill": "Remplissage",
  "selection.noFill": "Transparent",
  "selection.customColor": "Couleur personnalisée",
  "selection.contentGroup": "Contenu et couleurs",
  "selection.appearanceGroup": "Aspect du bloc",
  "selection.actionsGroup": "Actions et réglages",
  "selection.roundedRectangle": "Rectangle arrondi",
  "selection.circle": "Cercle",
  "selection.capsule": "Capsule",
  "selection.parallelogram": "Parallélogramme",
  "selection.reverseParallelogram": "Parallélogramme inversé",
  "selection.trapezoid": "Trapèze",
  "selection.triangle": "Triangle",
  "selection.hexagon": "Hexagone",
  "selection.cylinder": "Cylindre",
  "selection.brace": "Accolade",
  "selection.cloud": "Nuage",
  "selection.star": "Étoile",
  "selection.rectangle": "Rectangle",
  "selection.ellipse": "Ellipse",
  "selection.diamond": "Losange",
  "selection.solid": "Continu",
  "selection.dashed": "Tirets",
  "selection.dotted": "Pointillés",
  "selection.rotate": "Pivoter de 90°",
  "selection.strokeWidth": "Épaisseur du trait",
  "selection.filled": "Plein",
  "selection.outline": "Contour seul",
  "selection.dashedOutline": "Contour en tirets",
  "selection.rounded": "Angles arrondis",
  "selection.startArrowhead": "Embout de départ",
  "selection.endArrowhead": "Embout d’arrivée",
  "selection.apply": "Appliquer",
  "diagram.tool": "Diagramme rapide",
  "diagram.place":
    "Cliquez dans le tableau ou appuyez sur Entrée pour placer le premier bloc.",
  "diagram.controls": "Commandes du bloc sélectionné",
  "diagram.add.left": "Ajouter un bloc à gauche",
  "diagram.add.up": "Ajouter un bloc au-dessus",
  "diagram.add.down": "Ajouter un bloc en dessous",
  "diagram.add.right": "Ajouter un bloc à droite",
  "diagram.dimensions": "Dimensions du bloc",
  "diagram.label": "Texte du nouveau bloc",
  "diagram.labelPlaceholder": "Texte",
  "diagram.noSpace": "Aucun emplacement disponible dans cette direction.",
  "diagram.capacity": "Le tableau a atteint sa capacité.",
  "diagram.busy": "Terminez l’édition en cours, puis réessayez.",
  "diagram.labelFailed": "Le texte du bloc n’a pas pu être enregistré.",
  "mind.tool": "Carte mentale",
  "mind.place":
    "Cliquez dans le tableau ou appuyez sur Entrée pour placer le sujet central.",
  "mind.addChild": "Ajouter une branche",
  "mind.label": "Texte du sujet",
  "mind.keys":
    "Tab ajoute un enfant. Entrée ajoute un frère, ou le premier enfant du sujet central. Échap termine la saisie.",
  "mind.disconnected": "Ce sujet est détaché de sa carte mentale.",
} as const;

type Catalog = typeof fr;
export type MessageId = keyof Catalog;
type Params = Readonly<Record<string, string | number>>;

const locale = "fr-FR";
const plurals = new Intl.PluralRules(locale);
const dateTime = new Intl.DateTimeFormat(locale, {
  dateStyle: "medium",
  timeStyle: "short",
});

const fill = (template: string, params: Params): string =>
  template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.hasOwn(params, key) ? String(params[key]) : match,
  );

/** Renders a catalog message; plural entries select their form from the `count` parameter. */
export const t = (id: MessageId, params: Params = {}): string => {
  const entry: string | Readonly<Record<string, string>> = fr[id];
  if (typeof entry === "string") {
    return fill(entry, params);
  }
  const count = Number(params.count ?? 0);
  // "zero" is an explicit product choice (hide the label), not a CLDR category in French.
  const form = count === 0 && "zero" in entry ? "zero" : plurals.select(count);
  return fill(entry[form] ?? entry.other, params);
};

/** Formats an ISO timestamp for display, e.g. « 19 nov. 2026, 07:48 ». */
export const formatDate = (iso: string): string =>
  dateTime.format(new Date(iso));
