/** 4F8CB0 edit boundary. The caller owns transport/recipient/commands; this module owns DOM input.
 * IME Enter does not send; slash consumption is synchronous so rejected private commands cannot
 * race an async fallback to public chat. Shift+Enter retains focus; Escape/empty-arrow exits edit.
 */
export function chatEntry({
  input,
  onFocus,
  command,
  send,
}: {
  input: HTMLInputElement;
  onFocus(): void;
  command(text: string): boolean;
  send(text: string): void;
}) {
  const focus = () => onFocus();
  const blur = () => {
    input.placeholder = "";
  };
  const key = (event: KeyboardEvent) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (
      event.key === "Escape" ||
      (["ArrowLeft", "ArrowRight"].includes(event.key) && !input.value)
    ) {
      event.preventDefault();
      event.stopPropagation();
      input.value = "";
      input.blur();
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.stopPropagation();
    const text = input.value.trim();
    input.value = "";
    if (text && !command(text)) send(text);
    if (!event.shiftKey) input.blur();
  };
  input.addEventListener("focus", focus);
  input.addEventListener("blur", blur);
  input.addEventListener("keydown", key);
  return {
    dispose() {
      input.removeEventListener("focus", focus);
      input.removeEventListener("blur", blur);
      input.removeEventListener("keydown", key);
    },
  };
}
