/** Browser-only operator panel. Explicitly not part of the original Maple UI. */
export function testTools({
  send,
  getSelf,
  getMovement = () => undefined,
  getCombat = () => "",
  isInGame,
  onOpen,
  openSkills,
  log,
}) {
  const el = (id) => document.getElementById(id),
    root = el("test-tools-shell"),
    toggle = el("test-tools-toggle");
  let opened = false,
    enabled = false,
    busy = false,
    checkpoint = false,
    restoreAvailable = false,
    canMap = false,
    jobs = [],
    repairCount = 0,
    maps = [],
    lastRequest,
    lastMovementAt = -Infinity;
  const status = (text) => {
    el("test-tools-status").textContent = text;
  };
  function movementStatus() {
    el("qa-combat").textContent = getCombat();
    const state = getMovement();
    el("qa-movement").textContent = state
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
    const ready = enabled && !busy && el("qa-confirm").checked;
    for (const id of [
      "qa-apply",
      "qa-heal",
      "qa-drain",
      "qa-near-death",
      "qa-checkpoint",
      "qa-speed-potions",
      "qa-combat-potions",
      "qa-evasion-potions",
    ])
      el(id).disabled = !ready;
    el("qa-repair-starters").disabled = !ready || repairCount === 0;
    el("qa-repair-starters").textContent = `修復舊全零起始裝備（${repairCount}件；原WZ值）`;
    el("qa-restore").disabled = !ready || !restoreAvailable;
    for (const id of ["qa-map-go", "qa-town", "qa-hunt", "qa-jump-cloud"])
      el(id).disabled = !enabled || busy || !canMap;
    el("qa-checkpoint").textContent = checkpoint
      ? "更新還原點（取代舊點）"
      : "建立能力／技能還原點";
    el("qa-character").textContent = getSelf()
      ? `${getSelf().name} · Lv.${getSelf().level} · job ${getSelf().job} · AP ${getSelf().ap} / SP ${getSelf().sp}`
      : "尚未進入地圖";
    el("qa-checkpoint-note").textContent = checkpoint
      ? restoreAvailable
        ? "已有還原點（只存能力／技能；不跨服務重啟）"
        : "已有還原點，但等級已不同；為保護升級成長，不能還原舊點。"
      : "第一次變更能力前自動記住能力與已學技能；不回溯EXP、道具、金錢或地圖。";
  }
  function close() {
    opened = false;
    el("qa-confirm").checked = false;
    sync();
    if (root.contains(document.activeElement)) toggle.focus();
  }
  async function loadMaps() {
    if (maps.length) return;
    try {
      const r = await fetch("/api/maps");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      maps = await r.json();
      filterMaps();
    } catch (error) {
      log(`體驗地圖清單：${error}`);
    }
  }
  function filterMaps() {
    const q = el("qa-map-filter").value.trim().toLowerCase(),
      select = el("qa-map");
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
    el("qa-confirm").checked = false;
    onOpen();
    status("正在詢問目前帳號的伺服器授權…");
    sync();
    el("qa-close").focus();
    lastRequest = "state";
    send({ t: "test-tools", action: { kind: "state" } });
  }
  function action(kind, extra = {}) {
    if (!enabled || busy || !el("qa-confirm").checked) return;
    busy = true;
    lastRequest = kind;
    status("等待伺服器套用；不會在瀏覽器自行修改數值…");
    sync();
    send({ t: "test-tools", action: { kind, confirmed: true, ...extra } });
  }
  function preset(job) {
    el("qa-job").value = String(job);
    el("qa-ap").value = "20";
    el("qa-sp").value = "40";
    el("qa-reset-skills").checked = true;
    status(
      "僅填入表單，尚未變更角色。確認後按「套用體驗配置」；會清除已學技能，原紀錄保留於還原點。",
    );
  }
  function warp(id) {
    if (
      enabled &&
      canMap &&
      !busy &&
      Number.isInteger(id) &&
      getSelf()?.hp > 0
    ) {
      send({ t: "warp-map", mapId: id });
      close();
    } else status("請先復活，並確認伺服器開放 --map-command。");
  }
  toggle.addEventListener("click", () => (opened ? close() : open()));
  el("qa-close").addEventListener("click", close);
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
  el("qa-confirm").addEventListener("change", sync);
  el("qa-warrior").addEventListener("click", () => preset(100));
  el("qa-magician").addEventListener("click", () => preset(200));
  el("qa-thief").addEventListener("click", () => preset(400));
  el("qa-apply").addEventListener("click", () => {
    if (["qa-job", "qa-ap", "qa-sp"].some((id) => el(id).value.trim() === "")) {
      status("請選擇職業並填入AP／SP；空白不會當成0套用。");
      return;
    }
    action("configure", {
      job: Number(el("qa-job").value),
      ap: Number(el("qa-ap").value),
      sp: Number(el("qa-sp").value),
      resetSkills: el("qa-reset-skills").checked,
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
  ])
    el(`qa-${kind}`).addEventListener("click", () => action(kind));
  el("qa-map-filter").addEventListener("input", filterMaps);
  el("qa-map-go").addEventListener("click", () => {
    if (el("qa-map").value !== "") warp(Number(el("qa-map").value));
  });
  el("qa-town").addEventListener("click", () => warp(101000000));
  el("qa-hunt").addEventListener("click", () => warp(40000));
  el("qa-jump-cloud").addEventListener("click", () => warp(104040000));
  el("qa-skills").addEventListener("click", () => {
    close();
    openSkills();
  });
  sync();
  return {
    get open() {
      return opened;
    },
    tick(now) {
      if (opened && now - lastMovementAt >= 250) {
        lastMovementAt = now;
        movementStatus();
      }
    },
    close,
    openPanel: open,
    receive(message) {
      if (message.t === "test-tools") {
        enabled = message.enabled;
        repairCount = message.equipmentRepairCount ?? 0;
        busy = false;
        checkpoint = message.checkpoint;
        restoreAvailable = message.restoreAvailable;
        canMap = message.canMap;
        jobs = message.jobs;
        const select = el("qa-job"),
          old = select.value;
        select.replaceChildren();
        for (const job of jobs) {
          const option = document.createElement("option");
          option.value = String(job.id);
          option.textContent = `${job.id} · ${job.name}`;
          select.append(option);
        }
        select.value = jobs.some((j) => String(j.id) === old)
          ? old
          : String(getSelf()?.job ?? 0);
        if (lastRequest && lastRequest !== "state") log(message.message);
        status(message.message);
        sync();
        if (enabled) void loadMaps();
        if (
          lastRequest === "configure" &&
          enabled &&
          el("qa-open-skills").checked
        ) {
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
