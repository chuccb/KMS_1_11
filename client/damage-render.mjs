/** CAnimationDisplayer::41E610/41F200; NoRed for mob hits; NoViolet (palette 2) for incoming damage/MISS.
 * Glyph dimensions/origins are archive metadata, not hardcoded guessed font metrics.
 */
export function damageGlyphLayout(
  value,
  glyphs,
  jitter = [],
  palette = "NoRed",
) {
  if (!(value > 0)) {
    const g = glyphs.get(`${palette}0/Miss`);
    return g ? [{ ...g, x: -Math.trunc(g.width / 2), y: -g.height }] : [];
  }
  const digits = [...String(Math.trunc(value))];
  let cursor = 0,
    previous = 0;
  const out = [];
  for (let i = 0; i < digits.length; i++) {
    const g = glyphs.get(`${palette}${i === 0 ? 1 : 0}/${digits[i]}`);
    if (!g) return [];
    const anchor = cursor + g.ox - previous;
    out.push({
      ...g,
      x: anchor - g.ox,
      y: 10 - (i % 2 ? 1 : 4) - (jitter[i] ?? 0) - g.height,
    });
    cursor = g.width - g.ox + anchor;
    previous = Math.trunc((3 * (g.width - g.ox)) / 5);
  }
  const centre = Math.trunc(cursor / 2);
  return out.map((g) => ({ ...g, x: g.x - centre }));
}
export function damageNumbers({ image, log }) {
  const glyphs = new Map();
  let loading;
  function preload() {
    return (loading ??= Promise.all(
      ["NoRed", "NoViolet"]
        .flatMap((palette) => [
          ...[0, 1].flatMap((bank) =>
            Array.from({ length: 10 }, (_, n) => `${palette}${bank}/${n}`),
          ),
          `${palette}0/Miss`,
        ])
        .map(async (key) => {
          const path = `Effect/BasicEff.img/${key}`;
          const response = await fetch(
            `/api/canvas/${encodeURIComponent(path)}`,
          );
          if (!response.ok)
            throw new Error(`Damage glyph unavailable: ${path}`);
          const meta = await response.json();
          glyphs.set(key, { ...meta, path });
          image(path);
        }),
    ).catch((error) => {
      loading = undefined;
      log(String(error));
    }));
  }
  return {
    preload,
    draw(ctx, mark, cameraX, cameraY, now) {
      const elapsed = now - mark.start;
      if (elapsed < 0 || elapsed >= 1000) return;
      if (mark.avatar && !Number.isFinite(mark.avatar.damageOriginY)) return;
      const anchor = mark.avatar?.damageOriginY ?? 0;
      const layout = damageGlyphLayout(
        mark.value,
        glyphs,
        mark.jitter,
        mark.palette,
      );
      // 400ms opaque + 600ms fade, 30px rise over 1000ms. No CSS-font fallback.
      ctx.save();
      ctx.globalAlpha = elapsed <= 400 ? 1 : (1000 - elapsed) / 600;
      for (const g of layout) {
        const art = image(g.path);
        if (art.ready)
          ctx.drawImage(
            art.img,
            Math.round(mark.x - cameraX + g.x),
            Math.round(mark.y - anchor - cameraY - (30 * elapsed) / 1000 + g.y),
          );
      }
      ctx.restore();
    },
  };
}
