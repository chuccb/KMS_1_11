/** Component-only browser fixture, NOT imported by the game or a gameplay probe.
 * Installation is explicit. Real HTML images/canvas and production modules; no fake Image or WS.
 */
import { requireContext2d } from "../../../client/dom.ts";
import { archiveImages } from "../../../client/image-cache.ts";
import {
  createDropRecord,
  dropPosition,
  beginDropPickup,
  type DropPoint,
  type DropPose,
} from "../../../client/drop-presentation.ts";
import { dropRenderer, dropIconPath, mesoFramePath } from "../../../client/drop-renderer.ts";
export interface RewardFixtureInput {
  drop: unknown;
  now: number;
  camera: DropPoint;
  alpha?: number;
  pickup?: { at: number; id: number; taker?: DropPoint };
  wait?: boolean;
  throwDraw?: boolean;
}
export interface RewardFixtureResult {
  pose?: DropPose;
  painted: boolean;
  alpha: number;
  error?: string;
  draw?: { x: number; y: number; width: number; height: number; alpha: number; path: string };
  opaqueBottom?: number;
}
declare global {
  interface Window {
    rewardFixture: { render(input: RewardFixtureInput): Promise<RewardFixtureResult> };
  }
}
export function installRewardFixture(): void {
  const canvas = document.createElement("canvas");
  canvas.width = 800;
  canvas.height = 600;
  document.body.append(canvas);
  const ctx = requireContext2d(canvas),
    images = archiveImages(),
    facts = new Map<number, unknown>();
  const painter = dropRenderer({
    ctx,
    image: images.get,
    item: (id) => facts.get(id),
    describe: () => undefined,
  });
  window.rewardFixture = {
    async render(input) {
      const record = createDropRecord(input.drop, 0);
      if (!record) throw new Error("Invalid fixture packet");
      const drop = record.drop;
      if (!drop.money && !facts.has(drop.value)) {
        const response = await fetch(`/api/item/${drop.value}`);
        facts.set(drop.value, response.ok ? await response.json() : null);
      }
      painter.preload(drop);
      const path = drop.money
        ? mesoFramePath(drop.value, input.now)
        : dropIconPath(facts.get(drop.value));
      if (path && input.wait !== false) await images.get(path).loading;
      if (input.pickup) beginDropPickup(record, input.pickup.at, input.pickup.id);
      const pose = dropPosition(record, input.now, input.pickup?.taker),
        result: RewardFixtureResult = { pose, painted: false, alpha: 0 };
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = input.alpha ?? 1;
      const original = ctx.drawImage.bind(ctx);
      ctx.drawImage = (image: CanvasImageSource, x: number, y: number) => {
        if (!(image instanceof HTMLImageElement))
          throw new Error("Reward is not a real HTML image");
        if (input.throwDraw) throw new Error("Deliberate fixture draw failure");
        result.draw = {
          x,
          y,
          width: image.naturalWidth,
          height: image.naturalHeight,
          alpha: ctx.globalAlpha,
          path: decodeURIComponent(new URL(image.src).pathname),
        };
        original(image, x, y);
      };
      try {
        if (pose) result.painted = painter.draw(drop, pose, input.camera, input.now);
      } catch (error) {
        result.error = String(error);
      } finally {
        ctx.drawImage = original;
        result.alpha = ctx.globalAlpha;
      }
      if (result.draw) {
        const { x, y, width, height } = result.draw,
          pixels = ctx.getImageData(x, y, width, height).data;
        for (let row = height - 1; row >= 0; row--) {
          if (
            Array.from(
              { length: width },
              (_, column) => pixels[(row * width + column) * 4 + 3],
            ).some((alpha) => alpha !== 0)
          ) {
            result.opaqueBottom = y + row + 1;
            break;
          }
        }
      }
      return result;
    },
  };
}
