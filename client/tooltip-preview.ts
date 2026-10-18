import { isRecord, isTooltipFacts, isTooltipSkill } from "./resource-validation.ts";
interface Preview {
  abort: AbortController;
  mode?: string;
  skill?: TooltipSkill;
  level?: number;
  facts?: TooltipFacts;
  item?: TooltipItem;
  template?: boolean;
}
type Focusable = Element & { focus(): void; blur(): void };
function focusable(node: Element | null): node is Focusable {
  return (
    !!node &&
    "focus" in node &&
    typeof node.focus === "function" &&
    "blur" in node &&
    typeof node.blur === "function"
  );
}
function requiredElement(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Required tooltip preview element missing: ${id}`);
  return node;
}
import type {
  NativeTooltipRenderer,
  TooltipBasic,
  TooltipItem,
  TooltipSkill,
  TooltipFacts,
} from "./tooltip.ts";
/** Explicitly NON-NATIVE, read-only viewer for the SAME tooltip renderer used by game windows.
 * No send callback, no inventory edits, no character configuration. World simulation continues. */
export function tooltipPreview({
  renderer,
  point,
  getBasic,
  getInstance,
  onOpen,
  onClose,
}: {
  renderer: NativeTooltipRenderer;
  point: (event: MouseEvent) => { x: number; y: number };
  getBasic: () => TooltipBasic | undefined;
  getInstance: () => TooltipItem | undefined;
  onOpen: () => void;
  onClose: () => void;
}): {
  readonly open: boolean;
  show(mode?: string): boolean;
  close(restore?: boolean): void;
  draw(): void;
} {
  const root = requiredElement("tooltip-preview");
  const status = requiredElement("tooltip-preview-status");
  const choices = [
    ["item", "一般道具"],
    ["equipment", "商店裝備模板"],
    ["instance", "持有裝備快照"],
    ["requirements", "需求比較值 0"],
    ["enhanced", "合成 CUC=3 標題"],
    ["skill0", "技能 0 級"],
    ["skill1", "技能 1 級"],
    ["skillMax", "技能 MAX"],
  ];
  const buttons = new Map<string, HTMLButtonElement>();
  let current: Preview | undefined,
    previousFocus: Focusable | undefined,
    pointer: { x: number; y: number } | undefined;
  const group = requiredElement("tooltip-preview-choices");
  function close(restore = true) {
    if (!current) return;
    current.abort.abort();
    current = pointer = undefined;
    root.classList.add("hidden");
    root.removeAttribute("aria-busy");
    const target =
      previousFocus?.isConnected && !previousFocus.closest?.(".hidden")
        ? previousFocus
        : document.getElementById("test-tools-toggle");
    if (restore && target?.isConnected) target.focus();
    else if (root.contains(document.activeElement) && focusable(document.activeElement))
      document.activeElement.blur();
    previousFocus = undefined;
    onClose();
  }
  async function choose(mode: string) {
    if (!current) return;
    current.abort.abort();
    pointer = { x: 400, y: 190 };
    const c: Preview = (current = { mode, abort: new AbortController() });
    for (const [name, button] of buttons)
      button.setAttribute("aria-pressed", String(name === mode));
    root.setAttribute("aria-busy", "true");
    status.textContent = "唯讀素材載入中；場景不暫停。";
    try {
      const snapshot = mode === "instance" ? getInstance() : undefined;
      if (mode === "instance" && !snapshot)
        throw new Error("目前沒有持有裝備；不會用 WZ 模板冒充實例。");
      const id = snapshot?.itemId ?? (mode === "item" ? 2000000 : 1302001);
      const skillMode = mode.startsWith("skill");
      const response = await fetch(skillMode ? "/api/skills/100" : `/api/item/${id}`, {
        signal: c.abort.signal,
      });
      if (!response.ok) throw new Error(`Data.wz 資料讀取失敗（${response.status}）`);
      const data: unknown = await response.json();
      if (current !== c || c.abort.signal.aborted) return;
      if (skillMode) {
        if (!isRecord(data) || !Array.isArray(data.books))
          throw new Error("Invalid skill catalogue");
        c.skill = data.books
          .flatMap((book: unknown) =>
            isRecord(book) && Array.isArray(book.skills) ? book.skills : [],
          )
          .filter(isTooltipSkill)
          .find((skill) => skill.id === 1000000);
        if (!c.skill) throw new Error("原戰士技能資料未取得。");
        c.level = mode === "skillMax" ? c.skill.maxLevel : mode === "skill1" ? 1 : 0;
        status.textContent = `UI PREVIEW · ${c.skill.name} · 合成閱覽等級 ${c.level}（不是角色已學等級）。不學技能、不消耗 SP。`;
      } else {
        if (!isTooltipFacts(data)) throw new Error("Invalid item metadata");
        c.facts = data;
        c.item = snapshot ?? { itemId: id };
        c.template = mode !== "item" && mode !== "instance" && mode !== "enhanced";
        if (mode === "enhanced") {
          if (!data.equipment) throw new Error("原裝備模板未取得。");
          c.item = {
            itemId: id,
            stats: { ...data.equipment.stats },
            ruc: data.equipment.ruc,
            cuc: 3,
          };
        }
        const note =
          mode === "instance"
            ? "開啟時持有實例快照（原實例 stats）"
            : mode === "requirements"
              ? "商店模板；比較值暫用 0，沒有更動角色能力"
              : mode === "enhanced"
                ? "明示合成標題 CUC=3；不代表已強化，不模擬卷軸或增加能力"
                : mode === "equipment"
                  ? "商店模板（不是持有裝備）"
                  : "原普通道具資料";
        status.textContent = `UI PREVIEW · ${data.name ?? id} · ${note}。不給道具、不改存檔；場景不暫停。`;
      }
    } catch (error) {
      if (current === c && !c.abort.signal.aborted)
        status.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      if (current === c) root.removeAttribute("aria-busy");
    }
  }
  for (const [mode, label] of choices) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => {
      void choose(mode);
    });
    buttons.set(mode, button);
    group.append(button);
  }
  requiredElement("tooltip-preview-close").addEventListener("click", () => close());
  root.addEventListener("mousemove", (event) => {
    pointer = point(event);
  });
  root.addEventListener("mouseleave", () => {
    pointer = undefined;
  });
  root.addEventListener("keydown", (event) => {
    if (!current) return;
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Tab") {
      const nodes = [...buttons.values(), requiredElement("tooltip-preview-close")];
      let index = nodes.findIndex((node) => node === document.activeElement);
      index =
        index < 0
          ? event.shiftKey
            ? nodes.length - 1
            : 0
          : (index + (event.shiftKey ? -1 : 1) + nodes.length) % nodes.length;
      event.preventDefault();
      nodes[index].focus();
    }
  });
  root.addEventListener("keyup", (event) => {
    if (current) event.stopPropagation();
  });
  window.addEventListener("blur", () => {
    pointer = undefined;
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pointer = undefined;
  });
  return {
    get open() {
      return !!current;
    },
    show(mode = "item") {
      if (current || !buttons.has(mode)) return false;
      previousFocus = focusable(document.activeElement) ? document.activeElement : undefined;
      current = { abort: new AbortController() };
      onOpen();
      pointer = { x: 400, y: 190 };
      root.classList.remove("hidden");
      root.focus();
      void choose(mode);
      return true;
    },
    close,
    draw() {
      const c = current;
      if (!c || !pointer) return;
      if (c.skill && c.level !== undefined)
        renderer.skill(pointer.x, pointer.y + 20, c.skill, c.level);
      else if (c.facts && c.item)
        renderer.item(
          pointer.x,
          pointer.y + 20,
          c.facts,
          c.item,
          c.mode === "requirements" ? { level: 0, str: 0, dex: 0, int: 0, luk: 0 } : getBasic(),
          { template: c.template },
        );
    },
  };
}
