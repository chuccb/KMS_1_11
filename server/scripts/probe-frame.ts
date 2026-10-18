/** Pure evidence analysis: decoded native image blits in one RAF must reach the actual view canvas. */
import type { ProbeDraw } from "./browser-observation.ts";
export const FRAME_LAYERS = [
  "title",
  "background",
  "tile",
  "avatar",
  "npc",
  "item-drop",
  "meso-drop",
] as const;
export type FrameLayer = (typeof FRAME_LAYERS)[number];
export function frameLayers(value: string): FrameLayer[] {
  const names = value.split(",");
  const layers = names.map((name) => {
    const found = FRAME_LAYERS.find((entry) => entry === name);
    if (!found) throw new Error(`Unknown frame layer ${name}`);
    return found;
  });
  if (new Set(layers).size !== layers.length) throw new Error("Duplicate frame layers");
  for (const required of ["background", "tile", "avatar"] as const)
    if (!layers.includes(required)) throw new Error(`Field frame must require ${required}`);
  if (layers.includes("title")) throw new Error("Title is not a field layer");
  return layers;
}
function layerOf(src: string, origin: string): FrameLayer | undefined {
  if (!src) return undefined;
  let url: URL;
  try {
    url = new URL(src, origin);
  } catch {
    return undefined;
  }
  if (url.origin !== origin) return undefined;
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return undefined;
  }
  if (path === "/api/avatar.png") return "avatar";
  if (path.startsWith("/api/png/UI/Login.img/Title/")) return "title";
  if (path.startsWith("/api/png/Map/Back/")) return "background";
  if (path.startsWith("/api/png/Map/Tile/")) return "tile";
  if (path.startsWith("/api/png/Npc/")) return "npc";
  if (/^\/api\/png\/Item\/Special\/0900\.img\/0900000[0-3]\/iconRaw\/\d+$/.test(path))
    return "meso-drop";
  if (path.startsWith("/api/png/Item/") && path.endsWith("/iconRaw")) return "item-drop";
  return undefined;
}
interface Bounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
function rectangle(x: number, y: number, w: number, h: number): Bounds {
  return {
    left: Math.min(x, x + w),
    right: Math.max(x, x + w),
    top: Math.min(y, y + h),
    bottom: Math.max(y, y + h),
  };
}
function intersect(a: Bounds, b: Bounds): Bounds | undefined {
  const result = {
    left: Math.max(a.left, b.left),
    right: Math.min(a.right, b.right),
    top: Math.max(a.top, b.top),
    bottom: Math.min(a.bottom, b.bottom),
  };
  return result.left < result.right && result.top < result.bottom ? result : undefined;
}
function source(draw: ProbeDraw): Bounds {
  return draw.args.length === 8
    ? rectangle(draw.args[0]!, draw.args[1]!, draw.args[2]!, draw.args[3]!)
    : rectangle(0, 0, ...draw.sourceSize);
}
/** Clip to decoded source pixels before projecting through destination sizing and the canvas CTM. */
function project(draw: ProbeDraw, area: Bounds): Bounds {
  const args = draw.args,
    src = source(draw),
    x = args.length === 8 ? args[4]! : args[0]!,
    y = args.length === 8 ? args[5]! : args[1]!;
  const width = args.length === 2 ? draw.sourceSize[0] : args.length === 4 ? args[2]! : args[6]!;
  const height = args.length === 2 ? draw.sourceSize[1] : args.length === 4 ? args[3]! : args[7]!;
  const dest = rectangle(x, y, width, height),
    m = draw.matrix;
  const points = [
    [area.left, area.top],
    [area.right, area.top],
    [area.left, area.bottom],
    [area.right, area.bottom],
  ].map(([sx = 0, sy = 0]) => {
    const px = dest.left + ((sx - src.left) * (dest.right - dest.left)) / (src.right - src.left),
      py = dest.top + ((sy - src.top) * (dest.bottom - dest.top)) / (src.bottom - src.top);
    return [m.a * px + m.c * py + m.e, m.b * px + m.d * py + m.f];
  });
  const xs = points.map((p) => p[0]!),
    ys = points.map((p) => p[1]!);
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  };
}
function raster(draw: ProbeDraw): Bounds | undefined {
  const clipped = intersect(source(draw), rectangle(0, 0, ...draw.sourceSize));
  return clipped ? project(draw, clipped) : undefined;
}
export function analyzeFrame(
  draws: readonly ProbeDraw[],
  origin: string,
  required: readonly FrameLayer[],
) {
  const complete: { frame: number; canvas: number; layers: FrameLayer[]; paths: string[] }[] = [];
  for (let end = 0; end < draws.length; end++) {
    const present = draws[end]!;
    if (
      present.frame <= 0 ||
      present.targetId !== "view" ||
      present.alpha <= 0 ||
      present.sourceCanvas === undefined
    )
      continue;
    const view = rectangle(0, 0, ...present.canvas),
      footprint = raster(present);
    if (!footprint || !intersect(footprint, view)) continue;
    const crop = intersect(source(present), rectangle(0, 0, ...present.sourceSize));
    if (!crop) continue;
    const paths: string[] = [],
      layers = new Set<FrameLayer>();
    for (const draw of draws.slice(0, end)) {
      if (
        draw.frame !== present.frame ||
        draw.target !== present.sourceCanvas ||
        draw.targetGeneration !== present.sourceGeneration ||
        draw.alpha <= 0 ||
        draw.sourceSize.some((size) => size <= 0)
      )
        continue;
      const layer = layerOf(draw.src, origin);
      const footprint = raster(draw),
        clipped = footprint && intersect(footprint, crop);
      if (layer && clipped && intersect(project(present, clipped), view)) {
        layers.add(layer);
        paths.push(draw.src);
      }
    }
    if (required.every((layer) => layers.has(layer)))
      complete.push({
        frame: present.frame,
        canvas: present.sourceCanvas,
        layers: [...layers],
        paths,
      });
  }
  return complete.at(-1);
}
