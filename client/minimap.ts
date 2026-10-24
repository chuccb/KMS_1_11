import type { MiniMapArt } from "../server/src/game/minimap.ts";
import type { ImageLookup } from "./render-types.ts";
import type { UiPoint } from "./ui-types.ts";
import { requireElement, requireContext2d } from "./dom.ts";
import { isRecord, isFiniteNumber } from "./resource-validation.ts";
type MiniMapGeometry = Omit<MiniMapArt, "path" | "npcs"> & { npcs?: readonly UiPoint[] };
type MiniMapViewport = { width: number; height: number; x: number; y: number };
type MiniMapPortal = UiPoint & { type: number };
interface MiniMapMark extends UiPoint {
  w: number;
  h: number;
  color: string;
  kind: "portal" | "npc" | "user" | "self";
}
interface MiniMapOptions {
  ctx: CanvasRenderingContext2D;
  image: ImageLookup;
  getSelf(): UiPoint | undefined;
  getUsers(): readonly UiPoint[];
  isInGame(): boolean;
  point(event: MouseEvent): UiPoint;
  isCovered?(point: UiPoint): boolean;
  onVisibilityChange?(shown: boolean): void;
  viewport?(): { width: number; height: number };
}
import { releaseOnInterrupt } from "./pointer.ts";
/** Original CUIMiniMap: sub_4E52C0, sub_4E5C70, sub_4E6430; config sub_43D750.
 * No modern map-name header, invented monster dots or rescaled whole-map thumbnail. */
export const MINI_FRAME = "UI/UIWindow.img/MiniMap";
export function miniMapViewport(map: MiniMapGeometry, self?: UiPoint) {
  const width = map.canvasWidth >= 280 ? 210 : map.canvasWidth,
    height = map.canvasHeight >= 150 ? 112 : map.canvasHeight;
  const unit = 2 ** map.mag;
  // Native clamps low THEN high; preserve integer division / arithmetic shift semantics.
  const crop = (v: number, center: number, total: number, size: number) =>
    Math.floor(
      (center +
        Math.min(
          Math.max(Math.trunc(v) - Math.trunc((size * unit) / 2), -center),
          total - center - size * unit,
        )) /
        unit,
    );
  return {
    width,
    height,
    x: crop(self?.x ?? 0, map.centerX, map.width, width),
    y: crop(self?.y ?? 0, map.centerY, map.height, height),
  };
}
export function miniMapPoint(
  map: MiniMapGeometry,
  viewport: Pick<MiniMapViewport, "x" | "y">,
  point: UiPoint,
) {
  const unit = 2 ** map.mag;
  return {
    x: Math.floor((map.centerX + Math.trunc(point.x)) / unit) - viewport.x,
    y: Math.floor((map.centerY + Math.trunc(point.y)) / unit) - viewport.y,
  };
}
/** Two overlapping rectangles are the ORIGINAL marker shapes/ARGB colors, not substitute icons. */
export function miniMapMarks(
  map: MiniMapGeometry,
  viewport: Pick<MiniMapViewport, "x" | "y">,
  self: UiPoint | undefined,
  users: readonly UiPoint[] = [],
  portals: readonly MiniMapPortal[] = [],
  tick = 0,
) {
  const out: MiniMapMark[] = [],
    add = (p: UiPoint, color: string, kind: MiniMapMark["kind"]) => {
      const at = miniMapPoint(map, viewport, p);
      const shapes =
        kind === "portal"
          ? [
              [at.x + 1, at.y - 2, 4, 6],
              [at.x, at.y - 1, 6, 4],
            ]
          : kind === "npc"
            ? [
                [at.x + 2, at.y - 2, 2, 6],
                [at.x + 1, at.y - 1, 4, 5],
              ]
            : [
                [at.x + 2, at.y - 2, 2, 6],
                [at.x + 1, at.y - 1, 4, 5],
              ];
      for (const [x, y, w, h] of shapes) out.push({ x, y, w, h, color, kind });
    };
  if (tick % 128 < 64)
    for (let i = portals.length - 1; i >= 0; i--)
      if (portals[i].type === 2) add(portals[i], "#8090ffcc", "portal");
  if (tick % 80 < 40) for (const p of map.npcs ?? []) add(p, "#20ff20aa", "npc");
  for (const p of users) add(p, "#ff2020aa", "user");
  if (self) add(self, "#ffff00dd", "self");
  return out;
}
export function miniMapWindow({
  ctx,
  image,
  getSelf,
  getUsers,
  isInGame,
  point,
  isCovered,
  onVisibilityChange,
  viewport = () => ({ width: 800, height: 600 }),
}: MiniMapOptions) {
  const root = requireElement("minimap-window", "div");
  let map: MiniMapArt | undefined,
    portals: readonly MiniMapPortal[] = [],
    shown = true,
    at = { x: 8, y: 8 },
    drag: UiPoint | undefined,
    pointer: UiPoint | undefined,
    cache: HTMLCanvasElement | undefined,
    cacheCtx: CanvasRenderingContext2D | undefined,
    epoch = -1,
    clockAt: number | undefined,
    tick = 0;
  try {
    const saved: unknown = JSON.parse(localStorage.getItem("kms111.minimap") ?? "null");
    if (isRecord(saved)) {
      shown = saved.shown !== false;
      if (isFiniteNumber(saved.x) && isFiniteNumber(saved.y))
        at = {
          x: Math.max(0, Math.min(784, Math.round(saved.x))),
          y: Math.max(0, Math.min(584, Math.round(saved.y))),
        };
    }
  } catch {}
  const save = () => {
    try {
      localStorage.setItem("kms111.minimap", JSON.stringify({ ...at, shown }));
    } catch {}
  };
  function limits(v = map ? miniMapViewport(map, getSelf()) : undefined) {
    const size = viewport(),
      width = v?.width ?? 210,
      height = v?.height ?? 112;
    return {
      x: Math.max(0, size.width - (width + 6)),
      y: Math.max(0, size.height - (height + 13)),
    };
  }
  function sync() {
    const v = map ? miniMapViewport(map, getSelf()) : undefined,
      max = limits(v);
    at = {
      x: Math.max(0, Math.min(max.x, at.x)),
      y: Math.max(0, Math.min(max.y, at.y)),
    };
    root.classList.toggle("hidden", !shown || !v || !isInGame());
    root.style.pointerEvents = !drag && pointer && isCovered?.(pointer) ? "none" : "auto";
    Object.assign(root.style, {
      left: `${at.x}px`,
      top: `${at.y}px`,
      width: `${(v?.width ?? 0) + 6}px`,
      height: `${(v?.height ?? 0) + 13}px`,
    });
  }
  root.addEventListener("mousedown", (e) => {
    if (!map || !shown || e.button > 0) return;
    const p = point(e);
    drag = { x: p.x - at.x, y: p.y - at.y };
    e.preventDefault();
  });
  window.addEventListener("mousemove", (e) => {
    const p = point(e);
    pointer = p;
    if (!drag) {
      sync();
      return;
    }
    const max = limits();
    at = {
      x: Math.max(0, Math.min(max.x, Math.round(p.x - drag.x))),
      y: Math.max(0, Math.min(max.y, Math.round(p.y - drag.y))),
    };
    sync();
  });
  const release = () => {
    if (drag) {
      drag = undefined;
      save();
    }
  };
  window.addEventListener("mouseup", release);
  releaseOnInterrupt(release);
  const stamp = (name: string, x: number, y: number, w?: number, h?: number) => {
    const a = image(`${MINI_FRAME}/${name}`);
    if (!a.ready || !cacheCtx) return false;
    if (w === undefined || h === undefined) cacheCtx.drawImage(a.img, x, y);
    else cacheCtx.drawImage(a.img, x, y, w, h);
    return true;
  };
  return {
    setMap(value: MiniMapArt | undefined, doors: readonly MiniMapPortal[] = []) {
      map = value;
      portals = doors;
      epoch = -1;
      clockAt = undefined;
      cache = undefined;
      sync();
    },
    toggle() {
      shown = !shown;
      save();
      sync();
      onVisibilityChange?.(shown);
    },
    // GameOpt preview/cancel must not persist its draft into the older position profile.
    setShown(value: boolean) {
      shown = !!value;
      sync();
    },
    get shown() {
      return shown;
    },
    contains(x: number, y: number) {
      if (!shown || !map || !isInGame()) return false;
      const v = miniMapViewport(map, getSelf());
      return x >= at.x && y >= at.y && x < at.x + v.width + 6 && y < at.y + v.height + 13;
    },
    draw(now: number) {
      sync();
      if (!map || !isInGame() || !getSelf()) {
        clockAt = undefined;
        return;
      }
      // sub_553F40 calls the registered updates through sub_549660 at 30ms intervals.
      // Accumulate by elapsed time, not RAF count. A hidden-but-loaded native window still updates.
      clockAt ??= now;
      const steps = Math.max(0, Math.floor((now - clockAt) / 30));
      tick += steps;
      clockAt += steps * 30;
      if (!shown) return;
      const nextEpoch = Math.floor(tick / 4),
        v = miniMapViewport(map, getSelf());
      const bitmap = image(map.path);
      const ready =
        bitmap.ready &&
        ["nw", "n", "ne", "w", "e", "sw", "s", "se"].every(
          (k) => image(`${MINI_FRAME}/${k}`).ready,
        );
      if (!ready) return;
      if (!cache) {
        cache = document.createElement("canvas");
        cache.width = v.width + 6;
        cache.height = v.height + 13;
        cacheCtx = requireContext2d(cache);
        cacheCtx.imageSmoothingEnabled = false;
      }
      if (!cacheCtx) return;
      if (epoch !== nextEpoch) {
        epoch = nextEpoch;
        cacheCtx.clearRect(0, 0, cache.width, cache.height);
        // sub_4E5C70 clears white, overlays ARGB A0000000, then copies the original bitmap at 1:1.
        cacheCtx.fillStyle = "#ffffff";
        cacheCtx.fillRect(3, 3, v.width, v.height);
        cacheCtx.fillStyle = "#000000a0";
        cacheCtx.fillRect(3, 3, v.width, v.height);
        cacheCtx.save();
        cacheCtx.beginPath();
        cacheCtx.rect(3, 3, v.width, v.height);
        cacheCtx.clip();
        cacheCtx.drawImage(bitmap.img, v.x, v.y, v.width, v.height, 3, 3, v.width, v.height);
        // Native establishes the same content clip for both bitmap and marker rectangles.
        for (const m of miniMapMarks(map, v, getSelf(), getUsers(), portals, tick)) {
          cacheCtx.fillStyle = m.color;
          cacheCtx.fillRect(m.x, m.y, m.w, m.h);
        }
        cacheCtx.restore();
        stamp("n", 4, 0, v.width - 2, 3);
        stamp("s", 4, v.height + 3, v.width - 2, 3);
        stamp("w", 0, 4, 3, v.height - 2);
        stamp("e", v.width + 3, 4, 3, v.height - 2);
        stamp("nw", 0, 0);
        stamp("ne", v.width + 2, 0);
        stamp("sw", 0, v.height + 2);
        stamp("se", v.width + 2, v.height + 2);
      }
      ctx.drawImage(cache, at.x, at.y);
    },
  };
}
