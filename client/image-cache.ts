import type { FaceAnimation } from "../server/src/game/face.ts";

export interface LoadedImage {
  img: HTMLImageElement;
  ready: boolean;
  loading: Promise<void>;
}
export interface AvatarImage extends LoadedImage {
  dx: number;
  dy: number;
  planeHeight: number;
  damageOriginY?: number;
}
export interface BrowserLook {
  face: number;
  hair: number;
  items: readonly number[];
}
interface ImageCacheOptions {
  image?(): HTMLImageElement;
  limit?: number;
}
function cacheLimit(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error("Image cache limit must be a positive integer");
  return value;
}
/** Browser memory budgets, not native constants. Evict 1/4 in insertion order, preferring to
 * retain shared UI/damage glyphs. Preference must not let an all-UI cache grow without bound.
 * Eviction releases cache ownership only; already-held images/promises remain valid.
 */
function makeRoom<T>(
  cache: Map<string, T>,
  limit: number,
  preferred: (key: string) => boolean = () => false,
) {
  if (cache.size < limit) return;
  let left = Math.max(1, Math.floor(limit / 4));
  for (const key of cache.keys()) {
    if (preferred(key)) continue;
    cache.delete(key);
    if (--left === 0) return;
  }
  for (const key of cache.keys()) {
    cache.delete(key);
    if (--left === 0) return;
  }
}
export function archiveImages({
  image = () => new Image(),
  limit: requestedLimit,
}: ImageCacheOptions = {}) {
  const limit = cacheLimit(requestedLimit, 1024);
  const entries = new Map<string, LoadedImage>();
  const preferred = (path: string) =>
    path.startsWith("UI/") || /^Effect\/BasicEff\.img\/No(?:Red|Violet)/.test(path);
  function get(path: string): LoadedImage {
    const cached = entries.get(path);
    if (cached) return cached;
    makeRoom(entries, limit, preferred);
    const entry: LoadedImage = { img: image(), ready: false, loading: Promise.resolve() };
    entries.set(path, entry);
    entry.loading = new Promise<void>((resolve) => {
      const finish = (ready: boolean) => {
        entry.ready = ready;
        entry.img.onload = null;
        entry.img.onerror = null;
        if (!ready && entries.get(path) === entry) entries.delete(path);
        resolve(); // callers inspect ready; failures retry without an unhandled rejection.
      };
      entry.img.onload = () => finish(true);
      entry.img.onerror = () => finish(false);
      try {
        entry.img.src = `/api/png/${encodeURIComponent(path)}`;
      } catch {
        finish(false);
      }
    });
    return entry;
  }
  return {
    get,
    get size() {
      return entries.size;
    },
  };
}

interface AvatarCacheOptions extends ImageCacheOptions {
  fetcher?: (url: string) => Promise<Response>;
  faceProfile?(face: number): FaceAnimation | undefined;
  createUrl?(blob: Blob): string;
  revokeUrl?(url: string): void;
}
function headerNumber(headers: Headers, name: string, fallback = 0): number {
  const raw = headers.get(name);
  if (raw === null) return fallback;
  if (!raw.trim() || !Number.isFinite(Number(raw)))
    throw new Error(`Invalid avatar header: ${name}`);
  return Number(raw);
}
export function avatarImages({
  image = () => new Image(),
  limit: requestedLimit,
  fetcher = fetch,
  faceProfile = () => undefined,
  createUrl = (blob) => URL.createObjectURL(blob),
  revokeUrl = (url) => URL.revokeObjectURL(url),
}: AvatarCacheOptions = {}) {
  const limit = cacheLimit(requestedLimit, 256);
  const entries = new Map<string, AvatarImage>();
  function get(
    look: BrowserLook,
    stance: string,
    frame: number,
    flip: boolean,
    emotion?: string,
    planes = false,
    faceFrame = 0,
  ): AvatarImage {
    // Actual cache membership, not a stale once-only warm marker, also covers character previews.
    if (emotion === undefined)
      for (const blink of faceProfile(look.face)?.actions.blink?.frames ?? [])
        get(look, stance, frame, flip, "blink", planes, blink.index);
    const key = JSON.stringify([
      look.face,
      look.hair,
      look.items,
      stance,
      frame,
      flip,
      emotion ?? "default",
      faceFrame,
      planes,
    ]);
    const cached = entries.get(key);
    if (cached) {
      entries.delete(key);
      entries.set(key, cached); // avatar poses are LRU, unlike archive FIFO.
      return cached;
    }
    makeRoom(entries, limit);
    const entry: AvatarImage = {
      img: image(),
      dx: 0,
      dy: 0,
      planeHeight: 0,
      ready: false,
      loading: Promise.resolve(),
    };
    entries.set(key, entry);
    const query = new URLSearchParams({
      face: String(look.face),
      hair: String(look.hair),
      items: look.items.join(","),
      stance,
      frame: String(frame),
      flip: flip ? "1" : "0",
      emotion: emotion ?? "default",
      planes: planes ? "1" : "0",
      faceFrame: String(faceFrame),
      v: "20261018-native-body-motion",
    });
    entry.loading = Promise.resolve()
      .then(() => fetcher(`/api/avatar.png?${query}`))
      .then(async (response) => {
        if (!response.ok) throw new Error(`Avatar HTTP ${response.status}`);
        entry.dx = headerNumber(response.headers, "x-frame-dx");
        entry.dy = headerNumber(response.headers, "x-frame-dy");
        entry.planeHeight = headerNumber(response.headers, "x-frame-plane-height");
        if (!Number.isSafeInteger(entry.planeHeight) || entry.planeHeight < 0)
          throw new Error("Invalid avatar plane height");
        if (response.headers.has("x-frame-damage-origin-y"))
          entry.damageOriginY = headerNumber(response.headers, "x-frame-damage-origin-y");
        const url = createUrl(await response.blob());
        try {
          const decoded = image();
          await new Promise<void>((resolve, reject) => {
            decoded.onload = () => resolve();
            decoded.onerror = () => reject(new Error("Avatar PNG decode failed"));
            decoded.src = url;
          });
          entry.img = decoded;
          entry.ready = true;
        } finally {
          revokeUrl(url);
        }
      })
      .catch(() => {
        if (entries.get(key) === entry) entries.delete(key);
      });
    return entry;
  }
  return {
    get,
    get size() {
      return entries.size;
    },
  };
}
