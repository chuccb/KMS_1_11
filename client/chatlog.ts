import { requireQuery, requireContext2d } from "./dom.ts";
interface ChatGroup {
  text: string;
  tone: string;
  removed: number;
}
import { releaseOnInterrupt } from "./pointer.ts";
import { wrapChatText, followChat } from "./chatlayout.ts";
/** 4FB670/4FBEE0: six rows, 13px advance; cap 64 WRAPPED records, not 64 messages.
 * IWzFont is replaced by browser Gulim/fallback measurement, not by CSS auto wrapping.
 */
export function chatHistory({
  root,
  list,
  bar,
  clock = () => performance.now(),
}: {
  root: HTMLElement;
  list: HTMLElement;
  bar: HTMLElement;
  clock?: () => number;
}) {
  const prev = requireQuery(bar, "[data-chat-prev]", "button"),
    next = requireQuery(bar, "[data-chat-next]", "button");
  const thumb = requireQuery(bar, "[data-chat-thumb]", "button"),
    track = requireQuery(bar, "[data-chat-track]", "div");
  const context = requireContext2d(document.createElement("canvas"));
  const ownership = new WeakMap<Element, ChatGroup>();
  let drag: { y: number; scroll: number } | undefined,
    sticky = true,
    lastScroll = clock();
  const max = () => Math.max(0, root.scrollHeight - root.clientHeight);
  function sync() {
    const end = max(),
      enabled = end > 0;
    bar.classList.toggle("disabled", !enabled);
    prev.disabled = next.disabled = !enabled;
    thumb.hidden = !enabled;
    thumb.style.top = `${12 + (end ? Math.round((46 * root.scrollTop) / end) : 0)}px`;
  }
  function scroll(value: number) {
    root.scrollTop = Math.max(0, Math.min(max(), Math.round(value / 13) * 13));
    lastScroll = clock();
    sticky = root.scrollTop >= max() - 1;
    sync();
  }
  function changed(incoming = true) {
    while (list.children.length > 64) {
      const row = list.firstElementChild!;
      const group = ownership.get(row);
      if (!group) throw new Error("Chat history contains an unowned row");
      group.removed++;
      row.remove();
      root.scrollTop = Math.max(0, root.scrollTop - 13);
    }
    if (incoming ? list.children.length <= 7 || followChat(sticky, lastScroll, clock()) : sticky) {
      root.scrollTop = max();
      sticky = true;
    }
    sync();
  }
  function rows(group: ChatGroup) {
    context.font = "12px 'Gulim','굴림','KMSCJK',sans-serif";
    return wrapChatText(group.text, (text) => context.measureText(text).width)
      .slice(group.removed)
      .map((text) => {
        const row = document.createElement("li");
        row.textContent = text;
        row.className = group.tone;
        ownership.set(row, group);
        return row;
      });
  }
  function update(group: ChatGroup, text: unknown, tone = group.tone) {
    const old = [...list.children].filter((row) => ownership.get(row) === group);
    if (!old.length) return; // Late metadata never resurrects a pruned message or another owner's log.
    const prior = root.scrollTop;
    group.text = String(text);
    group.tone = tone;
    old[0].before(...rows(group));
    for (const row of old) row.remove();
    root.scrollTop = prior;
    changed(false);
  }
  prev.addEventListener("click", () => scroll(root.scrollTop - 13));
  next.addEventListener("click", () => scroll(root.scrollTop + 13));
  root.addEventListener(
    "wheel",
    (e) => {
      if (!e.deltaY) return;
      e.preventDefault();
      scroll(root.scrollTop + Math.sign(e.deltaY) * 39);
    },
    { passive: false },
  );
  track.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    const rect = bar.getBoundingClientRect(),
      scale = rect.height / 82;
    if (!scale) return;
    const local = (e.clientY - rect.top) / scale;
    scroll(root.scrollTop + (local < 12 + (46 * root.scrollTop) / (max() || 1) ? -78 : 78));
    e.preventDefault();
  });
  thumb.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    drag = { y: e.clientY, scroll: root.scrollTop };
    e.preventDefault();
  });
  window.addEventListener("mousemove", (e) => {
    if (!drag) return;
    const scale = bar.getBoundingClientRect().height / 82;
    if (!scale) return;
    scroll(drag.scroll + (((e.clientY - drag.y) / scale) * max()) / 46);
  });
  const release = () => {
    drag = undefined;
  };
  window.addEventListener("mouseup", release);
  releaseOnInterrupt(release);
  // Re-measure only on font availability changes, never on every RAF or every unrelated image load.
  document.fonts?.addEventListener("loadingdone", () => {
    const groups = new Set([...list.children].map((row) => ownership.get(row)));
    for (const group of groups) if (group) update(group, group.text);
  });
  return {
    append(text: unknown, tone = "normal") {
      const group = { text: String(text), tone, removed: 0 };
      list.append(...rows(group));
      changed();
      return { update: (text: unknown, tone?: string) => update(group, text, tone) };
    },
    changed,
    latest() {
      scroll(max());
    },
    cancelDrag: release,
    clear() {
      release();
      list.replaceChildren();
      sticky = true;
      sync();
    },
  };
}
