/** CUIRevive: 4E94E0 / 4E9750 / 4E99C0 / 4E9E30 / 4E9E70.
 * Native Notice skin, original Korean text, (268,104), OK at +(100,92).
 * The browser starts the 2200ms clock on authoritative HP=0 (native 509AF0 writes CField+680).
 * No local healing, teleport or test-tool mutation: OK/Enter asks for c2s 0x0D kind=0.
 */
export const REVIVE_DELAY_MS = 2200;
export const REVIVE_TEXT = [
  "확인을 누르시면 부활하게 됩니다.",
  "부활을 하시면 안전한 마을로 이동됩니다.",
];
export function reviveWindow({ ctx, image, send, isInGame, onOpen }) {
  const root = document.getElementById("revive-dialog"),
    ok = document.getElementById("revive-ok");
  let deathSince,
    opened = false,
    pending = false,
    sentAt = 0,
    hover = false,
    pressed = false;
  const reset = () => {
    deathSince = undefined;
    opened = pending = hover = pressed = false;
    root.classList.add("hidden");
    if (root.contains(document.activeElement)) document.activeElement.blur();
  };
  function accept() {
    if (!opened || pending || !isInGame()) return;
    pending = true;
    sentAt = performance.now();
    ok.disabled = true;
    send({ t: "revive" });
  }
  ok.addEventListener("click", accept);
  ok.addEventListener("pointerenter", () => {
    hover = true;
  });
  ok.addEventListener("pointerleave", () => {
    hover = pressed = false;
  });
  ok.addEventListener("pointerdown", () => {
    pressed = true;
  });
  window.addEventListener("pointerup", () => {
    pressed = false;
  });
  window.addEventListener("blur", () => {
    pressed = false;
  });
  window.addEventListener(
    "keydown",
    (event) => {
      if (!opened) return;
      event.stopImmediatePropagation();
      // Escape is swallowed, not Cancel: native revive has no cancel/close action.
      if (
        event.key === "Enter" ||
        event.key === "Escape" ||
        event.key === "Tab"
      ) {
        event.preventDefault();
        if (event.key === "Enter") accept();
        if (event.key === "Tab") ok.focus();
      }
    },
    { capture: true },
  );
  function stamp(path, x, y) {
    const art = image(path);
    if (art.ready) ctx.drawImage(art.img, x, y);
  }
  // Warm only original art; never invent a replacement notice or button.
  image("UI/Basic.img/Notice/backgrnd");
  for (const state of ["normal", "mouseOver", "pressed", "disabled"])
    image(`UI/Basic.img/BtOK/${state}/0`);
  return {
    reset,
    get open() {
      return opened;
    },
    receive(message) {
      if (["field", "login", "disconnect"].includes(message.t)) reset();
      if (["field", "self"].includes(message.t) && message.self) {
        if (message.self.hp > 0) reset();
        else if (message.self.hp <= 0 && deathSince === undefined)
          deathSince = performance.now();
      }
      if (message.t === "error" && pending) {
        pending = false;
        ok.disabled = false;
      }
    },
    draw(now) {
      if (!isInGame() || deathSince === undefined) return;
      if (!opened && now - deathSince > REVIVE_DELAY_MS) {
        opened = true;
        ok.disabled = false;
        onOpen();
        root.classList.remove("hidden");
        ok.focus();
      }
      if (!opened) return;
      // A lost/failed request may be retried; only a real field packet restores the character.
      if (pending && now - sentAt > 5000) {
        pending = false;
        ok.disabled = false;
      }
      ctx.save();
      stamp("UI/Basic.img/Notice/backgrnd", 268, 104);
      ctx.font = "12px 'Dotum', '돋움', 'KMSCJK', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      for (let i = 0; i < REVIVE_TEXT.length; i++) {
        const y = 154 + i * 14;
        ctx.fillStyle = "#fff";
        ctx.fillText(REVIVE_TEXT[i], 401, y + 1);
        ctx.fillStyle = "#000";
        ctx.fillText(REVIVE_TEXT[i], 400, y);
      }
      const state = pending
        ? "disabled"
        : pressed
          ? "pressed"
          : hover || document.activeElement === ok
            ? "mouseOver"
            : "normal";
      stamp(`UI/Basic.img/BtOK/${state}/0`, 368, 196);
      ctx.restore();
    },
  };
}
