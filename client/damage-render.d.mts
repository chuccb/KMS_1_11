export interface DamageGlyph {
  path: string;
  width: number;
  height: number;
  ox: number;
  oy: number;
}
export function damageGlyphLayout(
  value: number,
  glyphs: Map<string, DamageGlyph>,
  jitter?: number[],
  palette?: "NoRed" | "NoViolet",
): (DamageGlyph & { x: number; y: number })[];
export function damageNumbers(options: {
  image: (path: string) => unknown;
  log: (message: string) => void;
}): {
  preload(): Promise<unknown>;
  draw(
    ctx: unknown,
    mark: unknown,
    cameraX: number,
    cameraY: number,
    now: number,
  ): void;
};
