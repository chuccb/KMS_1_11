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
  newName: /** @type {HTMLInputElement} */ (document.getElementById("new-name")),
  create: /** @type {HTMLButtonElement} */ (document.getElementById("create")),
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
  emotes: /** @type {HTMLElement} */ (document.getElementById("emotes")),
  log: /** @type {HTMLElement} */ (document.getElementById("log")),
  logLines: /** @type {HTMLElement} */ (document.getElementById("log-lines")),
  logToggle: /** @type {HTMLButtonElement} */ (document.getElementById("log-toggle")),
  inventory: /** @type {HTMLElement} */ (document.getElementById("inventory")),
  invToggle: /** @type {HTMLButtonElement} */ (document.getElementById("inv-toggle")),
  invClose: /** @type {HTMLButtonElement} */ (document.getElementById("inv-close")),
  invTabs: /** @type {HTMLElement} */ (document.getElementById("inv-tabs")),
  invWorn: /** @type {HTMLElement} */ (document.getElementById("inv-worn")),
  invGrid: /** @type {HTMLElement} */ (document.getElementById("inv-grid")),
  invInfo: /** @type {HTMLElement} */ (document.getElementById("inv-info")),
  shop: /** @type {HTMLElement} */ (document.getElementById("shop")),
  shopTitle: /** @type {HTMLElement} */ (document.getElementById("shop-title")),
  shopRows: /** @type {HTMLElement} */ (document.getElementById("shop-rows")),
  shopClose: /** @type {HTMLButtonElement} */ (document.getElementById("shop-close")),
  shopNote: /** @type {HTMLElement} */ (document.getElementById("shop-note")),
  dialogue: /** @type {HTMLElement} */ (document.getElementById("dialogue")),
  dialogueText: /** @type {HTMLElement} */ (document.getElementById("dialogue-text")),
  dialogueOk: /** @type {HTMLButtonElement} */ (document.getElementById("dialogue-ok")),
  dialogueClose: /** @type {HTMLButtonElement} */ (document.getElementById("dialogue-close")),
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
/** `mapId -> name`, filled by every `/api/map/<id>` this page fetches; a find answer has an id only. */
const mapNames = new Map();
/** @type {Set<string>} */
const keys = new Set();
let lastMoveSent = 0;
/** The portal the mouse is over, so the frame can ring it. @type {any} */
let hoveredPortal;
/** The last time a portal was asked for; `sub_472590` refuses a second request within 500 ms. */
let lastPortalAt = 0;
/** The face the local player is wearing, and until when - the server's `0x27` excludes the mover. */
let selfEmotion;
/**
 * The last whisper this page sent, kept the way the 2003 client keeps it (`CField+28`, written by
 * `sub_4717D0`): the answer (`0x1A` 0x0A) carries no text, so the sender's own line is printed from
 * what it typed.
 */
let pendingWhisper;

// ---------------------------------------------------------------- inventory

/** The inventory the server last described (`0x16` and every `0x0B` since); null before a map. */
let inventory;
/**
 * The tab the panel shows: 1 equip, 2 use, 3 etc, 4 cash (`0x0B`'s `u8 inventory`).
 *
 * 0 means "the player has not picked one yet": the first render then opens USE if it holds
 * something (that is where a potion is, which is what a panel is usually opened for) and otherwise
 * the first tab that has anything at all. After that the choice is the player's and never moves.
 */
let inventoryTab = 0;
/** `itemId -> { id, name, price, desc }` from `/api/item/<id>`; absent until the fetch lands. */
const itemInfo = new Map();
/** Ids a lookup is already in flight for, so a re-render does not ask twice. */
const itemInfoPending = new Set();
/** Ids the archive has no icon for - the page stops asking. */
const iconMissing = new Set();
/** The shop `0x4A` opened, or undefined when no NPC's window is up. */
let shop;
/** The NPC whose `0x47` line is on screen, or undefined when the dialog is closed. */
let talkingNpc;

/** The four tabs, named the way a player says them; the numbers are the wire's. */
const INVENTORY_TABS = [
  { tab: 1, label: "裝備" },
  { tab: 2, label: "消耗" },
  { tab: 3, label: "其他" },
  { tab: 4, label: "現金" },
];

/** A tab slot, or a worn slot when `slot` is negative (`-1` is the first of the group). */
function slotName(slot) {
  return slot < 0 ? `穿戴 ${-slot}` : String(slot);
}

/**
 * The nine faces, in the client's own order (`EMOTION_NAMES` in `server/src/protocol/field.ts`,
 * read out of `Character/Face/*` and the drawing code's table). 1..7 are what the 2003 client's
 * F1..F7 send; 0 (the neutral blink) and 8 have no key there, and this page has no button for them.
 */
const EMOTE_NAMES = ["blink", "hit", "smile", "troubled", "cry", "angry", "bewildered", "stunned", "vomit"];
const EMOTE_KEYS = [1, 2, 3, 4, 5, 6, 7];

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
  socket.addEventListener("error", () => {
    // The usual cause is a proxy that does not forward the upgrade (an https page whose proxy
    // refuses `wss`). Saying so beats a page that silently does nothing.
    ui.status.textContent =
      "WebSocket 連線失敗：這個網址的代理可能不轉發 upgrade。請在本機開 http://127.0.0.1:8500/。";
    ui.status.classList.add("bad");
    logLine("websocket error");
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
      ui.characterStatus.classList.remove("bad");
      ui.characterList.replaceChildren(
        ...message.characters.map((character) => {
          const button = document.createElement("button");
          button.type = "button";
          // The 2003 character-select shows the character itself; the archive's own frame is one
          // request away and the record already carries the face, the hair and the worn ids.
          const picture = document.createElement("img");
          picture.className = "character-picture";
          picture.alt = character.name;
          picture.src =
            `/api/avatar.png?face=${character.face ?? 20000}&hair=${character.hair ?? 30000}` +
            `&items=${(character.items ?? []).join(",")}&stance=stand1&frame=0`;
          const text = document.createElement("span");
          text.className = "character-text";
          text.innerHTML =
            `${escapeHtml(character.name)}<small>Lv.${character.level} · ${character.job} · ` +
            `HP ${character.hp}/${character.maxHp} · 地圖 ${character.mapId}</small>`;
          button.append(picture, text);
          button.addEventListener("click", () => {
            ui.characterStatus.textContent = "進入遊戲…";
            send({ t: "character", id: character.id });
          });
          return button;
        }),
      );
      if (message.characters.length === 0) {
        ui.characterList.textContent = "這個世界還沒有角色：在下面輸入名字建立一個。";
      }
      logLine(`characters: ${message.characters.length}`);
      return;

    case "created":
      ui.characterStatus.textContent = message.ok
        ? `已建立「${message.name}」，選它進入遊戲。`
        : `建立失敗「${message.name}」：${message.reason}`;
      ui.characterStatus.classList.toggle("bad", !message.ok);
      logLine(message.ok ? `created ${message.name} (id ${message.id})` : `create failed: ${message.reason}`);
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
      // The server drops the windows with the map (the shop and the dialog belong to its NPCs), so
      // this side must not tell it to close something it already forgot.
      closeShop(false);
      closeDialogue(false);
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

    case "inventory":
      inventory = message.inventory;
      renderInventory();
      return;

    case "shop-open":
      shop = message.shop;
      renderShop();
      return;

    case "shop-result":
      // Every buy/sell is answered with a result byte - `0` is "silent", i.e. it worked.
      if (message.code !== 0) logLine(`shop: ${message.message}`);
      return;

    case "npc-say":
      talkingNpc = message.npcId;
      ui.dialogueText.textContent = String(message.message);
      ui.dialogue.classList.remove("hidden");
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
          if (message.x !== self.x) self.facing = message.x < self.x ? 1 : 0;
          self.x = message.x;
          self.y = message.y;
          self.movedAt = performance.now();
        }
        return;
      }
      const user = users.get(String(message.characterId));
      if (user) {
        if (message.x !== user.x) user.facing = message.x < user.x ? 1 : 0;
        user.x = message.x;
        user.y = message.y;
        user.action = message.action;
        user.movedAt = performance.now();
      }
      return;
    }

    case "user-emotion": {
      const until = performance.now() + 2500;
      // The server sends 0x27 to everyone but the mover, so this branch is the page's own echo of
      // what it just sent - the same reason `user-move` for `self` is applied without an event.
      if (selfView && message.characterId === selfView.characterId) {
        selfEmotion = { value: message.emotion, until };
        selfView.emotion = selfEmotion;
        return;
      }
      const user = users.get(String(message.characterId));
      if (user) user.emotion = { value: message.emotion, until };
      return;
    }

    case "level-up": {
      const user = users.get(String(message.characterId));
      if (user) user.levelUpAt = performance.now();
      return;
    }

    case "chat":
      // A delivered whisper arrives here too: the server relays it as `0x1A` sub-op 0x12, the same
      // packet as field chat, so the receiving client cannot tell the two apart (FINDINGS 4.31).
      chatLine(message.name, message.text);
      return;

    case "whisper-answer": {
      // The text is not on the wire: the 2003 client prints its own kept line as "name<< text".
      // The answer names the character as the server spells it, which can differ in case from what
      // was typed - `/w alt hi` still has to print its own line.
      const text =
        pendingWhisper && pendingWhisper.name.toLowerCase() === message.name.toLowerCase()
          ? pendingWhisper.text
          : undefined;
      pendingWhisper = undefined;
      if (message.delivered) {
        chatLine(`${message.name}<<`, text ?? "");
      } else {
        chatLine("系統", `找不到「${message.name}」。`);
      }
      logLine(`whisper ${message.delivered ? "delivered" : "not found"}: ${message.name}`);
      return;
    }

    case "find-answer": {
      // No map name on the wire (FINDINGS 4.31): the answer is a map id or "not found". The name is
      // this page's own extra, looked up from the endpoint it already uses to draw the ground, and
      // only when a previous fetch happened to know it.
      if (message.mapId === -1) {
        chatLine("系統", `找不到「${message.name}」。`);
      } else {
        const where = mapNames.get(message.mapId);
        chatLine("系統", `${message.name} 在地圖 ${message.mapId}${where ? `（${where}）` : ""}。`);
        if (where === undefined) void rememberMapName(message.mapId);
      }
      logLine(`find ${message.name}: ${message.mapId}`);
      return;
    }

    case "mob-enter":
      mobs.set(String(message.mob.mobId), message.mob);
      return;

    case "mob-move": {
      const mob = mobs.get(String(message.mobId));
      if (mob) {
        // A mob that is walking faces the way it goes; the frame loop uses that to pick the walk
        // animation, which is what the 2003 client does when it plays the 0x33 leg.
        if (message.x !== mob.x) mob.facing = message.x < mob.x ? 1 : 0;
        mob.x = message.x;
        mob.y = message.y;
        mob.movedAt = performance.now();
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

    case "error": {
      // The status line lives in the login panel, which is hidden once a character is in a field -
      // so a mid-game error (a text the code page cannot carry, an unreadable message) also goes to
      // the chat box, or it would be invisible.
      const text = /is not a CP949 character/.test(message.message)
        ? `${message.message}（2003 client 只收 CP949：韓文與 ASCII，中文送不出去）`
        : message.message;
      if (self) chatLine("系統", text);
      else {
        ui.status.textContent = text;
        ui.status.classList.add("bad");
      }
      logLine(`error: ${message.message}`);
      return;
    }

    case "unknown":
      logLine(`unhandled packet 0x${message.opcode.toString(16)} (${message.bytes}B)`);
      return;

    default:
      logLine(`unhandled message ${message.t}`);
  }
}

/** Fetches one map's name for the next `find-answer`; a failure is not worth a chat line. */
async function rememberMapName(mapId) {
  try {
    const response = await fetch(`/api/map/${mapId}`);
    if (!response.ok) return;
    const data = await response.json();
    mapNames.set(data.id, data.name);
  } catch {
    // The id is already on screen; the name is a bonus.
  }
}

async function loadMap(mapId) {
  try {
    const response = await fetch(`/api/map/${mapId}`);
    if (!response.ok) throw new Error(`map ${mapId}: HTTP ${response.status}`);
    map = await response.json();
    mapNames.set(map.id, map.name);
    hoveredPortal = undefined;
    // The map reset: the art of the previous map must not be drawn under the new one.
    mapArt = undefined;
    artImages.clear();
    avatarFrames.clear();
    npcArts.clear();
    mobArts.clear();
    artMissing.clear();
    if (cameraMapId !== mapId) {
      cameraMapId = mapId;
      camera.ready = false;
    }
    void loadMapArt(mapId);
    for (const npc of map.npcs ?? []) ensureEntityArt("npc", npc.templateId);
    for (const mob of map.mobs ?? []) ensureEntityArt("mob", mob.templateId);
    if (self && selfView) {
      // Where the server put this character: `0x16` carries no position, and the 2003 client spawns
      // on the map's `sp` portal (the same portal `FieldInstance` uses). The first foothold is only a
      // fallback for a map without one.
      const spawn = map.portals.find((portal) => portal.name === "sp") ?? map.footholds[0];
      if (spawn) {
        self.x = "x" in spawn ? spawn.x : spawn.x1;
        self.y = "y" in spawn ? spawn.y : spawn.y1;
      }
    }
    const doors = map.portals.filter((portal) => portal.name && portal.type !== 0 && portal.toMapId > 0).length;
    logLine(`map ${mapId}: ${map.name || "(no name)"}, ${map.footholds.length} foothold(s), ${doors} door(s)`);
  } catch (error) {
    logLine(String(error));
  }
}

/**
 * The map's pictures: the background stack, every tile and object with its position and draw depth,
 * and the camera's own rectangle. The page starts drawing as soon as the JSON lands; a canvas whose
 * PNG is still on the wire is skipped for that frame and appears on the next.
 */
async function loadMapArt(mapId) {
  try {
    const response = await fetch(`/api/map/${mapId}/art`);
    if (!response.ok) {
      logLine(`map ${mapId}: no art (${response.status}) - drawing the geometry only`);
      return;
    }
    const art = await response.json();
    if (map?.id !== mapId) return;
    mapArt = art;
    camera.ready = false;
    for (const back of art.backs) artImage(back.path);
    for (const frame of art.portalFrames ?? []) artImage(frame.path);
    // Only the canvases the map actually places: a 1000-sprite map is a few hundred distinct files.
    const wanted = new Set();
    for (const sprite of art.sprites) for (const frame of sprite.frames) wanted.add(frame.path);
    for (const path of wanted) artImage(path);
    logLine(`art ${mapId}: ${art.backs.length} back(s), ${art.sprites.length} sprite(s)`);
    if ((art.missingTiles ?? 0) > 0) {
      logLine(
        `art ${mapId}: ${art.missingTiles} tile(s) are not in Data.wz ` +
          `(${(art.missingTileSets ?? []).join(", ")}) - drawing the footholds instead`,
      );
    }
  } catch (error) {
    logLine(`art ${mapId}: ${String(error)}`);
  }
}

// ---------------------------------------------------------------- portals

/** The diamond is 14 px tall and its name sits 20 px below it; the click box is that plus slack. */
const PORTAL_BOX = { left: 18, right: 18, up: 11, down: 26 };
/** `sub_472590` will not send a second `0x0D` for 500 ms; the page keeps the same promise. */
const PORTAL_GUARD_MS = 600;
/** `RETURN_MAP_NONE` (`game/map.ts`): a portal that leads to no map at all. */
const RETURN_MAP_NONE = 999999999;

/**
 * A pointer event as a point of the 800x600 view (the canvas is scaled to the window by CSS).
 *
 * @param {MouseEvent} event
 */
function viewPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * VIEW_W,
    y: ((event.clientY - rect.top) / Math.max(1, rect.height)) * VIEW_H,
  };
}

/**
 * The portal under a screen point.
 *
 * Only doors the 2003 client could click: a `sp` portal (type 0) has no body on screen and a
 * `tm` of 0 or `RETURN_MAP_NONE` leads nowhere, so none of them are offered. The map's own `pn` is
 * what gets sent - the server looks the destination up in the same WZ file, never in the packet.
 *
 * @param {number} clientX
 * @param {number} clientY
 */
function portalAt(clientX, clientY) {
  if (!map || !self) return undefined;
  const x = clientX + camera.x;
  const y = clientY + camera.y;
  let found;
  let best = Infinity;
  for (const portal of map.portals) {
    if (!portal.name || portal.type === 0) continue;
    if (!(portal.toMapId > 0) || portal.toMapId === RETURN_MAP_NONE) continue;
    const dx = x - portal.x;
    const dy = y - portal.y;
    if (dx < -PORTAL_BOX.left || dx > PORTAL_BOX.right) continue;
    if (dy < -PORTAL_BOX.up || dy > PORTAL_BOX.down) continue;
    const distance = dx * dx + dy * dy;
    if (distance < best) {
      best = distance;
      found = portal;
    }
  }
  return found;
}

// ---------------------------------------------------------------- NPCs

/**
 * The click box around an NPC: wide enough for the widest shipped `Npc/*` sprite (~70 px) and tall
 * enough for the tallest, measured up from the feet. It is only a click target - the picture itself
 * comes from the archive.
 */
const NPC_BOX = { left: 36, right: 36, up: 96, down: 8 };

/**
 * The NPC under a screen point, or undefined.
 *
 * The click itself is the whole interaction: `0x33` with the runtime id `0x39` gave the NPC. What
 * comes back is the NPC's shop (`0x4A`) or its line (`0x47`) - the page does not decide which, it
 * only sends the click.
 */
function npcAt(clientX, clientY) {
  if (!self) return undefined;
  const x = clientX + camera.x;
  const y = clientY + camera.y;
  let found;
  let best = Infinity;
  for (const npc of npcs.values()) {
    const dx = x - npc.x;
    const dy = y - npc.y;
    if (dx < -NPC_BOX.left || dx > NPC_BOX.right) continue;
    if (dy < -NPC_BOX.up || dy > NPC_BOX.down) continue;
    const distance = dx * dx + dy * dy;
    if (distance < best) {
      best = distance;
      found = npc;
    }
  }
  return found;
}

canvas.addEventListener("mousemove", (event) => {
  const point = viewPoint(event);
  hoveredPortal = portalAt(point.x, point.y);
  const npc = npcAt(point.x, point.y);
  canvas.style.cursor = hoveredPortal || npc ? "pointer" : "default";
});

canvas.addEventListener("click", (event) => {
  // An NPC first: its box stands on the ground where a door could also be, and the server can only
  // open one window at a time (`0x4A`/`0x47` while another is up is a disconnect in the client).
  const point = viewPoint(event);
  const npc = npcAt(point.x, point.y);
  if (npc) {
    if (shop !== undefined || talkingNpc !== undefined) return;
    logLine(`click NPC ${npc.npcId} (template ${npc.templateId})`);
    send({ t: "click", objectId: npc.npcId });
    return;
  }
  const portal = portalAt(point.x, point.y);
  if (!portal) return;
  const now = performance.now();
  if (now - lastPortalAt < PORTAL_GUARD_MS) return;
  lastPortalAt = now;
  logLine(`portal ${portal.name} -> ${portal.toMapId}`);
  send({ t: "portal", name: portal.name });
});

// ---------------------------------------------------------------- rendering
//
// The view is the 2003 client's own 800x600, scaled to whatever the window is: every sprite in
// `Data.wz` is drawn at its own pixel size, so a bigger canvas would zoom the art, not show more of
// it. `image-rendering: pixelated` (style.css) keeps the scale crisp, like the original's D3D blit.
//
// The layers, back to front (`MapleStory.exe.c` `sub_469980`/`sub_46A1C0`/`sub_46A9F0`):
//
//   back (front = 0)   the sky, the far hills, the grass banks - each with its own parallax
//   layer 0..2 tiles   ground and the objects standing on it
//   characters         NPCs, mobs, other players and you, sorted by y
//   layer 3 tiles      foreground decorations that draw over the characters
//   back (front = 1)   the map's foreground sheets
//
// The map's own art is served by `/api/map/<id>/art` (positions and draw depths) and
// `/api/png/<path>` (the canvases); a character is composed on the server (`/api/avatar.png`) from
// the same `Character/*` images the 2003 client draws.

/** The original client's view size. */
const VIEW_W = 800;
const VIEW_H = 600;

/** How long the camera takes to catch up: the 2003 client eases over ~0.2 s, not instantly. */
const CAMERA_EASE = 0.18;

/** The background image stack of the current map (`/api/map/<id>/art`), or undefined. */
let mapArt;
/** `archive path -> { img, ready }`; the page draws a sprite only once its PNG has arrived. */
const artImages = new Map();
/** `look|stance|frame|flip -> { img, dx, dy, ready }` avatar frames. */
const avatarFrames = new Map();
/** `npc templateId -> actions` and `mob templateId -> actions` from `/api/npc` and `/api/mob`. */
const npcArts = new Map();
const mobArts = new Map();
/** Template ids whose art endpoint said 404 - stop asking. */
const artMissing = new Set();
/** The camera: world coordinate shown at the top-left of the 800x600 view. */
let camera = { x: 0, y: 0, ready: false };
/** The map the view was last set up for, so a re-entry resets the camera. */
let cameraMapId = 0;

/** Where the camera wants to be: the player at the centre, clamped to the map's `VR` box. */
function cameraTarget(width = VIEW_W, height = VIEW_H) {
  const px = self?.x ?? 0;
  const py = self?.y ?? 0;
  let x = px - width / 2;
  let y = py - height / 2;
  const bounds = mapArt?.bounds;
  if (bounds) {
    // The client's own clamp (`sub_469980`): never show past the map's rectangle; if the map is
    // smaller than the view, centre it instead of sliding it around.
    if (bounds.right - bounds.left <= width) x = (bounds.left + bounds.right) / 2 - width / 2;
    else x = Math.max(bounds.left, Math.min(bounds.right - width, x));
    if (bounds.bottom - bounds.top <= height) y = (bounds.top + bounds.bottom) / 2 - height / 2;
    else y = Math.max(bounds.top, Math.min(bounds.bottom - height, y));
  }
  return { x, y };
}

/** The canvas fills its box at an integer-friendly scale; the drawing itself stays 800x600. */
function resize() {
  canvas.width = VIEW_W;
  canvas.height = VIEW_H;
  const scale = Math.min(window.innerWidth / VIEW_W, window.innerHeight / VIEW_H);
  canvas.style.width = `${Math.floor(VIEW_W * scale)}px`;
  canvas.style.height = `${Math.floor(VIEW_H * scale)}px`;
  ctx.imageSmoothingEnabled = false;
}
window.addEventListener("resize", resize);
resize();

/** One PNG of the archive, by its own path; `src` is encoded as a single segment. */
function artImage(path) {
  let entry = artImages.get(path);
  if (entry) return entry;
  entry = { img: new Image(), ready: false };
  entry.img.onload = () => {
    entry.ready = true;
  };
  entry.img.onerror = () => {
    entry.ready = false;
  };
  entry.img.src = `/api/png/${encodeURIComponent(path)}`;
  artImages.set(path, entry);
  return entry;
}

/** `{ face, hair, items }` for the local character or another user of the field. */
function lookOf(entity) {
  if (!entity) return { face: 20000, hair: 30000, items: [] };
  if (typeof entity.hair === "number" && entity.hair !== 0) {
    return { face: entity.face || 20000, hair: entity.hair, items: entity.avatarItems ?? [] };
  }
  // Another user's `0x1C` list starts with the hair (`avatarItemsOf`) and carries no separate
  // hair field, so the first id is the hair and the rest are the worn equips.
  const list = entity.avatarItems ?? [];
  return { face: entity.face || 20000, hair: list[0] || 30000, items: list.slice(1) };
}

/**
 * Asks the server for one composed frame.
 *
 * `dx`/`dy` say where the PNG's top-left corner goes relative to the character's feet; the server
 * composes at the WZ origins, so the page never adds anchors of its own.
 */
function avatarFrame(look, stance, frame, flip) {
  const key = `${look.face}|${look.hair}|${look.items.join(".")}|${stance}|${frame}|${flip ? "l" : "r"}`;
  let entry = avatarFrames.get(key);
  if (entry) return entry;
  entry = { img: new Image(), dx: 0, dy: 0, ready: false, requested: false };
  avatarFrames.set(key, entry);
  const query =
    `?face=${look.face}&hair=${look.hair}&items=${look.items.join(",")}` +
    `&stance=${encodeURIComponent(stance)}&frame=${frame}&flip=${flip ? 1 : 0}`;
  entry.requested = true;
  fetch(`/api/avatar.png${query}`)
    .then(async (response) => {
      if (!response.ok) throw new Error(`avatar ${response.status}`);
      entry.dx = Number(response.headers.get("x-frame-dx") ?? 0);
      entry.dy = Number(response.headers.get("x-frame-dy") ?? 0);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = url;
      });
      entry.img = img;
      entry.ready = true;
    })
    .catch(() => {
      entry.requested = false;
    });
  return entry;
}

/** Warms the frames a look needs: idle (3) and the two walk cycles (4 each), both ways. */
function preloadAvatar(look) {
  for (let frame = 0; frame < 3; frame++) {
    avatarFrame(look, "stand1", frame, false);
    avatarFrame(look, "stand1", frame, true);
  }
  for (let frame = 0; frame < 4; frame++) {
    avatarFrame(look, "walk1", frame, false);
    avatarFrame(look, "walk1", frame, true);
  }
}

/** Fetches one NPC's or mob's frame table, once per template. */
function ensureEntityArt(kind, templateId) {
  const table = kind === "npc" ? npcArts : mobArts;
  if (table.has(templateId) || artMissing.has(`${kind}:${templateId}`)) return;
  table.set(templateId, undefined);
  fetch(`/api/${kind}/${templateId}`)
    .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
    .then((data) => {
      table.set(templateId, data.actions ?? {});
      for (const frames of Object.values(data.actions ?? {})) {
        for (const frame of frames) artImage(frame.path);
      }
    })
    .catch(() => {
      table.delete(templateId);
      artMissing.add(`${kind}:${templateId}`);
    });
}

/**
 * The frame of `action` to show at `now`: the archive's own delays, looping. The first frame is
 * used until the table has arrived, so an NPC appears as soon as its pictures do.
 */
function loopFrame(frames, now) {
  if (!frames || frames.length === 0) return undefined;
  if (frames.length === 1) return frames[0];
  const total = frames.reduce((sum, frame) => sum + Math.max(1, frame.delay), 0);
  let at = now % total;
  for (const frame of frames) {
    at -= Math.max(1, frame.delay);
    if (at < 0) return frame;
  }
  return frames[frames.length - 1];
}

/** Plays `action` from the table, falling back to the idle one. */
function playAction(actions, action, now) {
  if (!actions) return undefined;
  return loopFrame(actions[action], now) ?? loopFrame(actions.stand, now) ?? loopFrame(actions.move, now);
}

/** One image at `(x, y)` with the canvas' origin at that point. */
function drawArchiveImage(frame, x, y, flip) {
  const entry = artImage(frame.path);
  if (!entry.ready) return;
  const ox = frame.ox ?? 0;
  const oy = frame.oy ?? 0;
  const w = entry.img.naturalWidth;
  const h = entry.img.naturalHeight;
  if (flip) {
    // Mirror around the origin: source column u lands on `x + ox - u` (the same rule the server's
    // compositor uses), so the sprite stays anchored where it was drawn unflipped.
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    ctx.scale(-1, 1);
    ctx.drawImage(entry.img, -ox, -oy, w, h);
    ctx.restore();
  } else {
    ctx.drawImage(entry.img, Math.round(x) - ox, Math.round(y) - oy, w, h);
  }
}

/**
 * One background sheet, exactly as the 2003 client tiles it (`sub_46A9F0` and the Journey client's
 * reimplementation of it): the offset is the WZ `x/y` plus the parallax
 * `rx * (halfWidth + camera) / 100 + halfWidth`, the sheet is repeated `view/cx + 3` times when the
 * type tiles, and the strip is normalised so the first copy starts just off the left/top edge.
 */
function drawBack(back, cameraX, cameraY) {
  const entry = artImage(back.path);
  if (!entry.ready) return;
  const w = entry.img.naturalWidth;
  const h = entry.img.naturalHeight;
  if (w === 0 || h === 0) return;
  const stepX = back.cx > 0 ? back.cx : w;
  const stepY = back.cy > 0 ? back.cy : h;
  let x = back.x + (back.rx * (VIEW_W / 2 + cameraX)) / 100 + VIEW_W / 2;
  let y = back.y + (back.ry * (VIEW_H / 2 + cameraY)) / 100 + VIEW_H / 2;
  const horizontal = back.type === 1 || back.type === 3 || back.type === 4 || back.type === 6;
  const vertical = back.type === 2 || back.type === 3 || back.type === 5 || back.type === 7;
  if (horizontal) {
    while (x > 0) x -= stepX;
    while (x < -stepX) x += stepX;
  }
  if (vertical) {
    while (y > 0) y -= stepY;
    while (y < -stepY) y += stepY;
  }
  const columns = horizontal ? Math.ceil(VIEW_W / stepX) + 3 : 1;
  const rows = vertical ? Math.ceil(VIEW_H / stepY) + 3 : 1;
  ctx.globalAlpha = Math.max(0, Math.min(255, back.a ?? 255)) / 255;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const sx = Math.round(x + column * stepX);
      const sy = Math.round(y + row * stepY);
      if (sx > VIEW_W || sy > VIEW_H || sx + w < 0 || sy + h < 0) continue;
      // A flipped sheet mirrors in place: its right edge is drawn where the left one would be.
      drawArchiveImage({ path: back.path, ox: 0, oy: 0 }, back.flip ? sx + (w - 1) : sx, sy, back.flip);
    }
  }
  ctx.globalAlpha = 1;
}

/**
 * The fallback ground, drawn only when the archive cannot draw the map's own tiles.
 *
 * `Data.wz` in this repository is a subset: it carries nine of the tile sets, and the maps that are
 * built from `grassySoil`, `dryRock` or `darkWood` have no tile canvases at all. Drawing sky under
 * the player would read as "the client is broken", so those maps get their footholds drawn instead -
 * a thin line exactly where the 2003 client's collision is. Maps whose tiles are in the archive
 * never see this function.
 */
function drawFootholds(cameraX, cameraY) {
  if (!map) return;
  // Each foothold segment becomes a slab: the line the 2003 client lets a character stand on, with
  // the earth that would be under it and a grass lip on top. A platform stays a platform (the slab
  // is 18 px deep, not a wall), and a floor reads as a floor.
  const DEPTH = 18;
  for (const segment of map.footholds) {
    const x1 = segment.x1 - cameraX;
    const y1 = segment.y1 - cameraY;
    const x2 = segment.x2 - cameraX;
    const y2 = segment.y2 - cameraY;
    if (Math.max(x1, x2) < -40 || Math.min(x1, x2) > VIEW_W + 40) continue;
    if (Math.min(y1, y2) > VIEW_H + 40 || Math.max(y1, y2) < -60) continue;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x2, y2 + DEPTH);
    ctx.lineTo(x1, y1 + DEPTH);
    ctx.closePath();
    ctx.fillStyle = "#6b5232";
    ctx.fill();
    ctx.strokeStyle = "#3b2d1c";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // The grass: a soft band along the surface, the lighter one a touch above the darker.
    ctx.strokeStyle = "#3f7a33";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(x1, y1 - 1);
    ctx.lineTo(x2, y2 - 1);
    ctx.stroke();
    ctx.strokeStyle = "#66a94c";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x1, y1 - 2);
    ctx.lineTo(x2, y2 - 2);
    ctx.stroke();
  }
}

/** One tile/object, its animation frame picked from the map's clock. */
function drawMapSprite(sprite, cameraX, cameraY, now, flipWorld) {
  const frame = loopFrame(sprite.frames, now);
  if (frame === undefined) return;
  const worldFlip = sprite.flip !== flipWorld;
  drawArchiveImage(frame, sprite.x - cameraX, sprite.y - cameraY, worldFlip);
}

/** The character's stance and frame from its movement, the way the page can see it. */
function stanceOfEntity(entity, now) {
  // The wire only says where a character is, so "walking" is "a move arrived recently"; the body
  // image's own delays are 180 ms for `walk1`'s four frames and 500 ms for `stand1`'s three.
  const moving = now - (entity.movedAt ?? 0) < 360;
  return {
    stance: moving ? "walk1" : "stand1",
    frame: moving ? Math.floor(now / 180) % 4 : Math.floor(now / 500) % 3,
  };
}

/** The face folder an active emotion names, or undefined when it has expired. */
function emotionFace(emotion, now) {
  if (!emotion || emotion.until <= now) return undefined;
  return EMOTE_NAMES[emotion.value];
}

/** An avatar drawn with its feet at `(screenX, screenY)`, mirrored while facing left. */
function drawAvatarAt(entity, screenX, screenY, now, flip) {
  const look = lookOf(entity);
  preloadAvatar(look);
  const state = stanceOfEntity(entity, now);
  const frame = avatarFrame(look, state.stance, state.frame, flip, emotionFace(entity.emotion, now));
  if (frame.ready) {
    // The server composed this frame facing the requested way and reported where its top-left
    // corner goes relative to the feet, so the page adds `dx`/`dy` and nothing else.
    ctx.drawImage(frame.img, Math.round(screenX + frame.dx), Math.round(screenY + frame.dy));
    return;
  }
  // Before the composed PNG arrives (or if the archive is off): a neutral placeholder at the same
  // spot, so the field is not empty while the first pictures load.
  ctx.fillStyle = "rgba(120, 170, 210, 0.35)";
  ctx.fillRect(Math.round(screenX) - 9, Math.round(screenY) - 42, 18, 42);
}

/** The NPC/mob sprite at `(x, y)`, with its own animation. */
function drawEntitySprite(kind, templateId, x, y, facing, moving, now) {
  ensureEntityArt(kind, templateId);
  const actions = (kind === "npc" ? npcArts : mobArts).get(templateId);
  const action = kind === "npc" ? "stand" : moving ? "move" : "stand";
  const frame = playAction(actions, action, now);
  if (frame === undefined) return;
  drawArchiveImage(frame, x, y, facing === 1);
}

function frame() {
  const now = performance.now();
  const target = cameraTarget();
  if (!camera.ready) {
    camera.x = target.x;
    camera.y = target.y;
    camera.ready = true;
  } else {
    camera.x += (target.x - camera.x) * CAMERA_EASE;
    camera.y += (target.y - camera.y) * CAMERA_EASE;
  }
  const cameraX = camera.x;
  const cameraY = camera.y;

  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  const backs = mapArt?.backs ?? [];
  for (const back of backs) if (!back.front) drawBack(back, cameraX, cameraY);
  if ((mapArt?.missingTiles ?? 0) > 0) drawFootholds(cameraX, cameraY);

  const sprites = mapArt?.sprites ?? [];
  const behind = sprites.filter((sprite) => (sprite.layer ?? 0) < CHARACTER_LAYER);
  const front = sprites.filter((sprite) => (sprite.layer ?? 0) >= CHARACTER_LAYER);
  for (const sprite of behind) drawMapSprite(sprite, cameraX, cameraY, now, false);
  drawPortals(cameraX, cameraY, now);

  // Characters, back to front by their feet.
  const actors = [];
  for (const npc of npcs.values()) actors.push({ kind: "npc", y: npc.y, npc });
  for (const mob of mobs.values()) actors.push({ kind: "mob", y: mob.y, mob });
  for (const user of users.values()) actors.push({ kind: "user", y: user.y, user });
  if (self && selfView) actors.push({ kind: "self", y: self.y, self });
  actors.sort((left, right) => left.y - right.y);
  for (const actor of actors) {
    const x = actor.kind === "self" ? self.x - cameraX : actor.kind === "mob" ? actor.mob.x - cameraX : actor.kind === "npc" ? actor.npc.x - cameraX : actor.user.x - cameraX;
    const y = actor.y - cameraY;
    if (x < -200 || x > VIEW_W + 200 || y < -300 || y > VIEW_H + 300) continue;
    if (actor.kind === "npc") {
      drawEntitySprite("npc", actor.npc.templateId, x, y, actor.npc.facing ?? 0, false, now);
    } else if (actor.kind === "mob") {
      const moved = now - (actor.mob.movedAt ?? 0) < 400;
      drawEntitySprite("mob", actor.mob.templateId, x, y, actor.mob.facing ?? 0, moved, now);
    } else if (actor.kind === "self") {
      drawAvatarAt(selfView, x, y, now, selfView.facing === 1);
      drawName(selfView.name, x, y - 62);
    } else {
      drawAvatarAt(actor.user, x, y, now, actor.user.facing === 1);
      drawName(actor.user.name, x, y - 62);
    }
  }

  for (const sprite of front) drawMapSprite(sprite, cameraX, cameraY, now, false);
  for (const back of backs) if (back.front) drawBack(back, cameraX, cameraY);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/** The layer the characters are drawn in: after layers 0-2, before layer 3 and the front backs. */
const CHARACTER_LAYER = 3;

/** A name tag above a character, white with a soft shadow - the 2003 client's look. */
function drawName(name, x, y) {
  if (!name) return;
  ctx.font = "12px 'Malgun Gothic', 'Apple SD Gothic Neo', system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.75)";
  ctx.strokeText(name, x, y);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(name, x, y);
}

/**
 * The portal swirls, exactly where the original draws them: `pt == 2` warps (`pt == 0` is a spawn
 * point and `pt == 1` a hidden passage, neither of which has a picture), using the shared
 * `MapHelper.img/portal/game/pv` animation. They belong to the field, so they are drawn behind the
 * characters - the page calls this before the actors.
 */
function drawPortals(cameraX, cameraY, now) {
  if (!map || !mapArt) return;
  const frames = mapArt.portalFrames ?? [];
  const frame = loopFrame(frames, now);
  if (frame === undefined) return;
  for (const portal of map.portals) {
    if (portal.type !== 2) continue;
    const x = portal.x - cameraX;
    const y = portal.y - cameraY;
    const width = 120;
    if (x < -width || x > VIEW_W + width || y < -width || y > VIEW_H + width) continue;
    drawArchiveImage(frame, x, y, false);
  }
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
  if (name === "系統") {
    who.classList.add("system");
    who.textContent = `${name}：`;
  } else if (name.endsWith("<<")) {
    // The 2003 client's own whisper echo: "name<< text" (`CField+28`).
    who.classList.add("whisper");
    who.textContent = `${name} `;
  } else {
    who.textContent = `${name} : `;
  }
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

// ---------------------------------------------------------------- inventory panel

/**
 * Draws the panel from `inventory`.
 *
 * Everything but the numbers on the cells is *not* from the wire: `0x0B` carries an id, a count and
 * (for an equip) its upgrade slots, so the name and the icon come from `/api/item/<id>`, which reads
 * the same `Data.wz` the 2003 client read. A fetch that fails leaves the id showing - the panel never
 * invents a name.
 */
function renderInventory() {
  if (inventory === undefined || inventory === null) {
    ui.invGrid.replaceChildren();
    ui.invWorn.replaceChildren();
    ui.invInfo.textContent = "尚未進入地圖。";
    return;
  }
  if (inventoryTab === 0) {
    const use = inventory.tabs.find((entry) => entry.tab === 2);
    const firstFull = inventory.tabs.find((entry) => entry.items.length > 0);
    inventoryTab = (use !== undefined && use.items.length > 0 ? use : firstFull)?.tab ?? 2;
  }
  ui.invTabs.replaceChildren(
    ...INVENTORY_TABS.map(({ tab, label }) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      if (tab === inventoryTab) button.classList.add("active");
      button.addEventListener("click", () => {
        inventoryTab = tab;
        showInventoryHint();
        renderInventory();
      });
      return button;
    }),
  );

  // The worn group: `worn` is the 14 equipment slots, `wornCash` the 14 cash ones. Both are drawn
  // above the grid, the way the 2003 window has them; a tab with no such slots keeps the row hidden.
  const worn = inventoryTab === 4 ? inventory.wornCash : inventory.worn;
  ui.invWorn.replaceChildren(...worn.map((item) => inventoryCell(item, true)));
  ui.invWorn.classList.toggle("hidden", worn.length === 0);

  const active = inventory.tabs.find((entry) => entry.tab === inventoryTab);
  const cells = [];
  for (let slot = 1; slot <= (active?.capacity ?? 0); slot += 1) {
    const item = active?.items.find((entry) => entry.slot === slot);
    cells.push(item === undefined ? inventoryCell(undefined, false) : inventoryCell(item, false));
  }
  ui.invGrid.replaceChildren(...cells);
  if (cells.length === 0) ui.invInfo.textContent = "這個伺服器沒有回報背包內容。";
}

/** The line the panel shows before (or instead of) an item: what a cell does is not obvious. */
function showInventoryHint() {
  ui.invInfo.textContent = "點一下看資訊；雙擊消耗品使用。";
}

/** One square. `item` undefined is an empty slot; a worn square never sends `use`. */
function inventoryCell(item, worn) {
  const cell = document.createElement("div");
  cell.className = "inv-cell";
  if (item === undefined) return cell;
  // 200..203 are the four families `0x18`/`0x19` carry (204 is a scroll, `0x1A`, which this page
  // has no target slot for).
  const family = Math.floor(item.itemId / 10000);
  const usable = !worn && inventoryTab === 2 && family >= 200 && family <= 203;
  cell.classList.add("filled");
  if (usable) cell.classList.add("usable");
  cell.title = `${slotName(item.slot)} · ${item.itemId}`;
  cell.dataset.itemId = String(item.itemId);
  cell.dataset.slot = String(item.slot);

  if (!iconMissing.has(item.itemId)) {
    const image = document.createElement("img");
    // The listener first: a 404 that is already in the cache fires `error` before a listener
    // attached after `src` would exist, and the cell would keep a broken image for good.
    image.addEventListener("error", () => {
      iconMissing.add(item.itemId);
      image.remove();
      cell.classList.add("no-icon");
    });
    image.alt = "";
    image.src = `/api/item/${item.itemId}/icon.png`;
    cell.append(image);
  }
  // A stack's count, and an equip's remaining upgrades - but a fresh item's `ruc` is 0 on every
  // single piece of starter gear, and a `0` under every icon reads as noise rather than as a fact.
  const count = item.quantity !== undefined && item.quantity > 1
    ? String(item.quantity)
    : item.ruc !== undefined && item.ruc > 0
      ? String(item.ruc)
      : undefined;
  if (count !== undefined) {
    const label = document.createElement("span");
    label.className = "count";
    label.textContent = count;
    cell.append(label);
  }

  // A double-click uses a USE-tab item, which is what `sub_462DC0` does with the same click.
  if (usable) {
    cell.addEventListener("dblclick", () => send({ t: "use", slot: item.slot, itemId: item.itemId }));
  }
  cell.addEventListener("click", () => showItemInfo(item));
  describeItem(item.itemId);
  return cell;
}

/** Puts the last-clicked item in the info line, if its facts have arrived. */
function showItemInfo(item) {
  const facts = itemInfo.get(item.itemId);
  const lines = [`${slotName(item.slot)} · ${item.itemId}${facts?.name ? ` · ${facts.name}` : ""}`];
  if (item.quantity !== undefined) lines.push(`數量 ${item.quantity}`);
  if (item.ruc !== undefined && item.ruc > 0) lines.push(`可升級次數 ${item.ruc}`);
  if (facts?.desc) lines.push(facts.desc);
  else if (facts !== undefined && facts.name === undefined) lines.push("（Data.wz 查不到這個道具）");
  ui.invInfo.textContent = lines.join("\n");
}

/** Asks `/api/item/<id>` once per id; a failure is remembered as "no facts" so it is not retried. */
function describeItem(itemId) {
  if (itemInfo.has(itemId) || itemInfoPending.has(itemId)) return;
  itemInfoPending.add(itemId);
  fetch(`/api/item/${itemId}`)
    .then((response) => (response.ok ? response.json() : null))
    .then((facts) => {
      itemInfo.set(itemId, facts);
      itemInfoPending.delete(itemId);
      renderInventory();
      if (shop !== undefined) renderShop();
    })
    .catch(() => {
      itemInfo.set(itemId, null);
      itemInfoPending.delete(itemId);
    });
}

// ---------------------------------------------------------------- shop & dialogue

/**
 * The window `0x4A` opened: one row per item the server priced from the archive.
 *
 * Buying sends the client's own `0x16` (`{t:"shop",action:"buy",row,itemId,count}`); the answer is
 * a `0x4B` result byte and, when it worked, a `0x0B` (the slot) plus a `0x0D` (the mesos) - the
 * same three packets a real client gets. Selling is *not* wired to a control: it needs a slot and a
 * count from somewhere, and the page has neither a drag nor a quantity dialog yet.
 */
function renderShop() {
  if (shop === undefined) {
    ui.shop.classList.add("hidden");
    return;
  }
  ui.shopTitle.textContent = `商店 ${shop.shopId}`;
  ui.shopRows.replaceChildren(...shop.items.map((row, index) => shopRow(row, index)));
  ui.shop.classList.remove("hidden");
}

function shopRow(row, index) {
  const li = document.createElement("li");
  li.className = "shop-row";
  const image = document.createElement("img");
  image.alt = "";
  image.addEventListener("error", () => image.remove());
  image.src = `/api/item/${row.itemId}/icon.png`;
  const name = document.createElement("span");
  name.className = "shop-name";
  name.textContent = itemInfo.get(row.itemId)?.name ?? String(row.itemId);
  const price = document.createElement("span");
  price.className = "shop-price";
  price.textContent = `${row.price} 元`;
  const one = document.createElement("button");
  one.type = "button";
  one.textContent = "買";
  one.title = `買 1 個（${row.price} 元）`;
  one.addEventListener("click", () => buyItem(row, index, 1));
  li.append(image, name, price, one);
  // `maxCount` is the cap on one purchase, so a row that cannot take ten does not offer ten.
  if (row.maxCount >= 10) {
    const ten = document.createElement("button");
    ten.type = "button";
    ten.textContent = "×10";
    ten.title = `買 10 個（${row.price * 10} 元）`;
    ten.addEventListener("click", () => buyItem(row, index, 10));
    li.append(ten);
  }
  describeItem(row.itemId);
  return li;
}

function buyItem(row, index, count) {
  send({ t: "shop", action: "buy", row: index, itemId: row.itemId, count });
}

/** Closes the window; `notify` is false when the server already dropped it (a map change did). */
function closeShop(notify = true) {
  ui.shop.classList.add("hidden");
  if (shop === undefined) return;
  shop = undefined;
  if (notify) send({ t: "shop", action: "close" });
}

/**
 * The NPC dialog (`0x47`). `確定` sends the primary answer, which the server advances on; `關閉`
 * sends the secondary one, which ends the conversation - exactly the two buttons the 2003 client
 * offers. The box closes on either, and reappears if the server sent another line.
 */
function closeDialogue(notify = true, answer = 0) {
  ui.dialogue.classList.add("hidden");
  if (talkingNpc === undefined) return;
  talkingNpc = undefined;
  if (notify) send({ t: "talk", answer });
}

function toggleInventory(force) {
  const show = force ?? ui.inventory.classList.contains("hidden");
  ui.inventory.classList.toggle("hidden", !show);
  if (show) {
    renderInventory();
    if (ui.invInfo.textContent === "") showInventoryHint();
  }
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

ui.create.addEventListener("click", () => {
  const name = ui.newName.value.trim();
  if (name === "") {
    ui.characterStatus.textContent = "先輸入角色名稱。";
    return;
  }
  send({ t: "create", name });
});
ui.pass.addEventListener("keydown", (event) => {
  if (event.key === "Enter") connect();
});
ui.user.addEventListener("keydown", (event) => {
  if (event.key === "Enter") ui.pass.focus();
});
ui.logToggle.addEventListener("click", () => ui.log.classList.toggle("hidden"));
ui.invToggle.addEventListener("click", () => toggleInventory());
ui.invClose.addEventListener("click", () => toggleInventory(false));
ui.shopClose.addEventListener("click", () => closeShop());
ui.dialogueOk.addEventListener("click", () => closeDialogue(true, 1));
ui.dialogueClose.addEventListener("click", () => closeDialogue(true, 0));

// The 2003 client sends these from F1..F7 (`sub_511E20` case 10); a browser cannot take those keys
// (F1 is help, F5 reloads), so the page offers the same seven faces as buttons.
ui.emotes.replaceChildren(
  ...EMOTE_KEYS.map((value) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = EMOTE_NAMES[value];
    button.title = `表情 ${value}：${EMOTE_NAMES[value]}`;
    button.addEventListener("click", () => {
      // The 2003 client paints the face before it sends (`.text:00511FD8` precedes `push 0x13`), and
      // the server does not echo `0x27` to the sender - so the page does the same and keeps it.
      selfEmotion = { value, until: performance.now() + 2500 };
      if (selfView) selfView.emotion = selfEmotion;
      send({ t: "emotion", value });
    });
    return button;
  }),
);

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
  if (event.key === "Escape") {
    if (shop !== undefined) closeShop();
    if (talkingNpc !== undefined) closeDialogue();
    return;
  }
  // `I` opens the inventory. The 2003 client opens it from its own shortcut bar (`I` in the default
  // key map); there is no packet involved - the panel is drawn from state this page already has.
  if (event.key.toLowerCase() === "i") {
    event.preventDefault();
    toggleInventory();
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
  if (dx !== 0) self.facing = dx < 0 ? 1 : 0;
  self.movedAt = performance.now();
  self.x += dx * MOVE_PX_PER_TICK;
  self.y += dy * MOVE_PX_PER_TICK;
  if (performance.now() - lastMoveSent < MOVE_TICK_MS) return;
  lastMoveSent = performance.now();
  send({ t: "move", x: Math.round(self.x), y: Math.round(self.y), foothold: 0 });
}, 40);

/**
 * The chat box's two commands.
 *
 * The 2003 client spells them `/귓속말` and `/헉추적`; the spellings never reach the wire - the
 * client translates them into `0x23` kind 0x06 / 0x05 itself - so `/w` and `/f` are this page's own
 * names for the same two requests (ADR-036). Anything that is not one of them is chat, including a
 * line that merely starts with a slash.
 *
 * @param {string} text what was typed
 * @param {() => void} local print a line in this page's own chat box
 * @returns {boolean} true when the line was a command and must not be sent as chat
 */
function runCommand(text, local) {
  const match = /^\/(w|f)\s+(\S+)(?:\s+([\s\S]*))?$/.exec(text);
  if (!match) {
    if (text.startsWith("/")) {
      local("系統", "這個頁面的指令只有 /w 名字 訊息 與 /f 名字。");
      return true;
    }
    return false;
  }
  const [, command, name, rest] = match;
  if (command === "f") {
    if (rest !== undefined && rest !== "") {
      local("系統", "用法：/f 名字");
      return true;
    }
    send({ t: "find", name });
    return true;
  }
  if (rest === undefined || rest === "") {
    local("系統", "用法：/w 名字 訊息");
    return true;
  }
  send({ t: "whisper", name, text: rest });
  pendingWhisper = { name, text: rest };
  return true;
}

ui.say.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  const text = ui.say.value.trim();
  ui.say.value = "";
  if (text !== "" && !runCommand(text, chatLine)) send({ t: "say", text });
  if (!event.shiftKey) ui.say.blur();
});

ui.say.addEventListener("blur", () => {
  ui.say.placeholder = "Enter 開始輸入，再按 Enter 送出";
});

/** The first thing a user sees; also what a refresh returns to. */
showPanel(ui.connect);
logLine(`page loaded; ws target ${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
