export interface BackgroundLayer {
  x: number; y: number; rx: number; ry: number; type: number; cx: number; cy: number;
  ox?: number; oy?: number;
}
export function backgroundDrift(rx: number, elapsedMs: number): number;
export function backgroundLayout(back: BackgroundLayer, width: number, height: number,
  cameraX: number, cameraY: number, elapsedMs: number, viewW?: number, viewH?: number): {
  x: number; y: number; stepX: number; stepY: number; columns: number; rows: number;
};
