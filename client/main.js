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
  gameUi: /** @type {HTMLElement} */ (document.getElementById("game-ui")),
  chatbox: /** @type {HTMLElement} */ (document.getElementById("chatbox")),
  chatLines: /** @type {HTMLElement} */ (document.getElementById("chat-lines")),
  say: /** @type {HTMLInputElement} */ (document.getElementById("say")),
  emotes: /** @type {HTMLElement} */ (document.getElementById("emotes")),
  log: /** @type {HTMLElement} */ (document.getElementById("log")),
  logLines: /** @type {HTMLElement} */ (document.getElementById("log-lines")),
  logToggle: /** @type {HTMLButtonElement} */ (document.getElementById("log-toggle")),
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
/** The shop `0x4A` opened, or undefined when no NPC's window is up. */
let shop;
/** The NPC whose `0x47` line is on screen, or undefined when the dialog is closed. */
let talkingNpc;

/** The four tabs of the sheet, in the order `sub_4DA440` adds them to its `CCtrlTab`. */
const INVENTORY_TABS = [
  { tab: 1, label: "장비" },
  { tab: 2, label: "소비" },
  { tab: 3, label: "설치" },
  { tab: 4, label: "기타" },
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
      drops.clear();
      dying.clear();
      for (const user of message.users) users.set(String(user.characterId), user);
      for (const mob of message.mobs) mobs.set(String(mob.mobId), mob);
      for (const npc of message.npcs) npcs.set(String(npc.npcId), npc);
      hidePanels();
      // The server drops the windows with the map (the shop and the dialog belong to its NPCs), so
      // this side must not tell it to close something it already forgot.
      closeShop(false);
      closeDialogue(false);
      ui.chatbox.classList.remove("hidden");
      ui.where.textContent = `${selfView.name} · 地圖 ${message.mapId}`;
      void loadMap(message.mapId);
      logLine(`field ${message.mapId}`);
      return;

    case "self":
      selfView = message.self;
      return;

    case "inventory":
      // The window draws from this on the next frame; `0x0B` also changes the stack counts.
      inventory = message.inventory;
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

    case "mob-die": {
      // `0x30`: the monster is still on the field (its corpse is), and the 2003 client plays
      // `Mob/<id>.img/die1` before `0x31` takes it away. Nothing else changes here - the loot and
      // the exp are other packets, from the server.
      dying.set(String(message.mobId), performance.now());
      return;
    }

    case "mob-leave":
      mobs.delete(String(message.mobId));
      dying.delete(String(message.mobId));
      return;

    case "loot": {
      // `0x11`: the 2003 client prints the pickup itself (`sub_55C130`), in Korean, from its own
      // archive. The page has the same archive behind `/api/item/<id>`, so it prints the same line.
      const notice = message.notice;
      if (notice?.kind === "mesos") {
        chatLine("系統", `메소를 얻었습니다 (+${notice.amount})`);
        return;
      }
      if (notice?.kind !== "item") {
        if (notice?.kind === "rejected") chatLine("系統", "아이템을 더 이상 가질 수 없습니다");
        return;
      }
      const itemId = Number(notice.itemId);
      const count = Number(notice.count ?? 1);
      const sentence = (label) =>
        count >= 2 ? `아이템을 얻었습니다 (${label} ${count}개)` : `아이템을 얻었습니다 (${label})`;
      // The name is an archive lookup, so a first-time item shows its id for a frame and the line
      // is rewritten when the name lands. `icon.png`/`iconRaw` only exist if the id does, so a
      // failed lookup leaves the id in place, which is what the client prints for an unnamed item.
      const known = itemInfo.get(itemId);
      const line = chatLine("系統", sentence(known?.name ?? String(itemId)));
      describeItem(itemId);
      if (known === undefined) {
        void (async () => {
          for (let i = 0; i < 40 && itemInfo.get(itemId) === undefined; i++) {
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          const facts = itemInfo.get(itemId);
          if (typeof facts?.name === "string") {
            const text = line.lastChild;
            if (text) text.textContent = sentence(facts.name);
          }
        })();
      }
      return;
    }

    case "hit": {
      // The swing's own numbers: the wire has no packet for them (the 2003 client drew them while it
      // built 0x1B), so the bridge answers the page with what it rolled and sent.
      const mob = mobs.get(String(message.mobId));
      const now = performance.now();
      if (mob) {
        mobHits.set(String(message.mobId), now);
        damageMarks.push({ x: mob.x, y: mob.y, value: message.damage, start: now });
      }
      return;
    }

    case "user-attack": {
      // Somebody else's swing (`0x23`): their character plays the motion, the mobs they named flash
      // and show the numbers they sent - which is exactly what the relayed packet carries.
      const user = users.get(String(message.characterId));
      const now = performance.now();
      if (user) user.swing = { stance: SWING_STANCES[swingCounter++ % SWING_STANCES.length], start: now };
      for (const target of message.targets ?? []) {
        const mob = mobs.get(String(target.mobId));
        if (!mob) continue;
        mobHits.set(String(target.mobId), now);
        const total = (target.damages ?? []).reduce((sum, value) => sum + value, 0);
        if (total > 0) damageMarks.push({ x: mob.x, y: mob.y, value: total, start: now });
      }
      return;
    }

    case "drop-enter": {
      // The drop flies out of the monster that left it: the packet carries the monster and where the
      // item came to rest, and the two are a hop apart.
      const mob = message.drop.mobId === undefined ? undefined : mobs.get(String(message.drop.mobId));
      const fromX = mob?.x ?? message.drop.mobX ?? message.drop.x;
      const fromY = mob?.y ?? message.drop.mobY ?? message.drop.y;
      drops.set(String(message.drop.dropId), {
        drop: message.drop,
        born: performance.now(),
        fromX,
        fromY,
      });
      return;
    }

    case "drop-leave": {
      const key = String(message.dropId);
      const record = drops.get(key);
      if (record === undefined) return;
      // `taken` is the only kind the original turns into an animation: the icon flies to the
      // character in `characterId` (0x44's own field) and disappears when it gets there.
      if (message.reason !== "taken" || message.characterId === undefined) {
        drops.delete(key);
        return;
      }
      record.takenAt = performance.now();
      record.takenBy = message.characterId;
      return;
    }

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

/** Where the pointer is (surface pixels), so the item tooltip can follow it. */
let pointerAt;

canvas.addEventListener("mousemove", (event) => {
  const point = viewPoint(event);
  pointerAt = point;
  if (inventoryDrag !== undefined) {
    // Four pixels of slop: a click that wobbles on a slot still selects it instead of moving the
    // window. Past that, the press becomes the window drag the original has.
    if (Math.abs(point.x - inventoryDrag.startX) + Math.abs(point.y - inventoryDrag.startY) > 3) {
      inventoryDrag.moved = true;
    }
    if (inventoryDrag.moved) {
      // Keep a strip of the window on screen: a window dragged fully out could never be grabbed again.
      inventoryAt = {
        x: Math.max(-INVENTORY.width + 48, Math.min(VIEW_W - 48, Math.round(point.x - inventoryDrag.dx))),
        y: Math.max(0, Math.min(VIEW_H - 32, Math.round(point.y - inventoryDrag.dy))),
      };
      canvas.style.cursor = "move";
      return;
    }
  }
  inventoryHover = inventoryWindowAt(point.x, point.y);
  if (inventoryHover !== undefined) {
    statusHover = undefined;
    hoveredPortal = undefined;
    const pointer = inventoryHover.kind === "close"
      || inventoryHover.kind === "tab"
      || (inventoryHover.kind === "slot" && inventoryHover.item !== undefined);
    canvas.style.cursor = pointer ? "pointer" : "default";
    return;
  }
  const button = statusButtonAt(point.x, point.y);
  statusHover = button?.action;
  hoveredPortal = button ? undefined : portalAt(point.x, point.y);
  const npc = button ? undefined : npcAt(point.x, point.y);
  canvas.style.cursor = button || hoveredPortal || npc ? "pointer" : "default";
});

canvas.addEventListener("mousedown", (event) => {
  const point = viewPoint(event);
  const hit = inventoryWindowAt(point.x, point.y);
  if (hit !== undefined && hit.kind !== "close" && hit.kind !== "tab") {
    inventoryDrag = {
      dx: point.x - inventoryAt.x,
      dy: point.y - inventoryAt.y,
      startX: point.x,
      startY: point.y,
      moved: false,
    };
  }
  statusPressed = statusButtonAt(point.x, point.y)?.action;
});

canvas.addEventListener("mouseup", () => {
  if (inventoryDrag?.moved === true) {
    // A drag is not a click: the window moved, so the sheet under the press must not act.
    inventorySuppressClick = true;
    try {
      localStorage.setItem("kms111.inventoryAt", JSON.stringify(inventoryAt));
    } catch {
      // A blocked localStorage only costs the position.
    }
  }
  inventoryDrag = undefined;
  statusPressed = undefined;
});

/** Set by a finished window drag so the `click` that follows does not also hit a slot. */
let inventorySuppressClick = false;

canvas.addEventListener("dblclick", (event) => {
  const point = viewPoint(event);
  const hit = inventoryWindowAt(point.x, point.y);
  if (hit?.kind !== "slot" || hit.item === undefined) return;
  // `sub_462DC0` uses a USE-tab item on a double click; the family is the first three digits.
  const family = Math.floor(hit.item.itemId / 10000);
  if (inventoryTab !== 2 || family < 200 || family > 203) return;
  send({ t: "use", slot: hit.item.slot, itemId: hit.item.itemId });
});

canvas.addEventListener("click", (event) => {
  // The status bar is drawn over the world, so its buttons win over anything behind them - and the
  // inventory window is above both.
  const point = viewPoint(event);
  if (inventorySuppressClick) {
    inventorySuppressClick = false;
    return;
  }
  const hit = inventoryWindowAt(point.x, point.y);
  if (hit !== undefined) {
    if (hit.kind === "close") {
      toggleInventory(false);
    } else if (hit.kind === "tab") {
      inventoryTab = hit.tab;
      inventoryPick = undefined;
    } else if (hit.kind === "slot") {
      inventoryPick = hit.item;
      if (hit.item !== undefined) describeItem(hit.item.itemId);
    }
    return;
  }
  const button = statusButtonAt(point.x, point.y);
  if (button) {
    if (shop !== undefined || talkingNpc !== undefined) return;
    statusButtonClick(button);
    return;
  }
  // An NPC first: its box stands on the ground where a door could also be, and the server can only
  // open one window at a time (`0x4A`/`0x47` while another is up is a disconnect in the client).
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
/** `mobId -> when its 0x30 (die) arrived`; the corpse plays the monster's own `die1` frames. */
const dying = new Map();
/**
 * `dropId -> { drop, born, fromX, fromY }`: what `0x43` put on the ground.
 *
 * A v1.11 client has no pickup request, so this map is write-only from the wire's point of view:
 * the field decides who gets a drop and sends `0x44` kind 2 with the taker's id, which is what the
 * page animates (the icon flies to that character).
 */
const drops = new Map();
/** Meso piles, one entry per tier: `[{path,ox,oy}]`, the four `iconRaw` frames of `0900.img`. */
const mesoArt = new Map();
/** The local character's current swing (`{stance, start}`), and the three the client cycles. */
let selfSwing;
let swingCounter = 0;
/** `{x, y, value, start}` per damage number on screen, and `mobId -> when it was last hit`. */
const damageMarks = [];
const mobHits = new Map();

/** Every swing lives this long; the three `swingO*` motions cover the weapon images this build has. */
const SWING_MS = 480;
const SWING_COOLDOWN_MS = 460;
const SWING_STANCES = ["swingO1", "swingO2", "swingO3"];
/** The 2003 client's reach for a one-handed swing, in px, and how far up/down a mob still counts. */
const SWING_REACH_X = 90;
const SWING_REACH_UP = 72;
const SWING_REACH_DOWN = 36;
let lastSwingAt = 0;
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
  // The canvas is centred with a transform, so its own rect is where the game UI layer belongs.
  const rect = canvas.getBoundingClientRect();
  ui.gameUi.style.left = `${rect.left}px`;
  ui.gameUi.style.top = `${rect.top}px`;
  ui.gameUi.style.transform = `scale(${rect.width / VIEW_W})`;
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
  // The sheet's own `origin` is the offset the 2003 client blits from (`TMapBack` takes it from the
  // canvas): a copy anchored at (x, y) has its top-left at (x - ox, y - oy).
  const ox = back.ox ?? 0;
  const oy = back.oy ?? 0;
  ctx.globalAlpha = Math.max(0, Math.min(255, back.a ?? 255)) / 255;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const anchorX = Math.round(x + column * stepX);
      const anchorY = Math.round(y + row * stepY);
      const sx = anchorX - ox;
      const sy = anchorY - oy;
      if (sx > VIEW_W || sy > VIEW_H || sx + w < 0 || sy + h < 0) continue;
      // A flipped sheet mirrors in place: source column `u` lands on `anchorX + ox - u`, so the same
      // footprint needs the anchor moved by `w - 2*ox`.
      drawArchiveImage({ path: back.path, ox, oy }, back.flip ? anchorX - 2 * ox + w - 1 : anchorX, anchorY, back.flip);
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
  // A swing outranks walking: the 2003 client's attack motion is played to its end before the body
  // goes back to standing, and both the local character and a relayed `0x23` use the same three
  // `swingO*` motions. The frames are spread over the swing's own length.
  const swing = entity === selfView ? selfSwing : entity.swing;
  if (swing !== undefined) {
    const elapsed = now - swing.start;
    if (elapsed < SWING_MS) {
      const frames = swing.frames ?? 3;
      return { stance: swing.stance, frame: Math.min(frames - 1, Math.floor(elapsed / (SWING_MS / frames))) };
    }
    if (entity === selfView) selfSwing = undefined;
    else delete entity.swing;
  }
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
  if (state.stance !== "stand1") {
    // A stance the archive cannot compose for this look (`swingO1` while the weapon's own PNG is
    // still on the wire) falls back to standing rather than to a grey box.
    const stand = avatarFrame(look, "stand1", 0, flip, emotionFace(entity.emotion, now));
    if (stand.ready) {
      ctx.drawImage(stand.img, Math.round(screenX + stand.dx), Math.round(screenY + stand.dy));
      return;
    }
  }
  // Before the composed PNG arrives (or if the archive is off): a neutral placeholder at the same
  // spot, so the field is not empty while the first pictures load.
  ctx.fillStyle = "rgba(120, 170, 210, 0.35)";
  ctx.fillRect(Math.round(screenX) - 9, Math.round(screenY) - 42, 18, 42);
}

/** The NPC/mob sprite at `(x, y)`, with its own animation. */
function drawEntitySprite(kind, templateId, x, y, facing, moving, now, corpseSince, entityKey) {
  ensureEntityArt(kind, templateId);
  const actions = (kind === "npc" ? npcArts : mobArts).get(templateId);
  const action = kind === "npc" ? "stand" : moving ? "move" : "stand";
  // A hit flashes the monster's own `hit1` for a moment - the same frame the 2003 client plays when
  // the damage it just dealt is applied (`sub_4882F0`, FINDINGS 4.13.1).
  if (kind === "mob" && actions?.hit1 !== undefined) {
    const hitAt = mobHits.get(entityKey);
    if (hitAt !== undefined) {
      const elapsed = now - hitAt;
      if (elapsed < 240) {
        const frame = actions.hit1[Math.min(actions.hit1.length - 1, Math.floor(elapsed / 120))];
        if (frame !== undefined) drawArchiveImage(frame, x, y, facing === 1);
        return;
      }
      mobHits.delete(entityKey);
    }
  }
  // A monster that was hit (`0x30`) plays `die1` once and then holds its last frame until `0x31`:
  // the 2003 client's corpse is the end of that animation, not a picture the server has to send.
  if (corpseSince !== undefined && actions?.die1 !== undefined) {
    // The frames' own delays, exactly like every other action: the field's `dieMs` is their sum, so
    // the corpse lasts as long as the server keeps the monster in its pool.
    const frames = actions.die1;
    const total = frames.reduce((sum, frame) => sum + Math.max(1, frame.delay), 0);
    let at = Math.min(Math.max(0, now - corpseSince), Math.max(0, total - 1));
    let index = frames.length - 1;
    for (let i = 0; i < frames.length; i++) {
      at -= Math.max(1, frames[i].delay);
      if (at < 0) {
        index = i;
        break;
      }
    }
    const frame = frames[index];
    if (frame !== undefined) drawArchiveImage(frame, x, y, facing === 1);
    return;
  }
  const frame = playAction(actions, action, now);
  if (frame === undefined) return;
  drawArchiveImage(frame, x, y, facing === 1);
}

/* --------------------------------------------------------------------------------------------
 * The 2003 status bar (`UI/StatusBar.img`).
 *
 * `CUIStatusBar` is a window at (0, 392) of the 800x600 surface (`sub_545450(this, 0, 392, 800,
 * 208)`), and it is not one picture: a 243x208 left panel, the 446x27 chat bar along the bottom and
 * the 111x136 key pad at the right edge. HP/MP/EXP are 1-px gauge sheets stretched to the troughs
 * the client fills - `v36 = 163 * hp` in `sub_4FA5E0` is the 163-px width, and `sub_4FA170`'s
 * tooltip boxes name the same rectangles (HP 143..159, MP 162..178, EXP 190..198).
 * ------------------------------------------------------------------------------------------ */
const STATUS_BAR = {
  y: 392,
  panel: { path: "UI/StatusBar.img/base/0", x: 0, y: 392 },
  chat: { path: "UI/StatusBar.img/base/1", x: 243, y: 573 },
  keys: { path: "UI/StatusBar.img/base/2", x: 689, y: 464 },
  gauges: {
    hp: { x: 49, y: 143, w: 163, h: 16 },
    mp: { x: 49, y: 162, w: 163, h: 16 },
    exp: { x: 50, y: 190, w: 163, h: 8 },
  },
  // `base/0` carries the same pixels at these spots; the client still draws the button widgets on
  // top of it so a hover or a press can swap the face (36x35, and `BtMenu` 38x17).
  buttons: [
    { name: "BtItem", x: 9, y: 7, w: 36, h: 35, action: "inventory" },
    { name: "BtEquip", x: 9, y: 43, w: 36, h: 35, action: "equip" },
    { name: "BtStat", x: 38, y: 67, w: 36, h: 35, action: "stat" },
    { name: "BtSkill", x: 9, y: 91, w: 36, h: 35, action: "skill" },
    { name: "BtMenu", x: 192, y: 91, w: 38, h: 17, action: "menu" },
  ],
};

/** The `Bt*` action the cursor is over, and the one a press started on. */
let statusHover;
let statusPressed;

/** The bar's button at a surface point, or `undefined`. */
function statusButtonAt(x, y) {
  if (!selfView) return undefined;
  for (const button of STATUS_BAR.buttons) {
    const by = STATUS_BAR.y + button.y;
    if (x >= button.x && x < button.x + button.w && y >= by && y < by + button.h) return button;
  }
  return undefined;
}

/** The job names `CUIStatusBar` prints from its own table (this archive has no String.wz). */
const JOB_NAMES = new Map([
  [0, "초보자"],
  [100, "전사"],
  [110, "파이터"],
  [120, "페이지"],
  [130, "스피어맨"],
  [200, "마법사"],
  [210, "위자드"],
  [220, "클레릭"],
  [230, "위자드"],
  [300, "궁수"],
  [310, "헌터"],
  [320, "사수"],
  [400, "도적"],
  [410, "어쌔신"],
  [420, "시프"],
]);

function jobNameOf(job) {
  return JOB_NAMES.get(job) ?? JOB_NAMES.get(Math.floor(job / 100) * 100) ?? "초보자";
}

/** One line of the bar's white boxes: white text with the dark edge its bitmap font draws. */
function statusText(text, x, y, align = "left") {
  ctx.font = "12px 'Dotum', '돋움', 'Malgun Gothic', sans-serif";
  ctx.textAlign = align;
  ctx.textBaseline = "top";
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, x, y);
}

/** One gauge: the 1-px sheet stretched to `163 * value / max` (`sub_4FA5E0`). */
function drawStatusGauge(key, value, max) {
  const trough = STATUS_BAR.gauges[key];
  const entry = artImage(`UI/StatusBar.img/gauge/${key}`);
  if (!entry.ready || max <= 0) return;
  const filled = Math.round(trough.w * Math.max(0, Math.min(1, value / max)));
  if (filled <= 0) return;
  ctx.drawImage(entry.img, 0, 0, 1, trough.h, trough.x, STATUS_BAR.y + trough.y, filled, trough.h);
}

function drawStatusBar() {
  if (!selfView) return;
  for (const piece of [STATUS_BAR.panel, STATUS_BAR.chat, STATUS_BAR.keys]) {
    const entry = artImage(piece.path);
    if (entry.ready) ctx.drawImage(entry.img, piece.x, piece.y);
  }
  drawStatusGauge("hp", selfView.hp, selfView.maxHp);
  drawStatusGauge("mp", selfView.mp, selfView.maxMp);
  drawStatusGauge("exp", selfView.exp, selfView.expToNext ?? 0);
  for (const button of STATUS_BAR.buttons) {
    let state = "normal";
    if (statusPressed === button.action) state = "pressed";
    else if (statusHover === button.action) state = "mouseOver";
    const entry = artImage(`UI/StatusBar.img/${button.name}/${state}/0`);
    if (entry.ready) ctx.drawImage(entry.img, button.x, STATUS_BAR.y + button.y);
  }
  statusText(`Lv.${selfView.level}`, 54, STATUS_BAR.y + 116);
  statusText(jobNameOf(selfView.job), 136, STATUS_BAR.y + 116, "right");
  statusText(selfView.name, 153, STATUS_BAR.y + 111);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

function statusButtonClick(button) {
  if (button.action === "inventory") {
    toggleInventory();
    return;
  }
  logLine(`${button.name}：這個原版視窗還沒接上來。`);
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

  // A map whose tile set this archive does not carry leaves holes where its ground should be; soil
  // under them reads as ground, where black reads as a broken picture. Every other map fills black,
  // which is what a missing corner of a background sheet should look like.
  ctx.fillStyle = (mapArt?.missingTiles ?? 0) > 0 ? "#2a2118" : "#000000";
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  const backs = mapArt?.backs ?? [];
  for (const back of backs) if (!back.front) drawBack(back, cameraX, cameraY);
  if ((mapArt?.missingTiles ?? 0) > 0) drawFootholds(cameraX, cameraY);

  const sprites = mapArt?.sprites ?? [];
  const behind = sprites.filter((sprite) => (sprite.layer ?? 0) < CHARACTER_LAYER);
  const front = sprites.filter((sprite) => (sprite.layer ?? 0) >= CHARACTER_LAYER);
  for (const sprite of behind) drawMapSprite(sprite, cameraX, cameraY, now, false);
  drawPortals(cameraX, cameraY, now);
  // Loot lies on the ground, under everyone's feet: the original's reward pool draws before the
  // characters, so a player standing on a drop hides it.
  drawDrops(cameraX, cameraY, now);

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
      const doomed = dying.get(String(actor.mob.mobId));
      drawEntitySprite("mob", actor.mob.templateId, x, y, actor.mob.facing ?? 0, moved, now, doomed, String(actor.mob.mobId));
    } else if (actor.kind === "self") {
      drawAvatarAt(selfView, x, y, now, selfView.facing === 1);
      drawName(selfView.name, x, y - 62);
    } else {
      drawAvatarAt(actor.user, x, y, now, actor.user.facing === 1);
      drawName(actor.user.name, x, y - 62);
    }
  }

  // The numbers a swing rolled, over the mobs they landed on (white with a dark edge, rising).
  for (let i = damageMarks.length - 1; i >= 0; i--) {
    const mark = damageMarks[i];
    const t = (now - mark.start) / 800;
    if (t >= 1) {
      damageMarks.splice(i, 1);
      continue;
    }
    const x = mark.x - cameraX;
    const y = mark.y - cameraY - 34 - t * 38;
    ctx.font = "bold 14px 'Malgun Gothic', 'Apple SD Gothic Neo', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
    ctx.strokeText(String(mark.value), x, y);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(String(mark.value), x, y);
  }

  for (const sprite of front) drawMapSprite(sprite, cameraX, cameraY, now, false);
  for (const back of backs) if (back.front) drawBack(back, cameraX, cameraY);
  drawStatusBar();
  drawInventoryWindow();
  if (pointerAt !== undefined) drawItemTooltip(pointerAt.x, pointerAt.y);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/** How long a drop's flight out of the monster takes, and the pickup's flight to its taker. */
const DROP_HOP_MS = 420;
const DROP_PICKUP_MS = 260;
/** The 2003 client draws a drop's icon 16 px above the ground line the packet names. */
const DROP_LIFT_PX = 16;

/** The four meso piles of `Item/Special/0900.img`, by amount (`sub_4A9C10`). */
function mesoTier(amount) {
  if (amount < 50) return 0;
  if (amount < 100) return 1;
  if (amount < 1000) return 2;
  return 3;
}

/** The four `iconRaw` frames of one meso pile, asked for once; a partial list is used as it lands. */
function mesoFrames(tier) {
  let entry = mesoArt.get(tier);
  if (entry !== undefined) return entry;
  entry = { frames: [] };
  mesoArt.set(tier, entry);
  void (async () => {
    for (let frame = 0; frame < 4; frame++) {
      const path = `Item/Special/0900.img/0900000${tier}/iconRaw/${frame}`;
      try {
        const response = await fetch(`/api/canvas/${encodeURIComponent(path)}`);
        if (!response.ok) return;
        const meta = await response.json();
        artImage(path);
        entry.frames.push({ path, ox: meta.ox, oy: meta.oy });
      } catch {
        return;
      }
    }
  })();
  return entry;
}

/** The picture of one drop: an animated meso pile, or the item's own `iconRaw`. */
function dropFrameOf(drop, now) {
  if (drop.money) {
    const frames = mesoFrames(mesoTier(drop.value)).frames;
    if (frames.length === 0) return undefined;
    return frames[Math.floor(now / 140) % frames.length];
  }
  // The item's icon and its origin come from the catalogue the shop and the inventory already use.
  describeItem(drop.value);
  const icon = itemInfo.get(drop.value)?.iconRaw;
  return icon === undefined ? undefined : { path: icon.path, ox: icon.ox, oy: icon.oy };
}

/** Where a drop is right now: it hops out of the monster, then lies still (or flies to its taker). */
function dropPosition(record, now) {
  const drop = record.drop;
  if (record.takenAt !== undefined) {
    const t = Math.min(1, (now - record.takenAt) / DROP_PICKUP_MS);
    const taker = record.takenBy === selfView?.characterId
      ? self
      : users.get(String(record.takenBy)) ?? undefined;
    if (taker === undefined) return t >= 1 ? undefined : { x: drop.x, y: drop.y - DROP_LIFT_PX, t };
    return {
      x: drop.x + (taker.x - drop.x) * t,
      y: drop.y - DROP_LIFT_PX + (taker.y - 30 - (drop.y - DROP_LIFT_PX)) * t,
      t,
    };
  }
  const t = Math.min(1, (now - record.born) / DROP_HOP_MS);
  if (t >= 1) return { x: drop.x, y: drop.y - DROP_LIFT_PX, t: 1 };
  // A small parabola between where the monster stood and where the item lands.
  return {
    x: record.fromX + (drop.x - record.fromX) * t,
    y: record.fromY + (drop.y - record.fromY) * t - 28 * Math.sin(Math.PI * t),
    t,
  };
}

/** Every drop on the ground, and every one on its way to a taker. */
function drawDrops(cameraX, cameraY, now) {
  for (const [key, record] of drops) {
    const at = dropPosition(record, now);
    if (at === undefined) {
      drops.delete(key);
      continue;
    }
    if (record.takenAt !== undefined && at.t >= 1) {
      drops.delete(key);
      continue;
    }
    const x = at.x - cameraX;
    const y = at.y - cameraY;
    if (x < -80 || x > VIEW_W + 80 || y < -120 || y > VIEW_H + 120) continue;
    const frame = dropFrameOf(record.drop, now);
    if (frame === undefined) continue;
    ctx.globalAlpha = record.takenAt === undefined ? 1 : 1 - at.t * 0.75;
    drawArchiveImage(frame, x, y, false);
    ctx.globalAlpha = 1;
  }
}

/** The nearest monster a swing would reach: in front of the character, and close enough. */
function mobInReach() {
  if (!self || !selfView) return undefined;
  const facingLeft = selfView.facing === 1;
  let found;
  let best = Infinity;
  for (const mob of mobs.values()) {
    const dx = mob.x - self.x;
    const dy = mob.y - self.y;
    if (Math.abs(dx) > SWING_REACH_X) continue;
    if (dy < -SWING_REACH_UP || dy > SWING_REACH_DOWN) continue;
    // A swing only hits what is in front of it; a monster on top of the character counts as in front.
    if (dx !== 0 && (facingLeft ? dx > 0 : dx < 0)) continue;
    const distance = dx * dx + dy * dy;
    if (distance < best) {
      best = distance;
      found = mob;
    }
  }
  return found;
}

/**
 * Ctrl: the client's own attack key. The swing is played locally no matter what, and the packet
 * only goes out when there is something in reach - a miss is a picture, not a message.
 */
function swing() {
  if (!self || !selfView) return;
  const now = performance.now();
  if (now - lastSwingAt < SWING_COOLDOWN_MS) return;
  lastSwingAt = now;
  selfSwing = { stance: SWING_STANCES[swingCounter++ % SWING_STANCES.length], start: now };
  const mob = mobInReach();
  if (mob !== undefined) {
    send({ t: "attack", mobId: mob.mobId, facingLeft: selfView.facing === 1 });
    return;
  }
  // Nothing in reach: the swing still plays (the 2003 client does the same), so the field is not
  // spammed with empty attack packets.
}

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
  return line;
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

// ---------------------------------------------------------------- inventory window
//
// `CUIItem` (`sub_4DA1C0`) is the 2003 inventory: a 162x315 sheet at (114, 9) - `sub_506440(this,
// 0, 114, 9, 1)` - and the sheet itself already carries the title, the four tabs, the 4x6 slot grid
// and the meso row (`UI/UIWindow.img/Item/backgrnd`). What the page adds is the contents.
//
// The sheet's strip is painted with the first tab lit. The original repaints the strip through
// `CCtrlTab` (`UI/Basic.img/Tab/*`), so this page lifts the two states out of the same sheet - the
// lit tab from x=2 and an idle one from x=36 - and stamps them back over whichever tab is open.

const INVENTORY = {
  path: "UI/UIWindow.img/Item/backgrnd",
  width: 162,
  height: 315,
  /** `sub_506440(this, 0, 114, 9, 1)`'s box; the layout table replaces it once a player moves it. */
  home: { x: 114, y: 9 },
  /** The slot grid: 32 px cells at a 35 px pitch, four across and six down (24 slots). */
  grid: { x: 6, y: 80, columns: 4, rows: 6, size: 32, pitch: 35 },
  /** The meso field, ending where the sheet's own `메소` label starts. */
  mesos: { x: 9, y: 296, width: 116, height: 13 },
  /** Tab boxes, measured from the separators the sheet draws at x=35/69/104/139. */
  tabs: [
    { x: 2, y: 52, width: 34 },
    { x: 36, y: 52, width: 34 },
    { x: 70, y: 52, width: 34 },
    { x: 104, y: 52, width: 36 },
  ],
  /** The CLOSE button's pentagon, top right of the sheet. */
  close: { x: 112, y: 0, width: 48, height: 28 },
  /** The lit and idle tab faces, both taken out of the sheet's own strip. */
  litTab: { x: 2, y: 52, width: 34, height: 24 },
  idleTab: { x: 36, y: 52, width: 34, height: 24 },
};

/** Whether the inventory is up, and where - `sub_545450` puts it at (114, 9) until it is dragged. */
let inventoryOpen = false;
let inventoryAt = { ...INVENTORY.home };
/** The window the pointer is over, or the piece it is dragging. */
let inventoryHover;
let inventoryDrag;
/** The item a click last picked (its tooltip stays up while it is set). */
let inventoryPick;

// The 2003 client keeps a window's place in the registry; a page can only keep it locally.
try {
  const saved = JSON.parse(localStorage.getItem("kms111.inventoryAt") ?? "null");
  if (saved !== null && Number.isFinite(saved.x) && Number.isFinite(saved.y)) inventoryAt = { x: saved.x, y: saved.y };
} catch {
  // A blocked localStorage is not worth an error: the window just opens at its default spot.
}

/** `itemId -> {img, ready}`; the same `/api/item/<id>/icon.png` the shop asks for. */
const itemIcons = new Map();

/** The icon of one item, asked for once. */
function itemIcon(itemId) {
  let entry = itemIcons.get(itemId);
  if (entry !== undefined) return entry;
  const img = new Image();
  entry = { img, ready: false };
  img.onload = () => {
    entry.ready = true;
  };
  img.onerror = () => {
    entry.ready = false;
  };
  img.src = `/api/item/${itemId}/icon.png`;
  itemIcons.set(itemId, entry);
  return entry;
}

/**
 * The tab the window shows, picked the first time it has data to pick from: the USE tab if it holds
 * anything (that is where a potion is), otherwise the first tab that does. After that the player's
 * choice stands - the original remembers the last tab, too.
 */
function ensureInventoryTab() {
  if (inventoryTab !== 0 || inventory === undefined) return;
  const use = inventory.tabs.find((entry) => entry.tab === 2);
  const firstFull = inventory.tabs.find((entry) => entry.items.length > 0);
  inventoryTab = (use !== undefined && use.items.length > 0 ? use : firstFull)?.tab ?? 1;
}

/** The inventory tab the window shows (a `0x0B` inventory number). */
function inventoryTabView() {
  ensureInventoryTab();
  return inventory?.tabs.find((tab) => tab.tab === inventoryTab);
}

/** The slot number under a grid point, or 0 when the point is not on a cell. */
function inventorySlotAt(localX, localY) {
  const { grid } = INVENTORY;
  const column = Math.floor((localX - grid.x) / grid.pitch);
  const row = Math.floor((localY - grid.y) / grid.pitch);
  if (column < 0 || column >= grid.columns || row < 0 || row >= grid.rows) return 0;
  // Inside the 32-px face, not the 3-px gap between cells.
  if (localX - grid.x - column * grid.pitch >= grid.size) return 0;
  if (localY - grid.y - row * grid.pitch >= grid.size) return 0;
  return row * grid.columns + column + 1;
}

/**
 * What of the window is at a surface point. `kind` is `close`, `tab`, `slot` (with `slot`) or
 * `body`; a point outside is `undefined`.
 */
function inventoryWindowAt(x, y) {
  if (!inventoryOpen || !selfView) return undefined;
  const localX = x - inventoryAt.x;
  const localY = y - inventoryAt.y;
  if (localX < 0 || localY < 0 || localX >= INVENTORY.width || localY >= INVENTORY.height) return undefined;
  const { close } = INVENTORY;
  if (localX >= close.x && localX < close.x + close.width && localY >= close.y && localY < close.y + close.height) {
    return { kind: "close" };
  }
  const tab = INVENTORY.tabs.findIndex((box) => localX >= box.x && localX < box.x + box.width && localY >= box.y && localY < box.y + 24);
  if (tab >= 0) return { kind: "tab", index: tab, tab: INVENTORY_TABS[tab].tab };
  const slot = inventorySlotAt(localX, localY);
  if (slot > 0) {
    const item = inventoryTabView()?.items.find((entry) => entry.slot === slot);
    return { kind: "slot", slot, item };
  }
  return { kind: "body" };
}

/** One tab label, in the sheet's own colours: black on the lit tab, slate on the idle ones. */
function drawInventoryLabel(label, centerX, baselineY, lit) {
  ctx.font = "11px 'Dotum', '돋움', 'Malgun Gothic', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = lit ? "#000000" : "#44586e";
  ctx.fillText(label, centerX, baselineY);
}

/**
 * Paints the window and its contents. The slots are the sheet's own; the icons, the counts and the
 * mesos are what the page knows from `0x16`/`0x0B` and `/api/item/<id>`.
 */
function drawInventoryWindow() {
  if (!inventoryOpen || !selfView) return;
  const entry = artImage(INVENTORY.path);
  if (!entry.ready) return;
  const x = Math.round(inventoryAt.x);
  const y = Math.round(inventoryAt.y);
  ctx.drawImage(entry.img, x, y);

  // Stamp the tab faces: the lit one over the open tab, an idle one over the sheet's own lit tab.
  const lit = INVENTORY_TABS.findIndex((tab) => tab.tab === inventoryTab);
  const litIndex = lit < 0 ? 0 : lit;
  for (let index = 0; index < INVENTORY.tabs.length; index++) {
    const box = INVENTORY.tabs[index];
    const stamp = index === litIndex ? INVENTORY.litTab : INVENTORY.idleTab;
    if (index === litIndex || index === 0) {
      ctx.drawImage(entry.img, stamp.x, stamp.y, stamp.width, stamp.height, x + box.x, y + box.y, box.width, stamp.height);
    }
    // The stamp carries the sheet's own Korean label; cover it and draw the right one.
    ctx.fillStyle = index === litIndex ? "#ffffff" : "#ccddee";
    ctx.fillRect(x + box.x + 6, y + box.y + 5, 22, 13);
    drawInventoryLabel(INVENTORY_TABS[index].label, x + box.x + box.width / 2, y + box.y + 12, index === litIndex);
  }

  // The items of the open tab.
  const view = inventoryTabView();
  const { grid } = INVENTORY;
  if (view !== undefined) {
    for (const item of view.items) {
      const index = item.slot - 1;
      const column = index % grid.columns;
      const row = Math.floor(index / grid.columns);
      if (row >= grid.rows) continue;
      const cellX = x + grid.x + column * grid.pitch;
      const cellY = y + grid.y + row * grid.pitch;
      const icon = itemIcon(item.itemId);
      if (icon.ready) {
        const width = icon.img.naturalWidth;
        const height = icon.img.naturalHeight;
        ctx.drawImage(icon.img, cellX + Math.floor((grid.size - width) / 2), cellY + Math.floor((grid.size - height) / 2));
      }
      const count = item.quantity !== undefined && item.quantity > 1 ? item.quantity : item.ruc !== undefined && item.ruc > 0 ? item.ruc : undefined;
      if (count !== undefined) {
        ctx.font = "10px 'Dotum', '돋움', 'Malgun Gothic', sans-serif";
        ctx.textAlign = "right";
        ctx.textBaseline = "bottom";
        ctx.lineWidth = 2;
        ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
        ctx.strokeText(String(count), cellX + grid.size - 1, cellY + grid.size + 2);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(String(count), cellX + grid.size - 1, cellY + grid.size + 2);
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
      }
    }
  }

  // The hovered cell wears `activeIcon`: a 36x36 frame two pixels larger than the slot.
  if (inventoryHover?.kind === "slot") {
    const active = artImage("UI/UIWindow.img/Item/activeIcon");
    if (active.ready) {
      const index = inventoryHover.slot - 1;
      const cellX = x + grid.x + (index % grid.columns) * grid.pitch;
      const cellY = y + grid.y + Math.floor(index / grid.columns) * grid.pitch;
      ctx.drawImage(active.img, cellX - 2, cellY - 2);
    }
  }

  // Mesos, right-aligned inside the dark field.
  statusText(String(selfView.mesos), x + INVENTORY.mesos.x + INVENTORY.mesos.width - 3, y + INVENTORY.mesos.y + 1, "right");
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

/** Item facts as tooltip lines: the archive's name, its description, and the stack's count. */
function itemTooltipLines(item) {
  const facts = itemInfo.get(item.itemId);
  const lines = [facts?.name ?? `Item ${item.itemId}`];
  if (item.quantity !== undefined && item.quantity > 1) lines.push(`數量 ${item.quantity}`);
  if (item.ruc !== undefined && item.ruc > 0) lines.push(`可升級次數 ${item.ruc}`);
  if (facts?.desc) {
    // The archive stores the description with `\n` line breaks; the tooltip keeps them.
    for (const line of String(facts.desc).split(/\r?\n/)) if (line !== "") lines.push(line);
  } else if (facts !== undefined && facts.name === undefined) {
    lines.push("（Data.wz 查不到這個道具）");
  }
  return lines;
}

/** A dark tooltip beside the pointer, the way the client's item box sits next to the cursor. */
function drawItemTooltip(x, y) {
  const item = inventoryPick ?? inventoryHover?.item;
  if (item === undefined || !inventoryOpen) return;
  const lines = itemTooltipLines(item);
  ctx.font = "11px 'Dotum', '돋움', 'Malgun Gothic', sans-serif";
  ctx.textBaseline = "top";
  let width = 0;
  for (const line of lines) width = Math.max(width, ctx.measureText(line).width);
  const height = lines.length * 14 + 6;
  let left = x + 16;
  let top = y + 18;
  if (left + width + 8 > VIEW_W) left = VIEW_W - width - 12;
  if (top + height > VIEW_H) top = VIEW_H - height - 4;
  ctx.fillStyle = "rgba(8, 14, 24, 0.9)";
  ctx.fillRect(left, top, width + 8, height);
  ctx.strokeStyle = "rgba(136, 170, 204, 0.8)";
  ctx.lineWidth = 1;
  ctx.strokeRect(left + 0.5, top + 0.5, width + 7, height - 1);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  for (let index = 0; index < lines.length; index++) {
    ctx.fillText(lines[index], left + 4, top + 3 + index * 14);
  }
  ctx.textBaseline = "alphabetic";
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

/**
 * `I`, the ITEM button and the sheet's own CLOSE all land here. No packet is involved: the window
 * is drawn from state the page already has (`sub_4DA1C0` keeps it in the client too).
 */
function toggleInventory(force) {
  const show = force ?? !inventoryOpen;
  inventoryOpen = show;
  if (!show) {
    inventoryHover = undefined;
    inventoryPick = undefined;
    inventoryDrag = undefined;
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
// The page's own header keeps a button for the same window the ITEM button opens.
document.getElementById("inv-toggle")?.addEventListener("click", () => toggleInventory());
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
  // Ctrl is the 2003 client's attack key (`sub_511E20`'s case 10 sits next to the emotes). A held
  // key repeats, so the page swings on keydown and lets `swing()` own the cooldown.
  if (event.key === "Control") {
    event.preventDefault();
    swing();
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
