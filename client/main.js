import {
  weaponIdOf,
  basicAmmo,
  attackDuration,
  attackFrame,
  shotRelease,
  shotNear,
  projectileLeg,
} from "./basiccombat.mjs";
import { itemDialogs } from "./itemdialogs.mjs";
import { equipmentWindow, bodyPart, canWear } from "./equipment.mjs";
import { miniMapWindow } from "./minimap.mjs";
import { viewLayout, DISPLAY_MODES } from "./display.mjs";
import { movementPortal, arrivalPortal } from "./portals.mjs";
import { statWindow } from "./statwindow.mjs";
import { prepareMapScene, mergeScene, visibleSprite } from "./scene.mjs";
import { characterDialogs } from "./creation.mjs";
import {
  WORLD_UI,
  CHARACTER_UI,
  SELECTION_BUTTONS,
  characterSlot,
  worldPopulation,
} from "./selection.mjs";
import { createAudio, spatialVolume } from "./audio.mjs";
import {
  collisionWorld,
  createPlayer,
  advancePlayer,
  locomotion,
  actionOf,
  beginPath,
  sampleMotion,
  actorDepth,
  animationPose,
  remoteStance,
  facingFlip,
} from "./motion.mjs";

/**
 * The browser view.
 *
 * JSON bridge to the 2003 packet implementation. The field, map layers, UI and composed avatars
 * come from the original Data.wz, not placeholder geometry. motion.mjs handles fixed-step local
 * ground/air/climbing physics and timed remote paths; combat and ground-mob roaming live server-side.
 * This is a reconstruction, not a claim that every original client state is already implemented.
 */

const audio = createAudio({
  onError: (error) => logLine(`audio: ${error.message}`),
});
audio.setBgm("BgmUI/Title");
window.addEventListener(
  "pointerdown",
  () => {
    void audio.unlock();
  },
  { capture: true },
);
window.addEventListener(
  "keydown",
  () => {
    void audio.unlock();
  },
  { capture: true },
);
window.addEventListener(
  "click",
  (event) => {
    if (event.target?.closest?.("button") && event.target.id !== "stat-body")
      void audio.effect("UI/BtMouseClick");
  },
  { capture: true },
);
const soundToggle = document.getElementById("sound-toggle");
soundToggle?.addEventListener("click", () => {
  audio.setMuted(!audio.muted);
  soundToggle.textContent = audio.muted ? "聲音：關" : "聲音：開";
  soundToggle.setAttribute?.("aria-pressed", String(audio.muted));
});

const canvas = /** @type {HTMLCanvasElement} */ (
  document.getElementById("view")
);
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
  characters: /** @type {HTMLElement} */ (
    document.getElementById("characters")
  ),
  characterList: /** @type {HTMLElement} */ (
    document.getElementById("character-list")
  ),
  characterStatus: /** @type {HTMLElement} */ (
    document.getElementById("character-status")
  ),
  newName: /** @type {HTMLInputElement} */ (
    document.getElementById("new-name")
  ),
  create: /** @type {HTMLButtonElement} */ (document.getElementById("create")),
  gameUi: /** @type {HTMLElement} */ (document.getElementById("game-ui")),
  chatbox: /** @type {HTMLElement} */ (document.getElementById("chatbox")),
  chatLines: /** @type {HTMLElement} */ (document.getElementById("chat-lines")),
  say: /** @type {HTMLInputElement} */ (document.getElementById("say")),
  emotes: /** @type {HTMLElement} */ (document.getElementById("emotes")),
  log: /** @type {HTMLElement} */ (document.getElementById("log")),
  logLines: /** @type {HTMLElement} */ (document.getElementById("log-lines")),
  logToggle: /** @type {HTMLButtonElement} */ (
    document.getElementById("log-toggle")
  ),
  dialogue: /** @type {HTMLElement} */ (document.getElementById("dialogue")),
  dialogueText: /** @type {HTMLElement} */ (
    document.getElementById("dialogue-text")
  ),
  dialogueOk: /** @type {HTMLButtonElement} */ (
    document.getElementById("dialogue-ok")
  ),
  dialogueClose: /** @type {HTMLButtonElement} */ (
    document.getElementById("dialogue-close")
  ),
};

// All login stages share the original 800x600 WZ surface and transparent accessible hit targets.
const titleUi = document.getElementById("title-ui");
const titleMenu = document.getElementById("title-menu");
const titleNotice = document.getElementById("title-notice");
const rememberUser = document.getElementById("remember-user");
const pageBar = document.getElementById("bar");
let loginStage = "title";
let titleDialogOpen = false;
let titleHover;
let titlePressed;
let loginPending = false;
let loginWorlds = [],
  loginCharacters = [];
let selectedWorld = -1,
  selectedCharacter = -1;
let selectedCharacterSince = 0;
let worldScroll = 0,
  selectionPending = false;
let selectionHover, selectionPressed;
const TITLE_BUTTONS = [
  {
    id: "title-new",
    path: "UI/Login.img/Title/BtNew",
    x: 356,
    y: 394,
    dialog: false,
  },
  {
    id: "title-continue",
    path: "UI/Login.img/Title/BtContinue",
    x: 356,
    y: 423,
    dialog: false,
  },
  {
    id: "title-homepage",
    path: "UI/Login.img/Title/BtHomepage",
    x: 356,
    y: 452,
    dialog: false,
  },
  {
    id: "title-quit",
    path: "UI/Login.img/Title/BtQuit",
    x: 356,
    y: 481,
    dialog: false,
  },
  {
    id: "login-lost",
    path: "UI/Login.img/Title/BtIdPasswdLost",
    x: 287,
    y: 331,
    dialog: true,
  },
  { id: "login", path: "UI/Basic.img/BtOK", x: 373, y: 342, dialog: true },
  {
    id: "login-cancel",
    path: "UI/Basic.img/BtCancel",
    x: 445,
    y: 342,
    dialog: true,
  },
];
try {
  const saved = localStorage.getItem("kms111.loginUser");
  if (saved) {
    ui.user.value = saved;
    rememberUser.checked = true;
  }
} catch {
  // Browser privacy settings may disable persistence. Never store a password.
}

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
let playerBody;
let terrain = collisionWorld({});
let lastPhysicsAt;
let lastSentMotion;
/** The portal the mouse is over, so the frame can ring it. @type {any} */
let hoveredPortal;
/** The last time a portal was asked for; `sub_472590` refuses a second request within 500 ms. */
let lastPortalAt = -Infinity;
let portalPending = false;
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
let pendingUse;
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
const itemInfoPending = new Map();
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
const EMOTE_NAMES = [
  "blink",
  "hit",
  "smile",
  "troubled",
  "cry",
  "angry",
  "bewildered",
  "stunned",
  "vomit",
];
const EMOTE_KEYS = [1, 2, 3, 4, 5, 6, 7];

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

function setLoginPending(pending) {
  loginPending = pending;
  ui.login.disabled = pending;
  ui.user.disabled = pending;
  ui.pass.disabled = pending;
  document.getElementById("login-cancel").disabled = pending;
}

function connect() {
  if (loginPending) return;
  showPanel(ui.connect);
  setLoginPending(true);
  ui.status.textContent = "連線中…";
  ui.status.classList.remove("bad");
  const previous = socket;
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  const connection = new WebSocket(`${scheme}://${location.host}/ws`);
  socket = connection;
  previous?.close();
  connection.addEventListener("open", () => {
    if (socket !== connection) return;
    ui.status.textContent = "已連線，送出登入…";
    ui.status.classList.remove("bad");
    send({ t: "login", user: ui.user.value, password: ui.pass.value });
  });
  connection.addEventListener("error", () => {
    if (socket !== connection) return;
    setLoginPending(false);
    // The usual cause is a proxy that does not forward the upgrade (an https page whose proxy
    // refuses `wss`). Saying so beats a page that silently does nothing.
    ui.status.textContent =
      "WebSocket 連線失敗：請確認服務可用，且此網址的代理支援 WebSocket upgrade。";
    ui.status.classList.add("bad");
    logLine("websocket error");
  });
  connection.addEventListener("close", () => {
    if (socket !== connection) return;
    setLoginPending(false);
    itemDialog.close(false);
    itemDrag = undefined;
    slotPending = shopPending = mesoPending = false;
    combatEpoch++;
    selfSwing = undefined;
    projectiles.length = damageMarks.length = 0;
    ui.where.textContent = "斷線";
    ui.status.textContent = "連線結束。重新載入頁面再試一次。";
    ui.status.classList.add("bad");
    logLine("websocket closed");
  });
  connection.addEventListener("message", (event) => {
    if (socket !== connection) return;
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
  if (creationDialogs.receive(message)) return;
  if (statPanel.receive(message)) return;
  if (["field", "disconnect", "login"].includes(message.t)) {
    miniMapPanel.setMap(undefined);
    itemEpoch++;
    itemDialog.close(false);
    inventoryScrollDrag = undefined;
    shopPending = false;
    if (message.t !== "field") inventoryScroll.fill(0);
    itemDrag = undefined;
    slotPending = mesoPending = false;
    mesoNextAt = 0;
    slotNextAt = 0;
    equipHover = undefined;
    if (message.t !== "field") equipPanel.toggle(false);
  }
  if (message.t === "error") {
    slotPending = shopPending = mesoPending = false;
    itemDialog.close(false);
  }
  switch (message.t) {
    case "login":
      setLoginPending(false);
      if (message.result !== 0) {
        ui.status.textContent = `登入失敗（結果 ${message.result}）`;
        ui.status.classList.add("bad");
        return;
      }
      try {
        localStorage.setItem(
          "kms111.loginUser",
          rememberUser.checked ? ui.user.value : "",
        );
      } catch {
        /* Only the account name is optional persistence. */
      }
      creationDialogs.setGender(message.gender);
      ui.pass.value = "";
      ui.status.textContent = "";
      showPanel(ui.worlds);
      loginWorlds = message.worlds;
      selectedWorld = -1;
      worldScroll = 0;
      selectionPending = false;
      rebuildWorldRows();
      logLine(`login ok: ${message.worlds.length} world(s)`);
      return;

    case "characters":
      if (message.result !== 0) {
        selectionPending = false;
        updateSelectionControls();
        ui.characterStatus.textContent = `讀取角色失敗（結果 ${message.result}）`;
        ui.characterStatus.classList.add("bad");
        return;
      }
      selectionPending = false;
      ui.characterStatus.textContent = "";
      ui.characterStatus.classList.remove("bad");
      const priorId = loginCharacters[selectedCharacter]?.id;
      loginCharacters = message.characters.slice(0, CHARACTER_UI.slots);
      const retained = loginCharacters.findIndex((c) => c.id === priorId);
      selectedCharacter =
        retained >= 0
          ? retained
          : loginCharacters.length
            ? Math.min(
                Math.max(selectedCharacter, 0),
                loginCharacters.length - 1,
              )
            : -1;
      selectedCharacterSince = performance.now();
      ui.characterList.replaceChildren(
        ...loginCharacters.map((character, index) => {
          const button = document.createElement("button");
          const slot = characterSlot(index);
          button.type = "button";
          button.className = "sprite-hit";
          button.textContent = character.name;
          button.title = `${character.name} · Lv.${character.level}`;
          button.setAttribute?.("aria-label", button.title);
          Object.assign(button.style, {
            left: `${slot.x}px`,
            top: `${slot.y}px`,
            width: `${slot.width}px`,
            height: `${slot.height}px`,
          });
          button.addEventListener("click", () => selectLoginCharacter(index));
          button.addEventListener("dblclick", enterLoginCharacter);
          preloadAvatar({
            face: character.face ?? 20000,
            hair: character.hair ?? 30000,
            items: character.items ?? [],
          });
          return button;
        }),
      );
      updateSelectionControls();
      logLine(`characters: ${message.characters.length}`);
      return;

    case "created":
      if (message.ok) ui.newName.value = "";
      selectionPending = false;
      updateSelectionControls();
      ui.characterStatus.textContent = ""; // CUINewChar already owns native failure notices; no extra HTML overlay.
      ui.characterStatus.classList.remove("bad");
      if (message.ok) {
        const index = loginCharacters.findIndex((c) => c.id === message.id);
        if (index >= 0) selectLoginCharacter(index);
      }
      logLine(
        message.ok
          ? `created ${message.name} (id ${message.id})`
          : `create failed: ${message.reason}`,
      );
      return;

    case "meso-drop-result":
      mesoPending = false;
      mesoNextAt = performance.now() + 200;
      if (!message.changed) chatLine("系統", "無法丟棄這個數量的楓幣。");
      return;

    case "request-release":
      portalPending = false;
      return;

    case "field":
      portalPending = false;
      void audio.effect(self ? "Game/Portal" : "Game/GameIn");
      playerBody = undefined;
      terrain = collisionWorld({});
      lastPhysicsAt = undefined;
      lastSentMotion = undefined;
      keys.clear();
      selfView = message.self;
      self = { x: 0, y: 0, mapId: message.mapId };
      users.clear();
      selfSwing = undefined;
      combatEpoch++;
      nextSwingAt = 0;
      projectiles.length = 0;
      damageMarks.length = 0;
      mobHits.clear();
      mobs.clear();
      npcs.clear();
      drops.clear();
      dying.clear();
      for (const user of message.users)
        users.set(String(user.characterId), user);
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
      if (selfView && message.self.level > selfView.level)
        void audio.effect("Game/LevelUp");
      if (selfView?.hp > 0 && message.self.hp <= 0)
        void audio.effect("Game/Tombstone");
      selfView = message.self;
      if (selfView.hp <= 0) {
        itemDialog.close(false);
        itemDrag = undefined;
      }
      return;

    case "inventory":
      if (pendingUse) {
        const { slot, itemId, quantity, at } = pendingUse;
        const remaining =
          message.inventory.tabs
            ?.find((t) => t.tab === 2)
            ?.items.find((item) => item.slot === slot && item.itemId === itemId)
            ?.quantity ?? 0;
        if (
          performance.now() - at < 5000 &&
          remaining < quantity &&
          Math.floor(itemId / 10000) <= 202
        ) {
          void audio.effect(`Item/${String(itemId).padStart(8, "0")}/Use`);
        }
        pendingUse = undefined;
      }
      // The window draws from this on the next frame; `0x0B` also changes the stack counts.
      if (message.ack) slotPending = false;
      inventoryPick = undefined;
      inventory = message.inventory;
      const ammo = basicAmmo(inventory, weaponIdOf(lookOf(selfView)));
      if (ammo) void ensureProjectileFrames(ammo.itemId);
      setInventoryScroll(inventoryScroll[inventoryTab] ?? 0);
      reconcileShopInventory();
      return;

    case "shop-open":
      openShop(message.shop);
      return;

    case "shop-result":
      shopPending = false;
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
      logLine(
        `user enter ${message.user.name}@${message.user.x},${message.user.y}`,
      );
      return;

    case "user-look": {
      const user = users.get(String(message.characterId));
      if (!user) return;
      if (message.face !== undefined) user.face = message.face;
      if (message.avatarItems !== undefined)
        user.avatarItems = message.avatarItems;
      return;
    }

    case "user-leave":
      users.delete(String(message.characterId));
      return;

    case "user-move": {
      if (selfView && message.characterId === selfView.characterId) {
        if (message.local) return; // The bridge echoes what WE sent, not a server correction.
        if (self) {
          if (message.x !== self.x) self.facing = message.x < self.x ? 1 : 0;
          self.x = message.x;
          self.y = message.y;
          self.movedAt = performance.now();
          selfView.facing = self.facing;
          if (map?.id === self.mapId)
            playerBody = createPlayer(
              self.x,
              self.y,
              terrain,
              message.foothold,
            );
        }
        return;
      }
      const user = users.get(String(message.characterId));
      if (user) {
        if (message.x !== user.x) user.facing = message.x < user.x ? 1 : 0;
        user.action = message.action;
        beginPath(
          user,
          message.path ?? { elements: [{ ...message, duration: 100 }] },
          performance.now(),
        );
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
      if (message.characterId === selfView?.characterId)
        void audio.effect("Game/LevelUp");
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
        pendingWhisper &&
        pendingWhisper.name.toLowerCase() === message.name.toLowerCase()
          ? pendingWhisper.text
          : undefined;
      pendingWhisper = undefined;
      if (message.delivered) {
        chatLine(`${message.name}<<`, text ?? "");
      } else {
        chatLine("系統", `找不到「${message.name}」。`);
      }
      logLine(
        `whisper ${message.delivered ? "delivered" : "not found"}: ${message.name}`,
      );
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
        chatLine(
          "系統",
          `${message.name} 在地圖 ${message.mapId}${where ? `（${where}）` : ""}。`,
        );
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
        // 0x33 carries a timed CMovePath, not a teleport to its last element.
        sampleMotion(mob, performance.now(), terrain);
        mob.facing =
          message.facing ??
          (message.x === mob.x ? mob.facing : message.x < mob.x ? 1 : 0);
        beginPath(
          mob,
          message.path ?? { elements: [{ ...message, duration: 100 }] },
          performance.now(),
        );
      }
      return;
    }

    case "mob-die": {
      // `0x30`: the monster is still on the field (its corpse is), and the 2003 client plays
      // `Mob/<id>.img/die1` before `0x31` takes it away. Nothing else changes here - the loot and
      // the exp are other packets, from the server.
      const corpse = mobs.get(String(message.mobId));
      if (corpse)
        void audio.effect(
          `Mob/${String(corpse.templateId).padStart(7, "0")}/Die`,
          spatialVolume(corpse.x, corpse.y, self),
        );
      if (corpse) {
        sampleMotion(corpse, performance.now(), terrain);
        corpse.motion = undefined;
      }
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
      if (notice?.kind === "mesos" || notice?.kind === "item")
        void audio.effect("Game/PickUpItem");
      if (notice?.kind === "mesos") {
        chatLine("系統", `메소를 얻었습니다 (+${notice.amount})`);
        return;
      }
      if (notice?.kind !== "item") {
        if (notice?.kind === "rejected")
          chatLine("系統", "아이템을 더 이상 가질 수 없습니다");
        return;
      }
      const itemId = Number(notice.itemId);
      const count = Number(notice.count ?? 1);
      const sentence = (label) =>
        count >= 2
          ? `아이템을 얻었습니다 (${label} ${count}개)`
          : `아이템을 얻었습니다 (${label})`;
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
      scheduleAttackHit(
        message.mobId,
        message.damage,
        performance.now() + (message.delayMs ?? 0),
      );
      return;
    }

    case "user-attack": {
      void receiveUserAttack(message, performance.now());
      return;
    }

    case "drop-enter": {
      // The drop flies out of the monster that left it: the packet carries the monster and where the
      // item came to rest, and the two are a hop apart.
      const mob =
        message.drop.mobId === undefined
          ? undefined
          : mobs.get(String(message.drop.mobId));
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
      portalPending = false;
      setLoginPending(false);
      ui.status.textContent = `伺服器斷線：${message.reason}`;
      ui.status.classList.add("bad");
      logLine(`disconnect: ${message.reason}`);
      return;

    case "error": {
      portalPending = false;
      // The status line lives in the login panel, which is hidden once a character is in a field -
      // so a mid-game error (a text the code page cannot carry, an unreadable message) also goes to
      // the chat box, or it would be invisible.
      const text = /is not a CP949 character/.test(message.message)
        ? `${message.message}（2003 client 只收 CP949：韓文與 ASCII，中文送不出去）`
        : message.message;
      if (self) chatLine("系統", text);
      else {
        setLoginPending(false);
        selectionPending = false;
        updateSelectionControls();
        if (loginStage !== "title") ui.characterStatus.textContent = text;
        ui.status.textContent = text;
        ui.status.classList.add("bad");
      }
      logLine(`error: ${message.message}`);
      return;
    }

    case "unknown":
      logLine(
        `unhandled packet 0x${message.opcode.toString(16)} (${message.bytes}B)`,
      );
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
    const loaded = await response.json();
    if (self?.mapId !== mapId) return; // A slow previous map request must not replace a newer field.
    map = loaded;
    audio.setBgm(map.bgm);
    terrain = collisionWorld(map);
    mapNames.set(map.id, map.name);
    hoveredPortal = undefined;
    // The map reset: the art of the previous map must not be drawn under the new one.
    mapArt = undefined;
    // Shared UI/map sheets and avatar poses survive portals; bounded caches evict old entries.
    mapScene = [];
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
      // sub_511820: stats+101 indexes the NON-type-3 array; initialize ten pixels above tn.
      const spawn = arrivalPortal(map, selfView.spawnPortal);
      self.x = spawn?.x ?? 0;
      self.y = (spawn?.y ?? 0) - 10;
    }
    if (self) playerBody = createPlayer(self.x, self.y, terrain, 0, false);
    lastPhysicsAt = performance.now();
    const doors = map.portals.filter(
      (portal) => portal.name && portal.type !== 0 && portal.toMapId >= 0,
    ).length;
    logLine(
      `map ${mapId}: ${map.name || "(no name)"}, ${map.footholds.length} foothold(s), ${doors} door(s)`,
    );
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
      logLine(`map ${mapId}: no art (${response.status})`);
      return;
    }
    const art = await response.json();
    if (map?.id !== mapId) return;
    mapArt = art;
    miniMapPanel.setMap(art.miniMap, map.portals);
    mapScene = prepareMapScene(art.sprites);
    camera.ready = false;
    for (const back of art.backs) artImage(back.path);
    for (const frame of art.portalFrames ?? []) artImage(frame.path);
    // Only the canvases the map actually places: a 1000-sprite map is a few hundred distinct files.
    const wanted = new Set();
    for (const sprite of art.sprites)
      for (const frame of sprite.frames) wanted.add(frame.path);
    for (const path of wanted) artImage(path);
    logLine(
      `art ${mapId}: ${art.backs.length} back(s), ${art.sprites.length} sprite(s)`,
    );
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
const PORTAL_GUARD_MS = 500;
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
    if (!(portal.toMapId >= 0) || portal.toMapId === RETURN_MAP_NONE) continue;
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

/** Both original movement activation and optional pointer activation share one sender guard. */
function requestPortal(portal, now) {
  if (
    portalPending ||
    now - lastPortalAt < PORTAL_GUARD_MS ||
    !selfView ||
    selfView.hp <= 0
  )
    return;
  portalPending = true;
  lastPortalAt = now;
  logLine(`portal ${portal.name} -> ${portal.toMapId}`);
  send({ t: "portal", name: portal.name });
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
  if (itemDialog.open || itemDrag) return;
  if (equipPanel.hit(point.x, point.y) && !shopWindowAt(point.x, point.y))
    return;
  if (shopScrollDrag !== undefined) {
    const { side, offset } = shopScrollDrag;
    const geometry = shopScrollbarGeometry(side);
    if (geometry !== undefined) {
      const position =
        point.y - shopAt.y - SHOP.scrollbar[side].y - 12 - offset;
      setShopScroll(
        side,
        Math.round((position * geometry.max) / geometry.travel),
      );
    }
    canvas.style.cursor = "default";
    return;
  }
  if (shopDrag !== undefined) {
    if (
      Math.abs(point.x - shopDrag.startX) +
        Math.abs(point.y - shopDrag.startY) >
      3
    )
      shopDrag.moved = true;
    if (shopDrag.moved) {
      shopAt = {
        x: Math.max(
          -SHOP.width + 48,
          Math.min(VIEW_W - 48, Math.round(point.x - shopDrag.dx)),
        ),
        y: Math.max(
          0,
          Math.min(VIEW_H - 32, Math.round(point.y - shopDrag.dy)),
        ),
      };
      canvas.style.cursor = "move";
      return;
    }
  }
  if (inventoryDrag !== undefined) {
    // Four pixels of slop: a click that wobbles on a slot still selects it instead of moving the
    // window. Past that, the press becomes the window drag the original has.
    if (
      Math.abs(point.x - inventoryDrag.startX) +
        Math.abs(point.y - inventoryDrag.startY) >
      3
    ) {
      inventoryDrag.moved = true;
    }
    if (inventoryDrag.moved) {
      // Keep a strip of the window on screen: a window dragged fully out could never be grabbed again.
      inventoryAt = {
        x: Math.max(
          -INVENTORY.width + 48,
          Math.min(VIEW_W - 48, Math.round(point.x - inventoryDrag.dx)),
        ),
        y: Math.max(
          0,
          Math.min(VIEW_H - 32, Math.round(point.y - inventoryDrag.dy)),
        ),
      };
      canvas.style.cursor = "move";
      return;
    }
  }
  const shopHit = shopWindowAt(point.x, point.y);
  if (shopHit !== undefined) {
    shopHover = shopHit;
    inventoryHover = undefined;
    statusHover = undefined;
    hoveredPortal = undefined;
    const pointer =
      shopHit.kind === "close" ||
      shopHit.kind === "button" ||
      shopHit.kind === "tab" ||
      shopHit.kind === "buy-row" ||
      shopHit.kind === "sell-row" ||
      shopHit.kind === "scrollbar";
    canvas.style.cursor = pointer ? "pointer" : "default";
    return;
  }
  shopHover = undefined;
  inventoryHover = inventoryWindowAt(point.x, point.y);
  if (inventoryHover !== undefined) {
    statusHover = undefined;
    hoveredPortal = undefined;
    const pointer =
      inventoryHover.kind === "close" ||
      inventoryHover.kind === "coin" ||
      inventoryHover.kind === "tab" ||
      (inventoryHover.kind === "slot" && inventoryHover.item !== undefined);
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
  if (itemDialog.open || event.button > 0) return;
  const point = viewPoint(event);
  if (equipPanel.hit(point.x, point.y) && !shopWindowAt(point.x, point.y))
    return;
  const shopHit = shopWindowAt(point.x, point.y);
  if (shopHit !== undefined) {
    if (shopHit.kind === "scrollbar" && shopHit.part === "thumb") {
      const geometry = shopScrollbarGeometry(shopHit.side);
      shopScrollDrag = {
        side: shopHit.side,
        offset:
          point.y -
          shopAt.y -
          SHOP.scrollbar[shopHit.side].y -
          12 -
          geometry.offset,
      };
    }
    if (shopHit.kind === "body") {
      shopDrag = {
        dx: point.x - shopAt.x,
        dy: point.y - shopAt.y,
        startX: point.x,
        startY: point.y,
        moved: false,
      };
    }
    if (shopHit.kind === "button") shopPressed = shopHit.button;
  }
  const hit =
    shopHit === undefined ? inventoryWindowAt(point.x, point.y) : undefined;
  if (hit?.kind === "coin") {
    coinPressed = true;
    event.preventDefault();
    return;
  }
  if (hit?.kind === "scrollbar") {
    const g = inventoryScrollbarGeometry();
    if (hit.part === "thumb" && g.max > 0) {
      inventoryScrollDrag = {
        offset: point.y - inventoryAt.y - INVENTORY.scrollbar.y - 12 - g.offset,
      };
      event.preventDefault();
    }
    return;
  }
  if (hit?.kind === "slot" && hit.item) {
    beginItemDrag({ tab: inventoryTab, slot: hit.slot, item: hit.item }, point);
    event.preventDefault();
    return;
  }
  if (hit?.kind === "body") {
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

function finishWindowPress(event) {
  coinPressed = false;
  if (inventoryDrag?.moved === true) {
    // A drag is not a click: the window moved, so the sheet under the press must not act.
    inventorySuppressClick = event?.target === canvas;
    try {
      localStorage.setItem("kms111.inventoryAt", JSON.stringify(inventoryAt));
    } catch {
      // A blocked localStorage only costs the position.
    }
  }
  if (shopDrag?.moved === true) {
    shopSuppressClick = true;
    try {
      localStorage.setItem("kms111.shopAt", JSON.stringify(shopAt));
    } catch {
      // A blocked localStorage only costs the position.
    }
  }
  if (shopScrollDrag !== undefined) shopSuppressClick = true;
  shopScrollDrag = undefined;
  inventoryDrag = undefined;
  shopDrag = undefined;
  shopScrollDrag = undefined;
  shopSuppressClick = false;
  shopPressed = undefined;
  statusPressed = undefined;
}
canvas.addEventListener("mouseup", finishWindowPress);
window.addEventListener("mouseup", finishWindowPress);
window.addEventListener("blur", finishWindowPress);

canvas.addEventListener("mouseleave", () => {
  pointerAt = undefined;
  shopHover = undefined;
  inventoryHover = undefined;
  statusHover = undefined;
});

/** Set by a finished window drag so the `click` that follows does not also hit a slot. */
let inventorySuppressClick = false;

canvas.addEventListener("dblclick", (event) => {
  if (itemDialog.open || shopPending || slotPending || mesoPending) return;
  const point = viewPoint(event);
  if (equipPanel.hit(point.x, point.y) && !shopWindowAt(point.x, point.y))
    return;
  const shopHit = shopWindowAt(point.x, point.y);
  if (shopHit?.kind === "buy-row") {
    shopBuyRow = shopHit.index;
    buyShopRow(shopHit.index);
    return;
  }
  if (shopHit?.kind === "sell-row") {
    shopSellPick = shopHit.row;
    sellShopItem(shopHit.row);
    return;
  }
  if (shopHit !== undefined) return;
  const hit = inventoryWindowAt(point.x, point.y);
  if (hit?.kind !== "slot" || hit.item === undefined) return;
  if (inventoryTab === 1) {
    void wearItem(hit.item, hit.slot);
    return;
  }
  // `sub_462DC0` uses a USE-tab item on a double click; the family is the first three digits.
  const family = Math.floor(hit.item.itemId / 10000);
  if (inventoryTab !== 2 || family < 200 || family > 203) return;
  pendingUse = {
    slot: hit.item.slot,
    itemId: hit.item.itemId,
    quantity: hit.item.quantity ?? 1,
    at: performance.now(),
  };
  send({ t: "use", slot: hit.item.slot, itemId: hit.item.itemId });
});

canvas.addEventListener("click", (event) => {
  if (itemDialog.open) return;
  // The status bar is drawn over the world, so its buttons win over anything behind them - and the
  // inventory window is above both.
  const point = viewPoint(event);
  if (inventorySuppressClick) {
    inventorySuppressClick = false;
    return;
  }
  if (shopSuppressClick) {
    shopSuppressClick = false;
    return;
  }
  const shopHit = shopWindowAt(point.x, point.y);
  if (shopHit !== undefined) {
    if (shopHit.kind === "close") {
      closeShop();
    } else if (shopHit.kind === "button") {
      if (shopHit.button === "buy" && shopBuyRow >= 0) buyShopRow(shopBuyRow);
      if (shopHit.button === "sell" && shopSellPick !== undefined)
        sellShopItem(shopSellPick);
      if (
        shopHit.button === "recharge" &&
        shopSellPick !== undefined &&
        Math.floor(shopSellPick.itemId / 10000) === 207
      ) {
        rechargeShopItem(shopSellPick);
      }
    } else if (shopHit.kind === "scrollbar") {
      const side = shopHit.side;
      const geometry = shopScrollbarGeometry(side);
      const localY = point.y - shopAt.y - SHOP.scrollbar[side].y;
      const delta =
        shopHit.part === "prev"
          ? -1
          : shopHit.part === "next"
            ? 1
            : localY < 12 + geometry.offset
              ? -shopVisibleRows(side)
              : shopVisibleRows(side);
      if (shopHit.part !== "thumb")
        setShopScroll(side, shopScroll[side] + delta);
    } else if (shopHit.kind === "tab") {
      shopTab = shopHit.tab;
      shopSellPick = undefined;
      shopScroll.sell = 0;
    } else if (shopHit.kind === "buy-row") {
      shopBuyRow = shopHit.index;
      describeItem(shopHit.row.itemId);
    } else if (shopHit.kind === "sell-row") {
      shopSellPick = shopHit.row;
      describeItem(shopHit.row.itemId);
    }
    return;
  }
  if (equipPanel.hit(point.x, point.y)) return;
  const hit = inventoryWindowAt(point.x, point.y);
  if (hit !== undefined) {
    if (hit.kind === "coin") {
      dropMesosDialog(point);
    } else if (hit.kind === "close") {
      toggleInventory(false);
    } else if (hit.kind === "tab") {
      inventoryTab = hit.tab;
      try {
        localStorage.setItem("kms111.inventoryTab", String(inventoryTab));
      } catch {}
      inventoryPick = undefined;
    } else if (hit.kind === "scrollbar") {
      const g = inventoryScrollbarGeometry();
      const localY = point.y - inventoryAt.y - INVENTORY.scrollbar.y;
      const delta =
        hit.part === "prev"
          ? -1
          : hit.part === "next"
            ? 1
            : localY < 12 + g.offset
              ? -6
              : 6;
      if (hit.part !== "thumb") setInventoryScroll(g.row + delta);
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
  requestPortal(portal, performance.now());
});

// The wheel scrolls the shop list under the pointer, the way a wheel over the 2003 scrollbar does.
canvas.addEventListener(
  "wheel",
  (event) => {
    if (itemDialog.open || itemDrag) return;
    const point = viewPoint(event);
    if (
      !shopWindowAt(point.x, point.y) &&
      !equipPanel.hit(point.x, point.y) &&
      inventoryWindowAt(point.x, point.y)
    ) {
      if (event.deltaY !== 0)
        setInventoryScroll(
          inventoryScrollbarGeometry().row + Math.sign(event.deltaY),
        );
      event.preventDefault();
      return;
    }
    if (shop === undefined) return;
    const localX = point.x - shopAt.x;
    const localY = point.y - shopAt.y;
    for (const side of ["buy", "sell"]) {
      const list = shopListOf(side);
      if (localX < list.x || localX >= SHOP.scrollbar[side].x + 12) continue;
      if (localY < list.y || localY >= list.y + list.rows * list.pitch)
        continue;
      if (event.deltaY === 0) return;
      setShopScroll(side, shopScroll[side] + Math.sign(event.deltaY));
      event.preventDefault();
      return;
    }
  },
  { passive: false },
);

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
let mapScene = [];
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

/** No-WZ/unarmed fallback only; real weapon actions and delays come from /api/attack. */
const SWING_COOLDOWN_MS = 480;
const SWING_STANCES = ["swingO1", "swingO2", "swingO3"];
/** Legacy fallback reach, NOT a claimed native rectangle. WZ-equipped actions use lt/rb below. */
const SWING_REACH_X = 90;
const SWING_REACH_UP = 72;
const SWING_REACH_DOWN = 36;
let nextSwingAt = 0;
let swingLoading = false;
let combatEpoch = 0;
const attackProfiles = new Map();
const projectileFrames = new Map();
const attackLooks = new Set();
const projectiles = [];
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
    if (bounds.right - bounds.left <= width)
      x = (bounds.left + bounds.right) / 2 - width / 2;
    else x = Math.max(bounds.left, Math.min(bounds.right - width, x));
    if (bounds.bottom - bounds.top <= height)
      y = (bounds.top + bounds.bottom) / 2 - height / 2;
    else y = Math.max(bounds.top, Math.min(bounds.bottom - height, y));
  }
  return { x, y };
}

/** CSS fit was 1.25x at 1000x800/DPR1: source columns alternated between 1 and 2 pixels.
 * Default to device-pixel integer presentation; keep fit/native as explicit browser preferences. */
const scaleSelect = document.getElementById("view-scale");
let displayMode = "pixel";
try {
  const saved = localStorage.getItem("kms111.displayMode");
  if (DISPLAY_MODES.includes(saved)) displayMode = saved;
} catch {}
scaleSelect.value = displayMode;
function resize() {
  // Assigning width/height clears the canvas/context. Do not do it on ordinary window/DPR changes.
  if (canvas.width !== VIEW_W) canvas.width = VIEW_W;
  if (canvas.height !== VIEW_H) canvas.height = VIEW_H;
  const layout = viewLayout(
    window.innerWidth,
    window.innerHeight,
    window.devicePixelRatio,
    displayMode,
  );
  Object.assign(canvas.style, {
    width: `${layout.width}px`,
    height: `${layout.height}px`,
    left: `${layout.left}px`,
    top: `${layout.top}px`,
  });
  Object.assign(ui.gameUi.style, {
    left: `${layout.left}px`,
    top: `${layout.top}px`,
    transform: `scale(${layout.scale})`,
  });
  ctx.imageSmoothingEnabled = false;
  canvas.dataset.displayMode = displayMode;
  scaleSelect.title = `800×600 → ${Math.round(layout.width)}×${Math.round(layout.height)} CSS px · DPR ${layout.dpr} · 每原像素 ${Number(layout.deviceScale.toFixed(3))} 實體像素${layout.downsampled ? "（視窗太小，正在縮小）" : ""}`;
  watchDpr();
}
scaleSelect.addEventListener("change", () => {
  displayMode = DISPLAY_MODES.includes(scaleSelect.value)
    ? scaleSelect.value
    : "pixel";
  try {
    localStorage.setItem("kms111.displayMode", displayMode);
  } catch {}
  resize();
});
// Moving a window between monitors can change DPR without changing its CSS dimensions.
let dprQuery;
function watchDpr() {
  if (!window.matchMedia) return;
  dprQuery?.removeEventListener?.("change", resize);
  dprQuery = window.matchMedia(
    `(resolution: ${window.devicePixelRatio || 1}dppx)`,
  );
  dprQuery.addEventListener?.("change", resize, { once: true });
}
window.addEventListener("resize", resize);
resize();

/** One PNG of the archive, by its own path; `src` is encoded as a single segment. */
function artImage(path) {
  let entry = artImages.get(path);
  if (entry) return entry;
  if (artImages.size >= 1024) {
    let drop = 256;
    for (const key of artImages.keys()) {
      if (key.startsWith("UI/")) continue;
      artImages.delete(key);
      if (--drop === 0) break;
    }
  }
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

/** Title positions are CUITitle/sub_4D05A0 and CUILogin/sub_4CEEC0's control coordinates. */
function drawTitleScreen() {
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  const stamp = (path, x, y) => {
    const art = artImage(path);
    if (art.ready) ctx.drawImage(art.img, x, y);
  };
  stamp("UI/Login.img/Title/backgrnd", 0, 0);
  if (loginStage === "title") {
    stamp("UI/Login.img/Title/menu", 302, 358);
    // Modal login sits above the still-visible title menu, centred by sub_461C50.
    for (const button of TITLE_BUTTONS.filter((entry) => !entry.dialog)) {
      const state =
        !titleDialogOpen && titlePressed === button.id
          ? "pressed"
          : !titleDialogOpen && titleHover === button.id
            ? "mouseOver"
            : "normal";
      stamp(`${button.path}/${state}/0`, button.x, button.y);
    }
    if (titleDialogOpen) {
      stamp("UI/Login.img/Title/loginDlg", 247, 215);
      stamp(`UI/Basic.img/CheckBox/${rememberUser.checked ? 1 : 0}`, 331, 299);
      ctx.font = "12px 'Dotum', '돋움', 'KMSCJK', sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillStyle = "#000000";
      ctx.fillText("메일주소 저장", 347, 299);
      for (const button of TITLE_BUTTONS.filter((entry) => entry.dialog)) {
        const disabled = document.getElementById(button.id).disabled;
        const state = disabled
          ? "disabled"
          : titlePressed === button.id
            ? "pressed"
            : titleHover === button.id
              ? "mouseOver"
              : "normal";
        stamp(`${button.path}/${state}/0`, button.x, button.y);
      }
    }
  }
  // CTitle/sub_4D0000 prints Ver. 1.11 at right=796, top=584.
  ctx.font = "11px 'Dotum', '돋움', 'KMSCJK', sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  ctx.fillText("Ver. 1.11", 796, 584);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

function updateSelectionControls() {
  document.getElementById("world-connect").disabled =
    selectionPending ||
    selectedWorld < 0 ||
    worldPopulation(loginWorlds[selectedWorld]) < 0;
  document.getElementById("character-enter").disabled =
    selectionPending || selectedCharacter < 0;
  document.getElementById("character-delete").disabled =
    selectionPending || selectedCharacter < 0;
  document.getElementById("character-new").disabled =
    selectionPending || loginCharacters.length >= 3;
  [...ui.worldList.children].forEach((element, index) =>
    element.setAttribute?.(
      "aria-pressed",
      String(worldScroll + index === selectedWorld),
    ),
  );
  [...ui.characterList.children].forEach((element, index) =>
    element.setAttribute?.("aria-pressed", String(index === selectedCharacter)),
  );
}
function rebuildWorldRows() {
  ui.worldList.replaceChildren(
    ...loginWorlds
      .slice(worldScroll, worldScroll + WORLD_UI.visibleRows)
      .map((world, offset) => {
        const index = worldScroll + offset;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "sprite-hit";
        button.textContent = world.name;
        button.setAttribute?.("aria-label", world.name);
        Object.assign(button.style, {
          left: "274px",
          top: `${288 + 25 * offset}px`,
          width: "240px",
          height: "25px",
        });
        button.addEventListener("click", () => {
          if (!selectionPending) {
            selectedWorld = index;
            updateSelectionControls();
          }
        });
        button.addEventListener("dblclick", connectLoginWorld);
        return button;
      }),
  );
  updateSelectionControls();
}
function connectLoginWorld() {
  if (
    loginStage !== "worlds" ||
    selectionPending ||
    selectedWorld < 0 ||
    worldPopulation(loginWorlds[selectedWorld]) < 0
  )
    return;
  selectionPending = true;
  updateSelectionControls();
  send({ t: "world", index: selectedWorld });
  showPanel(ui.characters);
  ui.characterStatus.textContent = "讀取角色…";
}
function selectLoginCharacter(index) {
  if (selectionPending || creationDialogs.open || !loginCharacters[index])
    return;
  if (selectedCharacter !== index) selectedCharacterSince = performance.now();
  selectedCharacter = index;
  void audio.effect("UI/CharSelect");
  updateSelectionControls();
}
function enterLoginCharacter() {
  const character = loginCharacters[selectedCharacter];
  if (
    loginStage !== "characters" ||
    selectionPending ||
    creationDialogs.open ||
    !character
  )
    return;
  selectionPending = true;
  updateSelectionControls();
  ui.characterStatus.textContent = "進入遊戲…";
  send({ t: "character", id: character.id });
}
for (const button of SELECTION_BUTTONS) {
  const element = document.getElementById(button.id);
  Object.assign(element.style, {
    left: `${button.x}px`,
    top: `${button.y}px`,
    width: `${button.width}px`,
    height: `${button.height}px`,
  });
  element.addEventListener("pointerenter", () => {
    selectionHover = button.id;
    if (!element.disabled) void audio.effect("UI/BtMouseOver");
  });
  element.addEventListener("pointerleave", () => {
    selectionHover = undefined;
    selectionPressed = undefined;
  });
  element.addEventListener("pointerdown", () => {
    selectionPressed = button.id;
  });
  element.addEventListener("pointerup", () => {
    selectionPressed = undefined;
  });
  element.addEventListener("focus", () => {
    selectionHover = button.id;
  });
  element.addEventListener("blur", () => {
    selectionHover = undefined;
    selectionPressed = undefined;
  });
}
window.addEventListener("blur", () => {
  selectionHover = undefined;
  selectionPressed = undefined;
});
document
  .getElementById("world-connect")
  .addEventListener("click", connectLoginWorld);
document
  .getElementById("character-enter")
  .addEventListener("click", enterLoginCharacter);
document.getElementById("character-new").addEventListener("click", () => {
  if (!selectionPending && loginCharacters.length < CHARACTER_UI.slots)
    void creationDialogs.openCreate();
});
document
  .getElementById("character-delete")
  .addEventListener("click", () => creationDialogs.openDelete());
ui.worldList.addEventListener("wheel", (event) => {
  event.preventDefault();
  if (selectionPending) return;
  worldScroll = Math.max(
    0,
    Math.min(
      Math.max(0, loginWorlds.length - WORLD_UI.visibleRows),
      worldScroll + Math.sign(event.deltaY),
    ),
  );
  rebuildWorldRows();
});
window.addEventListener("keydown", (event) => {
  if (
    !["worlds", "characters"].includes(loginStage) ||
    creationDialogs.open ||
    document.activeElement instanceof HTMLInputElement
  )
    return;
  if (
    event.key === "Enter" &&
    [...SELECTION_BUTTONS.map((b) => b.id), "create", "create-cancel"].includes(
      document.activeElement?.id,
    )
  )
    return;
  if (event.key === "Enter") {
    event.preventDefault();
    loginStage === "worlds" ? connectLoginWorld() : enterLoginCharacter();
  }
  if (selectionPending) return;
  if (
    loginStage === "characters" &&
    ["ArrowLeft", "ArrowRight"].includes(event.key)
  ) {
    event.preventDefault();
    selectLoginCharacter(
      Math.max(
        0,
        Math.min(
          loginCharacters.length - 1,
          selectedCharacter + (event.key === "ArrowLeft" ? -1 : 1),
        ),
      ),
    );
  } else if (
    loginStage === "worlds" &&
    ["ArrowUp", "ArrowDown"].includes(event.key)
  ) {
    event.preventDefault();
    selectedWorld = Math.max(
      0,
      Math.min(
        loginWorlds.length - 1,
        selectedWorld + (event.key === "ArrowUp" ? -1 : 1),
      ),
    );
    worldScroll = Math.max(
      0,
      Math.min(selectedWorld, Math.max(worldScroll, selectedWorld - 5)),
    );
    rebuildWorldRows();
  }
});
function drawSelectionScreen(now) {
  const worldStage = loginStage === "worlds";
  const root = `UI/Login.img/${worldStage ? "WorldSelect" : "CharSelect"}`;
  const layout = worldStage ? WORLD_UI : CHARACTER_UI;
  const stamp = (path, x, y) => {
    const art = artImage(path);
    if (art.ready) ctx.drawImage(art.img, x, y);
  };
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, 800, 600);
  stamp(`${root}/backgrnd`, 0, 0);
  stamp(`${root}/menu`, layout.x, layout.y);
  ctx.font = "12px 'Dotum', '돋움', 'KMSCJK', sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  if (worldStage) {
    stamp(`${root}/wsHeader`, 274, 270);
    loginWorlds.slice(worldScroll, worldScroll + 6).forEach((world, index) => {
      const y = 288 + index * 25;
      stamp(`${root}/wsItem`, 274, y);
      if (selectedWorld === index + worldScroll) {
        ctx.fillStyle = "rgba(0,0,0,.25)";
        ctx.fillRect(274, y, 240, 25);
      }
      ctx.globalAlpha = selectedWorld === index + worldScroll ? 1 : 140 / 255;
      stamp(`${root}/wsIcon`, 276, y + 3);
      const count = worldPopulation(world);
      const gauge = artImage(`${root}/wsGauge`);
      const crop =
        5 * (20 - Math.max(1, Math.min(20, Math.trunc((20 * count) / 3000))));
      if (gauge.ready)
        ctx.drawImage(
          gauge.img,
          crop,
          0,
          101 - crop,
          7,
          412 + crop,
          y + 15,
          101 - crop,
          7,
        );
      ctx.fillStyle = "#000";
      ctx.fillText(world.name, 296, y + 7, 110);
      ctx.textAlign = "right";
      ctx.fillText(
        count < 0 ? "접속불가" : `${count.toLocaleString("ko-KR")} 명`,
        514,
        y,
      );
      ctx.textAlign = "left";
      ctx.globalAlpha = 1;
    });
  } else {
    loginCharacters.forEach((character, index) => {
      const slot = characterSlot(index);
      const stance = index === selectedCharacter ? "walk1" : "stand1";
      const frame =
        Math.floor(
          (now - (index === selectedCharacter ? selectedCharacterSince : 0)) /
            (stance === "walk1" ? 100 : 500),
        ) % (stance === "walk1" ? 4 : 3);
      const image = avatarFrame(
        {
          face: character.face ?? 20000,
          hair: character.hair ?? 30000,
          items: character.items ?? [],
        },
        stance,
        frame,
        facingFlip(0),
      );
      if (image.ready)
        ctx.drawImage(image.img, slot.feetX + image.dx, slot.feetY + image.dy);
      ctx.globalAlpha = index === selectedCharacter ? 1 : 0.5;
      ctx.textAlign = "center";
      ctx.fillStyle = "#000";
      ctx.fillText(character.name, slot.feetX + 3, 325);
      ctx.globalAlpha = 1;
    });
    const character = loginCharacters[selectedCharacter];
    if (character) {
      ctx.textAlign = "left";
      ctx.fillStyle = "#fff";
      ctx.fillText(character.name, 253, 388);
      ctx.fillText(jobNameOf(character.job), 211, 408);
      ctx.fillText(String(character.level), 349, 408);
      ctx.textAlign = "center";
      [character.str, character.dex, character.int, character.luk].forEach(
        (value, index) =>
          ctx.fillText(String(value ?? "—"), 207 + index * 62, 451),
      );
    }
  }
  for (const button of SELECTION_BUTTONS.filter(
    (b) => b.stage === loginStage,
  )) {
    const disabled = document.getElementById(button.id).disabled;
    const state = disabled
      ? "disabled"
      : selectionPressed === button.id
        ? "pressed"
        : selectionHover === button.id
          ? "mouseOver"
          : "normal";
    stamp(`${button.path}/${state}/0`, button.x, button.y);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  creationDialogs.draw(now);
}

/** `{ face, hair, items }` for the local character or another user of the field. */
function lookOf(entity) {
  if (!entity) return { face: 20000, hair: 30000, items: [] };
  if (typeof entity.hair === "number" && entity.hair !== 0) {
    return {
      face: entity.face || 20000,
      hair: entity.hair,
      items: entity.avatarItems ?? [],
    };
  }
  // Another user's `0x1C` list starts with the hair (`avatarItemsOf`) and carries no separate
  // hair field, so the first id is the hair and the rest are the worn equips.
  const list = entity.avatarItems ?? [];
  return {
    face: entity.face || 20000,
    hair: list[0] || 30000,
    items: list.slice(1),
  };
}

/**
 * Asks the server for one composed frame.
 *
 * `dx`/`dy` say where the PNG's top-left corner goes relative to the character's feet; the server
 * composes at the WZ origins, so the page never adds anchors of its own.
 */
function avatarFrame(look, stance, frame, flip) {
  const key = `${look.face}|${look.hair}|${look.items.join(".")}|${stance}|${frame}|${flip ? "mirrored" : "native"}`;
  let entry = avatarFrames.get(key);
  if (entry) return entry;
  if (avatarFrames.size >= 256) {
    let drop = 64;
    for (const key of avatarFrames.keys()) {
      avatarFrames.delete(key);
      if (--drop === 0) break;
    }
  }
  entry = { img: new Image(), dx: 0, dy: 0, ready: false, requested: false };
  avatarFrames.set(key, entry);
  const query =
    `?face=${look.face}&hair=${look.hair}&items=${look.items.join(",")}` +
    `&stance=${encodeURIComponent(stance)}&frame=${frame}&flip=${flip ? 1 : 0}&v=20261017-back-pose`;
  entry.requested = true;
  fetch(`/api/avatar.png${query}`)
    .then(async (response) => {
      if (!response.ok) throw new Error(`avatar ${response.status}`);
      entry.dx = Number(response.headers.get("x-frame-dx") ?? 0);
      entry.dy = Number(response.headers.get("x-frame-dy") ?? 0);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const img = new Image();
      try {
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = url;
        });
      } finally {
        URL.revokeObjectURL(url);
      } // The decoded Image owns its pixels; don't leak a blob per pose/map.
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
  const key = `${look.face}|${look.hair}|${look.items.join(".")}`;
  if (!attackLooks.has(key)) {
    if (attackLooks.size >= 128) attackLooks.clear();
    attackLooks.add(key);
    void ensureAttackProfile(look).then((profile) => {
      for (const action of [
        ...(profile?.melee ?? []),
        ...(profile?.shoot ?? []),
      ]) {
        for (let frame = 0; frame < action.delays.length; frame++) {
          avatarFrame(look, action.stance, frame, false);
          avatarFrame(look, action.stance, frame, true);
        }
      }
    });
  }
  for (const item of look.items)
    if (item >= 1300000 && item < 2000000) describeItem(item);
  for (let frame = 0; frame < 3; frame++) {
    avatarFrame(look, "stand1", frame, false);
    avatarFrame(look, "stand1", frame, true);
  }
  for (const stance of ["jump", "ladder", "rope"]) {
    for (let frame = 0; frame < (stance === "jump" ? 1 : 2); frame++) {
      avatarFrame(look, stance, frame, false);
      avatarFrame(look, stance, frame, true);
    }
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
    .then((response) =>
      response.ok
        ? response.json()
        : Promise.reject(new Error(String(response.status))),
    )
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
  const total = frames.reduce(
    (sum, frame) => sum + Math.max(1, frame.delay),
    0,
  );
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
  return (
    loopFrame(actions[action], now) ??
    loopFrame(actions.stand, now) ??
    loopFrame(actions.move, now)
  );
}

/** One image at `(x, y)` with the canvas' origin at that point. */
function drawArchiveImage(frame, x, y, flip) {
  const entry = artImage(frame.path);
  if (!entry.ready) return;
  const ox = frame.ox ?? 0;
  const oy = frame.oy ?? 0;
  const w = entry.img.naturalWidth;
  const h = entry.img.naturalHeight;
  if (!visibleSprite(x, y, w, h, ox, oy, flip, VIEW_W, VIEW_H)) return;
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
  const horizontal =
    back.type === 1 || back.type === 3 || back.type === 4 || back.type === 6;
  const vertical =
    back.type === 2 || back.type === 3 || back.type === 5 || back.type === 7;
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
      drawArchiveImage(
        { path: back.path, ox, oy },
        back.flip ? anchorX - 2 * ox + w - 1 : anchorX,
        anchorY,
        back.flip,
      );
    }
  }
  ctx.globalAlpha = 1;
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
  const body = entity === selfView ? playerBody : undefined;
  if (body?.ladder) {
    selfSwing = undefined; // an old attack must never draw standing parts over a climbing pose
    return animationPose(entity, locomotion(body), Math.abs(body.vy) > 0, now);
  }
  // The wire carries the actual attack action. Use the body WZ's scaled delay per frame,
  // including every shoot2 frame, instead of stretching every motion into 480ms.
  const swing = entity === selfView ? selfSwing : entity.swing;
  if (swing !== undefined) {
    const frame = attackFrame(swing, now);
    if (frame >= 0) return { stance: swing.stance, frame };
    if (entity === selfView) selfSwing = undefined;
    else delete entity.swing;
  }
  const stance = body ? locomotion(body) : remoteStance(entity);
  return animationPose(
    entity,
    stance,
    Math.abs(body?.vy ?? entity.vy ?? 0) > 0,
    now,
  );
}

/** The face folder an active emotion names, or undefined when it has expired. */
function emotionFace(emotion, now) {
  if (!emotion || emotion.until <= now) return undefined;
  return EMOTE_NAMES[emotion.value];
}

/** An avatar drawn with its feet at `(screenX, screenY)`, mirrored while facing left. */
function drawAvatarAt(entity, screenX, screenY, now, flip) {
  const swing = entity === selfView ? selfSwing : entity.swing;
  const direction = swing ? !swing.facingLeft : flip;
  drawAvatarBodyAt(entity, screenX, screenY, now, direction);
  if (!swing) return;
  const index = attackFrame(swing, now);
  const frames = swing.effects?.[String(index)];
  if (!frames?.length || index < 0) return;
  const prior = swing.delays
    .slice(0, index)
    .reduce((sum, delay) => sum + delay, 0);
  const elapsed = now - swing.start - prior;
  // Sparse Afterimage body-frame attachments; no invented broad sword arc.
  drawArchiveImage(loopFrame(frames, elapsed), screenX, screenY, direction);
}

function drawAvatarBodyAt(entity, screenX, screenY, now, flip) {
  const look = lookOf(entity);
  preloadAvatar(look);
  const state = stanceOfEntity(entity, now);
  const frame = avatarFrame(
    look,
    state.stance,
    state.frame,
    flip,
    emotionFace(entity.emotion, now),
  );
  if (frame.ready) {
    // The server composed this frame facing the requested way and reported where its top-left
    // corner goes relative to the feet, so the page adds `dx`/`dy` and nothing else.
    ctx.drawImage(
      frame.img,
      Math.round(screenX + frame.dx),
      Math.round(screenY + frame.dy),
    );
    return;
  }
  if (state.stance !== "stand1") {
    // A stance the archive cannot compose for this look (`swingO1` while the weapon's own PNG is
    // still on the wire) falls back to standing rather than to a grey box.
    const stand = avatarFrame(
      look,
      "stand1",
      0,
      flip,
      emotionFace(entity.emotion, now),
    );
    if (stand.ready) {
      ctx.drawImage(
        stand.img,
        Math.round(screenX + stand.dx),
        Math.round(screenY + stand.dy),
      );
      return;
    }
  }
  // Before the composed PNG arrives (or if the archive is off): a neutral placeholder at the same
  // spot, so the field is not empty while the first pictures load.
  ctx.fillStyle = "rgba(120, 170, 210, 0.35)";
  ctx.fillRect(Math.round(screenX) - 9, Math.round(screenY) - 42, 18, 42);
}

/** The NPC/mob sprite at `(x, y)`, with its own animation. */
function drawEntitySprite(
  kind,
  templateId,
  x,
  y,
  facing,
  moving,
  now,
  corpseSince,
  entityKey,
  actionSince = 0,
) {
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
        const frame =
          actions.hit1[
            Math.min(actions.hit1.length - 1, Math.floor(elapsed / 120))
          ];
        if (frame !== undefined)
          drawArchiveImage(frame, x, y, facingFlip(facing));
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
    const total = frames.reduce(
      (sum, frame) => sum + Math.max(1, frame.delay),
      0,
    );
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
    if (frame !== undefined) drawArchiveImage(frame, x, y, facingFlip(facing));
    return;
  }
  const frame = playAction(actions, action, now - actionSince);
  if (frame === undefined) return;
  drawArchiveImage(frame, x, y, facingFlip(facing));
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
    if (
      x >= button.x &&
      x < button.x + button.w &&
      y >= by &&
      y < by + button.h
    )
      return button;
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
  return (
    JOB_NAMES.get(job) ?? JOB_NAMES.get(Math.floor(job / 100) * 100) ?? "초보자"
  );
}

/** One line of the bar's white boxes: white text with the dark edge its bitmap font draws. */
function statusText(text, x, y, align = "left") {
  ctx.font = "12px 'Dotum', '돋움', 'Malgun Gothic', 'KMSCJK', sans-serif";
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
  ctx.drawImage(
    entry.img,
    0,
    0,
    1,
    trough.h,
    trough.x,
    STATUS_BAR.y + trough.y,
    filled,
    trough.h,
  );
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
    if (entry.ready)
      ctx.drawImage(entry.img, button.x, STATUS_BAR.y + button.y);
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
  if (button.action === "stat") {
    statPanel.toggle();
    return;
  }
  if (button.action === "equip") {
    equipPanel.toggle();
    return;
  }
  logLine(`${button.name}：這個原版視窗還沒接上來。`);
}

function frame() {
  if (loginStage !== "game") {
    if (loginStage === "title") drawTitleScreen();
    else drawSelectionScreen(performance.now());
    requestAnimationFrame(frame);
    return;
  }
  const now = performance.now();
  const elapsed = Math.max(0, Math.min(250, now - (lastPhysicsAt ?? now)));
  lastPhysicsAt = now;
  if (playerBody && self && map?.id === self.mapId) {
    const blocked =
      portalPending ||
      itemDialog.open ||
      selfView?.hp <= 0 ||
      shop !== undefined ||
      talkingNpc !== undefined ||
      document.activeElement instanceof HTMLInputElement;
    const attackLocked =
      selfSwing && attackFrame(selfSwing, now) >= 0 && playerBody.grounded;
    const wasGrounded = playerBody.grounded;
    advancePlayer(
      playerBody,
      {
        horizontal:
          blocked || attackLocked
            ? 0
            : Number(keys.has("arrowright") || keys.has("d")) -
              Number(keys.has("arrowleft") || keys.has("a")),
        vertical:
          blocked || attackLocked
            ? 0
            : Number(keys.has("arrowdown")) -
              Number(keys.has("arrowup") || keys.has("w")),
        jump: !blocked && !attackLocked && (keys.has("alt") || keys.has(" ")),
      },
      terrain,
      elapsed,
    );
    if (wasGrounded && !playerBody.grounded && playerBody.vy < 0)
      void audio.effect("Game/Jump");
    self.x = playerBody.x;
    self.y = playerBody.y;
    selfView.facing = playerBody.facing;
    if (!blocked) {
      const portal = movementPortal(
        map.portals,
        playerBody,
        keys.has("arrowup"),
      );
      if (portal) requestPortal(portal, now);
    }
  }
  for (const mob of mobs.values()) {
    const active = sampleMotion(mob, now, terrain);
    const motion = mob.motion;
    const walking =
      active &&
      motion.elements.some((e) => e.x !== motion.x || e.y !== motion.y);
    if (mob.walking !== walking || mob.actionSince === undefined)
      mob.actionSince = now;
    mob.walking = walking;
  }
  for (const user of users.values()) sampleMotion(user, now, terrain);
  const target = cameraTarget();
  if (!camera.ready) {
    camera.x = target.x;
    camera.y = target.y;
    camera.ready = true;
  } else {
    const ease = 1 - Math.pow(1 - CAMERA_EASE, elapsed / (1000 / 60));
    camera.x += (target.x - camera.x) * ease;
    camera.y += (target.y - camera.y) * ease;
  }
  const cameraX = camera.x;
  const cameraY = camera.y;

  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  const backs = mapArt?.backs ?? [];
  for (const back of backs) if (!back.front) drawBack(back, cameraX, cameraY);

  // Characters, back to front by their feet.
  const actors = [];
  for (const npc of npcs.values()) actors.push({ kind: "npc", y: npc.y, npc });
  for (const mob of mobs.values()) actors.push({ kind: "mob", y: mob.y, mob });
  for (const user of users.values())
    actors.push({ kind: "user", y: user.y, user });
  if (self && selfView) actors.push({ kind: "self", y: self.y, self });
  // Actors belong to their foothold page/group, NOT one global "between layers 2 and 3" slot.
  const scene = [];
  for (const actor of actors) {
    const entity =
      actor.kind === "self" ? (playerBody ?? self) : actor[actor.kind];
    scene.push({ ...actor, z: actorDepth(entity, terrain, actor.kind) });
  }
  // Original CPortalList uses a fixed front-plane z; drops use their landing foothold's page/group.
  // Do not paint either before all the tiles: that hides them behind ordinary ground sprites.
  scene.push({ kind: "portals", y: 0, z: 250110 }); // sub_4A3920: -1073471724 relative to tile base
  for (const [key, record] of drops) {
    scene.push({
      kind: "drop",
      key,
      record,
      y: record.drop.y,
      z: actorDepth(record.drop, terrain, "drop"),
    });
  }
  for (const actor of mergeScene(mapScene, scene)) {
    if (actor.kind === "portals") {
      drawPortals(cameraX, cameraY, now);
      continue;
    }
    if (actor.kind === "drop") {
      drawDrop(actor.key, actor.record, cameraX, cameraY, now);
      continue;
    }
    if (actor.kind === "map") {
      drawMapSprite(actor.sprite, cameraX, cameraY, now, false);
      continue;
    }
    const x =
      actor.kind === "self"
        ? self.x - cameraX
        : actor.kind === "mob"
          ? actor.mob.x - cameraX
          : actor.kind === "npc"
            ? actor.npc.x - cameraX
            : actor.user.x - cameraX;
    const y = actor.y - cameraY;
    if (x < -200 || x > VIEW_W + 200 || y < -300 || y > VIEW_H + 300) continue;
    if (actor.kind === "npc") {
      drawEntitySprite(
        "npc",
        actor.npc.templateId,
        x,
        y,
        actor.npc.facing ?? 0,
        false,
        now,
      );
    } else if (actor.kind === "mob") {
      const moved = actor.mob.walking === true;
      const doomed = dying.get(String(actor.mob.mobId));
      drawEntitySprite(
        "mob",
        actor.mob.templateId,
        x,
        y,
        actor.mob.facing ?? 0,
        moved,
        now,
        doomed,
        String(actor.mob.mobId),
        actor.mob.actionSince,
      );
    } else if (actor.kind === "self") {
      drawAvatarAt(selfView, x, y, now, facingFlip(selfView.facing));
      drawName(selfView.name, x, y - 62);
    } else {
      drawAvatarAt(actor.user, x, y, now, facingFlip(actor.user.facing));
      drawName(actor.user.name, x, y - 62);
    }
  }

  drawProjectiles(cameraX, cameraY, now);

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
    ctx.font =
      "bold 14px 'Malgun Gothic', 'Apple SD Gothic Neo', 'KMSCJK', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
    ctx.strokeText(String(mark.value), x, y);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(String(mark.value), x, y);
  }

  for (const back of backs) if (back.front) drawBack(back, cameraX, cameraY);
  miniMapPanel.draw(now);
  drawStatusBar();
  drawInventoryWindow();
  equipPanel.draw();
  drawShopWindow();
  statPanel.draw();
  if (pointerAt !== undefined) {
    const pointed =
      shop !== undefined && shopHover !== undefined
        ? shopHover.row
        : equipPanel.hit(pointerAt.x, pointerAt.y)
          ? equipHover
          : (inventoryPick ?? inventoryHover?.item);
    if (!itemDrag && !itemDialog.open)
      drawItemTooltip(pointerAt.x, pointerAt.y, pointed);
  }

  drawDraggedItem();
  itemDialog.draw();
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
  return icon === undefined
    ? undefined
    : { path: icon.path, ox: icon.ox, oy: icon.oy };
}

/** Where a drop is right now: it hops out of the monster, then lies still (or flies to its taker). */
function dropPosition(record, now) {
  const drop = record.drop;
  if (record.takenAt !== undefined) {
    const t = Math.min(1, (now - record.takenAt) / DROP_PICKUP_MS);
    const taker =
      record.takenBy === selfView?.characterId
        ? self
        : (users.get(String(record.takenBy)) ?? undefined);
    if (taker === undefined)
      return t >= 1 ? undefined : { x: drop.x, y: drop.y - DROP_LIFT_PX, t };
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

/** One reward-pool entry, in the same z-space as the map and characters. */
function drawDrop(key, record, cameraX, cameraY, now) {
  const at = dropPosition(record, now);
  if (at === undefined || (record.takenAt !== undefined && at.t >= 1)) {
    drops.delete(key);
    return;
  }
  const x = at.x - cameraX;
  const y = at.y - cameraY;
  if (x < -80 || x > VIEW_W + 80 || y < -120 || y > VIEW_H + 120) return;
  const frame = dropFrameOf(record.drop, now);
  if (frame === undefined) return;
  ctx.globalAlpha = record.takenAt === undefined ? 1 : 1 - at.t * 0.75;
  drawArchiveImage(frame, x, y, false);
  ctx.globalAlpha = 1;
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

function playWeaponSound(entity) {
  const weapon = lookOf(entity).items.find(
    (id) => id >= 1300000 && id < 2000000,
  );
  const sfx = itemInfo.get(weapon)?.sfx;
  if (sfx)
    void audio.effect(
      `Weapon/${sfx}/Attack`,
      spatialVolume(
        entity === selfView ? self.x : entity.x,
        entity === selfView ? self.y : entity.y,
        self,
      ),
    );
}

/** Fetch native weapon action choices, body delays and sparse afterimage canvases, once/id. */
function ensureAttackProfile(look) {
  const id = weaponIdOf(look);
  if (!id) return Promise.resolve(undefined);
  if (!attackProfiles.has(id)) {
    attackProfiles.set(
      id,
      fetch(`/api/attack/${id}`)
        .then((response) => (response.ok ? response.json() : undefined))
        .then((profile) => {
          for (const action of [
            ...(profile?.melee ?? []),
            ...(profile?.shoot ?? []),
          ])
            for (const frames of Object.values(action.effects ?? {}))
              for (const frame of frames) artImage(frame.path);
          return profile;
        })
        .catch(() => undefined),
    );
  }
  return attackProfiles.get(id);
}
function ensureProjectileFrames(itemId) {
  if (!projectileFrames.has(itemId)) {
    projectileFrames.set(
      itemId,
      fetch(`/api/projectile/${itemId}`)
        .then((response) => (response.ok ? response.json() : []))
        .then((frames) => {
          for (const frame of frames) artImage(frame.path);
          return frames;
        })
        .catch(() => []),
    );
  }
  return projectileFrames.get(itemId);
}
function scheduleAttackHit(mobId, damage, at) {
  const field = self,
    epoch = combatEpoch;
  const show = () => {
    if (self !== field || combatEpoch !== epoch) return;
    const mob = mobs.get(String(mobId));
    if (!mob) return;
    const now = performance.now();
    void audio.effect(
      `Mob/${String(mob.templateId).padStart(7, "0")}/Damage`,
      spatialVolume(mob.x, mob.y, self),
    );
    mobHits.set(String(mobId), now);
    if (damage > 0)
      damageMarks.push({ x: mob.x, y: mob.y, value: damage, start: now });
  };
  const delay = at - performance.now();
  if (delay > 0) setTimeout(show, delay);
  else show();
}
function launchProjectile(entity, itemId, motion, mob, now, near) {
  const local = entity === selfView;
  const at = local ? self : entity;
  if (!at) return;
  const leg = projectileLeg(at.x, at.y, motion.facingLeft, mob, near);
  const record = { ...leg, releaseAt: now + shotRelease(motion), frames: [] };
  projectiles.push(record);
  const field = self;
  void ensureProjectileFrames(itemId).then((frames) => {
    if (self === field) record.frames = frames;
  });
}
function drawProjectiles(cameraX, cameraY, now) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const shot = projectiles[i];
    const elapsed = now - shot.releaseAt;
    if (elapsed < 0) continue;
    const t = elapsed / shot.duration;
    if (t >= 1) {
      projectiles.splice(i, 1);
      continue;
    }
    const frame = loopFrame(shot.frames, elapsed);
    if (!frame) continue;
    ctx.save();
    ctx.translate(
      Math.round(shot.x0 + (shot.x1 - shot.x0) * t - cameraX),
      Math.round(shot.y0 + (shot.y1 - shot.y0) * t - cameraY),
    );
    // 41BF60 turns the native left-facing bullet by atan2(start - destination).
    ctx.rotate(Math.atan2(shot.y0 - shot.y1, shot.x0 - shot.x1));
    drawArchiveImage(frame, 0, 0, false);
    ctx.restore();
  }
}
async function receiveUserAttack(message, now) {
  const user = users.get(String(message.characterId));
  if (!user) return;
  const field = self,
    epoch = combatEpoch;
  const look = lookOf(user);
  const profile = await ensureAttackProfile(look);
  if (
    self !== field ||
    combatEpoch !== epoch ||
    users.get(String(message.characterId)) !== user
  )
    return;
  const action = (message.shoot ? profile?.shoot : profile?.melee)?.find(
    (entry) => entry.action === message.action,
  );
  if (!action) return; // Do not turn an unknown/skill action into a fabricated one-handed swing.
  const speed = Math.max(0, Math.min(6, message.speed));
  // The relay owns speed; scale original WZ delays, never an already rounded profile.
  const delays = action.baseDelays.map((delay) =>
    Math.max(1, Math.trunc((delay * (speed + 5)) / 8)),
  );
  user.facing = message.facingLeft ? 1 : 0;
  user.swing = {
    ...action,
    delays,
    start: now,
    facingLeft: message.facingLeft,
  };
  playWeaponSound(user);
  const target = mobs.get(String(message.targets?.[0]?.mobId));
  const near = shotNear(profile.melee[0]);
  if (message.shoot && message.projectileItemId)
    launchProjectile(
      user,
      message.projectileItemId,
      user.swing,
      target,
      now,
      near,
    );
  for (const target of message.targets ?? []) {
    const mob = mobs.get(String(target.mobId));
    const delay = message.shoot
      ? shotRelease(user.swing) +
        projectileLeg(user.x, user.y, message.facingLeft, mob, near).duration
      : 0;
    scheduleAttackHit(
      target.mobId,
      (target.damages ?? []).reduce((sum, value) => sum + value, 0),
      now + delay,
    );
  }
}
/** Candidate mob canvas rectangles, not a claim to have ported native CShape2D collision. */
function mobInAttackRect(bounds, facingLeft, clampNear = false) {
  let found,
    best = Infinity;
  const left = clampNear ? Math.max(bounds.left, -65) : bounds.left;
  const right = bounds.right;
  const x0 = self.x + (facingLeft ? left : -right);
  const x1 = self.x + (facingLeft ? right : -left);
  for (const mob of mobs.values()) {
    if (dying.has(String(mob.mobId))) continue;
    const actions = mobArts.get(mob.templateId);
    const frame =
      (mob.walking ? actions?.move : actions?.stand)?.[0] ??
      actions?.stand?.[0];
    const width = frame?.width ?? 20,
      height = frame?.height ?? 30;
    const ox = frame?.ox ?? 10,
      oy = frame?.oy ?? 30;
    const ml = mob.x + (facingFlip(mob.facing) ? ox - width : -ox);
    const mt = mob.y - oy;
    if (
      ml + width < x0 ||
      ml > x1 ||
      mt + height < self.y + bounds.top ||
      mt > self.y + bounds.bottom
    )
      continue;
    const distance = Math.abs(mob.x - self.x);
    if (distance < best) {
      found = mob;
      best = distance;
    }
  }
  return found;
}
/** Ctrl: melee at close range/no ammo, otherwise a basic shot; empty attacks still go on the wire. */
async function swing() {
  if (
    !self ||
    !selfView ||
    !playerBody ||
    map?.id !== self.mapId ||
    playerBody?.ladder ||
    selfView.hp <= 0 ||
    portalPending ||
    shop ||
    shopPending ||
    talkingNpc ||
    itemDialog.open ||
    slotPending ||
    mesoPending ||
    swingLoading ||
    performance.now() < nextSwingAt
  )
    return;
  swingLoading = true;
  const field = self,
    entity = selfView,
    epoch = combatEpoch;
  try {
    const profile = await ensureAttackProfile(lookOf(entity));
    if (
      self !== field ||
      combatEpoch !== epoch ||
      selfView !== entity ||
      entity.hp <= 0 ||
      !playerBody ||
      map?.id !== self.mapId ||
      playerBody?.ladder ||
      portalPending ||
      shop ||
      shopPending ||
      talkingNpc ||
      itemDialog.open ||
      slotPending ||
      mesoPending
    )
      return;
    if (weaponIdOf(lookOf(entity)) && !profile?.melee.length) {
      logLine("無法取得此武器的原始攻擊資料；暫不以其他武器動作替代。");
      return;
    }
    const now = performance.now();
    if (now < nextSwingAt) return;
    const pick = (actions) =>
      actions?.[Math.floor(Math.random() * actions.length)];
    let action = pick(profile?.melee);
    const ammo = basicAmmo(inventory, weaponIdOf(lookOf(entity)));
    let mob = action?.bounds
      ? mobInAttackRect(action.bounds, entity.facing === 1, !!ammo)
      : mobInReach();
    const shoot = !!ammo && !!profile?.shoot.length && !mob;
    const near = shotNear(action);
    if (shoot) {
      action = pick(profile.shoot);
      // 513C80: near boundary to character x +/- 200, along y-25; CShape2D is not yet ported.
      mob = mobInAttackRect(
        { left: -200, right: -near, top: -25, bottom: -24 },
        entity.facing === 1,
      );
    }
    const fallback = {
      action: 5 + (swingCounter++ % 3),
      stance: SWING_STANCES[(swingCounter - 1) % 3],
      delays: [160, 160, 160],
      effects: {},
    };
    const motion = action ?? fallback;
    selfSwing = { ...motion, start: now, facingLeft: entity.facing === 1 };
    nextSwingAt = now + (action ? attackDuration(action) : SWING_COOLDOWN_MS);
    playWeaponSound(entity);
    if (shoot) launchProjectile(entity, ammo.itemId, selfSwing, mob, now, near);
    send({
      t: "attack",
      mode: shoot ? "shoot" : "melee",
      action: motion.action,
      mobId: mob?.mobId ?? 0,
      targetX: mob?.x,
      targetY: mob?.y,
      facingLeft: entity.facing === 1,
    });
  } finally {
    swingLoading = false;
  }
}

/** The layer the characters are drawn in: after layers 0-2, before layer 3 and the front backs. */

/** A name tag above a character, white with a soft shadow - the 2003 client's look. */
function drawName(name, x, y) {
  if (!name) return;
  ctx.font =
    "12px 'Malgun Gothic', 'Apple SD Gothic Neo', 'KMSCJK', system-ui, sans-serif";
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
    if (x < -width || x > VIEW_W + width || y < -width || y > VIEW_H + width)
      continue;
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
  while (ui.chatLines.children.length > 8)
    ui.chatLines.firstElementChild?.remove();
  return line;
}

function logLine(text) {
  const line = document.createElement("li");
  const stamp = new Date().toLocaleTimeString("zh-TW", { hour12: false });
  line.textContent = `${stamp}  ${text}`;
  ui.logLines.append(line);
  while (ui.logLines.children.length > 120)
    ui.logLines.firstElementChild?.remove();
  ui.log.scrollTop = ui.log.scrollHeight;
}

function escapeHtml(text) {
  return String(text).replace(
    /[&<>"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character] ??
      character,
  );
}

// A drag carries a source snapshot only. No item or look changes until native 0x0B arrives.
let itemDrag,
  equipHover,
  slotPending = false,
  mesoPending = false,
  mesoNextAt = 0,
  coinPressed = false,
  slotNextAt = 0,
  itemEpoch = 0;
function beginItemDrag(source, p) {
  if (
    slotPending ||
    mesoPending ||
    shopPending ||
    itemDialog.open ||
    shop ||
    talkingNpc !== undefined ||
    !selfView ||
    selfView.hp <= 0
  )
    return;
  itemDrag = { ...source, start: p, point: p, moved: false };
  inventoryPick = undefined;
}
function sourceItem(tab, slot) {
  return slot < 0
    ? inventory?.worn.find((i) => i.slot === -slot)
    : inventory?.tabs
        .find((t) => t.tab === tab)
        ?.items.find((i) => i.slot === slot);
}
function slotRequest(tab, fromSlot, toSlot, count = -1) {
  if (
    fromSlot === toSlot ||
    slotPending ||
    mesoPending ||
    shopPending ||
    shop !== undefined ||
    talkingNpc !== undefined ||
    !socket ||
    socket.readyState !== WebSocket.OPEN ||
    performance.now() < slotNextAt ||
    !selfView ||
    selfView.hp <= 0
  )
    return;
  slotPending = true;
  slotNextAt = performance.now() + 500;
  send({ t: "change-slot", tab, fromSlot, toSlot, count });
  void audio.effect("UI/DragEnd");
}
async function wearItem(item, slot, part = bodyPart(item.itemId)) {
  const character = selfView?.characterId,
    mapId = selfView?.mapId,
    epoch = itemEpoch;
  const facts = await describeItem(item.itemId);
  if (
    epoch !== itemEpoch ||
    character !== selfView?.characterId ||
    mapId !== selfView?.mapId ||
    JSON.stringify(sourceItem(1, slot)) !== JSON.stringify(item)
  )
    return;
  const reason = canWear(item, facts, selfView, inventory, part);
  if (reason) {
    chatLine("系統", reason);
    return;
  }
  slotRequest(1, slot, -part);
}
window.addEventListener("mousemove", (e) => {
  if (!itemDrag) return;
  const p = viewPoint(e);
  itemDrag.point = p;
  pointerAt = p;
  if (
    !itemDrag.moved &&
    Math.abs(p.x - itemDrag.start.x) + Math.abs(p.y - itemDrag.start.y) > 3
  ) {
    itemDrag.moved = true;
    void audio.effect("UI/DragStart");
  }
});
window.addEventListener("mouseup", (e) => {
  if (!itemDrag) return;
  const d = itemDrag;
  itemDrag = undefined;
  if (!d.moved) return;
  inventorySuppressClick = d.slot > 0 && e.target === canvas;
  if (
    !Number.isFinite(e.clientX) ||
    !Number.isFinite(e.clientY) ||
    e.target?.closest?.("#stat-window") ||
    e.target?.closest?.("#dialogue")
  )
    return;
  const p = viewPoint(e);
  if (shopWindowAt(p.x, p.y)) return;
  if (JSON.stringify(sourceItem(d.tab, d.slot)) !== JSON.stringify(d.item))
    return;
  const eq = equipPanel.hit(p.x, p.y);
  if (eq) {
    if (eq.kind === "slot" && d.tab === 1 && d.slot > 0)
      void wearItem(d.item, d.slot, -eq.slot);
    return;
  }
  const bag = inventoryWindowAt(p.x, p.y);
  if (!bag) {
    // Only releasing on the actual field canvas can throw away. Off-canvas, DOM UI, status bar
    // and minimap are cancellations. Worn equipment must first be put back in the bag.
    if (
      e.target === canvas &&
      p.x >= 0 &&
      p.x < VIEW_W &&
      p.y >= 0 &&
      p.y < STATUS_BAR.y &&
      !statusButtonAt(p.x, p.y) &&
      d.slot > 0
    )
      void dropInventoryItem(d, p);
    return;
  }
  if (bag.kind !== "slot" || inventoryTab !== d.tab) return;
  // Positive bag-to-bag move or worn-to-empty-bag unequip.
  if (d.slot < 0 && bag.item) return;
  slotRequest(d.tab, d.slot, bag.slot);
});
window.addEventListener("blur", () => {
  itemDrag = undefined;
});
/** Original 463BE0: 4031 confirms loss, equips=1, stars=whole stack, others ask total/1/total. */
async function dropInventoryItem(d, at) {
  const epoch = itemEpoch;
  const snapshot = JSON.stringify(d.item);
  const valid = () =>
    epoch === itemEpoch &&
    loginStage === "game" &&
    selfView?.hp > 0 &&
    !shop &&
    talkingNpc === undefined &&
    JSON.stringify(sourceItem(d.tab, d.slot)) === snapshot;
  const facts = await describeItem(d.item.itemId);
  if (!valid() || itemDialog.open) return;
  if (!facts || facts.cash || d.item.cash) {
    chatLine(
      "系統",
      facts
        ? "이 아이템은 버릴 수 없습니다."
        : "無法讀取道具原始資料，已取消丟棄。",
    );
    return;
  }
  const quantity = d.tab === 1 ? 1 : (d.item.quantity ?? 1);
  const sendDrop = (count) => {
    if (valid()) slotRequest(d.tab, d.slot, 0, count);
  };
  const choose = () => {
    if (!valid()) return;
    if (
      d.tab !== 1 &&
      Math.floor(d.item.itemId / 10000) !== 207 &&
      quantity > 1
    )
      itemDialog.quantity({
        text: "몇 개나 버리시겠습니까?",
        initial: Math.min(32767, quantity),
        max: Math.min(32767, quantity),
        at,
        accept: sendDrop,
      });
    else if (
      (quantity >= 1 ||
        (quantity === 0 && Math.floor(d.item.itemId / 10000) === 207)) &&
      quantity <= 32767
    )
      sendDrop(quantity);
    else chatLine("系統", "此整組數量超出原0x17可傳送範圍，已取消丟棄。");
  };
  if (Math.floor(d.item.itemId / 1000) === 4031) {
    itemDialog.confirm({
      text: "이 아이템을 버리시면 다시 회수할 수\n없습니다. 그래도 버리시겠습니까?",
      at,
      accept: choose,
    });
  } else choose();
}
function drawDraggedItem() {
  if (!itemDrag?.moved) return;
  const a = itemIcon(itemDrag.item.itemId);
  if (a.ready) {
    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.drawImage(a.img, itemDrag.point.x - 16, itemDrag.point.y - 16);
    ctx.restore();
  }
}

// ---------------------------------------------------------------- inventory window
//
// `CUIItem` (`sub_4DA1C0`) is a 162x315 sheet. CConfig type0 defaults to (24,24).
// sub_506440(this,0,114,9,1) gives CLOSE coordinates, NOT the window position. The sheet carries the title, the four tabs, the 4x6 slot grid
// and the meso row (`UI/UIWindow.img/Item/backgrnd`). What the page adds is the contents.
//
// The sheet's strip is painted with the first tab lit. The original repaints the strip through
// `CCtrlTab` (`UI/Basic.img/Tab/*`), so this page lifts the two states out of the same sheet - the
// lit tab from x=2 and an idle one from x=36 - and stamps them back over whichever tab is open.

const INVENTORY = {
  path: "UI/UIWindow.img/Item/backgrnd",
  width: 162,
  height: 315,
  /** sub_43D750 / sub_43E340: window type0, (24,24), hidden by default. */
  home: { x: 24, y: 24 },
  /** The slot grid: 32 px cells at a 35 px pitch, four across and six down (24 slots). */
  grid: { x: 6, y: 80, columns: 4, rows: 6, size: 32, pitch: 35 },
  /** 4DA440: CCtrlScrollBar id2001, (147,80), height208. */
  scrollbar: { x: 147, y: 80, width: 12, height: 208 },
  /** 4DA440: button2002 at (8,294); WZ BtCoin canvases are 17x17. */
  coin: { x: 8, y: 294, width: 17, height: 17 },
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
  close: { x: 114, y: 9, width: 32, height: 15 },
  /** The lit and idle tab faces, both taken out of the sheet's own strip. */
  litTab: { x: 2, y: 52, width: 34, height: 24 },
  idleTab: { x: 36, y: 52, width: 34, height: 24 },
};

/** Whether the inventory is up, and its CConfig position (not the CLOSE control coordinate). */
let inventoryOpen = false;
let inventoryAt = { ...INVENTORY.home };
/** The window the pointer is over, or the piece it is dragging. */
let inventoryHover;
let inventoryDrag;
/** The item a click last picked (its tooltip stays up while it is set). */
let inventoryPick;
/** 4DA810/4DA8B0: independent per-tab row positions; firstSlot = 4*row+1. */
const inventoryScroll = [0, 0, 0, 0, 0];
let inventoryScrollDrag;
function inventoryScrollbarGeometry() {
  const capacity = inventoryTabView()?.capacity ?? 0;
  const max = Math.max(0, Math.ceil(capacity / 4) - 6);
  const row = Math.max(0, Math.min(max, inventoryScroll[inventoryTab] ?? 0));
  const travel = INVENTORY.scrollbar.height - 36;
  return {
    max,
    row,
    travel,
    offset: max ? Math.round((travel * row) / max) : 0,
  };
}
function setInventoryScroll(row) {
  const g = inventoryScrollbarGeometry();
  inventoryScroll[inventoryTab] = Math.max(0, Math.min(g.max, Math.round(row)));
  inventoryPick = inventoryHover = undefined;
}
window.addEventListener("mousemove", (event) => {
  if (!inventoryScrollDrag || itemDialog.open) return;
  const g = inventoryScrollbarGeometry();
  const p = viewPoint(event);
  setInventoryScroll(
    ((p.y -
      inventoryAt.y -
      INVENTORY.scrollbar.y -
      12 -
      inventoryScrollDrag.offset) *
      g.max) /
      g.travel,
  );
});
window.addEventListener("mouseup", (event) => {
  if (inventoryScrollDrag) inventorySuppressClick = event.target === canvas;
  inventoryScrollDrag = undefined;
});
window.addEventListener("blur", () => {
  inventoryScrollDrag = undefined;
});
function drawInventoryScrollbar(x, y) {
  const g = inventoryScrollbarGeometry(),
    bar = INVENTORY.scrollbar;
  const stamp = (piece, offset) => {
    const a = artImage(
      `UI/Basic.img/VScr/${g.max ? "enabled" : "disabled"}/${piece}`,
    );
    if (a.ready) ctx.drawImage(a.img, x + bar.x, y + bar.y + offset);
  };
  ctx.save();
  ctx.beginPath();
  ctx.rect(x + bar.x, y + bar.y, 12, bar.height);
  ctx.clip();
  for (let py = 12; py < bar.height - 12; py += 12) stamp("base", py);
  stamp(g.max ? "prev0" : "prev", 0);
  stamp(g.max ? "next0" : "next", bar.height - 12);
  if (g.max) stamp(inventoryScrollDrag ? "thumb1" : "thumb0", 12 + g.offset);
  ctx.restore();
}

// The 2003 client keeps a window's place in the registry; a page can only keep it locally.
try {
  const saved = JSON.parse(
    localStorage.getItem("kms111.inventoryAt") ?? "null",
  );
  if (saved !== null && Number.isFinite(saved.x) && Number.isFinite(saved.y))
    inventoryAt = { x: saved.x, y: saved.y };
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

/** CConfig uiOpt0 defaults to 0; CUIItem adds 1, so a new profile starts on EQUIP, not USE. */
function ensureInventoryTab() {
  if (inventoryTab !== 0 || inventory === undefined) return;
  inventoryTab = 1;
  try {
    const saved = Number(localStorage.getItem("kms111.inventoryTab"));
    if (Number.isInteger(saved) && saved >= 1 && saved <= 4)
      inventoryTab = saved;
  } catch {}
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
  if (column < 0 || column >= grid.columns || row < 0 || row >= grid.rows)
    return 0;
  // Inside the 32-px face, not the 3-px gap between cells.
  if (localX - grid.x - column * grid.pitch >= grid.size) return 0;
  if (localY - grid.y - row * grid.pitch >= grid.size) return 0;
  return (row + inventoryScrollbarGeometry().row) * grid.columns + column + 1;
}

/**
 * What of the window is at a surface point. `kind` is `close`, `tab`, `slot` (with `slot`) or
 * `body`; a point outside is `undefined`.
 */
function inventoryWindowAt(x, y) {
  if (!inventoryOpen || !selfView) return undefined;
  const localX = x - inventoryAt.x;
  const localY = y - inventoryAt.y;
  if (
    localX < 0 ||
    localY < 0 ||
    localX >= INVENTORY.width ||
    localY >= INVENTORY.height
  )
    return undefined;
  if (insideBox(INVENTORY.coin, localX, localY)) return { kind: "coin" };
  const { close } = INVENTORY;
  if (
    localX >= close.x &&
    localX < close.x + close.width &&
    localY >= close.y &&
    localY < close.y + close.height
  ) {
    return { kind: "close" };
  }
  const tab = INVENTORY.tabs.findIndex(
    (box) =>
      localX >= box.x &&
      localX < box.x + box.width &&
      localY >= box.y &&
      localY < box.y + 24,
  );
  if (tab >= 0)
    return { kind: "tab", index: tab, tab: INVENTORY_TABS[tab].tab };
  const bar = INVENTORY.scrollbar;
  if (
    localX >= bar.x &&
    localX < bar.x + bar.width &&
    localY >= bar.y &&
    localY < bar.y + bar.height
  ) {
    const g = inventoryScrollbarGeometry();
    const y = localY - bar.y;
    return {
      kind: "scrollbar",
      part:
        y < 12
          ? "prev"
          : y >= bar.height - 12
            ? "next"
            : g.max && y >= 12 + g.offset && y < 24 + g.offset
              ? "thumb"
              : "track",
    };
  }
  const slot = inventorySlotAt(localX, localY);
  if (slot > 0 && slot <= (inventoryTabView()?.capacity ?? 0)) {
    const item = inventoryTabView()?.items.find((entry) => entry.slot === slot);
    return { kind: "slot", slot, item };
  }
  return { kind: "body" };
}

/** One tab label, in the sheet's own colours: black on the lit tab, slate on the idle ones. */
function drawInventoryLabel(label, centerX, baselineY, lit) {
  ctx.font = "11px 'Dotum', '돋움', 'Malgun Gothic', 'KMSCJK', sans-serif";
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
  const close = artImage("UI/UIWindow.img/BtUIClose/normal/0");
  if (close.ready) ctx.drawImage(close.img, x + 114, y + 9);

  // Stamp the tab faces: the lit one over the open tab, an idle one over the sheet's own lit tab.
  const lit = INVENTORY_TABS.findIndex((tab) => tab.tab === inventoryTab);
  const litIndex = lit < 0 ? 0 : lit;
  for (let index = 0; index < INVENTORY.tabs.length; index++) {
    const box = INVENTORY.tabs[index];
    const stamp = index === litIndex ? INVENTORY.litTab : INVENTORY.idleTab;
    if (index === litIndex || index === 0) {
      ctx.drawImage(
        entry.img,
        stamp.x,
        stamp.y,
        stamp.width,
        stamp.height,
        x + box.x,
        y + box.y,
        box.width,
        stamp.height,
      );
    }
    // The stamp carries the sheet's own Korean label; cover it and draw the right one.
    ctx.fillStyle = index === litIndex ? "#ffffff" : "#ccddee";
    ctx.fillRect(x + box.x + 6, y + box.y + 5, 22, 13);
    drawInventoryLabel(
      INVENTORY_TABS[index].label,
      x + box.x + box.width / 2,
      y + box.y + 12,
      index === litIndex,
    );
  }

  // The items of the open tab.
  const view = inventoryTabView();
  const { grid } = INVENTORY;
  if (view !== undefined) {
    for (const item of view.items) {
      const index = item.slot - 1 - 4 * inventoryScrollbarGeometry().row;
      if (index < 0) continue;
      const column = index % grid.columns;
      const row = Math.floor(index / grid.columns);
      if (row >= grid.rows) continue;
      const cellX = x + grid.x + column * grid.pitch;
      const cellY = y + grid.y + row * grid.pitch;
      const icon = itemIcon(item.itemId);
      if (icon.ready) {
        const width = icon.img.naturalWidth;
        const height = icon.img.naturalHeight;
        ctx.drawImage(
          icon.img,
          cellX + Math.floor((grid.size - width) / 2),
          cellY + Math.floor((grid.size - height) / 2),
        );
      }
      const count =
        item.quantity !== undefined &&
        (item.quantity > 1 || Math.floor(item.itemId / 10000) === 207)
          ? item.quantity
          : item.ruc !== undefined && item.ruc > 0
            ? item.ruc
            : undefined;
      if (count !== undefined) {
        ctx.font =
          "10px 'Dotum', '돋움', 'Malgun Gothic', 'KMSCJK', sans-serif";
        ctx.textAlign = "right";
        ctx.textBaseline = "bottom";
        ctx.lineWidth = 2;
        ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
        ctx.strokeText(
          String(count),
          cellX + grid.size - 1,
          cellY + grid.size + 2,
        );
        ctx.fillStyle = "#ffffff";
        ctx.fillText(
          String(count),
          cellX + grid.size - 1,
          cellY + grid.size + 2,
        );
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
      }
    }
  }

  // The hovered cell wears `activeIcon`: a 36x36 frame two pixels larger than the slot.
  if (inventoryHover?.kind === "slot") {
    const active = artImage("UI/UIWindow.img/Item/activeIcon");
    if (active.ready) {
      const index =
        inventoryHover.slot - 1 - 4 * inventoryScrollbarGeometry().row;
      const cellX = x + grid.x + (index % grid.columns) * grid.pitch;
      const cellY = y + grid.y + Math.floor(index / grid.columns) * grid.pitch;
      ctx.drawImage(active.img, cellX - 2, cellY - 2);
    }
  }

  drawInventoryScrollbar(x, y);
  const coinState =
    selfView.hp <= 0 ||
    selfView.mesos < 10 ||
    mesoPending ||
    slotPending ||
    shopPending
      ? "disabled"
      : coinPressed && inventoryHover?.kind === "coin"
        ? "pressed"
        : inventoryHover?.kind === "coin"
          ? "mouseOver"
          : "normal";
  const coin = artImage(`UI/UIWindow.img/Item/BtCoin/${coinState}/0`);
  if (coin.ready)
    ctx.drawImage(coin.img, x + INVENTORY.coin.x, y + INVENTORY.coin.y);

  // Mesos, right-aligned inside the dark field.
  statusText(
    String(selfView.mesos),
    x + INVENTORY.mesos.x + INVENTORY.mesos.width - 3,
    y + INVENTORY.mesos.y + 1,
    "right",
  );
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

/** 4DAF70 -> 55D5F0. The native field request is not an inventory move. */
function dropMesosDialog(at) {
  const epoch = itemEpoch,
    characterId = selfView?.characterId;
  const valid = () =>
    epoch === itemEpoch &&
    characterId === selfView?.characterId &&
    loginStage === "game" &&
    selfView?.hp > 0 &&
    !shop &&
    talkingNpc === undefined &&
    !slotPending &&
    !shopPending &&
    !mesoPending;
  if (
    !valid() ||
    itemDialog.open ||
    performance.now() < mesoNextAt ||
    selfView.mesos < 10
  )
    return;
  itemDialog.quantity({
    text: "얼마를 버리시겠습니까?",
    initial: 10,
    min: 10,
    max: Math.min(50000, selfView.mesos),
    at,
    accept: (amount) => {
      if (
        !valid() ||
        !socket ||
        socket.readyState !== WebSocket.OPEN ||
        !Number.isInteger(amount) ||
        amount < 10 ||
        amount > Math.min(50000, selfView.mesos) ||
        performance.now() < mesoNextAt
      )
        return;
      mesoPending = true;
      mesoNextAt = performance.now() + 200;
      send({ t: "drop-mesos", amount });
    },
  });
}

/** Item facts as tooltip lines: the archive's name, its description, and the stack's count. */
function itemTooltipLines(item) {
  const facts = itemInfo.get(item.itemId);
  const lines = [facts?.name ?? `Item ${item.itemId}`];
  if (item.price !== undefined) lines.push(`價格 ${item.price} 메소`);
  if (
    item.quantity !== undefined &&
    (item.quantity > 1 || Math.floor(item.itemId / 10000) === 207)
  )
    lines.push(`數量 ${item.quantity}`);
  if (item.ruc !== undefined && item.ruc > 0)
    lines.push(`可升級次數 ${item.ruc}`);
  if (item.cuc > 0) lines[0] += ` (+${item.cuc})`;
  const statNames = {
    str: "STR",
    dex: "DEX",
    int: "INT",
    luk: "LUK",
    maxHp: "HP",
    maxMp: "MP",
    pad: "攻擊力",
    mad: "魔力",
    pdd: "物理防禦",
    mdd: "魔法防禦",
    acc: "命中",
    eva: "迴避",
    craft: "手技",
    speed: "移動速度",
    jump: "跳躍力",
  };
  if (facts?.requirements) {
    const r = facts.requirements;
    lines.push(`需求等級 ${r.level}`);
    for (const k of ["str", "dex", "int", "luk"])
      if (r[k]) lines.push(`需求 ${k.toUpperCase()} ${r[k]}`);
  }
  for (const [k, value] of Object.entries(item.stats ?? {}))
    if (value) lines.push(`${statNames[k] ?? k} +${value}`);
  if (facts?.desc) {
    // The archive stores the description with `\n` line breaks; the tooltip keeps them.
    for (const line of String(facts.desc)
      .replace(/\\r\\n|\\n|\\r/g, "\n")
      .split(/\r?\n/))
      if (line !== "") lines.push(line);
  } else if (facts !== undefined && facts.name === undefined) {
    lines.push("（Data.wz 查不到這個道具）");
  }
  return lines;
}

/** A dark tooltip beside the pointer, the way the client's item box sits next to the cursor. */
function drawItemTooltip(x, y, item) {
  if (item === undefined) return;
  const lines = itemTooltipLines(item);
  ctx.font = "11px 'Dotum', '돋움', 'Malgun Gothic', 'KMSCJK', sans-serif";
  ctx.textBaseline = "top";
  let width = 0;
  for (const line of lines)
    width = Math.max(width, ctx.measureText(line).width);
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
  if (itemInfo.has(itemId)) return Promise.resolve(itemInfo.get(itemId));
  if (itemInfoPending.has(itemId)) return itemInfoPending.get(itemId);
  const task = fetch(`/api/item/${itemId}`)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((facts) => {
      itemInfo.set(itemId, facts);
      itemInfoPending.delete(itemId);
      return facts;
    });
  itemInfoPending.set(itemId, task);
  return task;
}

// ---------------------------------------------------------------- shop window
//
// `CShopDlg` (`sub_4B7640`, built by `sub_4B3780` from the `0x4A` list) is a 407x291 sheet that the
// client centres (`sub_461C50` -> `sub_545450` with `(800 - w) >> 1, (600 - h) >> 1`), so the page
// opens it at (196, 154). Every coordinate below is measured off
// `UI/UIWindow.img/Shop/backgrnd` and the controls `sub_4B3E60` creates:
//
//   close      id 2     (188,  9) 32x15     the sheet's own CLOSE stamp
//   buy        id 1000  ( 78, 31) 46x19     `BtBuy`     - 사기
//   sell       id 1001  (283, 31) 46x19     `BtSell`    - 팔기
//   recharge   id 1002  (225, 29) 50x23     `BtRecharge`- 충전
//   tabs       id 1003  (206, 65) 198x24    four inventory tabs, 장비/소비/설치/기타
//   buy list   id 1004  x=6,  y=68, six rows at a 35 px pitch  (`sub_4B6930`)
//   sell list  id 1005  x=209,y=91, five rows at a 35 px pitch
//
// The `buy` and `sell` canvases are the selected-row faces (188x34 with an icon slot at the left);
// `sub_4B5B10` paints one under the row the player picked, and the page does the same.

const SHOP = {
  path: "UI/UIWindow.img/Shop/backgrnd",
  width: 407,
  height: 291,
  /** `sub_461C50`: the window is centred, `((800 - w) >> 1, (600 - h) >> 1)`. */
  home: { x: 196, y: 154 },
  close: { x: 188, y: 9, width: 32, height: 15 },
  buy: { x: 78, y: 31, width: 46, height: 19 },
  sell: { x: 283, y: 31, width: 46, height: 19 },
  recharge: { x: 225, y: 29, width: 50, height: 23 },
  tabs: { x: 206, y: 65, width: 198, height: 24 },
  buyList: {
    x: 6,
    y: 68,
    rows: 6,
    pitch: 35,
    slot: 32,
    nameX: 42,
    nameRight: 184,
  },
  sellList: {
    x: 209,
    y: 91,
    rows: 5,
    pitch: 35,
    slot: 32,
    nameX: 245,
    nameRight: 388,
  },
  /**
   * The two selected-row faces, 188x34 - two pixels wider and taller than the 32-px row, so the
   * raised frame shows. The sheet's row has its slot at x=6/y=68 (left) and x=209/y=91 (right);
   * the sprite's slot interior sits one pixel inside its own edge, which is what puts the stamps
   * at (1,67) and (204,90).
   */
  face: {
    buy: { path: "UI/UIWindow.img/Shop/buy", x: 1, y: 67 },
    sell: { path: "UI/UIWindow.img/Shop/sell", x: 204, y: 90 },
  },
  /** The dark field left of the sheet's own `메소` label. */
  mesos: { right: 368, y: 272 },
  /** `sub_4AC3A0`-style 12-px scrollbars, drawn only when a list overflows. */
  scrollbar: {
    buy: { x: 189, y: 68, height: 207 },
    sell: { x: 390, y: 89, height: 174 },
  },
};

/** Where the sheet sits, what is picked in each list, and the two scroll offsets. */
let shopAt = { ...SHOP.home };

// Like the inventory sheet, the client keeps a window's place in the registry; a page keeps it here.
try {
  const saved = JSON.parse(localStorage.getItem("kms111.shopAt") ?? "null");
  if (saved !== null && Number.isFinite(saved.x) && Number.isFinite(saved.y))
    shopAt = {
      x: Math.max(-SHOP.width + 48, Math.min(VIEW_W - 48, Math.round(saved.x))),
      y: Math.max(0, Math.min(VIEW_H - 32, Math.round(saved.y))),
    };
} catch {
  // A blocked localStorage just means the shop opens centred.
}
let shopHover;
let shopDrag;
let shopPressed;
let shopScrollDrag;
let shopBuyRow = -1;
/** The category tab the sell pane shows (1 equip, 2 use, 3 install, 4 etc). */
let shopTab = 1;
/** The inventory item picked in the sell pane (`{slot, itemId, ...}`), or undefined. */
let shopSellPick;
let shopScroll = { buy: 0, sell: 0 };
/** Set by a finished window drag so the `click` that follows does not also act on a row. */
let shopSuppressClick = false;
let shopPending = false;

/**
 * The rows one half of the window shows: the shop's stock, or the player's items of the sell pane's
 * own category tab (`CCtrlTab` id 1003, `sub_4B4AD0` walks `inventory[tab]`).
 */
function shopRowsOf(side) {
  if (side === "buy") return shop?.items ?? [];
  return inventory?.tabs.find((entry) => entry.tab === shopTab)?.items ?? [];
}

/** How many rows a list shows at once (6 on the left, 5 under the tabs). */
function shopVisibleRows(side) {
  return side === "buy" ? SHOP.buyList.rows : SHOP.sellList.rows;
}

/** The list geometry for one side. */
function shopListOf(side) {
  return side === "buy" ? SHOP.buyList : SHOP.sellList;
}

/** The row index under a window-local point, or undefined. */
function shopRowAt(side, localX, localY) {
  const list = shopListOf(side);
  const row = Math.floor((localY - list.y) / list.pitch);
  if (row < 0 || row >= list.rows) return undefined;
  // Inside the 32-px row face, not the 3-px gap below it.
  if (localY - list.y - row * list.pitch >= list.slot) return undefined;
  if (localX < list.x || localX >= SHOP.scrollbar[side].x) return undefined;
  return row + shopScroll[side];
}

/** Which tab of the strip is under a window-local point, or -1. */
function shopTabAt(localX, localY) {
  const { tabs } = SHOP;
  if (localY < tabs.y || localY >= tabs.y + tabs.height) return -1;
  if (localX < tabs.x || localX >= tabs.x + tabs.width) return -1;
  const inner = tabs.width - 4 - 12;
  return Math.max(
    0,
    Math.min(3, Math.floor(((localX - tabs.x - 4) * 4) / inner)),
  );
}

/** Whether a window-local point is inside one of the sheet's controls. */
function insideBox(box, localX, localY) {
  return (
    localX >= box.x &&
    localX < box.x + box.width &&
    localY >= box.y &&
    localY < box.y + box.height
  );
}

/**
 * What of the shop is at a surface point. `kind` is `close`, `button` (with `button`), `tab` (with
 * `index`/`tab`), `buy-row`/`sell-row` (with `index`), `face` or `body`; a point outside is
 * `undefined`. The inventory window is drawn first, so a point both windows cover belongs to this
 * one - exactly the order the desktop client stacks its modeless windows in.
 */
function shopWindowAt(x, y) {
  if (shop === undefined || selfView === undefined) return undefined;
  const localX = x - shopAt.x;
  const localY = y - shopAt.y;
  if (localX < 0 || localY < 0 || localX >= SHOP.width || localY >= SHOP.height)
    return undefined;
  if (insideBox(SHOP.close, localX, localY)) return { kind: "close" };
  for (const button of ["buy", "sell", "recharge"]) {
    if (insideBox(SHOP[button], localX, localY))
      return { kind: "button", button };
  }
  const tab = shopTabAt(localX, localY);
  if (tab >= 0)
    return { kind: "tab", index: tab, tab: INVENTORY_TABS[tab].tab };
  for (const side of ["buy", "sell"]) {
    const geometry = shopScrollbarGeometry(side);
    const bar = SHOP.scrollbar[side];
    if (
      geometry !== undefined &&
      insideBox({ ...bar, width: 12 }, localX, localY)
    ) {
      const y = localY - bar.y;
      const part =
        y < 12
          ? "prev"
          : y >= bar.height - 12
            ? "next"
            : y >= 12 + geometry.offset && y < 24 + geometry.offset
              ? "thumb"
              : "track";
      return { kind: "scrollbar", side, part };
    }
    const row = shopRowAt(side, localX, localY);
    if (row !== undefined && row < shopRowsOf(side).length)
      return { kind: `${side}-row`, index: row, row: shopRowsOf(side)[row] };
  }
  return { kind: "body" };
}

/**
 * One line of row text, clipped to the plate it belongs on. The 2003 window draws both the name and
 * the `메소` line from the plate's left edge (`sub_4B5B10` passes x=42 for both, `sub_4B5FA0`
 * x=245), three pixels below the row's top edge and sixteen pixels apart.
 */
function drawShopText(text, x, y, width, colour = "#000000") {
  ctx.save();
  ctx.font = "11px 'Dotum', '돋움', 'Malgun Gothic', 'KMSCJK', sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.beginPath();
  ctx.rect(x, y - 1, width, 14);
  ctx.clip();
  ctx.fillStyle = colour;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** Paints one list: the picked row's face, then its icon, name and price, then a scrollbar. */
function drawShopList(side, originX, originY) {
  const list = shopListOf(side);
  const rows = shopRowsOf(side);
  const scroll = shopScroll[side];
  const picked =
    side === "buy"
      ? shopBuyRow
      : rows.findIndex((entry) => entry.slot === shopSellPick?.slot);
  if (picked >= scroll && picked < scroll + list.rows) {
    const face = artImage(SHOP.face[side].path);
    if (face.ready)
      ctx.drawImage(
        face.img,
        originX + SHOP.face[side].x,
        originY + SHOP.face[side].y + (picked - scroll) * list.pitch,
      );
  }
  for (let row = 0; row < list.rows; row++) {
    const index = row + scroll;
    const item = rows[index];
    if (item === undefined) continue;
    const cellY = originY + list.y + row * list.pitch;
    const facts = itemInfo.get(item.itemId);
    if (facts === undefined) describeItem(item.itemId);
    const icon = itemIcon(item.itemId);
    if (icon.ready) {
      const width = icon.img.naturalWidth;
      const height = icon.img.naturalHeight;
      // `sub_4B5B10` anchors the icon by its own origin: `x = slot - ox`, `y = rowBottom - oy`.
      const origin = facts?.iconRaw;
      const left =
        origin !== undefined
          ? list.x - origin.ox
          : list.x + Math.floor((list.slot - width) / 2);
      const top =
        origin !== undefined
          ? list.slot - origin.oy
          : Math.floor((list.slot - height) / 2);
      ctx.drawImage(icon.img, originX + left, cellY + top);
    }
    // `sub_4B5FA0` draws a non-equipment stack with Basic/ItemNo at (209, row+20).
    if (
      side === "sell" &&
      Math.floor(item.itemId / 1_000_000) !== 1 &&
      item.quantity !== undefined
    ) {
      const digits = String(item.quantity);
      for (let digit = 0; digit < digits.length; digit++) {
        const glyph = artImage(`UI/Basic.img/ItemNo/${digits[digit]}`);
        if (glyph.ready)
          ctx.drawImage(glyph.img, originX + list.x + digit * 8, cellY + 20);
      }
    }
    const nameWidth = list.nameRight - list.nameX;
    drawShopText(
      facts?.name ?? `Item ${item.itemId}`,
      originX + list.nameX,
      cellY + 3,
      nameWidth,
    );
    // The second line is mesos in both panes: the shelf price on the left, the stack's value on the
    // right (`info/price + ceil(count x info/unitPrice)`, 4B4AD0). This is the native display basis,
    // not a promise of the reconstructed server's 50% resale policy.
    let price = side === "buy" ? item.price : undefined;
    if (side === "sell" && facts?.price !== undefined)
      price =
        facts.price + Math.ceil((item.quantity ?? 1) * (facts.unitPrice ?? 0));
    if (price !== undefined)
      drawShopText(
        `${price} 메소`,
        originX + list.nameX,
        cellY + 19,
        nameWidth,
      );
  }
  if (rows.length > list.rows) drawShopScrollbar(side, originX, originY);
}

/** Clamp scrolling after wheel/arrow/track/drag input, including a shrinking inventory. */
function setShopScroll(side, position) {
  const max = Math.max(0, shopRowsOf(side).length - shopVisibleRows(side));
  shopScroll[side] = Math.max(0, Math.min(max, position));
  shopHover = undefined;
}

/** Do not send a second sale for an item the server has already removed or replaced. */
function reconcileShopInventory() {
  if (shop === undefined) return;
  if (shopSellPick !== undefined) {
    shopSellPick = shopRowsOf("sell").find(
      (item) =>
        item.slot === shopSellPick.slot && item.itemId === shopSellPick.itemId,
    );
  }
  setShopScroll("sell", shopScroll.sell);
}

/** VScr's thumb is a fixed 12px sprite; only its position changes, not its painted size. */
function shopScrollbarGeometry(side) {
  const max = shopRowsOf(side).length - shopVisibleRows(side);
  if (max <= 0) return undefined;
  const travel = SHOP.scrollbar[side].height - 36;
  return {
    max,
    travel,
    offset: Math.round((travel * Math.min(max, shopScroll[side])) / max),
  };
}

/** The 12-px `UI/Basic.img/VScr` strip: arrows, a clipped tiled trough and a fixed-size thumb. */
function drawShopScrollbar(side, originX, originY) {
  const bar = SHOP.scrollbar[side];
  const geometry = shopScrollbarGeometry(side);
  if (geometry === undefined) return;
  const x = originX + bar.x;
  const y = originY + bar.y;
  const stamp = (piece, at) => {
    const entry = artImage(`UI/Basic.img/VScr/enabled/${piece}`);
    if (entry.ready) ctx.drawImage(entry.img, x, at);
  };
  stamp("prev0", y);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y + 12, 12, bar.height - 24);
  ctx.clip();
  for (let tile = 12; tile < bar.height - 12; tile += 12)
    stamp("base", y + tile);
  ctx.restore();
  stamp("next0", y + bar.height - 12);
  stamp("thumb0", y + 12 + geometry.offset);
}

/**
 * The four category tabs, built out of `UI/Basic.img/Tab` the way `CCtrlTab` (sub_4582A0) paints
 * them: one 4-px `left` cap, a run of 1-px `fill` columns per tab, a 14-px `middle` crease at each
 * tab's right edge, and one 12-px `right` cap that fades back into the sheet's navy strip. The
 * crease is state 1 under the lit tab and state 2 when the next tab is the lit one (its gradient
 * runs light-blue to white).
 */
function drawShopTabs(originX, originY) {
  const { tabs } = SHOP;
  const count = INVENTORY_TABS.length;
  const open = Math.max(
    0,
    INVENTORY_TABS.findIndex((entry) => entry.tab === shopTab),
  );
  const x0 = originX + tabs.x;
  const y = originY + tabs.y;
  const cap = 4;
  const right = 12;
  const inner = tabs.width - cap - right;
  const stamp = (piece, x) => {
    const entry = artImage(`UI/Basic.img/Tab/${piece}`);
    if (entry.ready) ctx.drawImage(entry.img, x, y);
  };
  stamp(`left${open === 0 ? 1 : 0}`, x0);
  ctx.font = "11px 'Dotum', '돋움', 'Malgun Gothic', 'KMSCJK', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let start = x0 + cap;
  for (let index = 0; index < count; index++) {
    const end = x0 + cap + Math.round((inner * (index + 1)) / count);
    const lit = index === open;
    // The crease belongs to this tab's right edge, so the last one sits under the right cap.
    if (index < count - 1) {
      const piece = lit
        ? "middle1"
        : index + 1 === open
          ? "middle2"
          : "middle0";
      stamp(piece, end - 14);
    }
    const state = lit ? 1 : 0;
    for (let fill = start; fill < end - (index < count - 1 ? 14 : 0); fill++)
      stamp(`fill${state}`, fill);
    // `sub_4582A0` drops an unselected label one pixel, which is what makes the lit tab stand out.
    ctx.fillStyle = "#000000";
    ctx.fillText(
      INVENTORY_TABS[index].label,
      (start + end) / 2,
      y + (lit ? 12 : 13),
    );
    start = end;
  }
  stamp(`right${open === count - 1 ? 1 : 0}`, x0 + tabs.width - right);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

/** One of the three sheet buttons, in the state the pointer gives it. */
function drawShopButton(name, originX, originY) {
  const box = SHOP[name];
  const pressed =
    shopPressed === name &&
    shopHover?.kind === "button" &&
    shopHover.button === name;
  const hovered = shopHover?.kind === "button" && shopHover.button === name;
  const disabled =
    name === "recharge" && (!rechargeQuote(shopSellPick) || shopPending);
  const state = disabled
    ? "disabled"
    : pressed
      ? "pressed"
      : hovered
        ? "mouseOver"
        : "normal";
  const entry = artImage(
    `UI/UIWindow.img/Shop/Bt${name[0].toUpperCase()}${name.slice(1)}/${state}/0`,
  );
  if (entry.ready) ctx.drawImage(entry.img, originX + box.x, originY + box.y);
}

/** Paints the whole shop: the sheet, its lists, tabs, buttons and the meso field. */
function drawShopWindow() {
  if (shop === undefined || selfView === undefined) return;
  const entry = artImage(SHOP.path);
  if (!entry.ready) return;
  const x = Math.round(shopAt.x);
  const y = Math.round(shopAt.y);
  ctx.drawImage(entry.img, x, y);
  drawShopList("buy", x, y);
  drawShopList("sell", x, y);
  drawShopTabs(x, y);
  drawShopButton("buy", x, y);
  drawShopButton("sell", x, y);
  drawShopButton("recharge", x, y);
  statusText(
    String(selfView.mesos),
    x + SHOP.mesos.right,
    y + SHOP.mesos.y,
    "right",
  );
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

/** Opens the window at its saved position (centred by default), with nothing picked. */
function openShop(view) {
  itemDialog.close(false);
  shopPending = false;
  shop = view;
  shopBuyRow = -1;
  shopTab = 1;
  shopSellPick = undefined;
  shopScroll = { buy: 0, sell: 0 };
  shopHover = undefined;
  shopDrag = undefined;
  shopScrollDrag = undefined;
  shopSuppressClick = false;
  shopPressed = undefined;
  for (const row of view.items) describeItem(row.itemId);
}

/** Only 0x4B releases a trade. Quantity dialogs never locally remove items or spend mesos. */
function shopRequest(request) {
  if (
    !shop ||
    shopPending ||
    slotPending ||
    mesoPending ||
    selfView?.hp <= 0 ||
    !socket ||
    socket.readyState !== WebSocket.OPEN
  )
    return;
  shopPending = true;
  send(request);
}

/** 4B6B40: equipment=1, rechargeable confirmation, ordinary items default1/max=row.maxCount. */
function buyShopRow(index) {
  const opened = shop,
    row = opened?.items[index],
    epoch = itemEpoch;
  if (
    !row ||
    shopPending ||
    slotPending ||
    mesoPending ||
    itemDialog.open ||
    selfView?.hp <= 0
  )
    return;
  const commit = (count) => {
    if (shop !== opened || epoch !== itemEpoch || opened.items[index] !== row)
      return;
    if (!Number.isSafeInteger(count) || count < 1 || count > row.maxCount)
      return;
    if (
      !Number.isSafeInteger(row.price * count) ||
      row.price * count <= 0 ||
      selfView.mesos < row.price * count
    ) {
      chatLine("系統", "현금이 부족합니다");
      return;
    }
    shopRequest({
      t: "shop",
      action: "buy",
      row: index,
      itemId: row.itemId,
      count,
    });
  };
  if (Math.floor(row.itemId / 10000) === 207)
    itemDialog.confirm({
      text: "정말로 사시겠습니까?",
      accept: () => commit(1),
    });
  else if (Math.floor(row.itemId / 1000000) === 1) commit(1);
  else
    itemDialog.quantity({
      text: "몇 개를 사시겠습니까?",
      initial: 1,
      max: Math.min(65535, row.maxCount),
      accept: commit,
    });
}

/** 4B4AD0: find a matching 207 service row, then missingCharges * rowDouble. */
function rechargeQuote(item) {
  if (
    !shop ||
    shopTab !== 2 ||
    !item ||
    Math.floor(item.itemId / 10000) !== 207 ||
    item.cash
  )
    return undefined;
  const row = shop.rechargeables?.find((r) => r.itemId === item.itemId);
  const quantity = item.quantity ?? 0;
  if (
    !row ||
    !Number.isInteger(quantity) ||
    quantity < 0 ||
    quantity >= row.maxCount
  )
    return undefined;
  const total = Math.ceil((row.maxCount - quantity) * row.unitPrice);
  return Number.isSafeInteger(total) && total > 0
    ? { total, maxCount: row.maxCount }
    : undefined;
}
function rechargeShopItem(item) {
  const quote = rechargeQuote(item),
    opened = shop,
    epoch = itemEpoch;
  if (
    !quote ||
    shopPending ||
    slotPending ||
    mesoPending ||
    itemDialog.open ||
    selfView?.hp <= 0
  )
    return;
  const snapshot = JSON.stringify(sourceItem(2, item.slot));
  itemDialog.confirm({
    text: "정말로 충전하시겠습니까?",
    accept: () => {
      if (
        shop !== opened ||
        epoch !== itemEpoch ||
        JSON.stringify(sourceItem(2, item.slot)) !== snapshot ||
        shopTab !== 2 ||
        !rechargeQuote(item)
      )
        return;
      if (selfView.mesos < quote.total) {
        chatLine("系統", "현금이 부족합니다");
        return;
      }
      shopRequest({ t: "shop", action: "recharge", slot: item.slot });
    },
  });
}

/** 4B6E90: sale defaults to the whole stack, then revalidates the actual slot after dialog. */
function sellShopItem(item) {
  if (
    !item ||
    !shop ||
    shopPending ||
    slotPending ||
    mesoPending ||
    itemDialog.open ||
    selfView?.hp <= 0
  )
    return;
  const opened = shop,
    epoch = itemEpoch;
  // Use the actual authoritative pane, not the id's millions digit: legacy saves/server
  // currently group ETC in tab3. Inferring tab4 here would reject a legitimate sale snapshot.
  const tab = shopTab;
  const original = sourceItem(tab, item.slot);
  if (!original || original.itemId !== item.itemId) return;
  const snapshot = JSON.stringify(original),
    quantity = original.quantity ?? 1;
  const commit = (count) => {
    if (
      shop !== opened ||
      epoch !== itemEpoch ||
      JSON.stringify(sourceItem(tab, item.slot)) !== snapshot
    )
      return;
    shopRequest({
      t: "shop",
      action: "sell",
      slot: item.slot,
      itemId: item.itemId,
      count,
    });
  };
  if (Math.floor(item.itemId / 10000) === 207)
    itemDialog.confirm({
      text: "정말로 파시겠습니까?",
      accept: () => commit(quantity),
    });
  else
    itemDialog.quantity({
      text: "몇 개를 파시겠습니까?",
      initial: Math.min(65535, quantity),
      max: Math.min(65535, quantity),
      accept: commit,
    });
}

/** Closes the window; `notify` is false when the server already dropped it (a map change did). */
function closeShop(notify = true) {
  if (shop === undefined) return;
  itemDialog.close(false);
  shopPending = false;
  shop = undefined;
  shopBuyRow = -1;
  shopSellPick = undefined;
  shopHover = undefined;
  shopDrag = undefined;
  shopScrollDrag = undefined;
  shopSuppressClick = false;
  shopPressed = undefined;
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
  if (show !== inventoryOpen)
    void audio.effect(show ? "UI/MenuUp" : "UI/MenuDown");
  inventoryOpen = show;
  if (!show) {
    inventoryHover = undefined;
    inventoryPick = undefined;
    inventoryDrag = undefined;
    inventoryScrollDrag = undefined;
    itemDrag = undefined;
  }
}

function showPanel(panel) {
  loginStage =
    panel === ui.connect
      ? "title"
      : panel === ui.worlds
        ? "worlds"
        : "characters";
  audio.setBgm(loginStage === "title" ? "BgmUI/Title" : "BgmUI/WCSelect");
  titleDialogOpen = panel === ui.connect;
  titleHover = undefined;
  titlePressed = undefined;
  titleUi.classList.toggle("hidden", loginStage !== "title");
  titleMenu.classList.toggle("hidden", titleDialogOpen);
  pageBar.classList.add("hidden");
  for (const element of [ui.connect, ui.worlds, ui.characters])
    element.classList.add("hidden");
  panel.classList.remove("hidden");
  updateSelectionControls();
}

function hidePanels() {
  loginStage = "game";
  titleUi.classList.add("hidden");
  pageBar.classList.remove("hidden");
  for (const element of [ui.connect, ui.worlds, ui.characters])
    element.classList.add("hidden");
}

// ---------------------------------------------------------------- input

function closeTitleLogin() {
  if (loginPending) return;
  titleDialogOpen = false;
  titleHover = undefined;
  titlePressed = undefined;
  ui.connect.classList.add("hidden");
  titleMenu.classList.remove("hidden");
  ui.pass.value = "";
  ui.status.textContent = "";
  document.getElementById("title-continue").focus();
}
for (const button of TITLE_BUTTONS) {
  const element = document.getElementById(button.id);
  element.addEventListener("mouseenter", () => {
    titleHover = button.id;
    void audio.effect("UI/BtMouseOver");
  });
  element.addEventListener("mouseleave", () => {
    titleHover = undefined;
    titlePressed = undefined;
  });
  element.addEventListener("focus", () => {
    titleHover = button.id;
  });
  element.addEventListener("blur", () => {
    titleHover = undefined;
    titlePressed = undefined;
  });
  element.addEventListener("mousedown", () => {
    titlePressed = button.id;
  });
  element.addEventListener("mouseup", () => {
    titlePressed = undefined;
  });
  element.addEventListener("keydown", (event) => {
    if (event.key === " " || event.key === "Enter") titlePressed = button.id;
  });
  element.addEventListener("keyup", () => {
    titlePressed = undefined;
  });
}
window.addEventListener("mouseup", () => {
  titlePressed = undefined;
});
window.addEventListener("blur", () => {
  titlePressed = undefined;
  titleHover = undefined;
});
document.getElementById("title-continue").addEventListener("click", () => {
  titleNotice.textContent = "";
  showPanel(ui.connect);
  (rememberUser.checked && ui.user.value ? ui.pass : ui.user).focus();
});
document
  .getElementById("login-cancel")
  .addEventListener("click", closeTitleLogin);
document.getElementById("title-new").addEventListener("click", () => {
  titleNotice.textContent =
    "此重建伺服器的帳號由管理員設定；登入後可建立角色，未提供網站註冊。";
});
document.getElementById("title-homepage").addEventListener("click", () => {
  titleNotice.textContent =
    "原版按鈕連至 MapleStory 官網；此重建版未連接官方帳號服務。";
});
document.getElementById("title-quit").addEventListener("click", () => {
  titleNotice.textContent = "遊戲尚未連線；可直接關閉此瀏覽器分頁離開。";
});
document.getElementById("login-lost").addEventListener("click", () => {
  ui.status.textContent =
    "帳號及密碼由此重建伺服器的管理員管理，未連接官方帳密查詢服務。";
});
// Keep keyboard focus in the modal; the title menu is hidden from tab order while it is open.
ui.connect.addEventListener("keydown", (event) => {
  if (event.key !== "Tab") return;
  const controls = [
    ui.user,
    ui.pass,
    rememberUser,
    document.getElementById("login-lost"),
    ui.login,
    document.getElementById("login-cancel"),
  ].filter((element) => !element.disabled);
  const index = controls.indexOf(document.activeElement);
  if (event.shiftKey && index <= 0) {
    event.preventDefault();
    controls.at(-1)?.focus();
  } else if (!event.shiftKey && index === controls.length - 1) {
    event.preventDefault();
    controls[0]?.focus();
  }
});
ui.login.addEventListener("click", connect);

ui.pass.addEventListener("keydown", (event) => {
  if (event.key === "Enter") connect();
});
ui.user.addEventListener("keydown", (event) => {
  if (event.key === "Enter") ui.pass.focus();
});
ui.logToggle.addEventListener("click", () => ui.log.classList.toggle("hidden"));
// The page's own header keeps a button for the same window the ITEM button opens.
document
  .getElementById("inv-toggle")
  ?.addEventListener("click", () => toggleInventory());
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

// Keys feed the fixed-step vecctrl reconstruction; network snapshots do not drive local physics.
window.addEventListener("keydown", (event) => {
  if (loginStage !== "game") {
    if (event.key === "Escape" && titleDialogOpen) closeTitleLogin();
    return;
  }
  if (itemDialog.open) return;
  // Input owns Enter, I and WASD as well as arrows; none should leak to the game.
  if (
    document.activeElement instanceof HTMLInputElement &&
    document.activeElement !== ui.say
  )
    return;
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
    if (itemDrag) {
      itemDrag = undefined;
      return;
    }
    if (statPanel.open) {
      statPanel.toggle(false);
      return;
    }
    if (equipPanel.open) {
      equipPanel.toggle(false);
      return;
    }
    if (shop !== undefined) closeShop();
    if (talkingNpc !== undefined) closeDialogue();
    return;
  }
  if (event.key.toLowerCase() === "e") {
    event.preventDefault();
    if (!event.repeat) equipPanel.toggle();
    return;
  }
  if (event.key.toLowerCase() === "m") {
    event.preventDefault();
    if (!event.repeat) miniMapPanel.toggle();
    return;
  }
  if (event.key.toLowerCase() === "s") {
    event.preventDefault();
    if (!event.repeat) statPanel.toggle();
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
  if (
    [
      "arrowleft",
      "arrowright",
      "arrowup",
      "arrowdown",
      "a",
      "d",
      "w",
      "s",
      "alt",
      " ",
    ].includes(key)
  ) {
    event.preventDefault();
    keys.add(key);
  }
});
window.addEventListener("keyup", (event) =>
  keys.delete(event.key.toLowerCase()),
);

// Physics is stepped by requestAnimationFrame. The network only publishes snapshots at 10Hz.
setInterval(() => {
  if (
    !self ||
    !selfView ||
    !playerBody ||
    portalPending ||
    map?.id !== self.mapId
  )
    return;
  const packet = {
    t: "move",
    x: Math.round(self.x),
    y: Math.round(self.y),
    foothold: playerBody.foothold,
    action: actionOf(playerBody),
    vx: Math.round(playerBody.vx),
    vy: Math.round(playerBody.vy),
  };
  const state = JSON.stringify(packet);
  if (state === lastSentMotion) return;
  lastSentMotion = state;
  send(packet);
}, MOVE_TICK_MS);
window.addEventListener("blur", () => {
  keys.clear();
  lastPhysicsAt = undefined;
});

/**
 * Browser commands; map jumps still use the native 0x0D packet and server-side operator policy.
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
  const warp = /^\/(map|warp|go|헉맵)(?:\s+(.*))?$/i.exec(text);
  if (warp) {
    const id = /^\d+$/.test(warp[2] ?? "") ? Number(warp[2]) : NaN;
    if (
      !Number.isSafeInteger(id) ||
      id < 0 ||
      id > 0x7fffffff ||
      id === RETURN_MAP_NONE
    )
      local(
        "系統",
        "用法：/map 地圖ID（/maps 關鍵字 可查詢）。需伺服器開放地圖命令權限。",
      );
    else if (!selfView || selfView.hp <= 0)
      local("系統", "請先進入地圖並復活，再使用地圖命令。");
    else send({ t: "warp-map", mapId: id });
    return true;
  }
  const maps = /^\/maps(?:\s+(.*))?$/i.exec(text);
  if (maps) {
    const query = (maps[1] ?? "").toLowerCase();
    void fetch("/api/maps")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((all) => {
        const matches = all.filter((m) =>
          `${m.id} ${m.name} ${m.streetName}`.toLowerCase().includes(query),
        );
        for (const m of matches.slice(0, 20))
          local("地圖", `${m.id} · ${m.streetName} / ${m.name}`);
        local(
          "系統",
          matches.length
            ? `共 ${matches.length} 筆${matches.length > 20 ? "，先顯示20筆；可加關鍵字縮小範圍" : ""}。/map ID 前往。`
            : "沒有符合的地圖。",
        );
      })
      .catch((e) => local("系統", `地圖清單讀取失敗：${e.message}`));
    return true;
  }
  if (/^\/where$/i.test(text)) {
    local(
      "系統",
      self
        ? `${map?.streetName ?? ""} / ${map?.name ?? ""} · 地圖 ${self.mapId} · (${Math.round(self.x)}, ${Math.round(self.y)})`
        : "尚未進入地圖。",
    );
    return true;
  }
  if (/^\/help$/i.test(text)) {
    local(
      "系統",
      "/map ID（別名 /warp、/go、/헉맵；需開放權限）、/maps [關鍵字]、/where、/w 名字 訊息、/f 名字。傳送點：地面按↑；type 3 自動進入；M 顯示／隱藏小地圖。",
    );
    return true;
  }
  const match = /^\/(w|f)\s+(\S+)(?:\s+([\s\S]*))?$/.exec(text);
  if (!match) {
    if (text.startsWith("/")) {
      local("系統", "未知指令，輸入 /help 查看指令。");
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
  event.preventDefault();
  event.stopPropagation(); // Blurring before bubbling must not let the global Enter handler reopen chat.
  const text = ui.say.value.trim();
  ui.say.value = "";
  if (text !== "" && !runCommand(text, chatLine)) send({ t: "say", text });
  if (!event.shiftKey) ui.say.blur();
});

ui.say.addEventListener("blur", () => {
  ui.say.placeholder = "Enter 開始輸入，再按 Enter 送出";
});

/** The first thing a user sees; also what a refresh returns to. */
pageBar.classList.add("hidden");
ui.connect.classList.add("hidden");
document.getElementById("title-continue").focus();
logLine(
  `page loaded; ws target ${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
);

const creationDialogs = characterDialogs({
  ctx,
  image: artImage,
  avatar: avatarFrame,
  send,
  audio,
  log: logLine,
  busy(value) {
    selectionPending = value;
    updateSelectionControls();
  },
  getSelected: () => loginCharacters[selectedCharacter],
  isCharacterStage: () => loginStage === "characters",
});

const statPanel = statWindow({
  ctx,
  image: artImage,
  send,
  audio,
  getSelf: () => selfView,
  isInGame: () => loginStage === "game",
  point: viewPoint,
  jobName: jobNameOf,
  log: logLine,
});

const miniMapPanel = miniMapWindow({
  ctx,
  image: artImage,
  getSelf: () => self,
  getUsers: () => [...users.values()],
  isInGame: () => loginStage === "game",
  point: viewPoint,
  isCovered: (p) =>
    inventoryWindowAt(p.x, p.y) !== undefined ||
    equipPanel.hit(p.x, p.y) !== undefined ||
    shopWindowAt(p.x, p.y) !== undefined,
});

const equipPanel = equipmentWindow({
  ctx,
  image: artImage,
  icon: itemIcon,
  getInventory: () => inventory,
  getSelf: () => selfView,
  isInGame: () => loginStage === "game",
  point: viewPoint,
  audio,
  beginItem: beginItemDrag,
  describe: describeItem,
  isCovered: (p) => shopWindowAt(p.x, p.y) !== undefined,
  hover(item, p) {
    equipHover = item;
    if (p) pointerAt = p;
  },
});

const itemDialog = itemDialogs({
  ctx,
  image: artImage,
  audio,
  onOpen() {
    keys.clear();
    itemDrag = undefined;
    inventoryDrag = inventoryScrollDrag = undefined;
    shopDrag = shopScrollDrag = undefined;
    inventoryPick = inventoryHover = equipHover = undefined;
  },
});
