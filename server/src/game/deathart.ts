/** 509AF0: queue fall frames only until >=800ms, then every land frame, hold the last canvas.
 * Existing dead users (5084C0 a3!=0) get land/(count-1) immediately, with no new sound/fall/fade.
 * No generated replacement art; original origins/delays are read through the shared WZ reader.
 */
import { spriteFrames, type SpriteFrame } from "./sprites.ts";
import type { ArtReader } from "./wzart.ts";
export interface DeathArt {
  fall: SpriteFrame[];
  land: SpriteFrame[];
}
export function deathArtOf(reader: ArtReader): DeathArt | undefined {
  const fall = spriteFrames(reader, "Effect/Tomb.img", "fall", [], 90);
  const land = spriteFrames(reader, "Effect/Tomb.img", "land", [], 90);
  if (!fall.length || !land.length) return undefined;
  const queued: SpriteFrame[] = [];
  let elapsed = 0,
    index = 0;
  while (elapsed < 800) {
    const frame = fall[index++ % fall.length]!;
    queued.push(frame);
    elapsed += frame.delay;
  }
  return { fall: queued, land };
}
