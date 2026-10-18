import type { CanvasImage } from "./render-types.ts";
export interface UiPoint {
  x: number;
  y: number;
}
export type HtmlImageLookup = (path: string) => CanvasImage & { img: HTMLImageElement };
/** UI sound feedback only; it does not require or own the playback engine. */
export interface UiAudio {
  effect(path: string): unknown;
}
