/** Reward-only renderer. Inventory icon origins do NOT define a reward's ground anchor.
 * Native sub_4A88A0 centers its canvas at (groundX, groundY-16); this browser intentionally
 * bottom-aligns the actual PNG to the authoritative FH instead, per the grounded-drop requirement.
 * Native assets/size and money tiers are retained; no padding, fake sprite or ground-y mutation.
 */
import type { DropAppear } from "../server/src/protocol/drop.ts";
import type { LoadedImage } from "./image-cache.ts";
import type { DropPoint, DropPose } from "./drop-presentation.ts";
import { isRecord, isTooltipIcon } from "./resource-validation.ts";

/** Existing browser animation cadence; not a measured native frame delay. */
export const MESO_FRAME_MS = 140;
export const MESO_FRAME_COUNT = 4;
/** Native sub_4A9C10 amount thresholds, not item IDs or probabilities. */
export function mesoTier(amount: number): number {
  return amount < 50 ? 0 : amount < 100 ? 1 : amount < 1000 ? 2 : 3;
}
export function mesoFramePath(amount: number, now: number): string {
  const frame = Math.floor(Math.max(0, now) / MESO_FRAME_MS) % MESO_FRAME_COUNT;
  return `Item/Special/0900.img/0900000${mesoTier(amount)}/iconRaw/${frame}`;
}
export function dropIconPath(facts: unknown): string | undefined {
  return isRecord(facts) &&
    isTooltipIcon(facts.iconRaw) &&
    facts.iconRaw.path.length > 0 &&
    Number.isSafeInteger(facts.iconRaw.width) &&
    Number.isSafeInteger(facts.iconRaw.height) &&
    facts.iconRaw.width > 0 &&
    facts.iconRaw.height > 0
    ? facts.iconRaw.path
    : undefined;
}
export interface DropRendererOptions {
  ctx: CanvasRenderingContext2D;
  image(path: string): LoadedImage;
  item(itemId: number): unknown;
  describe(itemId: number): unknown;
  viewport?(): { width: number; height: number };
}
export function dropRenderer({
  ctx,
  image,
  item,
  describe,
  viewport = () => ctx.canvas,
}: DropRendererOptions) {
  return {
    /** Start all native money frames together; never animate a partial, growing frame list. */
    preload(drop: DropAppear): void {
      if (drop.money) {
        for (let frame = 0; frame < MESO_FRAME_COUNT; frame++)
          image(mesoFramePath(drop.value, frame * MESO_FRAME_MS));
      } else describe(drop.value);
    },
    draw(drop: DropAppear, pose: DropPose, camera: DropPoint, now: number): boolean {
      let path: string | undefined;
      if (drop.money) path = mesoFramePath(drop.value, now);
      else {
        describe(drop.value);
        path = dropIconPath(item(drop.value));
      }
      if (!path) return false;
      const loaded = image(path),
        { img } = loaded;
      if (!loaded.ready || img.naturalWidth <= 0 || img.naturalHeight <= 0) return false;
      const x = Math.round(pose.x - camera.x) - Math.trunc(img.naturalWidth / 2);
      const y = Math.round(pose.y - camera.y) - img.naturalHeight;
      const visible = viewport();
      if (
        x + img.naturalWidth < 0 ||
        x > visible.width ||
        y + img.naturalHeight < 0 ||
        y > visible.height
      )
        return false;
      const alpha = ctx.globalAlpha;
      try {
        ctx.globalAlpha = alpha * (pose.phase === "pickup" ? 1 - pose.t * 0.75 : 1);
        ctx.drawImage(img, x, y);
      } finally {
        ctx.globalAlpha = alpha;
      }
      return true;
    },
  };
}
