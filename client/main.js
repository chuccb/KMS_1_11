/**
 * The browser view.
 *
 * This file is deliberately protocol-free: it speaks the JSON of `server/src/net/webclient.ts`, not
 * the 2003 packets. Everything the 2003 client computes locally (damage, mob AI, the avatar look
 * table) is missing here on purpose - the browser is a window on the world, with a chat box and
 * arrow keys, and the server side of this repository is what proves the wire format.
 *
 * Rendering is intentionally plain canvas: the map's footholds are the only geometry the server can
 * give us, so the ground is drawn from them and everything alive is a labelled shape. The next
 * slices replace the shapes with `Map/Map/%09d.img`'s layers and `Character/*` sprites.
 */

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("view"));
const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));

const ui = {
  where: /** @type {HTMLElement} */ (document.getElementById("where")),
  connect: /** @type {HTMLElement} */ (document.getElementById("connect")),
  user: /** @type {HTMLInputElement} */ (document.getElementById("user")),
  pass: /** @type {HTMLInputElement} */ (document.getElementById("pass")),
  login: /** @type {HTMLButtonElement} */ (document.getElementById("login")),
  status: /** @type {HTMLElement} */ (document.getElementById("status")),
  worlds: /** @type {HTMLElement} */ (document.getElementById("worlds")),
  worldList: /** @type {HTMLElement} */ (document.getElementById("world-list")),
  characters: /** @type {HTMLElement} */ (document.getElementById("characters")),
  characterList: /** @type {HTMLElement} */ (document.getElementById("character-list")),
  characterStatus: /** @type {HTMLElement} */ (document.getElementById("character-status")),
  hud: /** @type {HTMLElement} */ (document.getElementById("hud")),
  hudName: /** @type {HTMLElement} */ (document.getElementById("hud-name")),
  hudLevel: /** @type {HTMLElement} */ (document.getElementById("hud-level")),
  hudHp: /** @type {HTMLElement} */ (document.getElementById("hud-hp")),
  hudHpText: /** @type {HTMLElement} */ (document.getElementById("hud-hp-text")),
  hudMp: /** @type {HTMLElement} */ (document.getElementById("hud-mp")),
  hudMpText: /** @type {HTMLElement} */ (document.getElementById("hud-mp-text")),
  hudExp: /** @type {HTMLElement} */ (document.getElementById("hud-exp")),
  hudMesos: /** @type {HTMLElement} */ (document.getElementById("hud-mesos")),
  hudMap: /** @type {HTMLElement} */ (document.getElementById("hud-map")),
  chatbox: /** @type {HTMLElement} */ (document.getElementById("chatbox")),
  chatLines: /** @type {HTMLElement} */ (document.getElementById("chat-lines")),
  say: /** @type {HTMLInputElement} */ (document.getElementById("say")),
  log: /** @type {HTMLElement} */ (document.getElementById("log")),
  logLines: /** @type {HTMLElement} */ (document.getElementById("log-lines")),
  logToggle: /** @type {HTMLButtonElement} */ (document.getElementById("log-toggle")),
};

/** @type {WebSocket | undefined} */
let socket;
/** @type {{ x: number, y: number, mapId: number } | undefined} */
let self;
/** @type {any} */
let selfView;
/** @type {Map<string, any>} */
const users = new Map();
const mobs = new Map();
const npcs = new Map();
/** @type {any} */
let map;
/** @type {Set<string>} */
const keys = new Set();
let lastMoveSent = 0;

const MOVE_PX_PER_TICK = 14;
const MOVE_TICK_MS = 100;

// ---------------------------------------------------------------- transport

/** Sends one JSON message; a socket that is not open yet is a programming error, not a user one. */
function send(message) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    logLine(`not connected: ${message.t}`);
    return;
  }
  socket.send(JSON.stringify(message));
}

function connect() {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${scheme}://${location.host}/ws`);
  socket.addEventListener("open", () => {
    ui.status.textContent = "已連線，送出登入…";
    ui.status.classList.remove("bad");
    send({ t: "login", user: ui.user.value, password: ui.pass.value });
  });
  socket.addEventListener("close", () => {
    ui.where.textContent = "斷線";
    ui.status.textContent = "連線結束。重新載入頁面再試一次。";
    ui.status.classList.add("bad");
    logLine("websocket closed");
  });
  socket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return logLine(`unreadable message: ${String(event.data).slice(0, 60)}`);
    }
    handle(message);
  });
}

/** @param {any} message */
function handle(message) {
  switch (message.t) {
    case "login":
      if (message.result !== 0) {
        ui.status.textContent = `登入失敗（結果 ${message.result}）`;
        ui.status.classList.add("bad");
        return;
      }
      ui.status.textContent = "";
      showPanel(ui.worlds);
      ui.worldList.replaceChildren(
        ...message.worlds.map((world, index) => {
          const button = document.createElement("button");
          button.type = "button";
          button.innerHTML = `${world.name}<small>世界 ${index}${world.unknownId ? ` · 0x${world.unknownId.toString(16)}` : ""}</small>`;
          button.addEventListener("click", () => {
            send({ t: "world", index });
            showPanel(ui.characters);
            ui.characterStatus.textContent = "讀取角色…";
          });
          return button;
        }),
      );
      if (message.worlds.length === 0) {
        ui.worldList.textContent = "這個伺服器沒有回報任何世界。";
      }
      logLine(`login ok: ${message.worlds.length} world(s)`);
      return;

    case "characters":
      if (message.result !== 0) {
        ui.characterStatus.textContent = `讀取角色失敗（結果 ${message.result}）`;
        ui.characterStatus.classList.add("bad");
        return;
      }
      ui.characterStatus.textContent = "";
      ui.characterList.replaceChildren(
        ...message.characters.map((character) => {
          const button = document.createElement("button");
          button.type = "button";
          button.innerHTML =
            `${escapeHtml(character.name)}<small>Lv.${character.level} · ${character.job} · ` +
            `HP ${character.hp}/${character.maxHp} · 地圖 ${character.mapId}</small>`;
          button.addEventListener("click", () => {
            ui.characterStatus.textContent = "進入遊戲…";
            send({ t: "character", id: character.id });
          });
          return button;
        }),
      );
      if (message.characters.length === 0) {
        ui.characterList.textContent = "這個世界還沒有角色（用原客戶端或 0x05 建立）。";
      }
      logLine(`characters: ${message.characters.length}`);
      return;

    case "field":
      selfView = message.self;
      self = { x: 0, y: 0, mapId: message.mapId };
      users.clear();
      mobs.clear();
      npcs.clear();
      for (const user of message.users) users.set(String(user.characterId), user);
      for (const mob of message.mobs) mobs.set(String(mob.mobId), mob);
      for (const npc of message.npcs) npcs.set(String(npc.npcId), npc);
      hidePanels();
      ui.hud.classList.remove("hidden");
      ui.chatbox.classList.remove("hidden");
      ui.where.textContent = `${selfView.name} · 地圖 ${message.mapId}`;
      updateHud();
      void loadMap(message.mapId);
      logLine(`field ${message.mapId}`);
      return;

    case "self":
      selfView = message.self;
      updateHud();
      return;

    case "user-enter":
      users.set(String(message.user.characterId), message.user);
      logLine(`user enter ${message.user.name}@${message.user.x},${message.user.y}`);
      return;

    case "user-leave":
      users.delete(String(message.characterId));
      return;

    case "user-move": {
      if (selfView && message.characterId === selfView.characterId) {
        if (self) {
          self.x = message.x;
          self.y = message.y;
        }
        return;
      }
      const user = users.get(String(message.characterId));
      if (user) {
        user.x = message.x;
        user.y = message.y;
        user.action = message.action;
      }
      return;
    }

    case "user-emotion": {
      const user = users.get(String(message.characterId));
      if (user) user.emotion = { value: message.emotion, until: performance.now() + 2500 };
      return;
    }

    case "level-up": {
      const user = users.get(String(message.characterId));
      if (user) user.levelUpAt = performance.now();
      return;
    }

    case "chat":
      chatLine(message.name, message.text);
      return;

    case "mob-enter":
      mobs.set(String(message.mob.mobId), message.mob);
      return;

    case "mob-move": {
      const mob = mobs.get(String(message.mobId));
      if (mob) {
        mob.x = message.x;
        mob.y = message.y;
      }
      return;
    }

    case "mob-leave":
      mobs.delete(String(message.mobId));
      return;

    case "npc-enter":
      npcs.set(String(message.npc.npcId), message.npc);
      return;

    case "npc-leave":
      npcs.delete(String(message.npcId));
      return;

    case "disconnect":
      ui.status.textContent = `伺服器斷線：${message.reason}`;
      ui.status.classList.add("bad");
      logLine(`disconnect: ${message.reason}`);
      return;

    case "error":
      ui.status.textContent = message.message;
      ui.status.classList.add("bad");
      logLine(`error: ${message.message}`);
      return;

    case "unknown":
      logLine(`unhandled packet 0x${message.opcode.toString(16)} (${message.bytes}B)`);
      return;

    default:
      logLine(`unhandled message ${message.t}`);
  }
}

async function loadMap(mapId) {
  try {
    const response = await fetch(`/api/map/${mapId}`);
    if (!response.ok) throw new Error(`map ${mapId}: HTTP ${response.status}`);
    map = await response.json();
    if (self && selfView) {
      // Start the camera on the character's own entrance point: the first 0x1C this client receives
      // for itself is not sent to the mover, so the spawn is the first foothold until it moves.
      const spawn = map.footholds[0];
      if (spawn) {
        self.x = spawn.x1;
        self.y = spawn.y1;
      }
    }
    logLine(`map ${mapId}: ${map.name || "(no name)"}, ${map.footholds.length} foothold(s)`);
  } catch (error) {
    logLine(String(error));
  }
}

// ---------------------------------------------------------------- rendering

function resize() {
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.floor(window.innerWidth * ratio);
  canvas.height = Math.floor(window.innerHeight * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}
window.addEventListener("resize", resize);
resize();

function frame() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  // The camera keeps the local player a little left of centre, like the 2003 client does.
  const cameraX = (self?.x ?? 0) - width * 0.45;
  const cameraY = (self?.y ?? 0) - height * 0.62;

  ctx.fillStyle = "#10131a";
  ctx.fillRect(0, 0, width, height);
  drawGrid(cameraX, cameraY, width, height);

  if (map) {
    drawFootholds(map, cameraX, cameraY);
    drawPortals(map, cameraX, cameraY);
  }
  if (selfView) drawSelf(cameraX, cameraY);

  const order = [
    ...[...npcs.values()].map((npc) => ({ kind: "npc", y: npc.y, npc })),
    ...[...mobs.values()].map((mob) => ({ kind: "mob", y: mob.y, mob })),
    ...[...users.values()].map((user) => ({ kind: "user", y: user.y, user })),
  ].sort((a, b) => a.y - b.y);

  for (const item of order) {
    if (item.kind === "npc") drawNpc(item.npc, cameraX, cameraY);
    else if (item.kind === "mob") drawMob(item.mob, cameraX, cameraY);
    else drawUser(item.user, cameraX, cameraY);
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function drawGrid(cameraX, cameraY, width, height) {
  const step = 100;
  const startX = -(cameraX % step);
  const startY = -(cameraY % step);
  ctx.strokeStyle = "rgba(255,255,255,0.045)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = startX; x < width; x += step) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (let y = startY; y < height; y += step) {
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();
}

function drawFootholds(currentMap, cameraX, cameraY) {
  ctx.strokeStyle = "rgba(220, 200, 150, 0.55)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const segment of currentMap.footholds) {
    ctx.moveTo(segment.x1 - cameraX, segment.y1 - cameraY);
    ctx.lineTo(segment.x2 - cameraX, segment.y2 - cameraY);
  }
  ctx.stroke();
}

function drawPortals(currentMap, cameraX, cameraY) {
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "center";
  for (const portal of currentMap.portals) {
    if (!portal.name) continue;
    const x = portal.x - cameraX;
    const y = portal.y - cameraY;
    ctx.fillStyle = portal.toMapId > 0 ? "rgba(120, 190, 255, 0.85)" : "rgba(180, 180, 180, 0.5)";
    ctx.beginPath();
    ctx.moveTo(x, y - 7);
    ctx.lineTo(x + 6, y);
    ctx.lineTo(x, y + 7);
    ctx.lineTo(x - 6, y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(200, 220, 255, 0.75)";
    ctx.fillText(portal.name, x, y + 20);
  }
}

function drawSelf(cameraX, cameraY) {
  const x = (self?.x ?? 0) - cameraX;
  const y = (self?.y ?? 0) - cameraY;
  drawAvatar(x, y, selfView, "#7fd1a0");
}

function drawUser(user, cameraX, cameraY) {
  const x = user.x - cameraX;
  const y = user.y - cameraY;
  drawAvatar(x, y, user, "#d8c48a");
  if (user.emotion && user.emotion.until > performance.now()) {
    ctx.font = "16px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(["…", "hit", "!", "?", "♥", "angry", "!!", "zzz", "sick"][user.emotion.value] ?? "?", x, y - 56);
  }
  if (user.levelUpAt && performance.now() - user.levelUpAt < 1200) {
    ctx.strokeStyle = "rgba(255, 230, 140, 0.9)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y - 18, 26 + (performance.now() - user.levelUpAt) / 18, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawAvatar(x, y, view, tint) {
  // A stand-in for `Character/*`: a body, a head in the face's own id colour and the name above it.
  const height = 44;
  ctx.fillStyle = tint;
  roundRect(x - 11, y - height + 12, 22, height - 12, 6);
  ctx.fill();
  ctx.fillStyle = view ? tintFor(view.face || view.appearanceA || 20000) : tint;
  ctx.beginPath();
  ctx.arc(x, y - height + 6, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.88)";
  ctx.font = "12px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(view?.name ?? "", x, y - height - 8);
}

function drawMob(mob, cameraX, cameraY) {
  const x = mob.x - cameraX;
  const y = mob.y - cameraY;
  ctx.fillStyle = "rgba(226, 140, 92, 0.9)";
  ctx.beginPath();
  ctx.ellipse(x, y - 12, 15, 13, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(20, 12, 10, 0.85)";
  ctx.font = "10px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.fillText(String(mob.templateId), x, y - 8);
}

function drawNpc(npc, cameraX, cameraY) {
  const x = npc.x - cameraX;
  const y = npc.y - cameraY;
  ctx.fillStyle = "rgba(120, 200, 150, 0.85)";
  roundRect(x - 9, y - 34, 18, 34, 4);
  ctx.fill();
  ctx.fillStyle = "rgba(220, 255, 230, 0.8)";
  ctx.font = "10px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.fillText(String(npc.templateId), x, y - 40);
}

function tintFor(face) {
  return `hsl(${((face ?? 20000) * 7) % 360}, 45%, 62%)`;
}

function roundRect(x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

// ---------------------------------------------------------------- hud & chat

function updateHud() {
  if (!selfView) return;
  ui.hudName.textContent = selfView.name;
  ui.hudLevel.textContent = `Lv.${selfView.level}`;
  const hp = Math.max(0, Math.min(1, selfView.maxHp === 0 ? 0 : selfView.hp / selfView.maxHp));
  const mp = Math.max(0, Math.min(1, selfView.maxMp === 0 ? 0 : selfView.mp / selfView.maxMp));
  ui.hudHp.style.width = `${hp * 100}%`;
  ui.hudMp.style.width = `${mp * 100}%`;
  ui.hudHpText.textContent = `${selfView.hp} / ${selfView.maxHp}`;
  ui.hudMpText.textContent = `${selfView.mp} / ${selfView.maxMp}`;
  ui.hudExp.textContent = `EXP ${selfView.exp}`;
  ui.hudMesos.textContent = `${selfView.mesos} mesos`;
  ui.hudMap.textContent = `地圖 ${selfView.mapId}`;
}

function chatLine(name, text) {
  const line = document.createElement("li");
  const who = document.createElement("span");
  who.className = "who";
  who.textContent = `${name} : `;
  line.append(who, document.createTextNode(text));
  ui.chatLines.append(line);
  while (ui.chatLines.children.length > 8) ui.chatLines.firstElementChild?.remove();
}

function logLine(text) {
  const line = document.createElement("li");
  const stamp = new Date().toLocaleTimeString("zh-TW", { hour12: false });
  line.textContent = `${stamp}  ${text}`;
  ui.logLines.append(line);
  while (ui.logLines.children.length > 120) ui.logLines.firstElementChild?.remove();
  ui.log.scrollTop = ui.log.scrollHeight;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character] ?? character);
}

function showPanel(panel) {
  for (const element of [ui.connect, ui.worlds, ui.characters]) element.classList.add("hidden");
  panel.classList.remove("hidden");
}

function hidePanels() {
  for (const element of [ui.connect, ui.worlds, ui.characters]) element.classList.add("hidden");
}

// ---------------------------------------------------------------- input

ui.login.addEventListener("click", connect);
ui.pass.addEventListener("keydown", (event) => {
  if (event.key === "Enter") connect();
});
ui.user.addEventListener("keydown", (event) => {
  if (event.key === "Enter") ui.pass.focus();
});
ui.logToggle.addEventListener("click", () => ui.log.classList.toggle("hidden"));

// Arrow keys and WASD walk. The 2003 client runs a physics vecctrl here; the browser sends a
// straight-line step and lets the server relay it, which is the honest subset until the movement
// codec's per-element actions are used by something that draws them.
window.addEventListener("keydown", (event) => {
  if (document.activeElement === ui.say) {
    if (event.key === "Escape") ui.say.blur();
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    ui.say.focus();
    return;
  }
  // A key pressed while the login fields are focused belongs to them, not to the character.
  const focused = document.activeElement;
  if (focused instanceof HTMLInputElement) return;
  const key = event.key.toLowerCase();
  if (["arrowleft", "arrowright", "arrowup", "arrowdown", "a", "d", "w", "s"].includes(key)) {
    event.preventDefault();
    keys.add(key);
  }
});
window.addEventListener("keyup", (event) => keys.delete(event.key.toLowerCase()));

setInterval(() => {
  if (!self || !selfView) return;
  let dx = 0;
  let dy = 0;
  if (keys.has("arrowleft") || keys.has("a")) dx -= 1;
  if (keys.has("arrowright") || keys.has("d")) dx += 1;
  if (keys.has("arrowup") || keys.has("w")) dy -= 1;
  if (keys.has("arrowdown") || keys.has("s")) dy += 1;
  if (dx === 0 && dy === 0) return;
  self.x += dx * MOVE_PX_PER_TICK;
  self.y += dy * MOVE_PX_PER_TICK;
  if (performance.now() - lastMoveSent < MOVE_TICK_MS) return;
  lastMoveSent = performance.now();
  send({ t: "move", x: Math.round(self.x), y: Math.round(self.y), foothold: 0 });
}, 40);

ui.say.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  const text = ui.say.value.trim();
  ui.say.value = "";
  if (text !== "") send({ t: "say", text });
  if (!event.shiftKey) ui.say.blur();
});

ui.say.addEventListener("blur", () => {
  ui.say.placeholder = "Enter 開始輸入，再按 Enter 送出";
});

/** The first thing a user sees; also what a refresh returns to. */
showPanel(ui.connect);
logLine(`page loaded; ws target ${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
