/** IWzFont metrics are supplied by the caller; browser fallback metrics are NOT original GDI.
 * 4FB670: wrap at 444 - VScr(12), trim continuation whitespace, indent five literal spaces.
 */
export function wrapChatText(
  value: unknown,
  measure: (text: string) => number,
  width: number = 432,
  continuation: string = "     ",
): string[] {
  const lines = [];
  for (const paragraph of String(value).replace(/\r\n?/g, "\n").split("\n")) {
    let rest = paragraph,
      prefix = "";
    do {
      const chars = Array.from(rest);
      let count = 0;
      while (count < chars.length && measure(prefix + chars.slice(0, count + 1).join("")) <= width)
        count++;
      if (count === 0 && chars.length) count = 1; // A wide glyph must make progress, never loop forever.
      lines.push(prefix + chars.slice(0, count).join("").trimEnd());
      rest = chars.slice(count).join("").trimStart();
      prefix = continuation;
    } while (rest);
  }
  return lines;
}
/** 4373A0: normal/dead frame uses 12px cells, 14px rows, at most seven columns, odd width. */
export function balloonLayout(
  text: string,
  measure: (text: string) => number,
  dead: boolean = false,
): {
  lines: string[];
  columns: number;
  width: number;
  height: number;
  x: number;
  y: number;
  arrowY: number;
} {
  const lines = wrapChatText(text, measure, 84, "");
  const columns =
    lines.length === 1 ? Math.min(7, Math.max(1, Math.ceil(measure(lines[0]) / 12) | 1)) : 7;
  const width = 12 + 12 * columns,
    height = 6 + (dead ? 15 : 13) + 14 * lines.length;
  return {
    lines,
    columns,
    width,
    height,
    x: 3 - Math.trunc(width / 2),
    y: -height,
    arrowY: height - (dead ? 15 : 13),
  };
}
/** 4386E0: full balloon top; its bounding box ends above the feet-anchored nameplate. */
export function balloonTop(
  y: number,
  originY: number,
  layout: Pick<ReturnType<typeof balloonLayout>, "y">,
) {
  return Math.round(y - originY - 5 + layout.y);
}
/** 4FB670: reader may hold scroll for <=5000ms; later incoming text returns to latest. */
export function followChat(sticky: boolean, lastScroll: number, now: number): boolean {
  return sticky || now - lastScroll > 5000;
}
