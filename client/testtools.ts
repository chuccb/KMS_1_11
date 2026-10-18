import type { SelfView } from "../server/src/client/session.ts";
import type { MapDestination } from "../server/src/game/map.ts";
import type { TestToolResult } from "../server/src/game/testtools.ts";
import type { mobAttackPreview } from "./mob-attack-preview.ts";
import { requireElement } from "./dom.ts";
import { isRecord, isFiniteNumber } from "./resource-validation.ts";
import { isMapDestinations, isTestToolResult } from "./ui-resource-validation.ts";
type TestToolChange =
  | { kind: "configure"; job: number; ap: number; sp: number; resetSkills: boolean }
  | { kind: "ranged-kit" | "ranged-level"; family: string; raiseLevel: boolean }
  | {
      kind:
        | "heal"
        | "drain"
        | "near-death"
        | "repair-starters"
        | "checkpoint"
        | "restore"
        | "speed-potions"
        | "combat-potions"
        | "evasion-potions"
        | "magic-potions";
    };
type TestToolAction = { kind: "state" } | (TestToolChange & { confirmed: true });
interface MovementStatus {
  speedPercent: number;
  jumpPercent: number;
  eva?: number;
  pdd?: number;
  secondsLeft?: number;
  contactPending: boolean;
  contactRemaining: number;
}
interface TestToolsOptions {
  send(
    message: { t: "test-tools"; action: TestToolAction } | { t: "warp-map"; mapId: number },
  ): unknown;
  getSelf(): Pick<SelfView, "name" | "level" | "job" | "ap" | "sp" | "hp"> | undefined;
  getMovement?(): MovementStatus | undefined;
  getCombat?(): string;
  getNpcStatus?(): string;
  drawMotionPreview?(
    now: number,
    selection: { weapon: string; action: string; climbing: boolean; left: boolean },
  ): string;
  resetMotionPreview?(): void;
  drawMobPreview?: ReturnType<typeof mobAttackPreview>["draw"];
  resetMobPreview?(): void;
  isInGame(): boolean;
  onOpen(): void;
  openSkills(): void;
  openDialogue?(kind: string): boolean;
  openTooltip?(kind: string): boolean;
  log(message: string): void;
}
/** Browser-only operator panel. Explicitly not part of the original Maple UI. */
export function testTools({
  send,
  getSelf,
  getMovement = () => undefined,
  getCombat = () => "",
  getNpcStatus = () => "",
  drawMotionPreview = () => "",
  resetMotionPreview = () => {},
  drawMobPreview = () => "",
  resetMobPreview = () => {},
  isInGame,
  onOpen,
  openSkills,
  openDialogue = () => false,
  openTooltip = () => false,
  log,
}: TestToolsOptions) {
  const button = (id: string) => requireElement(id, "button"),
    input = (id: string) => requireElement(id, "input"),
    selectElement = (id: string) => requireElement(id, "select"),
    details = (id: string) => requireElement(id, "details"),
    paragraph = (id: string) => requireElement(id, "p");
  const root = requireElement("test-tools-shell", "div"),
    toggle = button("test-tools-toggle");
  let opened = false,
    enabled = false,
    busy = false,
    checkpoint = false,
    restoreAvailable = false,
    canMap = false,
    rangedChoices: NonNullable<TestToolResult["rangedChoices"]> = [],
    repairCount = 0,
    maps: MapDestination[] = [],
    lastRequest: TestToolAction["kind"] | undefined,
    lastMovementAt = -Infinity;
  const status = (text: string) => {
    paragraph("test-tools-status").textContent = text;
  };
  function movementStatus() {
    paragraph("qa-combat").textContent = getCombat();
    paragraph("qa-npc").textContent = getNpcStatus();
    const state = getMovement();
    paragraph("qa-movement").textContent = state
      ? `唯讀快照（非原版工具）：速度 ${state.speedPercent}%／跳躍 ${state.jumpPercent}%／EVA ${state.eva ?? "—"}／PDD ${state.pdd ?? "—"}` +
        (state.secondsLeft === undefined
          ? "；沒有加速藥水效果。"
          : `；加速效果剩約 ${state.secondsLeft} 秒。`) +
        (state.contactPending
          ? "；碰撞回報中。"
          : state.contactRemaining > 0
            ? `；受傷保護 ${Math.ceil(state.contactRemaining / 30)} tick。`
            : state.contactRemaining < 0
              ? `；MISS 保護 ${Math.ceil(-state.contactRemaining / 30)} tick（不變色）。`
              : "；碰撞判定可用。")
      : "尚未進入地圖。";
  }
  function sync() {
    movementStatus();
    root.classList.toggle("hidden", !opened);
    toggle.disabled = !isInGame();
    toggle.setAttribute("aria-expanded", String(opened));
    const ready = enabled && !busy && input("qa-confirm").checked;
    for (const id of [
      "qa-apply",
      "qa-heal",
      "qa-drain",
      "qa-near-death",
      "qa-checkpoint",
      "qa-speed-potions",
      "qa-combat-potions",
      "qa-evasion-potions",
      "qa-magic-potions",
    ])
      button(id).disabled = !ready;
    const rangedReady =
      ready &&
      rangedChoices.some((choice) => choice.kind === selectElement("qa-ranged-family").value);
    selectElement("qa-ranged-family").disabled = !enabled || busy;
    input("qa-ranged-raise").disabled = !enabled || busy;
    button("qa-ranged-kit").disabled = !rangedReady;
    button("qa-ranged-level").disabled = !rangedReady || !input("qa-ranged-raise").checked;
    const choice = rangedChoices.find(
        (choice) => choice.kind === selectElement("qa-ranged-family").value,
      ),
      person = getSelf();
    paragraph("qa-ranged-requirements").textContent = choice
      ? `${choice.name}（${choice.weaponId}）：原WZ Lv${choice.requirements.level}、${choice.kind === "claw" ? "盜賊" : "弓手"}；目前 Lv${person?.level ?? "—"}／job ${person?.job ?? "—"}。${(person?.level ?? 0) < choice.requirements.level ? "未補足等級不能穿戴。" : "等級已足夠，仍檢查職業及能力。"}`
      : "原WZ遠距模板不可用，不發放。";
    button("qa-repair-starters").disabled = !ready || repairCount === 0;
    button("qa-repair-starters").textContent = `修復舊全零起始裝備（${repairCount}件；原WZ值）`;
    button("qa-restore").disabled = !ready || !restoreAvailable;
    for (const id of ["qa-map-go", "qa-town", "qa-hunt", "qa-layer-town", "qa-jump-cloud"])
      button(id).disabled = !enabled || busy || !canMap;
    button("qa-checkpoint").textContent = checkpoint
      ? "更新還原點（取代舊點）"
      : "建立能力／技能還原點";
    paragraph("qa-character").textContent = person
      ? `${person.name} · Lv.${person.level} · job ${person.job} · AP ${person.ap} / SP ${person.sp}`
      : "尚未進入地圖";
    paragraph("qa-checkpoint-note").textContent = checkpoint
      ? restoreAvailable
        ? "已有還原點（只存能力／技能；不跨服務重啟）"
        : "已有還原點，但等級已不同；為保護升級成長，不能還原舊點。"
      : "第一次變更能力前自動記住能力與已學技能；不回溯EXP、道具、金錢或地圖。";
  }
  function close() {
    opened = false;
    resetMotionPreview();
    resetMobPreview();
    input("qa-confirm").checked = false;
    input("qa-ranged-raise").checked = false;
    sync();
    if (root.contains(document.activeElement)) toggle.focus();
  }
  async function loadMaps() {
    if (maps.length) return;
    try {
      const r = await fetch("/api/maps");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const payload: unknown = await r.json();
      if (!isMapDestinations(payload)) throw new Error("Invalid map catalogue");
      maps = payload;
      filterMaps();
    } catch (error) {
      log(`體驗地圖清單：${error}`);
    }
  }
  function filterMaps() {
    const q = input("qa-map-filter").value.trim().toLowerCase(),
      select = selectElement("qa-map");
    select.replaceChildren();
    for (const m of maps.filter((m) =>
      `${m.id} ${m.name} ${m.streetName}`.toLowerCase().includes(q),
    )) {
      const option = document.createElement("option");
      option.value = String(m.id);
      option.textContent = `${m.id} · ${m.streetName} / ${m.name}`;
      select.append(option);
    }
  }
  function open() {
    if (!isInGame()) return;
    opened = true;
    if (busy) {
      sync();
      return;
    }
    busy = true;
    input("qa-confirm").checked = false;
    input("qa-ranged-raise").checked = false;
    onOpen();
    status("正在詢問目前帳號的伺服器授權…");
    sync();
    button("qa-close").focus();
    lastRequest = "state";
    send({ t: "test-tools", action: { kind: "state" } });
  }
  function action(change: TestToolChange) {
    if (!enabled || busy || !input("qa-confirm").checked) return;
    busy = true;
    lastRequest = change.kind;
    status("等待伺服器套用；不會在瀏覽器自行修改數值…");
    sync();
    send({ t: "test-tools", action: { confirmed: true, ...change } });
  }
  function preset(job: number) {
    selectElement("qa-job").value = String(job);
    input("qa-ranged-raise").checked = false;
    if (job === 300 || job === 400)
      selectElement("qa-ranged-family").value = job === 400 ? "claw" : "bow";
    input("qa-ap").value = "20";
    input("qa-sp").value = "40";
    input("qa-reset-skills").checked = true;
    status(
      "僅填入表單，尚未變更角色。確認後按「套用體驗配置」；會清除已學技能，原紀錄保留於還原點。",
    );
    sync();
  }
  function warp(id: number) {
    if (enabled && canMap && !busy && Number.isInteger(id) && (getSelf()?.hp ?? 0) > 0) {
      send({ t: "warp-map", mapId: id });
      close();
    } else status("請先復活，並確認伺服器開放 --map-command。");
  }
  toggle.addEventListener("click", () => (opened ? close() : open()));
  button("qa-close").addEventListener("click", close);
  root.addEventListener("click", (e) => {
    if (e.target === root) close();
  });
  root.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  });
  details("qa-mob").addEventListener("toggle", () => {
    if (!details("qa-mob").open) resetMobPreview();
  });
  details("qa-motion").addEventListener("toggle", () => {
    if (!details("qa-motion").open) resetMotionPreview();
  });
  selectElement("qa-ranged-family").addEventListener("change", () => {
    input("qa-ranged-raise").checked = false;
    sync();
  });
  input("qa-ranged-raise").addEventListener("change", sync);
  for (const kind of ["ranged-kit", "ranged-level"] as const)
    button(`qa-${kind}`).addEventListener("click", () =>
      action({
        kind,
        family: selectElement("qa-ranged-family").value,
        raiseLevel: input("qa-ranged-raise").checked,
      }),
    );
  input("qa-confirm").addEventListener("change", sync);
  button("qa-warrior").addEventListener("click", () => preset(100));
  button("qa-archer").addEventListener("click", () => preset(300));
  button("qa-magician").addEventListener("click", () => preset(200));
  button("qa-thief").addEventListener("click", () => preset(400));
  button("qa-apply").addEventListener("click", () => {
    if (
      [selectElement("qa-job"), input("qa-ap"), input("qa-sp")].some(
        (node) => node.value.trim() === "",
      )
    ) {
      status("請選擇職業並填入AP／SP；空白不會當成0套用。");
      return;
    }
    action({
      kind: "configure",
      job: Number(selectElement("qa-job").value),
      ap: Number(input("qa-ap").value),
      sp: Number(input("qa-sp").value),
      resetSkills: input("qa-reset-skills").checked,
    });
  });
  for (const kind of [
    "heal",
    "drain",
    "near-death",
    "repair-starters",
    "checkpoint",
    "restore",
    "speed-potions",
    "combat-potions",
    "evasion-potions",
    "magic-potions",
  ] as const)
    button(`qa-${kind}`).addEventListener("click", () => action({ kind }));
  input("qa-map-filter").addEventListener("input", filterMaps);
  button("qa-map-go").addEventListener("click", () => {
    if (selectElement("qa-map").value !== "") warp(Number(selectElement("qa-map").value));
  });
  button("qa-town").addEventListener("click", () => warp(101000000));
  button("qa-hunt").addEventListener("click", () => warp(40000));
  button("qa-layer-town").addEventListener("click", () => warp(103000000));
  button("qa-jump-cloud").addEventListener("click", () => warp(104040000));
  button("qa-skills").addEventListener("click", () => {
    close();
    openSkills();
  });
  for (const kind of ["item", "equipment", "instance", "skill0"])
    button(`qa-tooltip-${kind}`).addEventListener("click", () => {
      close();
      if (!openTooltip(kind)) log("提示框閱覽未開啟：請先結束對話／商店或等待目前操作完成。");
    });
  for (const kind of ["say", "confirm", "askText", "askNumber", "menu", "rich", "richMenu"])
    button(`qa-dialogue-${kind}`).addEventListener("click", () => {
      close();
      if (!openDialogue(kind)) log("對話窗範例未開啟：請先結束對話／商店或等待目前操作完成。");
    });
  sync();
  return {
    get open() {
      return opened;
    },
    tick(now: number) {
      if (opened && details("qa-mob").open) {
        const text = drawMobPreview(now, {
          id: input("qa-mob-id").value.trim(),
          action: selectElement("qa-mob-action").value,
          left: input("qa-mob-left").checked,
          chain: input("qa-mob-chain").checked,
        });
        if (paragraph("qa-mob-status").textContent !== text)
          paragraph("qa-mob-status").textContent = text;
      }
      if (opened && details("qa-motion").open) {
        const text = drawMotionPreview(now, {
          weapon: selectElement("qa-motion-weapon").value,
          action: selectElement("qa-motion-action").value,
          climbing: input("qa-motion-climbing").checked,
          left: input("qa-motion-left").checked,
        });
        if (paragraph("qa-motion-status").textContent !== text)
          paragraph("qa-motion-status").textContent = text;
      }
      if (opened && now - lastMovementAt >= 250) {
        lastMovementAt = now;
        movementStatus();
      }
    },
    close,
    openPanel: open,
    receive(message: unknown) {
      if (!isRecord(message) || typeof message.t !== "string") return false;
      if (message.t === "test-tools") {
        if (!isTestToolResult(message)) {
          busy = false;
          enabled = false;
          status("伺服器工具回覆格式不正確；未套用本機數值。");
          sync();
          return true;
        }
        enabled = message.enabled;
        repairCount = message.equipmentRepairCount ?? 0;
        busy = false;
        checkpoint = message.checkpoint;
        restoreAvailable = message.restoreAvailable;
        canMap = message.canMap;
        const jobs = message.jobs;
        rangedChoices = message.rangedChoices ?? [];
        input("qa-ranged-raise").checked = false;
        const family = selectElement("qa-ranged-family"),
          previous = family.value;
        family.replaceChildren();
        for (const choice of rangedChoices) {
          const option = document.createElement("option");
          option.value = choice.kind;
          option.textContent = `${choice.kind === "bow" ? "弓" : choice.kind === "crossbow" ? "弩" : "拳套"} · ${choice.name} · Lv${choice.requirements.level}`;
          family.append(option);
        }
        family.value = rangedChoices.some((c) => c.kind === previous)
          ? previous
          : Math.trunc((getSelf()?.job ?? 0) / 100) === 4
            ? "claw"
            : "bow";
        const select = selectElement("qa-job"),
          old = select.value;
        select.replaceChildren();
        for (const job of jobs) {
          const option = document.createElement("option");
          option.value = String(job.id);
          option.textContent = `${job.id} · ${job.name}`;
          select.append(option);
        }
        select.value = jobs.some((j) => String(j.id) === old) ? old : String(getSelf()?.job ?? 0);
        if (lastRequest && lastRequest !== "state") log(message.message);
        status(message.message);
        sync();
        if (enabled) void loadMaps();
        if (lastRequest === "configure" && enabled && input("qa-open-skills").checked) {
          close();
          openSkills();
        }
        lastRequest = undefined;
        return true;
      }
      if (message.t === "error" && busy) {
        busy = false;
        status(String(message.message));
        sync();
      }
      if (
        ["shop-open", "npc-say"].includes(message.t) ||
        (message.t === "self" &&
          isRecord(message.self) &&
          isFiniteNumber(message.self.hp) &&
          message.self.hp <= 0)
      )
        close();
      if (message.t === "self") queueMicrotask(sync);
      if (["field", "login", "disconnect"].includes(message.t)) {
        enabled = false;
        checkpoint = restoreAvailable = canMap = false;
        busy = false;
        lastRequest = undefined;
        close();
        queueMicrotask(sync);
      }
      return false;
    },
  };
}
