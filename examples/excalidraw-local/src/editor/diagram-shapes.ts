/** Native rectangle bounds carry these outlines through editing, undo, and files. */
const outlines = {
  capsule: "",
  parallelogram: "M .22 0 L 1 0 L .78 1 L 0 1 Z",
  reverseParallelogram: "M 0 0 L .78 0 L 1 1 L .22 1 Z",
  trapezoid: "M .19 0 L .81 0 L 1 1 L 0 1 Z",
  triangle: "M .5 0 L 1 1 L 0 1 Z",
  hexagon: "M .25 0 L .75 0 L 1 .5 L .75 1 L .25 1 L 0 .5 Z",
  cylinder:
    "M 0 .18 C 0 -.06 1 -.06 1 .18 L 1 .82 C 1 1.06 0 1.06 0 .82 Z M 0 .18 C 0 .42 1 .42 1 .18",
  brace:
    "M .70 .02 C .44 .02 .43 .15 .43 .29 C .43 .42 .35 .48 .25 .5 C .35 .52 .43 .58 .43 .71 C .43 .85 .44 .98 .70 .98",
  cloud:
    "M .19 .84 C .05 .86 0 .77 .02 .64 C -.02 .53 .04 .41 .16 .39 C .12 .25 .22 .13 .36 .15 C .42 .01 .59 -.01 .68 .11 C .81 .07 .91 .16 .92 .29 C 1.02 .34 1.02 .48 .94 .55 C 1.02 .67 .94 .81 .82 .83 C .8 .96 .63 1 .56 .91 C .46 1.02 .31 1.01 .26 .91 C .21 .92 .19 .88 .19 .84 Z",
  star: "M .5 0 L .61 .28 L .87 .13 L .72 .39 L 1 .5 L .72 .61 L .87 .87 L .61 .72 L .5 1 L .39 .72 L .13 .87 L .28 .61 L 0 .5 L .28 .39 L .13 .13 L .39 .28 Z",
} as const;

export type DiagramShape = keyof typeof outlines;

export const readDiagramShape = (element: {
  type: string;
  customData?: Record<string, unknown>;
}): DiagramShape | undefined => {
  const shape = element.customData?.excalidrawLocalShape;
  return element.type === "rectangle" &&
    typeof shape === "string" &&
    Object.hasOwn(outlines, shape)
    ? (shape as DiagramShape)
    : undefined;
};

export const diagramShapePath = (
  shape: DiagramShape,
  width: number,
  height: number,
  x = 0,
  y = 0,
): string => {
  if (shape === "capsule") {
    const radius = Math.min(width, height) / 2;
    return `M ${x + radius} ${y} H ${
      x + width - radius
    } A ${radius} ${radius} 0 0 1 ${x + width} ${y + radius} V ${
      y + height - radius
    } A ${radius} ${radius} 0 0 1 ${x + width - radius} ${y + height} H ${
      x + radius
    } A ${radius} ${radius} 0 0 1 ${x} ${y + height - radius} V ${
      y + radius
    } A ${radius} ${radius} 0 0 1 ${x + radius} ${y} Z`;
  }
  return outlines[shape].replace(
    /(-?[\d.]+) (-?[\d.]+)/g,
    (_, px: string, py: string) =>
      `${x + Number(px) * width} ${y + Number(py) * height}`,
  );
};

export const diagramShapes = Object.keys(outlines) as DiagramShape[];
