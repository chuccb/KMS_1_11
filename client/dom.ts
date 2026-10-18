/** Required elements belong to index.html's schema: fail clearly instead of hiding wiring errors. */
export function requireElement<K extends keyof HTMLElementTagNameMap>(
  id: string,
  tag: K,
): HTMLElementTagNameMap[K] {
  return requireTag(document.getElementById(id), tag, `#${id}`);
}
export function requireQuery<K extends keyof HTMLElementTagNameMap>(
  root: ParentNode,
  selector: string,
  tag: K,
): HTMLElementTagNameMap[K] {
  return requireTag(root.querySelector(selector), tag, selector);
}
function requireTag<K extends keyof HTMLElementTagNameMap>(
  element: Element | null,
  tag: K,
  description: string,
): HTMLElementTagNameMap[K] {
  if (!element || element.localName !== tag) {
    throw new Error(`Expected <${tag}> for ${description}`);
  }
  // This is the single DOM schema boundary, validated against the actual tag above.
  return element as HTMLElementTagNameMap[K];
}
export function requireContext2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("A 2D canvas context is required");
  return context;
}
/** Element can also be SVG; test the focus capability rather than assuming HTMLElement. */
export function focusTarget(
  element: Element | null,
): (Element & { focus(): void; blur(): void }) | undefined {
  return element &&
    "focus" in element &&
    typeof element.focus === "function" &&
    "blur" in element &&
    typeof element.blur === "function"
    ? (element as Element & { focus(): void; blur(): void })
    : undefined;
}
export function blurWithin(root: Node): void {
  const active = document.activeElement;
  if (root.contains(active)) focusTarget(active)?.blur();
}

/** Native browser editors/selects own their keys; camera/scale selection must not move a player. */
export function isEditingControl(element: Element | null): boolean {
  return element !== null && ["input", "textarea", "select"].includes(element.localName);
}
