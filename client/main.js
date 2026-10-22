import { chatEntry } from "./chat-entry.ts";
import { partyInvitation } from "./party-invitation.ts";
import { runSocialCommand } from "./social-commands.ts";
import { partyCommandLines } from "./party-state.ts";
import {
  TRADE_TEXT,
  TRADE_WINDOW,
  tradeCommandLines,
  tradeFinishText,
  tradeLogScroller,
  tradeState,
} from "./trade-state.ts";
import { tradeOfferCount, tradeRenderer, tradeWindowAt } from "./trade-window.ts";
import {
  MESSENGER_TEXT,
  MESSENGER_WINDOW,
  messengerLogScroller,
  messengerState,
} from "./messenger-state.ts";
import { messengerRenderer, messengerWindowAt } from "./messenger-window.ts";
import { partyMessage } from "./party.ts";
import { playerMenu } from "./player-menu.ts";
import { playerContains, playerMenuParty } from "./player-menu-data.ts";
import { fameMessage } from "./fame.ts";
import { loginScreen } from "./login-screen.ts";
import { sceneSurface, screenToWorld } from "./scene-surface.ts";
import { lensControls } from "./lens-controls.ts";
import {
  createDropRecord,
  parseDropRemoval,
  beginDropPickup,
  dropPosition,
} from "./drop-presentation.ts";
import { dropRenderer } from "./drop-renderer.ts";
import { CLIENT_READY_EVENT, clientStartupReady } from "./startup-guard.ts";
import { gameElements } from "./game-dom.ts";
import {
  INVENTORY,
  INVENTORY_TABS,
  clampInventoryScroll,
  consumeUseRoute,
  drawInventoryItems as paintInventoryItems,
  drawInventoryScrollbar as paintInventoryScrollbar,
  drawInventoryTabStrip as paintInventoryTabs,
  hasConsumeUseSound,
  inventoryCoinState,
  inventoryDropPlan,
  inventoryScrollbarGeometry as inventoryScrollGeometry,
  inventorySlotAt as inventorySlotAtLayout,
  inventoryStackCount,
  inventoryTabOfItem,
  inventoryWindowAt as inventoryHitAt,
  isIrreplaceableItem,
  isRechargeableItem,
  mesoDropAllowed,
  mesoDropBounds,
  quickSlotUseRoute,
} from "./inventory-window.ts";
import {
  SHOP,
  SHOP_SIDES,
  clampShopScroll,
  drawShopList as paintShopList,
  drawShopScrollbar as paintShopScrollbar,
  drawShopTabs as paintShopTabs,
  rechargeableRefillCost,
  shopActionBlocked,
  shopBuyBounds,
  shopBuyCount,
  shopListOf,
  shopPickedRowVisible,
  shopRowIconOrigin,
  shopRowPrice,
  shopRowStackCount,
  shopSellBounds,
  shopScrollbarGeometry as shopScrollGeometry,
  shopVisibleRows,
  shopWindowAt as shopHitAt,
} from "./shop-window.ts";
import { requireContext2d, requireElement, isEditingControl } from "./dom.ts";
import { pressRepeat, VSCR_CELL } from "./vscroll.ts";
import { samplePlayerPosition, resetPlayerPresentation } from "./player-presentation.ts";
import { createCamera, updateCamera, reframeCamera } from "./camera.ts";
import { cameraControls } from "./camera-controls.ts";
import { motionControls } from "./motion-controls.ts";
import {mobAttackPreview} from "./mob-attack-preview.ts";
import {mobForcedName,mobAttackName,mobForcedPose,mobForcedActive,replaceMobForced,mobDieAction} from "./mob-attacks.ts";
import {mobAttackEffects} from "./mob-attack-effects.ts";
import {ATTACK_EFFECT_Z,ATTACK_ORIGIN_HEIGHT,SHOT_NEAR_CLIP,attackMasteryTier,attackProfileAtTier,attackWorldRect,attackHitPoint,impactPosition,weaponHitKeys} from "./attack-presentation.ts";
import {magicSearchRects,magicHitPoint,magicLeg,clipMagicRay} from "./magiccombat.ts";
import {attackPredictions} from './attack-predictions.ts';
import {activeSkill,activeMeleeActions,activeSkillSpeed,activeSkillCost,activeMeleeBounds,activeRangedActions,activeSkillAmmo,activeProjectileLayout,activeMagicActions,activeMagicSpeed} from './active-skills.ts';
import { combatAssets } from "./combat-assets.ts";
import { beginAttackAlert, advanceAttackAlert, clearAttackAlert, forcedAttackInput, nativeBodyAction } from "./posture.ts";
import { attackCanvasFrame, attackHitDelay, attackTargetDelay, basicAttackAction, scaledAttackDelays } from "./attack-timing.ts";
import { avatarStance, avatarMotionProfiles, resetAvatarMotion } from "./avatar-motion.ts";
import { FACE_NAMES, faceProfiles, facePose, setFace, resetFace, movementFace } from "./faces.ts";
import {tooltipPreview} from "./tooltip-preview.ts";
import {npcPresentation} from "./npcmotion.ts";
import {dialogueExample} from "./dialogue-examples.ts";
import {npcDialogue} from "./npcdialogue.ts";
import {nativeCursor} from "./cursor.ts";
import {npcContains, releaseOnInterrupt} from "./pointer.ts";
import {drawSimpleTooltip, nativeTooltipRenderer, tooltipAnchor} from "./tooltip.ts";
import { drawItemNo, ITEM_NO_CELL_TOP } from "./itemno.ts";
import { backgroundCopies } from "./background.ts";
import { mobLocomotion } from "./mobmotion.ts";
import { systemMenu } from "./systemmenu.ts";
import { whisperNameError } from "./whisper.ts";
import {chatBalloons} from "./chatballoons.ts";
import { chatHistory } from "./chatlog.ts";
import {
  STATUS_BAR,
  STATUS_GAUGES,
  drawStatusGauge as paintStatusGauge,
  drawNamePlate,
  drawMapTitle,
  drawMessengerButton as paintMessengerButton,
  drawWhisperRecipient as paintWhisperRecipient,
  messengerButtonAt as messengerButtonHit,
  expPercent,
  gaugeFill,
  preloadStatusBar,
  statusBarButtonAt,
  statusText as paintStatusText,
  statusVitalText,
} from "./hud.ts";
import { portalSwirls } from "./portals.ts";
import {
  QUICK_SLOTS,
  quickSlotAt,
  quickItemState,
  quickItemProfile,
  quickSkillAllowed,
  quickSlotIconOrigin,
  skillIconPath,
} from "./quickslots.ts";
import { animationFrame } from "./animation.ts";
import { deathEffects, deathPose } from "./death.ts";
import { reviveWindow } from "./revive.ts";
import {
  contactClock,
  contactImpulse,
  mobRect,
  mobContactRect,
  playerContactRect,
  intersects,
} from "./contact.ts";
import { NATIVE_DAMAGE, damageNumberAnchor, damageNumbers } from "./damage-render.ts";
import { statTotals } from "./characterstats.ts";
import { temporaryStats, drawTemporaryStats } from "./temporarystats.ts";
import { naturalRecovery } from "./recovery.ts";
import { testTools } from "./testtools.ts";
import { skillWindow } from "./skills.ts";
import { jobNameOf } from "./jobs.ts";
import {
  weaponIdOf,
  basicAmmo,
  attackDuration,
  attackFrame,
  shotRelease,
  shotNear,
  projectileLeg,
} from "./basiccombat.ts";
import { itemDialogs } from "./itemdialogs.ts";
import { gameFeedback } from "./feedback.ts";
import { itemMetadataCache } from "./item-metadata.ts";
import { drawScreenMessages } from "./feedback-renderer.ts";
import { equipmentWindow, bodyPart, canWear } from "./equipment.ts";
import { miniMapWindow } from "./minimap.ts";
import { displayControls } from "./display-controls.ts";
import { archiveImages, avatarImages } from "./image-cache.ts";
import { entityAssets } from "./entity-assets.ts";
import { lookOf } from "./avatar-look.ts";
import { movementPortal, arrivalPortal } from "./portals.ts";
import { statWindow } from "./statwindow.ts";
import { prepareMapScene, mergeScene, visibleSprite, sceneOrdering } from "./scene.ts";
import { characterDialogs } from "./creation.ts";
import { createAudio, spatialVolume } from "./audio.ts";
import {
  collisionWorld,
  createPlayer,
  advancePlayer,
  requestPlayerJump,
  movementSnapshot,
  drainPlayerPath,
  queueKnockback,
  locomotion,
  actionOf,
  beginPath,
  sampleMotion,
  actorDepth,
  animationPose,
  remoteStance,
  facingFlip,
} from "./motion.ts";

/**
 * The browser view.
 *
 * JSON bridge to the 2003 packet implementation. The field, map layers, UI and composed avatars
 * come from the original Data.wz, not placeholder geometry. motion.ts handles fixed-step local
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

const { canvas, ui } = gameElements();
const renderSurface = sceneSurface(canvas);
const ctx = renderSurface.context;
const nativeTips = nativeTooltipRenderer({ctx, image: artImage});

const gameCursor = nativeCursor({
  surfaces: [canvas, ui.gameUi, ui.dialogue],
  onError: error => logLine(`cursor: ${error.message}`),
});

// Typed login UI owns all title/selection state; callbacks run only after module startup.
const loginScreens = loginScreen({
  ctx,
  ui,
  image: artImage,
  avatar: avatarFrame,
  bodyPose: sampleAvatarMotion,
  face: sampleAvatarFace,
  jobName: jobNameOf,
  audio,
  connect,
  send,
  preload: preloadAvatar,
  log: logLine,
  dismissLabs() {
    motionSettings.dismiss();
    lensSettings.dismiss();
  },
  labOpen: () => motionSettings.open || lensSettings.open || itemDialog.open,
  creation: () => creationDialogs,
});

/** @type {WebSocket | undefined} */
let socket, quitToTitle = false;
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
/** Immutable face data and bounded pose warm-up markers; clocks live on visual actors. */
const avatarMotionCatalog = avatarMotionProfiles();
const bodyWarmLooks = new Set();
let avatarPreviewActor = {y:0}, avatarPreviewLast;
const faceCatalog = faceProfiles();
const avatarWarmLooks = new Set();
let emoteAvailable; // First presentation tick also disables buttons outside an active field.
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
/** Native WZ-derived base; temporary values stay in the client timer model. */
let nativeBasis, nativeShotRange = 200, nativeAmmoPad = 0, nativeWornFacts = [];
const effectiveSelf = () => selfView && nativeBasis ? {...selfView,maxHp:nativeBasis.basic.maxHp,maxMp:nativeBasis.basic.maxMp} : selfView;
function effectiveMovement(now) {
  const totals=nativeBasis && statTotals(nativeBasis,buffs.values(now));
  return totals ? {speedPercent:totals.speed,jumpPercent:totals.jump} : {speedPercent:100,jumpPercent:100};
}
/** Shared archive facts for tooltips, requirements, sounds, shops and reward names. Not instances. */
const itemMetadata = itemMetadataCache({
  read: (id, signal) => fetch(`/api/item/${id}`, {signal}), now: () => performance.now(),
  onError: error => logLine(`item metadata: ${String(error)}`),
});
const itemInfo = itemMetadata.entries;
/** The shop `0x4A` opened, or undefined when no NPC's window is up. */
let shop;
/** Modal sentinel for a 0x47 dialog or explicitly marked local UI example; otherwise undefined. */
let talkingNpc;

/** The four tabs of the sheet, in the order `sub_4DA440` adds them to its `CCtrlTab`. */

/** A tab slot, or a worn slot when `slot` is negative (`-1` is the first of the group). */
function slotName(slot) {
  return slot < 0 ? `穿戴 ${-slot}` : String(slot);
}

/**
 * The nine faces, in the client's own order (`EMOTION_NAMES` in `server/src/protocol/field.ts`,
 * read out of `Character/Face/*` and the drawing code's table). 1..7 are what the 2003 client's
 * F1..F7 send; 0 (the neutral blink) and 8 have no key there, and this page has no button for them.
 */
const EMOTE_NAMES = FACE_NAMES;
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


function connect() {
  if (!clientStartupReady(document.documentElement) || loginScreens.loginPending) return;
  quitToTitle=false;
  feedback.reset();
  buffs.clear(); nativeBasis=undefined; nativeShotRange=200; nativeAmmoPad=0; nativeWornFacts=[];
  loginScreens.showPanel(ui.connect);
  loginScreens.setLoginPending(true);
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
    loginScreens.setLoginPending(false);
    // The usual cause is a proxy that does not forward the upgrade (an https page whose proxy
    // refuses `wss`). Saying so beats a page that silently does nothing.
    ui.status.textContent =
      "WebSocket 連線失敗：請確認服務可用，且此網址的代理支援 WebSocket upgrade。";
    ui.status.classList.add("bad");
    logLine("websocket error");
  });
  connection.addEventListener("close", () => {
    if (socket !== connection) return;
    loginScreens.setLoginPending(false);
    feedback.reset();
    playerContext.close(false); partyMenuState.clear();
    systemPanel.close(false, false);
    itemDialog.close(false);
    quickDrag = undefined;
    itemDrag = undefined;
    slotPending = shopPending = mesoPending = false;
    combatEpoch++;
    mobAttackFx.clear();mobWorldEffects.length=0;mobPreview.reset();
    skillEffects.length=0;skillHitEffects.length=0;weaponEffects.clear();activePredictions.clear();
    combatCatalog.clear(); attackLooks.clear(); avatarWarmLooks.clear(); bodyWarmLooks.clear();
    clearAttackAlert(playerBody);
    skillEffects.length=0;skillHitEffects.length=0;weaponEffects.clear();activePredictions.clear();buffs.clear();
    resetContact();
    resetFace(selfView);
    resetAvatarMotion(selfView);
    deathFx.reset();
    speechBalloons.clear();
    npcVisuals.clear();
    resetWhisper();
    chatHistoryPanel.cancelDrag();
    visualFieldActive = false;
    lastAttackTrace = undefined;
    ++mapGeneration;
    entityCatalog.clear();
    revivePanel.reset();
    selfSwing = undefined;
    projectiles.length = damageMarks.length = 0;
    ui.where.textContent = "斷線";
    ui.status.textContent = "連線結束。重新載入頁面再試一次。";
    ui.status.classList.add("bad");
    buffs.clear(); nativeBasis=undefined; nativeShotRange=200; nativeAmmoPad=0; nativeWornFacts=[];
    closeDialogue(false);
    logLine("websocket closed");
    if (quitToTitle) {
      quitToTitle = false;
      self = selfView = playerBody = undefined;
      users.clear(); mobs.clear(); npcs.clear(); drops.clear();
      inventory = undefined; quickDrag = undefined; resetWhisper();
      ui.chatbox.classList.add("hidden");
      testToolsPanel.close(); skillPanel.toggle(false); statPanel.toggle(false); equipPanel.toggle(false);
      toggleInventory(false); closeShop(false); closeDialogue(false);
      tradeOpen = false; tradeModel.clear(); tradeHover = tradeHoverOffer = undefined; tradeLogScroll.reset();
      closeMessenger(false);
      audio.stop(); loginScreens.showPanel(ui.connect); loginScreens.closeTitleLogin();
    }
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
  try { if (feedback.receive(message)) return; }
  catch (error) { logLine(`invalid feedback: ${error.message}`); return; }
  recovery.receive(message);
  revivePanel.receive(message);
  if (testToolsPanel.receive(message)) return;
  if (creationDialogs.receive(message)) return;
  if (skillPanel.receive(message)) return;
  if (statPanel.receive(message)) return;
  if (["field", "disconnect", "login"].includes(message.t)) {
    playerContext.close(false);
    if (message.t !== "field") partyMenuState.clear();
    skillEffects.length=0;skillHitEffects.length=0;weaponEffects.clear();activePredictions.clear();buffs.clear();
    resetContact();
    resetFace(selfView);
    resetAvatarMotion(selfView);
    deathFx.reset();
    speechBalloons.clear();
    npcVisuals.clear();
    pendingWhisper=undefined;userRequestUntil=0;
    chatHistoryPanel.cancelDrag();
    ++mapGeneration;
    entityCatalog.clear();
    visualFieldActive = false;
    lastAttackTrace = undefined;
    miniMapPanel.setMap(undefined);
    itemEpoch++;
    systemPanel.close(false, false);
    quickDrag = undefined;
    if (message.t !== "field") {resetWhisper();chatHistoryPanel.clear();}
    itemDialog.close(false);
    inventoryScrollDrag = undefined;
    shopPending = false;
    if (message.t !== "field") { inventoryScroll.fill(0); buffs.clear(); nativeBasis=undefined; nativeShotRange=200; nativeAmmoPad=0; nativeWornFacts=[]; }
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
      loginScreens.setLoginPending(false);
      if (message.result !== 0) {
        ui.status.textContent = `登入失敗（結果 ${message.result}）`;
        ui.status.classList.add("bad");
        return;
      }
      loginScreens.rememberAccount();
      creationDialogs.setGender(message.gender);
      ui.pass.value = "";
      ui.status.textContent = "";
      if (!loginScreens.replaceWorlds(message.worlds)) return;
      loginScreens.showPanel(ui.worlds);
      logLine(`login ok: ${message.worlds.length} world(s)`);
      return;

    case "characters":
      if (message.result !== 0) {
        loginScreens.setSelectionPending(false);
        ui.characterStatus.textContent = `讀取角色失敗（結果 ${message.result}）`;
        ui.characterStatus.classList.add("bad");
        return;
      }
      loginScreens.setSelectionPending(false);
      ui.characterStatus.textContent = "";
      ui.characterStatus.classList.remove("bad");
      if (!loginScreens.replaceCharacters(message.characters)) return;
      logLine(`characters: ${message.characters.length}`);
      return;

    case "created":
      if (message.ok) ui.newName.value = "";
      loginScreens.setSelectionPending(false);
      ui.characterStatus.textContent = ""; // CUINewChar already owns native failure notices; no extra HTML overlay.
      ui.characterStatus.classList.remove("bad");
      if (message.ok) {
        loginScreens.selectCharacterId(message.id);
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
      visualFieldActive = true;
      playerMenuEnabled = message.playerMenu === true;
      partyInviteIdentity = message.partyInviteIdentity === true;
      socialCommandsEnabled = message.socialCommands === true;
      tradeEnabled = message.trade === true;
      contactField = message.contactField;
      void damageArt.preload();
      void deathFx.preload();
      selfDeathSettled = message.self.hp <= 0;
      portalPending = false;
      void audio.effect(self ? "Game/Portal" : "Game/GameIn");
      playerBody = undefined;
      map = mapArt = undefined;
      mapScene = [];
      layerOrder = sceneOrdering();
      camera.ready = false;
      terrain = collisionWorld({});
      lastPhysicsAt = undefined;
      lastSentMotion = undefined;
      keys.clear();
      selfView = message.self;
      loadQuickItems();
      nextBagUseAt = 0;
      pendingUse = undefined;
      self = { x: 0, y: 0, mapId: message.mapId };
      users.clear();
      selfSwing = undefined;
      nativeShotRange = 200;
      combatEpoch++;
      nextSwingAt = 0;
      projectiles.length = 0;
      damageMarks.length = 0;
      mobForces.clear();mobAttackFx.clear();mobWorldEffects.length=0;mobPreview.reset();
      mobs.clear();
      npcs.clear();
      drops.clear();
      dying.clear();
      for (const user of message.users) {
        user.facing = user.action & 1;
        deathFx.observe(user.characterId, (user.action & ~1) === 18, user, performance.now(), true);
        users.set(String(user.characterId), user);
      }
      for (const mob of message.mobs) mobs.set(String(mob.mobId), mob);
      for (const npc of message.npcs) {
        npcs.set(String(npc.npcId), npc);npcVisuals.add(npc,performance.now());
      }
      loginScreens.hidePanels();
      // The server drops the windows with the map (the shop and the dialog belong to its NPCs), so
      // this side must not tell it to close something it already forgot.
      closeShop(false);
      closeDialogue(false);
      ui.chatbox.classList.remove("hidden");
      chatHistoryPanel.latest();
      ui.where.textContent = `${selfView.name} · 地圖 ${message.mapId}`;
      void loadMap(message.mapId, mapGeneration);
      logLine(`field ${message.mapId}`);
      return;

    case "stat-basis":
      if(nativeBasis&&nativeBasis.weaponId!==message.basis.weaponId)buffs.removeFields(['booster']);
      nativeBasis=message.basis; nativeShotRange=Number.isInteger(message.shotRange) ? message.shotRange : 200; nativeAmmoPad=message.ammoPad; nativeWornFacts=message.wornFacts??[];
      return;

    case "touch-result": {
      const pending = contactPending;
      if (
        !pending ||
        message.contactId !== pending.contactId ||
        message.contactField !== contactField
      )
        return;
      contactPending = undefined;
      if (!message.accepted) {
        contactRetryAt =
          performance.now() +
          (Number.isFinite(message.retryAfterMs)
            ? Math.max(30, Math.min(1500, message.retryAfterMs))
            : 250);
        if (message.message) logLine(`contact: ${message.message}`);
        return;
      }
      const damage = message.damage;
      // sub_4C8ED0 clamps a real hit to 1..9999. 0 is the one value below that floor the page lets
      // through: it is the touch that missed, it prints MISS, and it knocks back nothing.
      if (!Number.isInteger(damage) || damage < 0 || damage > NATIVE_DAMAGE.max) return;
      const now = performance.now();
      contact.accept(damage);
      addDamageMark({
        x: pending.player.x,
        y: pending.player.y,
        avatar: pending.avatar,
        value: damage,
        palette: "NoViolet",
        start: now,
        jitter: Array.from(String(damage), () => Math.floor(Math.random() * 2)),
      });
      if (damage > 0 && playerBody && selfView) {
        queueKnockback(playerBody, pending.impulse.x, pending.impulse.y);
        setFace(selfView, 1, now, 1500);
      }
      return;
    }

    case 'active-skill-result':
      if(!message.accepted)logLine('技能未施放：請確認已學等級、HP／MP、隊伍及前一項操作。');
      return;
    case 'skill-effect':
      void playSkillEffect(message.characterId,message.skillId,message.skillLevel,performance.now());return;
    case 'active-hit': {
      if(message.contactField!==contactField||!(selfView?.hp>0))return;
      const prediction=activePredictions.consume(message.attackToken,message.mobId);
      if(!prediction||prediction.field!==self||prediction.epoch!==combatEpoch||prediction.skillId!==message.skillId||
        prediction.skillLevel!==message.skillLevel||mobs.get(String(message.mobId))!==prediction.target.mob)return;
      const at=prediction.start+prediction.target.delayMs;
      scheduleActiveHits(message.mobId,message.damages??[],message.skillId,message.skillLevel,at,prediction.target.presentation);return;
    }
    case 'fame': {
      const text=fameMessage(message.result,selfView?.name??'');
      if(text!==undefined)chatHistoryPanel.append(text,'fame');
      return;
    }
    case 'party-command':
      for(const text of partyCommandLines(message.feedback))chatHistoryPanel.append(text,'fame');
      return;
    case 'trade-command':
      for(const text of tradeCommandLines(message.feedback))chatHistoryPanel.append(text,'fame');
      return;
    case 'trade': {
      const event = message.event;
      for (const t of tradeModel.receive(event)) {
        if (t.kind === 'invite') {
          // sub_481910: CConfig goExchange plus one modal at a time; a blocked offer is a no.
          const canAsk = tradeEnabled && systemPanel.gameSettings.exchange &&
            loginScreens.stage==='game' && visualFieldActive && selfView?.hp>0 && !portalPending &&
            !modalOpen() &&
            talkingNpc===undefined && !browserLabOpen() && !tradeOpen;
          if (!canAsk) { send({t:'trade-response', inviterId:event.inviterId, accepted:false}); continue; }
          const answered = itemDialog.confirm({
            text: TRADE_TEXT.invite(event.inviterName),
            accept(){ send({t:'trade-response', inviterId:event.inviterId, accepted:true}); },
            reject(){ send({t:'trade-response', inviterId:event.inviterId, accepted:false}); },
          });
          if (!answered) send({t:'trade-response', inviterId:event.inviterId, accepted:false});
        } else if (t.kind === 'opened') {
          tradeOpen = true;
          tradeAt = { ...TRADE_WINDOW.home };
          tradeHover = tradeHoverOffer = undefined;
          tradeLogScroll.reset();
          playerContext.close(false);
        } else if (t.kind === 'closed') {
          tradeOpen = false;
          tradeHover = tradeHoverOffer = undefined;
          tradeLogScroll.reset();
          const text = tradeFinishText(event.code);
          if (text !== undefined) itemDialog.notice({ text, accept(){} });
        }
      }
      if (event.kind === 'refused' && event.code !== 0)
        itemDialog.notice({
          text: event.code === 2 ? TRADE_TEXT.busy(event.name ?? '') : TRADE_TEXT.notFound,
          accept(){},
        });
      return;
    }
    case 'messenger': {
      const event = message.event;
      for (const t of messengerModel.receive(event, performance.now())) {
        if (t.kind === 'invite') {
          // sub_4E1BB0: goMessenger (n0xC8+28) gates the invite; a closed window raises the
          // modal, an open one only prints a row (the model did that already).
          const canAsk = systemPanel.gameSettings.messenger &&
            loginScreens.stage === 'game' && visualFieldActive && selfView?.hp > 0 && !portalPending &&
            !modalOpen() &&
            talkingNpc === undefined && !browserLabOpen() && !messengerOpen;
          if (!canAsk) { messengerModel.dismissInvite(event.roomId); continue; }
          itemDialog.confirm({
            text: MESSENGER_TEXT.inviteModal(event.inviterName),
            accept() {
              if (!messengerModel.answerInvite(event.roomId)) return;
              openMessengerAt(event.roomId);
            },
            reject() { messengerModel.dismissInvite(event.roomId); },
          });
        }
      }
      return;
    }
    case 'party': {
      const r=message.result;
      partyMenuState.receive(r,selfView?.characterId??0);
      playerContext.close(false);
      if(r.kind==='invite'){
        // Native party s2c case 3 (MapleStory.exe.c:353029) only pops the invite box when
        // CConfig goParty (+9) is on; when it is off the packet is silently ignored - no reply.
        if(systemPanel.gameSettings.party) partyPrompt.offer(r.inviterId,r.inviterName);
      }
      else {
        partyPrompt.membershipChanged(partyMenuState.id!==0);
        const text=partyMessage(r,selfView?.characterId??0,selfView?.name??'');
        if(text!==undefined)chatHistoryPanel.append(text,'fame');
      }
      return;
    }
    case "temporary-stat":
      buffs.apply(message.update, performance.now());
      return;

    case "self":
      if (selfView && message.self.level > selfView.level)
        void audio.effect("Game/LevelUp");
      if (selfView?.hp > 0 && message.self.hp <= 0) {
        playerContext.close(false);
        selfDeathSettled = false;
        if (playerBody && map?.id === self?.mapId)
          deathFx.observe(message.self.characterId, true, selfDisplayPosition(), performance.now());
        selfSwing = undefined;
        buffs.clear();skillEffects.length=0;skillHitEffects.length=0;weaponEffects.clear();activePredictions.clear();
        clearAttackAlert(playerBody);
        combatEpoch++;
        keys.clear();
      }
      const priorLook = selfView && JSON.stringify(lookOf(selfView));
      selfView = selfView?.characterId === message.self.characterId ? { ...selfView, ...message.self } : message.self;
      if (priorLook !== JSON.stringify(lookOf(selfView))) resetFace(selfView);
      if (selfView.hp > 0) deathFx.remove(selfView.characterId);
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
          hasConsumeUseSound(itemId)
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
      if (tooltipViewer.open) closeDialogue(false);
      openShop(message.shop);
      return;

    case "shop-result":
      shopPending = false;
      // Every buy/sell is answered with a result byte - `0` is "silent", i.e. it worked.
      if (message.code !== 0) logLine(`shop: ${message.message}`);
      return;

    case "npc-say":
      if (npcDialog.preview || tooltipViewer.open) closeDialogue(false); // Real server dialog always supersedes a local example.
      if (!npcDialog.show(message.npcId, message.body ?? {kind:"say",message:String(message.message)}))
        logLine("NPC dialog already open; did not replace the current modal.");
      return;

    case "user-enter":
      message.user.facing = message.user.action & 1;
      deathFx.observe(message.user.characterId, (message.user.action & ~1) === 18,
        message.user, performance.now(), true);
      users.set(String(message.user.characterId), message.user);
      preloadAvatar(lookOf(message.user));
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
      user.attackTicket = (user.attackTicket ?? 0) + 1;
      delete user.swing;
      resetFace(user);
      resetAvatarMotion(user);
      preloadAvatar(lookOf(user));
      return;
    }

    case "user-leave":
      if(playerContext.state?.target.characterId===message.characterId)playerContext.close(false);
      deathFx.remove(message.characterId);
      users.delete(String(message.characterId));
      speechBalloons.remove(message.characterId);
      return;

    case "user-move": {
      if (selfView && message.characterId === selfView.characterId) {
        if (message.local) return; // The bridge echoes what WE sent, not a server correction.
        if (self) {
          self.facing = message.action & 1;
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
          camera.ready = false;
        }
        return;
      }
      // bebb3009 switched this beginPath to the per-message `now` (the pattern mob-move uses) but
      // never declared it in this case block: a ReferenceError broke remote user paths in the
      // browser. The revived client_probe REMOTE PATH battery caught it (ADR-108).
      const now = performance.now();
      const user = users.get(String(message.characterId));
      if (user) {
        // The path's action bit is authoritative: moving backwards under force must not turn the face.
        beginPath(
          user,
          message.path ?? { elements: [{ ...message, duration: 100 }] },
          now,
        );
      }
      return;
    }

    case "user-emotion": {
      // ClientSession emits a local bridge echo; native already set its own face before 0x13.
      // Do not restart its timer, and do not let a delayed older echo replace the latest keypress.
      if (message.characterId === selfView?.characterId) return;
      const user = users.get(String(message.characterId));
      if (user) setFace(user, message.emotion, performance.now(), -1, remoteStance(user));
      return;
    }

    case "level-up": {
      if (message.characterId === selfView?.characterId)
        void audio.effect("Game/LevelUp");
      const user = users.get(String(message.characterId));
      if (user) user.levelUpAt = performance.now();
      return;
    }

    case "chat": {
      if(message.channel==='field') {
        chatLine(message.name,message.text);
        if(message.characterId!==undefined)speechBalloons.put(message.characterId,`${message.name} : ${message.text}`,performance.now());
      } else {
        // 472910 checks CConfig+24 (goWhisper). It never tests whether the chat window is open.
        if(systemPanel.gameSettings.whisper)chatLine(`${message.name}>>`,message.text);
        else send({t:'refuse-whisper',name:message.name});
        // 4732D0 remembers the incoming sender even when this client refused the line.
        whisperRecipient=lastWhisperRecipient=message.name;updateWhisperControl();
      }
      return;
    }
    case "whisper-refused":
      chatHistoryPanel.append(`'${message.name}'님은 현재 귓속말이 거부되어 있습니다.`, 'whisper');
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
      pendingWhisper = undefined; userRequestUntil=0;
      if (message.delivered) {
        if(text)chatLine(`${message.name}<<`,text);
        else chatHistoryPanel.append(`'${message.name}'님께 귓속말을 전달했습니다.`,'whisper');
      } else {
        chatHistoryPanel.append(`'${message.name}'님을 찾지 못했습니다`,'error');
      }
      logLine(
        `whisper ${message.delivered ? "delivered" : "not found"}: ${message.name}`,
      );
      return;
    }

    case "find-answer": {
      userRequestUntil=0;
      // 472910 reads map/street metadata locally. A first /find must not require a second /find.
      if (message.mapId === -1) {
        chatHistoryPanel.append(`'${message.name}'님을 찾지 못했습니다`,'error');
      } else {
        const where=mapNames.get(message.mapId);
        const format=place=>`'${message.name}'님의 현재 위치는 '${place}'입니다`;
        const line=chatHistoryPanel.append(format(where||String(message.mapId)),where?'find':'error');
        if(!where)void rememberMapName(message.mapId).then(place=>{
          if(place)line.update(format(place),'find'); // Pruned/owner-cleared records cannot reappear.
        });
      }
      logLine(`find ${message.name}: ${message.mapId}`);
      return;
    }

    case "mob-enter":
      dying.delete(String(message.mob.mobId));
      mobForces.delete(String(message.mob.mobId));mobAttackFx.remove(String(message.mob.mobId));
      previousContactMobs.delete(String(message.mob.mobId));
      mobs.set(String(message.mob.mobId), message.mob);
      if(message.presentation){
        const phase=message.presentation,now=performance.now(),key=String(message.mob.mobId);
        message.mob.mp=phase.mp;message.mob.reactionUntil=now+phase.reactionRemaining;
        if(phase.forced)mobForces.set(key,{action:phase.forced.action,facing:phase.forced.facing,since:now-phase.forced.age,duration:phase.forced.duration});
        if(phase.dyingAge!==undefined)dying.set(key,now-phase.dyingAge);
      }
      return;

    case "mob-stat": {
      const mob=mobs.get(String(message.mobId));if(mob)mob.mp=message.mp;return;
    }

    case "mob-move": {
      const mob = mobs.get(String(message.mobId));
      if (mob) {
        // 488BC0: the signed header controls forced sprite action; path actions control locomotion.
        const now=performance.now();
        if(message.presentation){mob.mp=message.presentation.mp;mob.reactionUntil=now+message.presentation.reactionRemaining;}
        sampleMotion(mob,now,terrain);
        const action=message.actionByte===undefined?-1:message.actionByte>>1;
        if(message.actionByte>=0&&action>=7&&action<=12){
          const current=mobForces.get(String(message.mobId));
          const active=mobForcedActive(mobArts.get(mob.templateId),current,now);
          if(!active||replaceMobForced(current.action,action))mobForces.set(String(message.mobId),{action,since:now,facing:message.actionByte&1,duration:message.forcedDuration});
          // A replacement controller path begins at its authoritative origin, never the old patrol endpoint.
          if(Number.isFinite(message.path?.originX)&&Number.isFinite(message.path?.originY)){
            mob.x=message.path.originX;mob.y=message.path.originY;
          }
          if(mobAttackName(action)){
            ensureEntityArt('mob',mob.templateId);
            mobAttackFx.put(String(message.mobId),mob.templateId,action,message.actionByte&1,message.value??0,mob,now);
          }
        }
        else if(message.actionByte>=0){
          mobForces.delete(String(message.mobId));mob.actionSince=now;
        }
        mob.facing =
          (message.actionByte<0?mob.facing:message.facing) ??
          (message.x === mob.x ? mob.facing : message.x < mob.x ? 1 : 0);
        beginPath(
          mob,
          message.path ?? { elements: [{ ...message, duration: 100 }] },
          now,
        );
      }
      return;
    }

    case "mob-die": {
      // `0x30`: the monster is still on the field (its corpse is), and the 2003 client plays
      // `Mob/<id>.img/die1|die2|dieF` before `0x31` takes it away. Nothing else changes here - the loot and
      // the exp are other packets, from the server.
      const corpse = mobs.get(String(message.mobId)),field=self,epoch=combatEpoch,at=performance.now();
      if (corpse)
        void audio.effect(
          `Mob/${String(corpse.templateId).padStart(7, "0")}/Die`,
          spatialVolume(corpse.x, corpse.y, self),
          {deadline:at+1000,valid:()=>self===field&&combatEpoch===epoch&&mobs.get(String(message.mobId))===corpse},
        );
      if (corpse) {
        sampleMotion(corpse, performance.now(), terrain);
        corpse.motion = undefined;corpse.vx=corpse.vy=0;
      }
      mobForces.delete(String(message.mobId));
      if(corpse)corpse.dieAction=mobDieAction(mobArts.get(corpse.templateId));
      dying.set(String(message.mobId), performance.now());
      return;
    }

    case "mob-leave":
      mobAttackFx.remove(String(message.mobId));
      mobForces.delete(String(message.mobId));
      previousContactMobs.delete(String(message.mobId));
      mobs.delete(String(message.mobId));
      dying.delete(String(message.mobId));
      return;

    case "hit": {
      if(message.contactField!==contactField||!(selfView?.hp>0))return;
      lastAttackTrace=message.trace;
      const prediction=activePredictions.consume(message.attackToken,message.mobId);
      if(!prediction||prediction.field!==self||prediction.epoch!==combatEpoch||prediction.skillId!==0||
        mobs.get(String(message.mobId))!==prediction.target.mob)return;
      scheduleActiveHits(message.mobId,[message.damage],0,0,prediction.start+prediction.target.delayMs,prediction.target.presentation);
      return;
    }

    case "user-attack": {
      void receiveUserAttack(message, performance.now());
      return;
    }

    case "drop-enter": {
      // The drop flies out of the monster that left it: the packet carries the monster and where the
      // item came to rest, and the two are a hop apart.
      const record = createDropRecord(message.drop, performance.now(), (id) =>
        mobs.get(String(id)),
      );
      if (record) {
        drops.set(String(record.drop.dropId), record);
        rewardPainter.preload(record.drop);
      }
      return;
    }

    case "drop-leave": {
      const removal = parseDropRemoval(message);
      if (!removal) return;
      const key = String(removal.dropId);
      const record = drops.get(key);
      if (record === undefined) return;
      // `taken` is the only kind the original turns into an animation: the icon flies to the
      // character in `characterId` (0x44's own field) and disappears when it gets there.
      if (removal.reason !== "taken") {
        drops.delete(key);
        return;
      }
      // 4A95B0: native pool removal kind2 sounds only for the local taker, once per drop.
      if (beginDropPickup(record, performance.now(), removal.characterId) &&
          removal.characterId === selfView?.characterId) void audio.effect("Game/PickUpItem");
      return;
    }

    case "npc-enter":
      npcs.set(String(message.npc.npcId), message.npc);
      npcVisuals.add(message.npc,performance.now());
      return;

    case "npc-leave":
      npcs.delete(String(message.npcId));npcVisuals.remove(message.npcId);
      return;

    case "npc-controller": {
      const npc=npcs.get(String(message.npcId));if(npc)npc.controlled=message.on;
      npcVisuals.controller(message.npcId,message.on,performance.now());return;
    }
    case "npc-idle": {
      const now=performance.now(),npc=npcs.get(String(message.npcId));
      if(npc&&message.path){sampleMotion(npc,now,terrain);beginPath(npc,message.path,now);}
      npcVisuals.receive(message,now);return;
    }

    case "disconnect":
      mobAttackFx.clear();mobWorldEffects.length=0;mobPreview.reset();
      closeDialogue(false);
      portalPending = false;
      loginScreens.setLoginPending(false);
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
        loginScreens.setLoginPending(false);
        loginScreens.setSelectionPending(false);
        if (loginScreens.stage !== "title") ui.characterStatus.textContent = text;
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

/** 4694F0/472910: lookup of street:map is client-side; it is not a movement or portal request. */
async function rememberMapName(mapId) {
  try {
    const response = await fetch(`/api/map/${mapId}`);
    if (!response.ok) return;
    const data = await response.json();
    const name=[data.streetName,data.name].filter(Boolean).join(':');
    mapNames.set(data.id,name);return name;
  } catch {
    // Leave the explicit id fallback if metadata could not be loaded.
  }
}

async function loadMap(mapId, generation) {
  try {
    const response = await fetch(`/api/map/${mapId}`);
    if (!response.ok) throw new Error(`map ${mapId}: HTTP ${response.status}`);
    const loaded = await response.json();
    if (self?.mapId !== mapId || generation !== mapGeneration) return; // Including same-map revive/re-entry.
    map = loaded;
    mapAnimationStart = performance.now();
    audio.setBgm(map.bgm);
    terrain = collisionWorld(map);
    mapNames.set(map.id,[map.streetName,map.name].filter(Boolean).join(':'));
    hoveredPortal = undefined;
    // The map reset: the art of the previous map must not be drawn under the new one.
    mapArt = undefined;
    // Shared UI/map sheets and avatar poses survive portals; bounded caches evict old entries.
    mapScene = [];
    layerOrder = sceneOrdering();
    entityCatalog.clear();
    // Every field entry is a discontinuity, including same-map revive/re-entry.
    camera.ready = false;
    void loadMapArt(mapId, generation);
    for (const npc of map.npcs ?? []) ensureEntityArt("npc", npc.templateId);
    for (const mob of map.mobs ?? []) ensureEntityArt("mob", mob.templateId);
    if (self && selfView) {
      // sub_511820: stats+101 indexes the NON-type-3 array; initialize ten pixels above tn.
      const spawn = arrivalPortal(map, selfView.spawnPortalIndex);
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
async function loadMapArt(mapId, generation) {
  try {
    const response = await fetch(`/api/map/${mapId}/art`);
    if (!response.ok) {
      logLine(`map ${mapId}: no art (${response.status})`);
      return;
    }
    const art = await response.json();
    if (map?.id !== mapId || generation !== mapGeneration) return;
    mapArt = art;
    lensSettings.reveal(performance.now());
    miniMapPanel.setMap(art.miniMap, map.portals);
    mapScene = prepareMapScene(art.sprites);
    // The archive's back index has a native z of its own, not a boolean final overlay.
    for (const [index, back] of (art.backs ?? []).entries()) mapScene.push({
      kind: "back", back, y: back.y, z: back.z ?? (1000 * index - 147990), order: mapScene.length,
    });
    mapScene.sort((a, b) => a.z - b.z || a.order - b.order);
    layerOrder = sceneOrdering(mapScene.length);
    // updateCamera applies the new bounds without a second recenter/pop when art arrives late.
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
  const { x, y } = screenToWorld({ x: clientX, y: clientY }, camera, renderSurface.viewport());
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
    modalOpen() || browserLabOpen() || talkingNpc !== undefined ||
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

/** 49F1F0 -> 49A670: first pool rectangle containing the point. The rectangle comes from
 * the NPC's OWN info.dc*, not the current/linked sprite, and does not flip with its facing.
 * Wait for metadata instead of guessing an oversized hit area while HTTP art is loading.
 */
function npcAt(clientX, clientY) {
  if (!self) return undefined;
  const { x, y } = screenToWorld({ x: clientX, y: clientY }, camera, renderSurface.viewport());
  for (const npc of npcs.values()) {
    ensureEntityArt("npc", npc.templateId);
    if (npcContains(npc, npcMetadata.get(npc.templateId)?.clickBounds, x, y)) return npc;
  }
  return undefined;
}

let canvasButtonHover, canvasButtonPress, canvasButtonActivation;
function canvasButtonAt(p) {
  if (loginScreens.stage !== "game" || !visualFieldActive || revivePanel.open || itemDialog.open ||
      systemPanel.visible || browserLabOpen() || itemDrag || quickDrag || shopDrag || inventoryDrag ||
      shopScrollDrag || inventoryScrollDrag || tradeDrag || tradeScrollDrag || messengerDrag || messengerScrollDrag ||
      statPanel.contains(p.x,p.y) || skillPanel.contains(p.x,p.y)) return;
  if (tradeOpen) {
    const tradeHit = tradeWindowAt(p.x, p.y, tradeAt, tradeModel.room, tradeLogScroll);
    if (tradeHit !== undefined) {
      if (tradeHit.kind === "close" || tradeHit.kind === "trade" || tradeHit.kind === "coin")
        return `trade:${tradeHit.kind}`;
      return; // sheet body and slot cells are not CCtrlButton sprite controls
    }
  }
  const shopHit = shopWindowAt(p.x,p.y);
  if (shopHit) {
    if (shopHit.kind === "close") return "shop:close";
    if (shopHit.kind === "button") {
      if (shopHit.button === "recharge" && (!rechargeQuote(shopSellPick) || shopPending)) return;
      return `shop:${shopHit.button}`;
    }
    return; // Rows/tabs/scrollbars are not CCtrlButton sprite controls.
  }
  if (equipPanel.hit(p.x,p.y)) return;
  const bag = inventoryWindowAt(p.x,p.y);
  if (bag) return bag.kind === "close" ? "inventory:close" : undefined;
  if (shop === undefined && talkingNpc === undefined) {
    const button = statusButtonAt(p.x,p.y);
    if (button) return `status:${button.action}`;
  }
}
canvas.addEventListener("mousemove", event => {
  const id = canvasButtonAt(viewPoint(event));
  if (id && id !== canvasButtonHover) void audio.effect("UI/BtMouseOver");
  canvasButtonHover = id;
});
canvas.addEventListener("mousedown", event => {
  if (event.button !== 0) return;
  canvasButtonPress = canvasButtonAt(viewPoint(event));
  canvasButtonActivation = undefined;
  inventorySuppressClick = shopSuppressClick = false;
});
// One canvas is many native controls. A browser click whose down/up hit different controls must
// not activate the button that merely happens to be under the release position.
window.addEventListener("mouseup", event => {
  if (event.button !== 0) return;
  const id = event.target === canvas ? canvasButtonAt(viewPoint(event)) : undefined;
  canvasButtonActivation = id && id === canvasButtonPress ? id : undefined;
  canvasButtonPress = undefined;
});
canvas.addEventListener("click", event => {
  if (event.button !== 0 || inventorySuppressClick || shopSuppressClick) return;
  const id = canvasButtonAt(viewPoint(event));
  if (id && id === canvasButtonActivation) void audio.effect("UI/BtMouseClick");
});

/** Where the pointer is (surface pixels), so the item tooltip can follow it. */
let pointerAt;

canvas.addEventListener("mousemove", (event) => {
  const point = viewPoint(event);
  pointerAt = point;
  if (modalOpen() || itemDrag || quickDrag) return;
  if (equipPanel.hit(point.x, point.y) && !shopWindowAt(point.x, point.y))
    return;
  if (shopScrollDrag !== undefined) {
    const { side, offset } = shopScrollDrag;
    const geometry = shopScrollbarGeometry(side);
    if (geometry !== undefined) {
      const position =
        point.y - shopAt.y - SHOP.scrollbar[side].y - VSCR_CELL - offset;
      setShopScroll(
        side,
        Math.round((position * geometry.max) / geometry.travel),
      );
    }
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
      return;
    }
  }
  if (messengerScrollDrag) {
    messengerScroll.moveTo(point.y - messengerAt.y);
    return;
  }
  if (messengerDrag) {
    if (
      !messengerDrag.moved &&
      Math.abs(point.x - messengerDrag.startX) + Math.abs(point.y - messengerDrag.startY) > 3
    )
      messengerDrag.moved = true;
    if (messengerDrag.moved) {
      messengerAt = {
        x: messengerDrag.origX + point.x - messengerDrag.startX,
        y: messengerDrag.origY + point.y - messengerDrag.startY,
      };
    }
    return;
  }
  if (tradeScrollDrag) {
    // sub_4526A0: the thumb follows the pointer proportionally inside the 180 px travel.
    tradeLogScroll.moveTo(point.y - tradeAt.y);
    return;
  }
  if (tradeDrag) {
    if (
      !tradeDrag.moved &&
      Math.abs(point.x - tradeDrag.startX) + Math.abs(point.y - tradeDrag.startY) > 3
    )
      tradeDrag.moved = true;
    if (tradeDrag.moved)
      tradeAt = {
        x: Math.max(0, Math.min(800 - TRADE_WINDOW.width, Math.round(point.x - tradeDrag.dx))),
        y: Math.max(0, Math.min(600 - TRADE_WINDOW.height, Math.round(point.y - tradeDrag.dy))),
      };
    return;
  }
  const messengerHit = messengerOpen
    ? messengerWindowAt(point.x, point.y, messengerAt, true, messengerScroll)
    : undefined;
  messengerHover = messengerOpen
    ? messengerHit?.kind === "close"
      ? "close"
      : undefined
    : messengerButtonAt(point)
      ? "button"
      : undefined;
  const tradeHit = tradeOpen ? tradeWindowAt(point.x, point.y, tradeAt, tradeModel.room, tradeLogScroll) : undefined;
  if (tradeHit !== undefined) {
    tradeHover = tradeHit.kind;
    tradeHoverOffer = tradeHit.kind === "slot" && tradeHit.occupied ? tradeHit : undefined;
    shopHover = undefined;
    inventoryHover = undefined;
    statusHover = undefined;
    hoveredPortal = undefined;
    return;
  }
  tradeHover = tradeHoverOffer = undefined;
  const shopHit = shopWindowAt(point.x, point.y);
  if (shopHit !== undefined) {
    shopHover = shopHit;
    inventoryHover = undefined;
    statusHover = undefined;
    hoveredPortal = undefined;
    return;
  }
  shopHover = undefined;
  inventoryHover = inventoryWindowAt(point.x, point.y);
  if (inventoryHover !== undefined) {
    statusHover = undefined;
    hoveredPortal = undefined;
    return;
  }
  const button = statusButtonAt(point.x, point.y);
  statusHover = button?.action;
  hoveredPortal = button ? undefined : portalAt(point.x, point.y);
});

canvas.addEventListener("mousedown", (event) => {
  if (revivePanel.open || modalOpen() || event.button > 0) return;
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
          VSCR_CELL -
          geometry.offset,
      };
    } else if (shopHit.kind === "scrollbar") {
      // sub_4521E0: an arrow or a track zone steps once on the press, then the timer takes over.
      shopScrollPress.side = shopHit.side;
      shopScrollAct(shopHit.side, shopHit.part);
      shopScrollPress.repeat.press(shopHit.part, performance.now());
      event.preventDefault();
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
    else if (shopHit.kind === "close") shopPressed = "close";
  }
  const messengerHit = messengerOpen
    ? messengerWindowAt(point.x, point.y, messengerAt, true, messengerScroll)
    : undefined;
  if (messengerHit?.kind === "scroll") {
    messengerScroll.activate(messengerHit.zone, point.y - messengerAt.y, performance.now());
    messengerScrollDrag = true;
    event.preventDefault();
    return;
  }
  if (messengerHit?.kind === "close") {
    messengerPressed = "close";
    return;
  }
  if (messengerHit?.kind === "edit") {
    messengerSayInput.focus();
    return;
  }
  if (messengerHit?.kind === "body") {
    messengerDrag = {
      startX: point.x,
      startY: point.y,
      origX: messengerAt.x,
      origY: messengerAt.y,
      moved: false,
    };
    return;
  }
  if (!messengerOpen && messengerButtonAt(point)) {
    messengerPressed = "button";
    return;
  }
  const tradeHit = tradeOpen ? tradeWindowAt(point.x, point.y, tradeAt, tradeModel.room, tradeLogScroll) : undefined;
  if (tradeHit?.kind === "scroll") {
    // sub_4521E0: arrows step, track pages, thumb starts the drag; the sheet never drags from here.
    tradeLogScroll.activate(tradeHit.zone, point.y - tradeAt.y, performance.now());
    tradeScrollDrag = true;
    event.preventDefault();
    return;
  }
  if (tradeHit?.kind === "body")
    tradeDrag = {
      dx: point.x - tradeAt.x,
      dy: point.y - tradeAt.y,
      startX: point.x,
      startY: point.y,
      moved: false,
    };
  const hit =
    shopHit === undefined && tradeHit === undefined
      ? inventoryWindowAt(point.x, point.y)
      : undefined;
  inventoryPressed = hit?.kind === "close" ? "close" : undefined;
  if (hit?.kind === "coin") {
    coinPressed = true;
    event.preventDefault();
    return;
  }
  if (hit?.kind === "scrollbar") {
    const g = inventoryScrollbarGeometry();
    if (hit.part === "thumb" && g.max > 0) {
      inventoryScrollDrag = {
        offset: point.y - inventoryAt.y - INVENTORY.scrollbar.y - VSCR_CELL - g.offset,
      };
    } else if (g.max > 0) {
      // sub_4521E0: the bag's bar does the same as the shop's, and the thumb never repeats.
      inventoryScrollAct(hit.part);
      inventoryScrollPress.repeat.press(hit.part, performance.now());
    }
    event.preventDefault();
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
  if (!hit && beginQuickDrag(point)) { event.preventDefault(); return; }
  statusPressed = statusButtonAt(point.x, point.y)?.action;
});

function finishWindowPress(event) {
  if (event?.type === "mouseup" && event.button !== 0) return;
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
    shopSuppressClick = event?.target === canvas;
    try {
      localStorage.setItem("kms111.shopAt", JSON.stringify(shopAt));
    } catch {
      // A blocked localStorage only costs the position.
    }
  }
  if (shopScrollDrag !== undefined) shopSuppressClick = event?.target === canvas;
  shopScrollDrag = undefined;
  // sub_4522B0: the release is what clears the pressed art, wherever the pointer ended up.
  shopScrollPress.repeat.release();
  inventoryScrollPress.repeat.release();
  if (messengerDrag?.moved === true) messengerSuppressClick = event?.target === canvas;
  if (messengerScrollDrag) {
    messengerScrollDrag = false;
    messengerScroll.end();
    messengerSuppressClick = event?.target === canvas;
  }
  if (messengerPressed === "close") {
    const hit =
      messengerOpen && pointerAt ? messengerWindowAt(pointerAt.x, pointerAt.y, messengerAt, true) : undefined;
    if (hit?.kind === "close") closeMessenger();
  }
  if (messengerPressed === "button" && !messengerOpen && pointerAt && messengerButtonAt(pointerAt))
    openMessengerAt(0);
  messengerPressed = undefined;
  messengerDrag = undefined;
  if (tradeDrag?.moved === true) tradeSuppressClick = event?.target === canvas;
  if (tradeScrollDrag) {
    tradeScrollDrag = false;
    tradeLogScroll.end();
    tradeSuppressClick = event?.target === canvas;
  }
  tradeDrag = undefined;
  inventoryDrag = undefined;
  shopDrag = undefined;
  shopPressed = undefined;
  statusPressed = undefined;
  inventoryPressed = undefined;
}
window.addEventListener("mouseup", finishWindowPress);

function clearCanvasHover() {
  pointerAt = undefined;
  shopHover = inventoryHover = equipHover = statusHover = hoveredPortal = undefined;
  canvasButtonHover = undefined;
}
canvas.addEventListener("mouseleave", clearCanvasHover);
// Capture runs before equipment's own DOM hover callback, which can then install a fresh tooltip.
window.addEventListener("mousemove", event => {
  if (event.target !== canvas) clearCanvasHover();
}, {capture: true});
releaseOnInterrupt(() => {
  finishWindowPress();
  inventoryScrollDrag = itemDrag = quickDrag = undefined;
  inventorySuppressClick = shopSuppressClick = false;
  clearCanvasHover();
  canvasButtonPress = canvasButtonActivation = undefined;
  loginScreens.clearPointer();
  localActionEpoch++;
  keys.clear();
});
for (const surface of [canvas, ui.gameUi])
  surface.addEventListener("contextmenu", event => event.preventDefault());

/** Set by a finished window drag so the `click` that follows does not also hit a slot. */
let inventorySuppressClick = false;

canvas.addEventListener("dblclick", (event) => {
  if (modalOpen() || shopPending || slotPending || mesoPending) return;
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
  // sub_4697A0 msg 515 (WM_LBUTTONDBLCLK) -> sub_5122D0 -> sub_512700: a double-clicked
  // player sends c2s 0x14 with its u32 charid. Windows win over the field first (the native
  // message routing), and the original has no s2c 0x14 consumer - nothing comes back.
  if (
    point.y < STATUS_BAR.y &&
    !inventoryWindowAt(point.x, point.y) &&
    !statPanel.contains(point.x, point.y) &&
    !skillPanel.contains(point.x, point.y) &&
    !miniMapPanel.contains(point.x, point.y)
  ) {
    const world = screenToWorld(point, camera, renderSurface.viewport());
    for (const user of users.values())
      if (playerContains(user, playerHitHistory.get(user), world)) {
        send({ t: "player-info", name: user.name });
        return;
      }
  }
  const hit = inventoryWindowAt(point.x, point.y);
  if (hit?.kind !== "slot" || hit.item === undefined) return;
  if (inventoryTab === 1) {
    void wearItem(hit.item, hit.slot);
    return;
  }
  // `sub_462DC0` uses a USE-tab item on a double click; the family is the first three digits.
  if (inventoryTab !== 2) return;
  useBagItem(hit.item, consumeUseRoute(hit.item.itemId));
});

canvas.addEventListener("click", (event) => {
  if (event.button !== 0) return;
  if (revivePanel.open || modalOpen()) return;
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
  if (tradeSuppressClick) {
    tradeSuppressClick = false;
    return;
  }
  const control = canvasButtonAt(point);
  const activation = canvasButtonActivation;
  canvasButtonActivation = undefined;
  if (control && control !== activation) return;
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
        isRechargeableItem(shopSellPick.itemId)
      ) {
        rechargeShopItem(shopSellPick);
      }
    } else if (shopHit.kind === "scrollbar") {
      // Nothing: the press on the way in already acted, and the timer is what repeats it. The
      // direction used to be recomputed here from localY; sub_452500 zones the trough instead.
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
  if (messengerSuppressClick) {
    messengerSuppressClick = false;
    return;
  }
  if (
    messengerOpen &&
    messengerWindowAt(point.x, point.y, messengerAt, true) !== undefined
  )
    return;
  if (!messengerOpen && messengerButtonAt(point)) return;
  const tradeHit = tradeOpen ? tradeWindowAt(point.x, point.y, tradeAt, tradeModel.room, tradeLogScroll) : undefined;
  if (tradeHit !== undefined) {
    if (tradeHit.kind === "close") tradeLeave();
    else if (tradeHit.kind === "trade") tradeConfirmAsk();
    else if (tradeHit.kind === "coin") tradeMesoAsk();
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
      // Nothing: the press on the way in already acted, and the timer is what repeats it.
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
  if (quickSlotAt(point.x, point.y) >= 0) return; // StatusBar owns these pixels, not the field below.
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
    if (modalOpen() || itemDrag || quickDrag) return;
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
    if (messengerOpen && messengerScroll.inBar(point.x - messengerAt.x, point.y - messengerAt.y)) {
      if (event.deltaY !== 0) messengerScroll.by(Math.sign(event.deltaY));
      event.preventDefault();
      return;
    }
    // sub_452340: the trade log wheel acts over the scrollbar's own rect, one line per notch.
    if (tradeOpen && tradeLogScroll.inBar(point.x - tradeAt.x, point.y - tradeAt.y)) {
      if (event.deltaY !== 0) tradeLogScroll.by(Math.sign(event.deltaY));
      event.preventDefault();
      return;
    }
    if (shop === undefined) return;
    const localX = point.x - shopAt.x;
    const localY = point.y - shopAt.y;
    for (const side of ["buy", "sell"]) {
      const list = shopListOf(side);
      if (localX < list.x || localX >= SHOP.scrollbar[side].x + VSCR_CELL) continue;
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
// Native UI/input remain 800x600. scene-surface.ts composites the world at its lens FOV
// and UI separately, each using bounded integer physical pixels. CSS/DPR layout and scroll
// share the canvas/DOM origin; no fit/downsample or fractional bitmap zoom.
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

/** The background image stack of the current map (`/api/map/<id>/art`), or undefined. */
let mapArt;
/** `archive path -> { img, ready }`; the page draws a sprite only once its PNG has arrived. */
const archiveCache = archiveImages();
let mapScene = [];
let layerOrder = sceneOrdering();
let mapGeneration = 0, mapAnimationStart = 0;
/** `look|stance|frame|flip -> { img, dx, dy, ready }` avatar frames. */
const avatarCache = avatarImages({ faceProfile: face => faceCatalog.get(face)?.data });
/** `npc templateId -> actions` and `mob templateId -> actions` from `/api/npc` and `/api/mob`. */
const entityCatalog = entityAssets({
  generation: () => mapGeneration,
  image: artImage,
  onNpc(data) {
    npcVisuals.load(data.templateId, data.actions, data.behavior, performance.now());
  },
  onError(kind, templateId, error) {
    logLine(`${kind} ${templateId}: ${String(error)}`);
  },
});
const npcArts = entityCatalog.npcActions;
const npcMetadata = entityCatalog.npcMetadata;
const mobArts = entityCatalog.mobActions;
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
/** Reward-only image anchors; inventory/shop WZ origins remain unchanged. */
const rewardPainter = dropRenderer({
  ctx,
  image: artImage,
  viewport: () => renderSurface,
  item: (id) => itemInfo.get(id),
  describe: describeItem,
});
/** The local forced attack: real WZ action, scaled delays, indices and acceptance time. */
let selfSwing;
/** `{x, y, value, start}` per damage number on screen, and `mobId -> when it was last hit`. */
const damageMarks = [];
function addDamageMark(mark){mark.order??=layerOrder(mark,ATTACK_EFFECT_Z);damageMarks.push(mark);}
const mobForces = new Map();
const mobBodyAttack = entityCatalog.bodyAttack;
const mobPushThreshold = entityCatalog.pushed;
const mobMetadata = entityCatalog.mobMetadata;
const mobWorldEffects = [];
const mobAttackFx=mobAttackEffects({metadata:id=>mobMetadata.get(id),emit(effect){
  const end=effect.start+effect.frames.reduce((n,f)=>n+f.delay,0);
  if(performance.now()>=end)return; // Cold metadata never restarts or replays an expired layer.
  for(const f of effect.frames)artImage(f.path);
  if(mobWorldEffects.length>=512)mobWorldEffects.shift();
  mobWorldEffects.push({...effect,end,order:layerOrder({},ATTACK_EFFECT_Z)});
}});
const contact = contactClock();
let contactField, contactPending, previousContactPlayer;
let contactSerial = 0,
  contactRetryAt = 0,
  lastContactAt;
let previousContactMobs = new Map();
function resetContact() {
  contact.reset();
  contactField = contactPending = previousContactPlayer = undefined;
  previousContactMobs.clear();
  contactRetryAt = 0;
  lastContactAt = undefined;
}
/** Snapshots on the 30ms contact clock, independent of UI input locks. Windows aren't invulnerability.
 * Field changes/closed sockets, dead users and dead mobs cannot initiate another touch request.
 */
function updateContact(now) {
  const elapsed = Math.max(0, now - (lastContactAt ?? now));
  lastContactAt = now;
  if (!contact.step(elapsed)) return;
  if (!self || !playerBody || map?.id !== self.mapId) {
    previousContactPlayer = undefined;
    previousContactMobs.clear();
    return;
  }
  const point = (entity) => ({
    x: Math.trunc(entity.x),
    y: Math.trunc(entity.y),
  });
  const player = point(self),
    previousPlayer = previousContactPlayer ?? player;
  const prior = previousContactMobs;
  previousContactPlayer = player;
  previousContactMobs = new Map([...mobs].map(([id, mob]) => [id, point(mob)]));
  if (
    document.hidden ||
    portalPending ||
    selfView?.hp <= 0 ||
    contactField === undefined ||
    !contact.ready ||
    contactPending ||
    now < contactRetryAt ||
    socket?.readyState !== WebSocket.OPEN
  )
    return;
  const playerRect = playerContactRect(player, previousPlayer);
  for (const [id, mob] of mobs) {
    if (dying.has(id) || mobBodyAttack.get(mob.templateId) !== true) continue;
    const frame = currentMobFrame(mob, now),
      current = point(mob),
      previousMob = prior.get(id) ?? current;
    if (
      !intersects(
        playerRect,
        mobContactRect(frame, current, facingFlip(mobRenderFacing(mob)), previousMob),
      )
    )
      continue;
    const state = stanceOfEntity(selfView, now);
    const avatar = avatarFrame(
      lookOf(selfView),
      state.stance,
      state.frame,
      facingFlip(selfView.facing),
      undefined,
      true,
    );
    contactPending = {
      contactId: ++contactSerial,
      player,
      avatar,
      impulse: contactImpulse(player, previousPlayer, current, previousMob),
    };
    send({
      t: "touch",
      contactId: contactPending.contactId,
      contactField,
      mobId: mob.mobId,
      frame: frame.path,
      facing: mobRenderFacing(mob) & 1,
      player,
      previousPlayer,
      mob: current,
      previousMob,
    });
    break; // 491FF0 takes the first intersecting live body-attacker in pool order.
  }
}

let nextSwingAt = 0;
let swingLoading = false;
let combatEpoch = 0, localActionEpoch = 0;
const combatCatalog = combatAssets({
  onAttack(profile) {
    for (const action of [...profile.melee, ...profile.shoot, ...(profile.magic??[]), ...(profile.prone ? [profile.prone] : [])])
      for (const frame of action.afterimage??[]) artImage(frame.path);
    for(const frames of Object.values(profile.hitEffects??{}))for(const frame of frames)artImage(frame.path);
    if(profile.sfx)void audio.preload(`Weapon/${profile.sfx}/Attack`);
  },
  onProjectile(frames) { for (const frame of frames) artImage(frame.path); },
});
const attackLooks = new Set();
const projectiles = [];
/** World origin of the active lens; independent from the native 800x600 UI. */
const camera = createCamera();
function clearPresentationInput() {
  playerContext.close(false);
  keys.clear();
  if (playerBody) {
    playerBody.jumpQueued = false;
    playerBody.jumpHeld = false;
  }
}
const motionSettings = motionControls({
  panel: requireElement("motion-lab", "details"),
  step: requireElement("physics-step", "select"),
  presentation: requireElement("presentation-mode", "select"),
  reset: requireElement("motion-reset", "button"),
  status: requireElement("motion-status", "p"),
  onInteract: clearPresentationInput,
  onClose() { canvas.focus(); },
});
const cameraSettings = cameraControls(
  requireElement("camera-mode", "select"),
  requireElement("camera-recenter", "button"),
  () => {
    camera.ready = false;
    canvas.focus();
  },
);

/** The local avatar's presentation vector is never written back to self or playerBody.
 * Attachments, camera and minimap share it; gameplay queries keep the authoritative body.
 */
function selfDisplayPosition() {
  return self && playerBody && map?.id === self.mapId
    ? { ...self, ...samplePlayerPosition(playerBody, motionSettings.presentation()) }
    : self;
}

const lensSettings = lensControls({
  panel: requireElement("camera-lab", "details"),
  onInteract: clearPresentationInput,
  onClose() { canvas.focus(); },
});

/** Device-pixel output is independent of logical world/UI drawing. */
const displayController = displayControls({
  canvas,
  context: requireContext2d(canvas),
  overlay: ui.gameUi,
  stage: requireElement("game-stage", "div"),
  scroll: requireElement("game-viewport", "div"),
  select: requireElement("view-scale", "select"),
  onScale: layout => gameCursor.resize(layout.deviceScale, layout.dpr),
});

/** One PNG of the archive; typed bounded cache retains shared UI preferentially. */
function artImage(path) {
  return archiveCache.get(path);
}

/**
 * Asks the server for one composed frame.
 *
 * `dx`/`dy` say where the PNG's top-left corner goes relative to the character's feet; the server
 * composes at the WZ origins, so the page never adds anchors of its own.
 */
function avatarFrame(look, stance, frame, flip, emotion, planes = false, faceFrame = 0) {
  return avatarCache.get(look, stance, frame, flip, emotion, planes, faceFrame);
}

/** Ordinary pose prewarm uses metadata indices, including reverse idle entries and weapon stance2. */
function warmBodyLook(look, profile) {
  if (!profile) return;
  const key = `${look.face}|${look.hair}|${look.items.join(".")}`;
  if (!avatarWarmLooks.has(key) || bodyWarmLooks.has(key)) return;
  if (bodyWarmLooks.size >= 64) bodyWarmLooks.delete(bodyWarmLooks.values().next().value);
  bodyWarmLooks.add(key);
  for (const stance of new Set([profile.walk, profile.stand, "jump", "ladder", "rope", "dead", "alert", "prone"])) {
    for (const index of new Set((profile.actions[stance]?.frames ?? []).map(f => f.index))) {
      for (const flip of [false,true]) avatarFrame(look, stance, index, flip, undefined, true);
    }
  }
  for (const stance of [profile.stand, "jump"]) for (const flip of [false,true])
    avatarFrame(look, stance, 0, flip, "hit", true);
}

/** One archive-backed ordinary profile per weapon; attack profiles keep their own native speed. */
function preloadAvatar(look, retainedProfile) {
  const key = `${look.face}|${look.hair}|${look.items.join(".")}`;
  faceCatalog.get(look.face);
  const body = retainedProfile ? {data:retainedProfile} : avatarMotionCatalog.get(weaponIdOf(look));
  warmBodyLook(look, body?.data); // Also handles a retry succeeding after the first look warm-up.
  if (avatarWarmLooks.has(key)) return;
  if (avatarWarmLooks.size >= 64) {
    const oldest = avatarWarmLooks.values().next().value;
    avatarWarmLooks.delete(oldest); bodyWarmLooks.delete(oldest);
  }
  avatarWarmLooks.add(key);
  if (body?.data) warmBodyLook(look, body.data);
  else if (body?.promise) void body.promise.then(profile => warmBodyLook(look, profile));
  if (!attackLooks.has(key)) {
    if (attackLooks.size >= 128) attackLooks.clear();
    attackLooks.add(key);
    void ensureAttackProfile(look).then((profile) => {
      for (const action of [...(profile?.melee ?? []), ...(profile?.shoot ?? []), ...(profile?.magic??[]), ...(profile?.prone ? [profile.prone] : [])]) {
        for (const frame of action.frameIndices) {
          avatarFrame(look, action.stance, frame, false, undefined, true);
          avatarFrame(look, action.stance, frame, true, undefined, true);
        }
      }
    });
  }
  for (const item of look.items) if (item >= 1300000 && item < 2000000) describeItem(item);
}

/** Fetches one NPC's or mob's frame table, once per template. */
function ensureEntityArt(kind, templateId) {
  void entityCatalog.load(kind, templateId);
}

/**
 * The frame of `action` to show at `now`: the archive's own delays, looping. The first frame is
 * used until the table has arrived, so an NPC appears as soon as its pictures do.
 */
function loopFrame(frames, now) {
  return animationFrame(frames, now);
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
  if(!frame)return;
  const entry = artImage(frame.path);
  if (!entry.ready) return;
  const ox = frame.ox ?? 0;
  const oy = frame.oy ?? 0;
  const w = entry.img.naturalWidth;
  const h = entry.img.naturalHeight;
  if (!visibleSprite(x, y, w, h, ox, oy, flip, renderSurface.width, renderSurface.height)) return;
  ctx.save();
  ctx.globalAlpha *= frame.alpha ?? 1;
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
  ctx.restore();
}

/** Background phase is field-relative and shared by front/back layers, never advanced per draw. */
function drawBack(back, cameraX, cameraY, now) {
  const entry = artImage(back.path);
  if (!entry.ready) return;
  const w = entry.img.naturalWidth;
  const h = entry.img.naturalHeight;
  if (w === 0 || h === 0) return;
  ctx.globalAlpha = Math.max(0, Math.min(255, back.a ?? 255)) / 255;
  for (const copy of backgroundCopies(
    back, w, h, cameraX, cameraY, now - mapAnimationStart, renderSurface.width, renderSurface.height))
    drawArchiveImage({ path: back.path, ox: back.ox ?? 0, oy: back.oy ?? 0 }, copy.x, copy.y, back.flip);
  ctx.globalAlpha = 1;
}

/** One tile/object, its animation frame picked from the map's clock. */
function drawMapSprite(sprite, cameraX, cameraY, now, flipWorld) {
  const frame = loopFrame(sprite.frames, now - mapAnimationStart);
  if (frame === undefined) return;
  const worldFlip = sprite.flip !== flipWorld;
  drawArchiveImage(frame, sprite.x - cameraX, sprite.y - cameraY, worldFlip);
}

/** UI/field ordinary actions use original weapon walk/stand choices, not attack group heuristics. */
function sampleAvatarMotion(entity, look, requested, now, y = entity?.y, facing = entity?.facing ?? 0) {
  const weapon = weaponIdOf(look);
  const profile = entity?.bodyProfile?.weaponId === weapon ? entity.bodyProfile : avatarMotionCatalog.get(weapon)?.data;
  if (entity && profile) entity.bodyProfile = profile; // Immutable data only; no async actor mutation.
  return animationPose(entity, avatarStance(requested, profile), false, now, {
    profile, key:`${look.face}|${look.hair}|${look.items.join(".")}`, y, facing,
  });
}

/** The character's stance and frame from its movement, the way the page can see it. */
function stanceOfEntity(entity, now) {
  const body = entity === selfView ? playerBody : undefined;
  if ((entity === selfView && entity.hp <= 0) || (entity !== selfView && remoteStance(entity) === "dead")) {
    if (entity === selfView) selfSwing = undefined;
    else delete entity.swing;
    return sampleAvatarMotion(entity, lookOf(entity), "dead", now, body?.y ?? entity.y, body?.facing ?? entity.facing);
  }
  if (body?.ladder) {
    selfSwing = undefined; // an old attack must never draw standing parts over a climbing pose
    return sampleAvatarMotion(entity, lookOf(entity), locomotion(body), now, body.y, body.facing);
  }
  if (!body && entity !== selfView && ["ladder", "rope"].includes(remoteStance(entity))) {
    delete entity.swing;
    return sampleAvatarMotion(entity, lookOf(entity), remoteStance(entity), now);
  }
  // The wire carries the actual attack action. Use the body WZ's scaled delay per frame,
  // including every shoot2 frame, instead of stretching every motion into 480ms.
  const swing = entity === selfView ? selfSwing : entity.swing;
  if (swing !== undefined) {
    const frame = attackFrame(swing, now);
    if (frame >= 0) {
      delete entity.animation; // 508700 changes actions; returning to idle starts its first frame.
      return { stance: swing.stance, frame: attackCanvasFrame(swing, frame) };
    }
    if (entity === selfView) selfSwing = undefined;
    else delete entity.swing;
  }
  const stance = body ? locomotion(body) : remoteStance(entity);
  return sampleAvatarMotion(entity, lookOf(entity), stance, now,
    body?.y ?? entity.y, body?.facing ?? entity.facing);
}

/** One face clock for field actors, character slots and the creation preview. No body-clock reset. */
function sampleAvatarFace(entity, look, now) {
  return facePose(entity, `${look.face}|${look.hair}|${look.items.join(".")}`,
    faceCatalog.get(look.face)?.data, now);
}

/** An avatar at `(screenX, screenY)`; native WZ faces left, right-facing pictures are mirrored. */
function drawAvatarAt(entity, screenX, screenY, now, flip, position = entity) {
  const dead = deathFx.get(entity.characterId);
  // 509AF0 tomb z=-1 is an OVERLAY CHILD of the avatar, not an independent world z-1.
  // It belongs behind this avatar's body, but not behind another root with a smaller z.
  const tomb = dead && deathFx.tomb(entity.characterId, now);
  if (tomb?.frame) {
    drawArchiveImage(tomb.frame, screenX + tomb.x - position.x, screenY + tomb.y - position.y, false);
  }
  const pendingSwing = dead ? undefined : entity === selfView ? selfSwing : entity.swing;
  const swing = pendingSwing && attackFrame(pendingSwing, now) >= 0 ? pendingSwing : undefined;
  const direction = swing ? !swing.facingLeft : flip;
  ctx.save();
  if (dead) {
    const pose = deathPose(dead, now);
    screenX += pose.x - position.x;
    screenY += pose.y - position.y;
    ctx.globalAlpha *= pose.alpha;
  }
  if (entity === selfView && selfView.hp > 0 && contact.tinted) ctx.filter = "brightness(0.5019607843137255)";
  // 507A20: the independent weapon afterimage is user+380, overlay child5 (not +368 child1).
  drawAvatarBodyAt(entity, screenX, screenY, now, direction);
  ctx.restore();
  if(!dead)drawWeaponAfterimage(entity,screenX,screenY,now);

}

function drawAvatarBodyAt(entity, screenX, screenY, now, flip) {
  const look = lookOf(entity);
  const state = stanceOfEntity(entity, now);
  preloadAvatar(look, entity.bodyProfile?.weaponId === weaponIdOf(look) ? entity.bodyProfile : undefined);
  const face = sampleAvatarFace(entity, look, now);
  let frame = avatarFrame(look, state.stance, state.frame, flip, face.emotion, true, face.frame);
  const attackPose = /^(swing|stab|shoot|proneStab)/.test(state.stance);
  // Cold facial art must not replace the body action with stand1 or a gray box.
  if (!frame.ready) frame = avatarFrame(look, state.stance, state.frame, flip, undefined, true);
  const draw = (entry) => {
    entity.chatOriginY=entry.damageOriginY;
    const x = Math.round(screenX + entry.dx), y = Math.round(screenY + entry.dy);
    const h = entry.planeHeight, w = entry.img.naturalWidth;
    if (h > 0 && entry.img.naturalHeight === h * 2) {
      ctx.drawImage(entry.img, 0, 0, w, h, x, y, w, h);
      ctx.drawImage(entry.img, 0, h, w, h, x, y, w, h);
    } else {
      ctx.drawImage(entry.img, x, y);
    }
  };
  if (frame.ready) { draw(frame); return; }
  const idleStance = entity.bodyProfile?.weaponId === weaponIdOf(look) ? entity.bodyProfile.stand : "stand1";
  if (state.stance !== idleStance && !attackPose) {
    const stand = avatarFrame(look, idleStance, 0, flip, undefined, true);
    if (stand.ready) { draw(stand); return; }
  }
  ctx.fillStyle = "rgba(120, 170, 210, 0.35)";
  ctx.fillRect(Math.round(screenX) - 9, Math.round(screenY) - 42, 18, 42);
}

function mobRenderFacing(mob){
  return mobForcedPose(mobArts.get(mob.templateId),mobForces.get(String(mob.mobId)),performance.now())?.facing??mob.facing;
}
/** Corpse wins; hit and attack forced layers run once on the separate 30ms sprite clock. */
function currentMobFrame(mob, now) {
  const id = String(mob.mobId),
    actions = mobArts.get(mob.templateId);
  if (!actions) return undefined;
  const once = (frames, elapsed) => animationFrame(frames, elapsed, false);
  const corpseSince = dying.get(id);
  if (corpseSince !== undefined) {
    mob.dieAction??=mobDieAction(actions);
    return once(actions[mob.dieAction],now-corpseSince);
  }
  const hit=mobForces.get(id),pose=mobForcedPose(actions,hit,now);
  if(pose)return once(pose.frames,pose.elapsed);
  if(hit){
    mob.actionSince=hit.since+(actions[mobForcedName(hit.action)]??[]).reduce((n,f)=>n+f.delay,0);
    mobForces.delete(id);
  }
  return playAction(
    actions,
    mobLocomotion(mob, actions),
    now - (mob.actionSince ?? 0),
  );
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
  entityKey,
  actionSince = 0,
) {
  ensureEntityArt(kind, templateId);
  if (kind === "mob") {
    const mob = mobs.get(entityKey);
    const frame = mob && currentMobFrame(mob, now);
    if (frame) drawArchiveImage(frame, x, y, facingFlip(mobRenderFacing(mob)));
    return;
  }
  const frame = npcVisuals.frame(Number(entityKey),now);
  if (frame === undefined) return;
  drawArchiveImage(frame, x, y, npcVisuals.flip(Number(entityKey),now)??facingFlip(facing));
}

/* --------------------------------------------------------------------------------------------
 * The 2003 status bar. `STATUS_BAR` (the 392 window, its three `base/N` plates and its five `Bt*`
 * buttons), `statusBarButtonAt`, `preloadStatusBar`, `statusText` and `drawStatusGauge` now live in
 * client/hud.ts next to the rest of that window's geometry (`STATUS_GAUGES`, `gaugeFill`,
 * `statusVitalText`); the job name is client/jobs.ts's `jobNameOf`, next to the table it reads.
 * What stays here is the state: which button the cursor is over and which one a press started on.
 * ------------------------------------------------------------------------------------------ */

/** The `Bt*` action the cursor is over, and the one a press started on. */
let statusHover;
let statusPressed;

/** The bar's button at a surface point, or `undefined` while there is no local player. */
function statusButtonAt(x, y) {
  if (!selfView) return undefined;
  return statusBarButtonAt(x, y);
}

preloadStatusBar(artImage);

function statusText(text, x, y, align = "left") {
  paintStatusText(ctx, text, x, y, align);
}

function drawStatusGauge(key, value, max) {
  paintStatusGauge(ctx, artImage, key, value, max);
}


/** 512570's 200ms guard; the server still owns validation and consumption. */
let quickProfile, quickOwner, nextBagUseAt = 0;
function loadQuickItems() {
  const owner = JSON.stringify([ui.user.value, selfView.characterId, selfView.name]);
  if (owner === quickOwner) return;
  resetWhisper();
  quickDrag = undefined;
  quickOwner = owner;
  let storage;
  try { storage = localStorage; } catch {}
  quickProfile = quickItemProfile(storage, owner);
}
/**
 * `sub_462DC0` / `sub_512570` -> `sub_55B2C0` (`0x18`) or `sub_55B4B0` (`0x19`).
 *
 * `route` is the caller's own family test, not a second guess: only the inventory double click
 * reaches the `203` return-scroll sender, and each sender keeps its own gate (200 ms / 500 ms).
 * Which opcode goes out is then `ClientSession.useItem`'s business - it is the family that decides.
 */
function useBagItem(item, route) {
  const now = performance.now();
  if (!item || route.kind === "none" || loginScreens.stage !== "game" || !visualFieldActive ||
      !selfView || selfView.hp <= 0 ||
      portalPending || itemDrag || quickDrag || modalOpen() || browserLabOpen() || shop !== undefined ||
      talkingNpc !== undefined || shopPending || slotPending || mesoPending ||
      now < nextBagUseAt) return;
  nextBagUseAt = now + route.cooldownMs;
  pendingUse = { slot: item.slot, itemId: item.itemId, quantity: item.quantity ?? 1, at: now };
  send({ t: "use", slot: item.slot, itemId: item.itemId });
}
function drawQuickItems() {
  if (!quickProfile) return;
  ctx.save();
  quickProfile.values().forEach((id, index) => {
    if (!id) return;
    const slot = QUICK_SLOTS[index];
    if(quickSkillAllowed(id)) {
      const data=combatCatalog.peekSkill(id.skillId);if(!data)void combatCatalog.skill(id.skillId);
      const a=artImage(skillIconPath(id.skillId));
      if(a.ready){const at=quickSlotIconOrigin(slot,data?.icon);
        ctx.save();if(!skillPanel.level(id.skillId))ctx.globalAlpha*=0.4;
        ctx.drawImage(a.img,at.x,at.y);ctx.restore();}
      return;
    }
    // An unlearned level fades the icon; an item's stack count rides under it (4FC440/4FC180).
    const facts = itemInfo.get(id);
    if (facts === undefined) void describeItem(id);
    if (facts?.icon) {
      const icon = artImage(facts.icon.path);
      if (icon.ready) {
        const at = quickSlotIconOrigin(slot, facts.icon);
        ctx.drawImage(icon.img, at.x, at.y);
      }
    }
    const {quantity} = quickItemState(inventory, id);
    drawItemNo(ctx, artImage, quantity, slot.x, slot.y + ITEM_NO_CELL_TOP);
  });
  ctx.restore();
}

function drawStatusBar() {
  if (!selfView) return;
  for (const piece of [STATUS_BAR.panel, STATUS_BAR.chat, STATUS_BAR.keys]) {
    const entry = artImage(piece.path);
    if (entry.ready) ctx.drawImage(entry.img, piece.x, piece.y);
  }
  drawStatusGauge("hp", selfView.hp, effectiveSelf().maxHp);
  drawStatusGauge("mp", selfView.mp, effectiveSelf().maxMp);
  drawStatusGauge("exp", selfView.exp, selfView.expToNext ?? 0);
  for (const button of STATUS_BAR.buttons) {
    let state = "normal";
    if (statusPressed === button.action && statusHover === button.action) state = "pressed";
    else if (statusHover === button.action) state = "mouseOver";
    const entry = artImage(`UI/StatusBar.img/${button.name}/${state}/0`);
    if (entry.ready)
      ctx.drawImage(entry.img, button.x, STATUS_BAR.y + button.y);
  }
  ctx.fillStyle = "#869eaa"; // 4FB440: ARGB FF869EAA, 20x12 at local (214,190).
  ctx.fillRect(214, STATUS_BAR.y + 190, 20, 12);
  statusText(`${expPercent(selfView.exp, selfView.expToNext ?? 0)}%`, 214, STATUS_BAR.y + 190);
  drawQuickItems();
  drawMessengerButton();
  drawWhisperRecipient();
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
  if (button.action === "skill") {
    skillPanel.toggle();
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
  if (button.action === "menu") { systemPanel.open(); return; }
  if (button.action === "whisper") { pickWhisperRecipient(); return; }
  logLine(`${button.name}：這個原版視窗還沒接上來。`);
}

/** Shared by keydown queueing and controller sampling, so a sub-frame jump cannot leak
 * from a focused input/modal/hidden document into the next gameplay update. */
/** Browser-only experiment panels share one input gate; none pauses the simulation. */
function browserLabOpen() {
  return testToolsPanel.open || motionSettings.open || lensSettings.open;
}
/** The three native modals that own the screen one at a time: an item dialog, the system menu and
 * the player context menu. The field takes no input while any of them is up. */
function modalOpen() {
  return itemDialog.open || systemPanel.visible || playerContext.open;
}
function movementBlocked() {
  return document.hidden || !document.hasFocus() || portalPending || modalOpen() || browserLabOpen() || selfView?.hp <= 0 || shop !== undefined ||
    talkingNpc !== undefined || isEditingControl(document.activeElement);
}
function frame() {
  displayController.refresh();
  feedback.tick();
  const enabled = !!canSendEmotion();
  if (enabled !== emoteAvailable) {
    emoteAvailable = enabled;
    for (const button of ui.emotes.children) button.disabled = !enabled;
  }
  if (loginScreens.stage !== "game") {
    renderSurface.beginUi(true);
    loginScreens.draw(performance.now());
    itemDialog.draw();
    renderSurface.presentUi();
    requestAnimationFrame(frame);
    return;
  }
  const now = performance.now();
  tickScrollPresses(now);
  testToolsPanel.tick(now);
  npcVisuals.tick(now);
  const elapsed = Math.max(0, Math.min(250, now - (lastPhysicsAt ?? now)));
  lastPhysicsAt = now;
  if (playerBody && self && map?.id === self.mapId) {
    playerBody.dead = selfView?.hp <= 0;
    if (playerBody.dead) clearAttackAlert(playerBody);
    else advanceAttackAlert(playerBody, now);
    const blocked = movementBlocked();
    const attackLocked =
      selfSwing && attackFrame(selfSwing, now) >= 0;
    const groundJumps = playerBody.groundJumps;
    advancePlayer(
      playerBody,
      {
        disabled: blocked,
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
        ...(!blocked && attackLocked ? forcedAttackInput(selfSwing.action) : {}),
        ...effectiveMovement(now),
      },
      terrain,
      elapsed,
      motionSettings.stepMs(),
    );
    if (playerBody.groundJumps !== groundJumps)
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
  if (!portalPending) recovery.step(elapsed);
  for (const mob of mobs.values()) {
    sampleMotion(mob, now, terrain);
    const action = mobLocomotion(mob, mobArts.get(mob.templateId) ?? {});
    if (mob.locomotion !== action || mob.actionSince === undefined) mob.actionSince = now;
    mob.locomotion = action;
    mob.walking = action === "move";
  }
  for(const npc of npcs.values()) {
    sampleMotion(npc,now,terrain);npcVisuals.locomotion(npc.npcId,npc.action??npc.facing,now);
  }
  if (selfView) stanceOfEntity(selfView, now);
  for (const user of users.values()) {
    playerHitHistory.set(user,{x:user.x,y:user.y});
    movementFace(user, now);
    sampleMotion(user, now, terrain);
    stanceOfEntity(user, now); // Native ordinary clocks also update off-screen, not only on draw.
    const dead = remoteStance(user) === "dead";
    if (dead) delete user.swing;
    if (visualFieldActive) deathFx.observe(user.characterId, dead, user, now);
  }
  const displaySelf = selfDisplayPosition();
  if (visualFieldActive && selfView && playerBody && self && map?.id === self.mapId)
    deathFx.observe(selfView.characterId, selfView.hp <= 0, displaySelf, now, selfDeathSettled);
  updateContact(now);
  const lens = lensSettings.sample(now, displayController.layout().deviceScale);
  reframeCamera(camera, renderSurface.viewport(), lens.viewport);
  renderSurface.beginWorld(lens.viewport);
  updateCamera(
    camera,
    displaySelf ?? { x: 0, y: 0 },
    cameraSettings.mode(),
    elapsed,
    lens.viewport.width,
    lens.viewport.height,
    mapArt?.bounds,
    playerBody,
  );
  const cameraX = camera.x;
  const cameraY = camera.y;

  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, renderSurface.width, renderSurface.height);

  // Root layers use native z + sequence. Avatar children remain grouped with their parent.
  const actors = [];
  for (const npc of npcs.values()) actors.push({ kind: "npc", y: npc.y, npc });
  for (const mob of mobs.values()) actors.push({ kind: "mob", y: mob.y, mob });
  for (const user of users.values())
    actors.push({ kind: "user", y: user.y, user });
  if (displaySelf && selfView) actors.push({ kind: "self", y: displaySelf.y, self: displaySelf });
  // Actors belong to their foothold page/group, NOT one global "between layers 2 and 3" slot.
  const scene = [];
  for (const actor of actors) {
    const entity =
      actor.kind === "self" ? (playerBody ?? self) : actor[actor.kind];
    const z = actorDepth(entity, terrain, actor.kind);
    scene.push({ ...actor, z, order: layerOrder(entity, z) });
  }
  // Original CPortalList uses a fixed front-plane z; drops use their landing foothold's page/group.
  // Do not paint either before all the tiles: that hides them behind ordinary ground sprites.
  scene.push({ kind: "portals", y: 0, z: 250110, order: 0 }); // sub_4A3920: -1073471724 relative to tile base
  for (const [key, record] of drops) {
    const z = actorDepth(record.drop, terrain, "drop");
    scene.push({ kind: "drop", key, record, y: record.drop.y, z, order: layerOrder(record, z) });
  }
  for (let i = projectiles.length - 1; i >= 0; i--)
    if (now - projectiles[i].releaseAt >= projectiles[i].duration) projectiles.splice(i, 1);
  for (const shot of projectiles)
    if (now >= shot.releaseAt) scene.push({ kind: "projectile", shot, z: shot.z, y: 0, order: layerOrder(shot, shot.z) });
  for(const [id,speech] of speechBalloons.active(now)) {
    const entity=id===selfView?.characterId?selfView:users.get(String(id));
    const position=id===selfView?.characterId?displaySelf:entity;
    if(entity&&position)scene.push({kind:'speech',entity,position,id,z:250210,y:0,order:layerOrder(speech,250210)});
  }
  for(const [id,speech] of npcBalloons.active(now)) {
    const npc=npcs.get(String(id));if(npc)scene.push({kind:'npc-speech',npc,id,z:250210,y:0,order:layerOrder(speech,250210)});
  }
  for(const entity of weaponEffects.keys())if(entity!==selfView&&users.get(String(entity.characterId))!==entity)weaponEffects.delete(entity);
  for(let i=damageMarks.length-1;i>=0;i--)if(now-damageMarks[i].start>=1000)damageMarks.splice(i,1);
  for(const mark of damageMarks)scene.push({kind:'damage',mark,z:ATTACK_EFFECT_Z,y:0,order:mark.order??layerOrder(mark,ATTACK_EFFECT_Z)});
  for(let i=skillEffects.length-1;i>=0;i--){const effect=skillEffects[i];
    const entity=effect.characterId===selfView?.characterId?selfView:users.get(String(effect.characterId));
    if(now>=effect.end||!entity||(effect.entity&&entity!==effect.entity)||deathFx.get(effect.characterId)||JSON.stringify(lookOf(entity))!==effect.lookKey){skillEffects.splice(i,1);continue;}
    if(now>=effect.start)scene.push({kind:'skill-effect',effect,position:entity===selfView?displaySelf:entity,z:ATTACK_EFFECT_Z,y:0,order:effect.order??(effect.order=layerOrder(effect,ATTACK_EFFECT_Z))});
  }
  for(let i=skillHitEffects.length-1;i>=0;i--)if(now>=skillHitEffects[i].end)skillHitEffects.splice(i,1);
  for(const effect of skillHitEffects)if(now>=effect.start)scene.push({kind:'hit-effect',effect,z:ATTACK_EFFECT_Z,y:0,order:effect.order});
  const mobActors=[...(self&&selfView?[{id:selfView.characterId,x:self.x,y:self.y,facing:selfView.facing,previous:previousContactPlayer}]:[]),
    ...[...users.values()].map(u=>({id:u.characterId,x:u.x,y:u.y,facing:u.facing??(u.action&1)}))];
  for(const ball of mobAttackFx.step(now,mobs,mobActors)){
    const owner=mobs.get(ball.owner),z=actorDepth(owner,terrain,'mob');
    scene.push({kind:'mob-ball',ball,z,y:0,order:layerOrder(ball,z)});
  }
  for(let i=mobWorldEffects.length-1;i>=0;i--){
    const e=mobWorldEffects[i];if(now>=e.end){mobWorldEffects.splice(i,1);continue;}
    if(e.kind==='effect'){
      const owner=mobs.get(e.owner);if(owner){e.x=owner.x;e.y=owner.y;}
    }else{
      const actor=mobActors.find(a=>a.id===e.actorId);if(!actor){mobWorldEffects.splice(i,1);continue;}
      const position=actor.id===selfView?.characterId?displaySelf:actor;
      e.x=position.x;e.y=position.y-30;
    }
    scene.push({kind:'mob-world-effect',effect:e,z:ATTACK_EFFECT_Z,y:0,order:e.order});
  }
  for (const actor of mergeScene(mapScene, scene)) {
    if(actor.kind==='mob-ball'){
      const b=actor.ball;drawArchiveImage(animationFrame(b.frames,now-b.start),b.x-cameraX,b.y-cameraY,false);continue;
    }
    if(actor.kind==='mob-world-effect'){
      const e=actor.effect;drawArchiveImage(oneShotFrame(e.frames,now-e.start),e.x-cameraX,e.y-cameraY,e.flip);continue;
    }
    if (actor.kind === "back") { drawBack(actor.back, cameraX, cameraY, now); continue; }
    if (actor.kind === "projectile") { drawProjectile(actor.shot, cameraX, cameraY, now); continue; }
    if(actor.kind==='npc-speech') {
      npcBalloons.draw(ctx,actor.id,actor.npc.x-cameraX,actor.npc.y-cameraY,npcVisuals.originY(actor.id),false,now);
      continue;
    }
    if(actor.kind==='speech'){
      speechBalloons.draw(ctx,actor.id,actor.position.x-cameraX,actor.position.y-cameraY,
        actor.entity.chatOriginY,(actor.entity.hp!==undefined?actor.entity.hp<=0:(actor.entity.action&~1)===18),now);
      continue;
    }
    if(actor.kind==='skill-effect'){drawSkillLayer(actor.effect,actor.position.x-cameraX,actor.position.y-cameraY,now);continue;}
    if(actor.kind==='hit-effect'){const e=actor.effect;drawArchiveImage(oneShotFrame(e.frames,now-e.start),e.x-cameraX,e.y-cameraY,e.flip);continue;}
    if(actor.kind==='damage'){damageArt.draw(ctx,actor.mark,cameraX,cameraY,now);continue;}
    if (actor.kind === "portals") {
      drawPortals(cameraX, cameraY, now - mapAnimationStart);
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
        ? actor.self.x - cameraX
        : actor.kind === "mob"
          ? actor.mob.x - cameraX
          : actor.kind === "npc"
            ? actor.npc.x - cameraX
            : actor.user.x - cameraX;
    const y = actor.y - cameraY;
    if (x < -200 || x > renderSurface.width + 200 || y < -300 || y > renderSurface.height + 300) continue;
    if (actor.kind === "npc") {
      drawEntitySprite(
        "npc",
        actor.npc.templateId,
        x,
        y,
        actor.npc.facing ?? 0,
        false,
        now,
        String(actor.npc.npcId),
        mapAnimationStart,
      );
      // 498CF0 passes font index 3 to CLife::47D110; 527720(3) = Gulim 12, FFFFFF20.
      // 499D60 hides the name while the real balloon exists. Cold browser art must not leave BOTH invisible.
      if(!npcVisuals.speaking(actor.npc.npcId,now)||!npcBalloons.visible(actor.npc.npcId,npcVisuals.originY(actor.npc.npcId),now))
        drawName(npcMetadata.get(actor.npc.templateId)?.name, x, y, "#ffff20");
    } else if (actor.kind === "mob") {
      const moved = actor.mob.walking === true;
      drawEntitySprite(
        "mob",
        actor.mob.templateId,
        x,
        y,
        actor.mob.facing ?? 0,
        moved,
        now,
        String(actor.mob.mobId),
        actor.mob.actionSince,
      );
    } else if (actor.kind === "self") {
      drawAvatarAt(selfView, x, y, now, facingFlip(selfView.facing), actor.self);
      drawName(selfView.name, x, y);
    } else {
      drawAvatarAt(actor.user, x, y, now, facingFlip(actor.user.facing));
      drawName(actor.user.name, x, y);
    }
  }

  renderSurface.presentWorld(lens.cover, lens.style);
  renderSurface.beginUi();
  drawMapTitle(ctx, artImage, mapArt?.title);
  drawTemporaryStats(ctx, artImage, buffs.icons(now));
  miniMapPanel.draw(now);
  drawStatusBar();
  drawInventoryWindow();
  equipPanel.draw();
  drawShopWindow();
  statPanel.draw();
  skillPanel.draw();
  if (pointerAt !== undefined) {
    // Re-hit current state, not the object captured on the last mousemove/selection. Inventory
    // replies, scrolling and shop reconciliation can change the row under a stationary pointer.
    const shopHit = shopWindowAt(pointerAt.x, pointerAt.y);
    const equipHit = equipPanel.hit(pointerAt.x, pointerAt.y);
    const bagHit = inventoryWindowAt(pointerAt.x, pointerAt.y);
    const pointed = shopHit ? shopHit.row : equipHit ? equipHit.item : bagHit ? bagHit.item : quickHoverItem();
    const tipSource = shopHit ? 'shop' : equipHit ? 'equip' : bagHit ? 'inventory' : 'quick';
    if (talkingNpc === undefined && !portalPending && selfView?.hp > 0 && !itemDrag && !quickDrag && !modalOpen() && !browserLabOpen() &&
        !statPanel.contains(pointerAt.x, pointerAt.y) && !skillPanel.contains(pointerAt.x, pointerAt.y)) {
      if(pointed?.skill){const at=tooltipAnchor('skill',pointerAt.x,pointerAt.y);nativeTips.skill(at.x,at.y,pointed.skill,pointed.level);}
      else drawItemTooltip(pointerAt.x, pointerAt.y, pointed, tipSource);
    }
    if (talkingNpc === undefined && !portalPending && selfView?.hp > 0 && !itemDrag && !quickDrag && !modalOpen() && !browserLabOpen() && !pointed &&
        !inventoryWindowAt(pointerAt.x, pointerAt.y) && !shopWindowAt(pointerAt.x, pointerAt.y) &&
        !equipPanel.hit(pointerAt.x, pointerAt.y) && !statPanel.contains(pointerAt.x, pointerAt.y) &&
        !skillPanel.contains(pointerAt.x, pointerAt.y)) {
      const line = statusVitalText(pointerAt.x, pointerAt.y, selfView, effectiveSelf());
      if (line) drawSimpleTooltip(ctx, pointerAt.x + 20, pointerAt.y + 20, line);
    }
  }

  drawDraggedItem();
  drawQuickDrag();
  if (messengerOpen) {
    messengerView.draw(messengerAt, messengerModel.room, {
      hover: messengerHover,
      pressed: messengerPressed,
    }, messengerScroll);
    positionMessengerInput();
    const now = performance.now();
    messengerTypingCheck(now);
    // sub_4523D0: the captured scrollbar's OnTimer re-hits the live cursor zone every tick
    // and repeats the pressed arrow/page through sub_4524C0's 50 ms gate.
    if (messengerScrollDrag && pointerAt)
      messengerScroll.tick(now, pointerAt.x - messengerAt.x, pointerAt.y - messengerAt.y);
  }
  if (tradeOpen) {
    tradeView.draw(tradeAt, tradeModel.room, {
      hover: typeof canvasButtonHover === "string" && canvasButtonHover.startsWith("trade:")
        ? canvasButtonHover.slice(6)
        : tradeHover === "close" || tradeHover === "trade" || tradeHover === "coin"
          ? tradeHover
          : undefined,
      pressed: typeof canvasButtonPress === "string" && canvasButtonPress.startsWith("trade:")
        ? canvasButtonPress.slice(6)
        : undefined,
    }, tradeLogScroll);
    // The same CCtrlScrollBar OnTimer repeat as the messenger log (sub_4523D0/sub_4524C0).
    if (tradeScrollDrag && pointerAt)
      tradeLogScroll.tick(performance.now(), pointerAt.x - tradeAt.x, pointerAt.y - tradeAt.y);
  }
  systemPanel.draw();
  playerContext.draw();
  drawScreenMessages(ctx, feedback.rows(now));
  itemDialog.draw();
  npcDialog.draw();
  if (tradeOpen && tradeHoverOffer && pointerAt && !itemDialog.open && talkingNpc === undefined) {
    const room = tradeModel.room;
    const side = room?.sides[tradeHoverOffer.theirs ? (room.myIndex === 0 ? 1 : 0) : room.myIndex];
    const offer = side?.offers.get(tradeHoverOffer.roomSlot);
    if (offer) drawItemTooltip(pointerAt.x, pointerAt.y, offer.item, "trade");
  }
  tooltipViewer.draw();
  revivePanel.draw(now);
  renderSurface.presentUi();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/** One reward-pool entry, in the same z-space as the map and characters. */
function drawDrop(key, record, cameraX, cameraY, now) {
  const taker =
    record.takenBy === selfView?.characterId
      ? selfDisplayPosition()
      : users.get(String(record.takenBy));
  const at = dropPosition(record, now, taker);
  if (at === undefined) {
    drops.delete(key);
    return;
  }
  rewardPainter.draw(record.drop, at, { x: cameraX, y: cameraY }, now);
}

function playWeaponSound(entity,profile,motion,start){
  if(!profile?.sfx)return;
  const field=self,epoch=combatEpoch,lookKey=JSON.stringify(lookOf(entity)),local=entity===selfView;
  const sound=`Weapon/${profile.sfx}/Attack`;void audio.preload(sound);
  const due=start+shotRelease(motion),deadline=due+Math.max(200,(motion.afterimage??[]).reduce((n,f)=>n+f.delay,0));
  const valid=()=>self===field&&combatEpoch===epoch&&(local?selfView===entity:users.get(String(entity.characterId))===entity)&&
    !deathFx.get(entity.characterId)&&JSON.stringify(lookOf(entity))===lookKey;
  const play=()=>{if(!valid())return;const p=local?self:entity;
    void audio.effect(sound,spatialVolume(p.x,p.y,self),{deadline,valid});};
  const wait=due-performance.now();if(wait>0)setTimeout(play,wait);else play();
}

/** Shared bounded metadata only. No promise captures an actor or resurrects a cleared cache. */
function ensureAttackProfile(look) { return combatCatalog.attack(weaponIdOf(look)); }
function ensureProjectileFrames(itemId) { return combatCatalog.projectile(itemId).then(frames => frames ?? []); }
const skillEffects=[],skillHitEffects=[];
const weaponEffects=new Map();
const activePredictions=attackPredictions();
function oneShotFrame(frames,elapsed) {
  if(elapsed<0)return;
  if(!frames?.length||elapsed>=frames.reduce((n,f)=>n+f.delay,0))return;
  return animationFrame(frames,elapsed,false);
}
async function preloadSkillArt(data,level) {
  const art=data?.arts?.[level];if(!art)return;
  if(art.useSound)void audio.preload(art.useSound);
  const pictures=[...art.effects,...(art.balls??[]),...(art.hitVariants?.flat()??art.hits)].map(f=>artImage(f.path));
  await Promise.all(pictures.map(p=>p.loading));
  return pictures.every(p=>p.ready)?art:undefined;
}
async function playSkillEffect(characterId,skillId,level,start,soundDeadline=Infinity) {
  const field=self,epoch=combatEpoch,entity=characterId===selfView?.characterId?selfView:users.get(String(characterId));
  if(!entity)return;
  const lookKey=JSON.stringify(lookOf(entity)),flip=facingFlip(entity.facing),order=layerOrder({},ATTACK_EFFECT_Z);
  let flash;
  if(skillId===1001003||skillId===2001003){
    const state=stanceOfEntity(entity,start);
    flash=avatarFrame(lookOf(entity),state.stance,state.frame,facingFlip(entity.facing));
  }
  const data=await combatCatalog.skill(skillId),art=await preloadSkillArt(data,level);
  if(flash)await flash.loading;
  const current=characterId===selfView?.characterId?selfView:users.get(String(characterId));
  if(self!==field||combatEpoch!==epoch||!art||deathFx.get(characterId)||!current||
    (characterId!==selfView?.characterId&&current!==entity)||JSON.stringify(lookOf(current))!==lookKey)return;
  const duration=art.armorFlash?400:art.effects.reduce((n,f)=>n+f.delay,0);
  if(performance.now()-start>=Math.max(duration,200))return; // Sound-only casts also expire; never replay on a late load.
  if(performance.now()<soundDeadline&&art.useSound)void audio.effect(art.useSound,spatialVolume(current===selfView?self.x:current.x,current===selfView?self.y:current.y,self),{deadline:Math.min(soundDeadline,start+Math.max(duration,200)),valid:()=>self===field&&combatEpoch===epoch&&!deathFx.get(characterId)&&(characterId===selfView?.characterId?current===selfView:users.get(String(characterId))===current)&&JSON.stringify(lookOf(current))===lookKey});
  if(duration>0){if(skillEffects.length>=128)skillEffects.shift();skillEffects.push({characterId,entity:characterId===selfView?.characterId?undefined:entity,lookKey,art,flash,flip,order,start,end:start+duration});}
}
/** Queue native +380 afterimage independently of the body's forced-action lifetime. */
function queueWeaponAfterimage(entity,motion,now){
  if(!motion.afterimage?.length)return;
  const record=weaponEffects.get(entity)??{};
  record.pending={frames:motion.afterimage,start:now+shotRelease(motion),flip:!motion.facingLeft,
    lookKey:JSON.stringify(lookOf(entity))};
  if(weaponEffects.size>=128&&!weaponEffects.has(entity))weaponEffects.delete(weaponEffects.keys().next().value);
  weaponEffects.set(entity,record);
}
function drawWeaponAfterimage(entity,x,y,now){
  const record=weaponEffects.get(entity);if(!record)return;
  if((entity!==selfView&&users.get(String(entity.characterId))!==entity)||deathFx.get(entity.characterId)||
    ['dead','ladder','rope'].includes(entity===selfView?locomotion(playerBody):remoteStance(entity))){weaponEffects.delete(entity);return;}
  const lookKey=JSON.stringify(lookOf(entity));
  if(record.pending?.lookKey!==lookKey)delete record.pending;
  if(record.current?.lookKey!==lookKey)delete record.current;
  if(record.pending&&now>=record.pending.start){record.current=record.pending;delete record.pending;}
  const effect=record.current;
  if(effect){
    const frame=oneShotFrame(effect.frames,now-effect.start);
    if(frame)drawArchiveImage(frame,x,y,effect.flip);else delete record.current;
  }
  if(!record.pending&&!record.current)weaponEffects.delete(entity);
}
function drawSkillLayer(effect,x,y,now){
  if(effect.art.armorFlash){
    const frame=effect.flash;if(!frame?.ready)return;
    const t=(now-effect.start)/400,scale=1+2*t;
    ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);ctx.globalAlpha*=(212/255)*(1-t);
    ctx.filter='brightness(0) invert(1)';ctx.drawImage(frame.img,frame.dx,frame.dy);ctx.restore();
  }else drawArchiveImage(oneShotFrame(effect.art.effects,now-effect.start),x,y,effect.flip);
}
/** The point is captured before any asynchronous work. 4882F0 stores a mob-relative offset. */
function hitPresentation(mob,point,facingLeft,profile,action,magic=false){
  return {offset:point?{x:point.x-mob.x,y:point.y-mob.y}:undefined,facingLeft,profile,action,magic};
}
function physicalHitPoint(source,mob,facingLeft,bounds,shoot=false,near=SHOT_NEAR_CLIP,range=nativeShotRange){
  const rect=mob.rect??mobRect(currentMobFrame(mob.mob??mob,performance.now()),mob,facingFlip(mobRenderFacing(mob.mob??mob)));
  // 513C80 gives a shot no WZ hit rectangle: it sweeps the one-pixel band at y-25 between its
  // near and far bounds, and 485B80 widens that band onto whatever it meets.
  const shot={left:-range,right:-near,top:-ATTACK_ORIGIN_HEIGHT,bottom:-ATTACK_ORIGIN_HEIGHT+1};
  return attackHitPoint(attackWorldRect(source,shoot?shot:bounds,facingLeft),rect);
}
async function hitFrames(skillId,level,presentation){
  if(skillId){
    const data=await combatCatalog.skill(skillId),art=data?.arts?.[level];
    if(!art)return []; // Unknown skill art is not permission to invent a weapon spark.
    const variants=art.hitVariants??[];
    if(variants.length){const frames=variants[Math.floor(Math.random()*variants.length)]??[];
      await Promise.all(frames.map(f=>artImage(f.path).loading));return frames;}
    if(art.hasHitPath)return []; // A declared but unreadable native skill path is not a weapon fallback.
  }
  if(presentation.magic)return []; // 514D30 uses 50D9F0, not physical 50D7F0 fallback.
  const keys=weaponHitKeys(presentation.profile?.weaponId??0,presentation.action),key=keys[Math.floor(Math.random()*keys.length)];
  const frames=presentation.profile?.hitEffects?.[key]??[];
  await Promise.all(frames.map(f=>artImage(f.path).loading));return frames;
}
/** 4882F0 -> 4862C0 -> 487A30 -> 41F8A0: each impact clamps, then freezes a world-plane layer. */
function scheduleActiveHits(mobId,damages,skillId,level,at,presentation={}){
  const field=self,epoch=combatEpoch;
  damages.forEach((damage,ordinal)=>{
    const start=at+attackHitDelay(ordinal),framesTask=damage>0?hitFrames(skillId,level,presentation):undefined;
    scheduleAttackHit(mobId,damage,start,ordinal,(mob,rect)=>{
      if(!framesTask)return;
      const point=impactPosition(presentation.offset,mob,rect);if(!point)return;
      const effect={...point,start,flip:!presentation.facingLeft};
      effect.order=layerOrder(effect,ATTACK_EFFECT_Z); // Allocate after the number, at impact, not at HTTP completion.
      void framesTask.then(frames=>{
        if(self!==field||combatEpoch!==epoch||!frames.length||frames.some(f=>!artImage(f.path).ready))return;
        const end=start+frames.reduce((n,f)=>n+f.delay,0);if(performance.now()>=end)return;
        if(skillHitEffects.length>=128)skillHitEffects.shift();
        skillHitEffects.push({...effect,frames,end}); // Already-created effects survive mob death/despawn.
      });
    });
  });
}
function scheduleAttackHit(mobId, damage, at, ordinal=0, onImpact) {
  const field = self,
    epoch = combatEpoch, originalMob=mobs.get(String(mobId));
  const show = () => {
    if (self !== field || combatEpoch !== epoch || mobs.get(String(mobId))!==originalMob) return;
    const mob = mobs.get(String(mobId));
    if (!mob) return;
    const now = performance.now();if(now-at>=1000)return;
    void audio.effect(
      `Mob/${String(mob.templateId).padStart(7, "0")}/Damage`,
      spatialVolume(mob.x, mob.y, self),
      {deadline:at+1000,valid:()=>self===field&&combatEpoch===epoch&&mobs.get(String(mobId))===originalMob},
    );
    const frame=currentMobFrame(mob,now);
    // Flinch is authoritative 0x33 (threshold/action/window), not every positive floating number.
    if(frame){const mark={...damageNumberAnchor(mob,frame.oy??0,ordinal),value:damage,start:at,
      jitter:Array.from({length:String(damage).length},()=>Math.floor(Math.random()*2))};
      mark.order=layerOrder(mark,ATTACK_EFFECT_Z);addDamageMark(mark);}
    onImpact?.(mob,mobRect(frame,mob,facingFlip(mobRenderFacing(mob))));
  };
  const delay = at - performance.now();
  if (delay > 0) setTimeout(show, delay);
  else show();
}
function launchProjectile(entity, itemId, motion, mob, now, near, options={}) {
  const local = entity === selfView;
  const at = options.source??(local ? self : entity);
  if (!at) return;
  const leg = projectileLeg(at.x, at.y, motion.facingLeft, mob, near, local ? nativeShotRange : 200);
  // 513C80 passes 515C70(source avatar main layer) through 41B630 -> 41BF60.
  // A bullet keeps its launch root depth; moving the shooter later must not drag its z around.
  const z = options.z??actorDepth(local ? (playerBody ?? at) : at, terrain, local ? "self" : "user");
  const record = {...leg,y1:leg.y1+(options.offsetY??0),
    releaseAt:now+shotRelease(motion)+(options.delayMs??0),frames:options.frames??[],z};
  projectiles.push(record);
  const field = self;
  if(!options.frames)void ensureProjectileFrames(itemId).then(frames=>{
    if(self===field)record.frames=frames;
  });
}
/** 513C80: same source/root z and common travel time; only endpoints/launch clocks fan out. */
function launchActiveProjectiles(entity,itemId,motion,mob,now,near,values,frames,options={}){
  for(const layout of activeProjectileLayout(activeSkillAmmo(values),isRechargeableItem(itemId)))
    launchProjectile(entity,itemId,motion,mob,now,near,{...options,...layout,frames});
}
/** Native magic has its own 50px launch, hit point and one ball, never arrow/star fanout. */
function launchMagicProjectile(entity,motion,plan,frames,now,options={}){
  if(!frames?.length||!plan)return;
  const local=entity===selfView;
  const z=options.z??actorDepth(local?(playerBody??self):entity,terrain,local?'self':'user');
  projectiles.push({...plan.leg,releaseAt:now+shotRelease(motion),frames,z});
}
/** 491F20 scans progressively taller 20px slices, taking the first matching live RECT.
 * Only rectangle source/order differs from the native swept CShape2D/ZList pool. */
function magicAttackPlan(source,facingLeft,ball,target,group=0){
  let selected=target;
  if(selected===undefined){
    outer:for(const rect of magicSearchRects(source,facingLeft))for(const mob of mobs.values()){
      if(dying.has(String(mob.mobId)))continue;
      const bounds=mobRect(currentMobFrame(mob,performance.now()),mob,facingFlip(mobRenderFacing(mob)));
      if(intersects(rect,bounds)){selected={mob,rect:bounds};break outer;}
    }
  }
  let point=selected?.rect?magicHitPoint(source,facingLeft,selected.rect):undefined;
  if(ball){
    const leg=magicLeg(source,facingLeft,point);
    const clipped=clipMagicRay(source,{x:leg.x1,y:leg.y1},terrain?.footholds??[],group);
    point=clipped.point;
    if(clipped.blocked)selected=undefined;
  }
  return {mob:selected?.mob,point,leg:magicLeg(source,facingLeft,point)};
}
function drawProjectile(shot, cameraX, cameraY, now) {
  const elapsed = now - shot.releaseAt, t = elapsed / shot.duration;
  const frame = loopFrame(shot.frames, elapsed);
  if (!frame) return;
  ctx.save();
  ctx.translate(Math.round(shot.x0 + (shot.x1 - shot.x0) * t - cameraX),
    Math.round(shot.y0 + (shot.y1 - shot.y0) * t - cameraY));
  ctx.rotate(Math.atan2(shot.y0 - shot.y1, shot.x0 - shot.x1));
  drawArchiveImage(frame, 0, 0, false);
  ctx.restore();
}
async function receiveUserAttack(message, now) {
  const user = users.get(String(message.characterId));
  if (!user || ["dead", "ladder", "rope"].includes(remoteStance(user))) return;
  const field = self,
    epoch = combatEpoch;
  const ticket = user.attackTicket = (user.attackTicket ?? 0) + 1;
  const look = lookOf(user), lookKey = JSON.stringify(look);
  const source={x:Math.trunc(user.x),y:Math.trunc(user.y)},z=actorDepth(user,terrain,'user'),group=user.group??0;
  const targets=new Map((message.targets??[]).flatMap(target=>{
    const mob=mobs.get(String(target.mobId));return mob?[[target.mobId,{mob,x:mob.x,y:mob.y,rect:mobRect(currentMobFrame(mob,now),mob,facingFlip(mobRenderFacing(mob)))}]]:[];
  }));
  const [baseProfile,skillData]=await Promise.all([ensureAttackProfile(look),
    message.skillId?combatCatalog.skill(message.skillId):undefined]);
  if (
    self !== field ||
    combatEpoch !== epoch ||
    users.get(String(message.characterId)) !== user ||
    ["dead", "ladder", "rope"].includes(remoteStance(user)) || user.attackTicket !== ticket || JSON.stringify(lookOf(user)) !== lookKey
  )
    return;
  const skillId=message.skillId??0,magic=message.magic===true;
  const profile=attackProfileAtTier(baseProfile,message.afterimage??0);
  if(magic&&activeSkill(skillId)?.kind!=='magic')return;
  const action = skillId?(magic?activeMagicActions(profile,skillId,skillData?.skillType):message.shoot?activeRangedActions(profile,skillId):activeMeleeActions(profile,skillId)).find(a=>a.action===message.action)
    :basicAttackAction(profile, message.action, message.shoot);
  if (!action) return; // Do not turn an unknown/skill action into a fabricated one-handed swing.
  // The relay owns speed; scale original WZ delays, never an already rounded profile.
  const delays = scaledAttackDelays(action.baseDelays, message.speed);
  user.facing = message.facingLeft ? 1 : 0;
  const motion = {
    ...action,
    delays,
    start: now,
    facingLeft: message.facingLeft,
  };
  const soundAllowed=performance.now()-now<attackDuration(motion);
  if(skillId)void playSkillEffect(message.characterId,skillId,message.skillLevel,now,now+attackDuration(motion));
  queueWeaponAfterimage(user,motion,now);
  if(soundAllowed&&!magic)playWeaponSound(user, profile,motion,now);
  for(const snapshot of targets.values())snapshot.point=physicalHitPoint(source,snapshot,message.facingLeft,action.bounds,message.shoot,
    shotNear(attackProfileAtTier(baseProfile,0)?.melee[0]),200);
  const target = targets.get(message.targets?.[0]?.mobId);
  const near = shotNear(attackProfileAtTier(baseProfile,0)?.melee[0]);
  const magicBalls=magic?skillData?.arts?.[message.skillLevel]?.balls:undefined;
  if(magic&&!magicBalls)return;
  // Passing null prevents a remote empty cast from acquiring some unrelated new target.
  const magicPlan=magic?magicAttackPlan(source,message.facingLeft,magicBalls.length>0,target??null,group):undefined;
  if(magic&&magicBalls.length)launchMagicProjectile(user,motion,magicPlan,magicBalls,now,{z});
  if(message.shoot&&message.projectileItemId){
    const values=skillData?.levels.find(row=>row.level===message.skillLevel)?.values;
    if(skillId&&values){
      const balls=skillData.arts?.[message.skillLevel]?.balls;
      // Keep the original start/root even if an ammo image arrives late.
      if(balls?.length)launchActiveProjectiles(user,message.projectileItemId,motion,target,now,near,values,balls,{source,z});
      else for(const layout of activeProjectileLayout(activeSkillAmmo(values),isRechargeableItem(message.projectileItemId)))
        launchProjectile(user,message.projectileItemId,motion,target,now,near,{...layout,source,z});
    }else if(!skillId)launchProjectile(user,message.projectileItemId,motion,target,now,near,{source,z});
  }
  for (const [targetIndex,target] of (message.targets ?? []).entries()) {
    const snapshot=targets.get(target.mobId);
    if(!snapshot||mobs.get(String(target.mobId))!==snapshot.mob)continue;
    const delay = magic?shotRelease(motion)+(magicBalls.length?magicPlan.leg.duration:0):message.shoot
      ? shotRelease(motion) +
        projectileLeg(source.x, source.y, message.facingLeft, snapshot, near).duration
      : shotRelease(motion)+(skillId?attackTargetDelay(targetIndex):0);
    const point=magic?magicPlan.point:message.shoot?snapshot.point:physicalHitPoint(source,snapshot,message.facingLeft,activeMeleeBounds(action.bounds,skillData?.levels.find(row=>row.level===message.skillLevel)?.values.range??0,message.facingLeft,true),false,near);
    scheduleActiveHits(target.mobId,target.damages??[],skillId,message.skillLevel,now+delay,
      hitPresentation(snapshot,point,message.facingLeft,profile,motion.action,magic));
  }
  // Preserve the received attack clock / hit scheduling. A cold remote action is not exposed to
  // the renderer as an unready gray box, and isn't restarted late after it already finished.
  const frames = delays.map((_, frame) => avatarFrame(look, motion.stance, attackCanvasFrame(motion, frame),
    !message.facingLeft, undefined, true));
  const effects = (motion.afterimage??[]).map((frame) => artImage(frame.path));
  await Promise.all([...frames, ...effects].map((frame) => frame.loading));
  if (self !== field || combatEpoch !== epoch || users.get(String(message.characterId)) !== user
      || user.attackTicket !== ticket || JSON.stringify(lookOf(user)) !== lookKey
      || ["dead", "ladder", "rope"].includes(remoteStance(user)) || performance.now() - now >= attackDuration(motion)
      || [...frames, ...effects].some((frame) => !frame.ready)) return;
  user.swing = motion;
}
/** Candidate mob canvas rectangles, not a claim to have ported native CShape2D collision. */
function mobsInAttackRect(bounds, facingLeft, clampNear = false) {
  if(!bounds)return [];
  const found=[];
  const left = clampNear ? Math.min(Math.max(bounds.left, -65), bounds.right - 1) : bounds.left;
  const right = bounds.right;
  const x0 = self.x + (facingLeft ? left : -right);
  const x1 = self.x + (facingLeft ? right : -left);
  for (const mob of mobs.values()) {
    if (dying.has(String(mob.mobId))) continue;
    const frame = currentMobFrame(mob, performance.now());
    const target = mobRect(frame, mob, facingFlip(mobRenderFacing(mob)));
    if (!intersects(target, { left: x0, right: x1, top: self.y + bounds.top, bottom: self.y + bounds.bottom })) continue;
    found.push(mob);
  }
  return found.sort((a,b)=>Math.abs(a.x-self.x)-Math.abs(b.x-self.x));
}
function mobInAttackRect(bounds,facingLeft,clampNear=false){return mobsInAttackRect(bounds,facingLeft,clampNear)[0];}
/** Ctrl: prone32; otherwise melee near/no ammo or a basic shot. Empty attacks still go on wire. */
async function swing(skillId=0) {
  let rule=skillId?activeSkill(skillId):undefined;
  if(skillId&&!rule){logLine("此技能尚未完整實作，未消耗資源。");return;}
  if (
    !self ||
    !selfView ||
    !playerBody ||
    !visualFieldActive || document.hidden || socket?.readyState !== WebSocket.OPEN ||
    browserLabOpen() || npcDialog.open || tooltipViewer.open ||
    isEditingControl(document.activeElement) ||
    map?.id !== self.mapId ||
    (playerBody?.ladder && rule?.kind!=='buff') ||
    selfView.hp <= 0 ||
    portalPending ||
    shop ||
    shopPending ||
    talkingNpc ||
    modalOpen() ||
    slotPending ||
    mesoPending ||
    quickDrag || itemDrag ||
    swingLoading ||
    performance.now() < nextSwingAt
  )
    return;
  swingLoading = true;
  const field = self, epoch = combatEpoch, interaction = localActionEpoch, characterId = selfView.characterId;
  let entity = selfView;
  const lookKey = JSON.stringify(lookOf(entity));
  try {
    let skillData,skillLevel,skillValues,skillArt;
    if(skillId){
      skillLevel=skillPanel.level(skillId);skillData=await combatCatalog.skill(skillId);
      skillValues=skillData?.levels.find(row=>row.level===skillLevel)?.values;
      if(!skillValues||!activeSkillCost(entity,skillValues)){logLine('技能尚未學習或 HP／MP 不足。');return;}
      const readyArt=skillArt=await preloadSkillArt(skillData,skillLevel);
      entity=selfView;
      if(!readyArt||self!==field||combatEpoch!==epoch||localActionEpoch!==interaction||entity?.characterId!==characterId||JSON.stringify(lookOf(entity))!==lookKey||
        selfView?.hp<=0||portalPending||shop||shopPending||talkingNpc||(itemDialog.open||systemPanel.visible||playerContext.open)||
        browserLabOpen()||quickDrag||itemDrag||slotPending||mesoPending||!visualFieldActive||document.hidden||
        socket?.readyState!==WebSocket.OPEN||skillPanel.level(skillId)!==skillLevel||performance.now()<nextSwingAt)return;
      if(rule.kind==='buff'){
        if(!activeSkillCost(entity,skillValues)||!publishPlayerMotion())return;
        nextSwingAt=performance.now()+200;
        send({t:'use-active-skill',skillId});return;
      }
    }
    // 512F90 -> 427F60: group outside 1..7 returns -1. No fake bare-hand sword cycle.
    if (!weaponIdOf(lookOf(entity))) return;
    const baseProfile = await ensureAttackProfile(lookOf(entity));
    let profile=baseProfile&&attackProfileAtTier(baseProfile,attackMasteryTier(baseProfile,id=>skillPanel.level(id)));
    entity = selfView;
    if (
      self !== field ||
      combatEpoch !== epoch || localActionEpoch !== interaction ||
      entity?.characterId !== characterId ||
      JSON.stringify(lookOf(entity)) !== lookKey ||
      entity.hp <= 0 ||
      !playerBody ||
      map?.id !== self.mapId ||
      playerBody?.ladder ||
      portalPending ||
      shop ||
      shopPending ||
      talkingNpc ||
      modalOpen() ||
      slotPending ||
      mesoPending
    )
      return;
    const prone = locomotion(playerBody) === "prone";
    if(skillId&&prone&&rule.kind!=='ranged'&&rule.kind!=='magic')return;
    if(rule?.kind==='magic'&&prone){skillId=0;rule=undefined;}
    const magic=rule?.kind==='magic';
    if(magic&&!playerBody.grounded)return;
    if (!profile || (prone ? !profile.prone : !profile.melee.length)) {
      logLine("無法取得此武器的原始攻擊資料；暫不以其他武器動作替代。");
      return;
    }
    if (performance.now() < nextSwingAt) return;
    const pick = (actions) =>
      actions?.[Math.floor(Math.random() * actions.length)];
    if(rule?.kind==='ranged'&&!activeRangedActions(profile,skillId).length){
      logLine('此技能需要相容的弓／弩或拳套；未消耗資源。');return;
    }
    if(magic&&!activeMagicActions(profile,skillId,skillData?.skillType).length){
      logLine('此武器的原版魔法動作表為空，不能施放；未消耗資源。');return;
    }
    let action = magic?pick(activeMagicActions(profile,skillId,skillData?.skillType)):rule?.kind==='melee'?pick(activeMeleeActions(profile,skillId))
      :prone?profile.prone:pick(profile.melee);
    let ammo = magic||prone||rule?.kind==='melee'?undefined
      :basicAmmo(inventory,weaponIdOf(lookOf(entity)),rule?.kind==='ranged'?activeSkillAmmo(skillValues):1);
    let mob=action?.bounds?mobInAttackRect(action.bounds,entity.facing===1,!!ammo):undefined;
    let forceMelee=false;
    // 519380: incompatible weapon refuses; prone, insufficient ammo or close target uses
    // ordinary melee and rolls back skill HP/MP. Never turn a failed skill into a free shot.
    if(rule?.kind==='ranged'&&(prone||!ammo||mob)){
      forceMelee=true;skillId=0;rule=undefined;ammo=undefined;
    }
    const shoot=!forceMelee&&!!ammo&&!!profile.shoot.length&&!mob;
    const near=shotNear(action);
    if(shoot){
      profile=attackProfileAtTier(baseProfile,attackMasteryTier(baseProfile,id=>skillPanel.level(id),true));
      action=pick(skillId?activeRangedActions(profile,skillId):profile.shoot);
      mob=mobInAttackRect({left:-nativeShotRange,right:-near,top:-25,bottom:-24},entity.facing===1);
    }
    if (!action) return;
    const speed=magic?activeMagicSpeed(profile):activeSkillSpeed(profile.baseSpeed??profile.speed,skillId,buffs.values(performance.now()).booster??0);
    const motion={...action,delays:scaledAttackDelays(action.baseDelays,speed)};
    const look = lookOf(entity), facingLeft = entity.facing === 1;
    const frames = motion.delays.map((_, frame) => avatarFrame(
      look, motion.stance, attackCanvasFrame(motion, frame), facingFlip(entity.facing), undefined, true));
    const effects = (motion.afterimage??[]).map((frame) => artImage(frame.path));
    const bulletFrames=shoot?(skillId&&skillArt?.balls?.length?skillArt.balls:await ensureProjectileFrames(ammo.itemId)):[];
    const bullets=bulletFrames.map(frame=>artImage(frame.path));
    await Promise.all([...frames,...effects,...bullets].map(frame=>frame.loading));
    entity = selfView;
    if (self !== field || entity?.characterId !== characterId || combatEpoch !== epoch || localActionEpoch !== interaction
      || JSON.stringify(lookOf(entity)) !== lookKey || entity.hp <= 0
      || !playerBody || playerBody.ladder || map?.id !== self.mapId || portalPending
      || shop || shopPending || talkingNpc || modalOpen() || slotPending || mesoPending
      || (entity.facing === 1) !== facingLeft || performance.now() < nextSwingAt
      || (magic&&!playerBody.grounded)
      || (locomotion(playerBody) === "prone") !== prone
      || !visualFieldActive || document.hidden || socket?.readyState !== WebSocket.OPEN
      || browserLabOpen() || npcDialog.open || tooltipViewer.open || quickDrag || itemDrag
      || isEditingControl(document.activeElement)) return;
    if ((shoot&&!bulletFrames.length)||[...frames,...effects,...bullets].some(frame=>!frame.ready)) {
      logLine("攻擊圖像尚未載入，未以站立圖或其他武器姿勢代替。");
      return;
    }
    if(!magic&&(activeSkillSpeed(profile.baseSpeed??profile.speed,skillId,buffs.values(performance.now()).booster??0)!==speed||
      attackMasteryTier(baseProfile,id=>skillPanel.level(id),shoot)!==profile.afterimageTier))return;
    if (shoot) {
      const readyAmmo = basicAmmo(inventory, weaponIdOf(look),skillId?activeSkillAmmo(skillValues):1);
      if (!readyAmmo || readyAmmo.slot !== ammo.slot || readyAmmo.itemId !== ammo.itemId) return;
      ammo = readyAmmo;
    }
    // Loading may take time on a cold look: choose the target again from current sampled positions.
    mob = shoot ? mobInAttackRect({left:-nativeShotRange,right:-near,top:-25,bottom:-24}, facingLeft)
      : action?.bounds ? mobInAttackRect(action.bounds, facingLeft, !!ammo) : undefined;
    let selected,magicPlan;
    if(skillId){
      if(skillPanel.level(skillId)!==skillLevel||!activeSkillCost(entity,skillValues))return;
      if(magic){
        magicPlan=magicAttackPlan({x:Math.trunc(self.x),y:Math.trunc(self.y)},facingLeft,skillArt.balls.length>0,undefined,playerBody.group??0);
        selected=magicPlan.mob?[magicPlan.mob]:[];
      }else if(shoot){
        // A target entered the near rectangle during cold loading: cancel, do not shoot through it.
        if(mobInAttackRect(attackProfileAtTier(baseProfile,0)?.melee[0]?.bounds,facingLeft,true))return;
        selected=mob?[mob]:[];
      }else{
      const near=mobsInAttackRect(action.bounds,facingLeft);
      const bounds=activeMeleeBounds(action.bounds,skillValues.range??0,facingLeft,near.length>0);
      selected=mobsInAttackRect(bounds,facingLeft).slice(0,skillValues.range&&near.length?6:1)
        .sort((a,b)=>(a.x-b.x)*(facingLeft?-1:1));
      }
    }
    const source={x:Math.trunc(self.x),y:Math.trunc(self.y)};
    const victims=skillId?selected:mob?[mob]:[];
    const hitBounds=skillId&&!shoot&&!magic?activeMeleeBounds(action.bounds,skillValues.range??0,facingLeft,mobsInAttackRect(action.bounds,facingLeft).length>0):action.bounds;
    const snapshots=new Map(victims.map(target=>[target.mobId,{mob:target,x:target.x,y:target.y,
      point:magic?magicPlan.point:physicalHitPoint(source,target,facingLeft,hitBounds,shoot,near)}]));
    const shotTarget=mob?snapshots.get(mob.mobId):undefined;
    const now = performance.now();
    // Flush actual posture BEFORE the attack; the 10Hz publisher may not yet have sent Down.
    // This ordering is a bridge policy, using existing movement packets, not a new native opcode.
    if (!publishPlayerMotion()) return;
    selfSwing = { ...motion, start: now, facingLeft };
    queueWeaponAfterimage(entity,selfSwing,now);
    beginAttackAlert(playerBody, now);
    nextSwingAt = now + attackDuration(motion);
    if(skillId){
      if(!magic)playWeaponSound(entity,profile,motion,now);
      void playSkillEffect(entity.characterId,skillId,skillLevel,now);
      if(magic)launchMagicProjectile(entity,motion,magicPlan,skillArt.balls,now);
      else if(shoot)launchActiveProjectiles(entity,ammo.itemId,motion,shotTarget,now,near,skillValues,bulletFrames);
      const attackToken=activePredictions.add({field:self,epoch:combatEpoch,start:now,skillId,skillLevel,
        targets:new Map(selected.map((target,index)=>[target.mobId,{mob:target,presentation:hitPresentation(target,snapshots.get(target.mobId)?.point,facingLeft,profile,motion.action,magic),delayMs:shotRelease(motion)+
          (magic?(skillArt.balls.length?magicPlan.leg.duration:0):shoot?projectileLeg(source.x,source.y,facingLeft,snapshots.get(target.mobId),near,nativeShotRange).duration:attackTargetDelay(index))}]))});
      send({t:magic?'active-magic':shoot?'active-ranged':'active-melee',attackToken,skillId,action:motion.action,facingLeft,
        targets:selected.map(mob=>({mobId:mob.mobId,x:snapshots.get(mob.mobId)?.point?.x??mob.x,y:snapshots.get(mob.mobId)?.point?.y??mob.y}))});return;
    }
    playWeaponSound(entity, profile,motion,now);
    if(shoot)launchProjectile(entity,ammo.itemId,selfSwing,shotTarget,now,near,{frames:bulletFrames,source});
    const point=shotTarget?.point;
    const attackToken=activePredictions.add({field:self,epoch:combatEpoch,start:now,skillId:0,skillLevel:0,
      targets:new Map(mob?[[mob.mobId,{mob,delayMs:shotRelease(motion)+(shoot?projectileLeg(source.x,source.y,facingLeft,shotTarget,near,nativeShotRange).duration:0),
        presentation:hitPresentation(mob,point,facingLeft,profile,motion.action)}]]:[])});
    send({
      t: "attack",attackToken,
      mode: shoot ? "shoot" : "melee",
      action: motion.action,
      mobId: mob?.mobId ?? 0,
      targetX: point?.x??mob?.x,
      targetY: point?.y??mob?.y,
      facingLeft: entity.facing === 1,
    });
  } finally {
    swingLoading = false;
  }
}

/** CLife::47D110; the plate itself lives in client/hud.ts with the rest of the HUD text. */
function drawName(name, x, y, color = "#ffffff") {
  drawNamePlate(ctx, name, x, y, color);
}

/**
 * The portal swirls, exactly where the original draws them: `pt == 2` warps (`pt == 0` is a spawn
 * point and `pt == 1` a hidden passage, neither of which has a picture), using the shared
 * `MapHelper.img/portal/game/pv` animation. They use the fixed portal root z,
 * not an unconditional before/after-actor pass. Which ones are on screen is `portalSwirls`
 * (client/portals.ts, next to the rest of the portal rules); only the painting stays here.
 */
function drawPortals(cameraX, cameraY, now) {
  if (!map || !mapArt) return;
  const frames = mapArt.portalFrames ?? [];
  const frame = loopFrame(frames, now);
  if (frame === undefined) return;
  for (const { x, y } of portalSwirls(map.portals, cameraX, cameraY, renderSurface))
    drawArchiveImage(frame, x, y, false);
}

// ---------------------------------------------------------------- hud & chat

const chatHistoryPanel = chatHistory({
  root: document.getElementById('chat-history'), list: ui.chatLines,
  bar: document.getElementById('chat-scroll'),
});
// 4F8940/4FB160: active recipient toggles back to everyone; otherwise ask remembered name.
let whisperRecipient = "", lastWhisperRecipient = "", userRequestUntil=0;
function beginUserRequest(name,text) {
  const now=performance.now();
  if(now<userRequestUntil){chatHistoryPanel.append('다른 요청을 처리 중입니다','error');return false;}
  if(socket?.readyState!==WebSocket.OPEN)return false;
  const reason=whisperNameError(name,selfView?.name);
  if(reason && text!==undefined){chatHistoryPanel.append(reason,'error');return false;}
  userRequestUntil=now+3000;
  pendingWhisper=text===undefined?undefined:{name,text};
  send(text===undefined?{t:'find',name}:{t:'whisper',name,text});return true;
}
function resetWhisper() {
  pendingWhisper=undefined;userRequestUntil=0;
  whisperRecipient = lastWhisperRecipient = "";
  updateWhisperControl();
}
function updateWhisperControl() {
  // BtWhisper paints on the canvas with the other six of `sub_4F6B70`'s controls, so there is no
  // button element to keep in step any more - only the chat input's own accessible name.
  ui.say.setAttribute("aria-label", whisperRecipient ? `悄悄話給 ${whisperRecipient}` : "聊天輸入");
}
function drawWhisperRecipient() {
  paintWhisperRecipient(ctx, whisperRecipient);
}
/**
 * `sub_4F8940`: BtWhisper's own arm (`sub_4F88C0` case 1006). A recipient already set is cleared
 * - the original passes an empty `lpMultiByteStr_0` to `sub_4FB160` - and with none set the bar
 * asks for one, in the original's own words (`asc_5BD308`, "귓속말 상대를 입력하세요.").
 *
 * The `/w name text` command does NOT come through here: it sends one whisper and leaves the
 * recipient alone, which is its own thing. The player menu's whisper action and an incoming
 * whisper's reply set `whisperRecipient` directly for the same reason.
 */
function pickWhisperRecipient() {
  if (revivePanel.open || modalOpen() || browserLabOpen() ||
      loginScreens.stage !== "game" || !visualFieldActive || !selfView || portalPending) return;
  if (whisperRecipient) {whisperRecipient="";updateWhisperControl();ui.say.focus();return;}
  const owner=quickOwner, epoch=itemEpoch;
  itemDialog.text({text:"귓속말 상대를 입력하세요.",initial:lastWhisperRecipient,maxLength:12,
    validate:value=>whisperNameError(value,selfView?.name),
    accept(name) {
      if(owner!==quickOwner || epoch!==itemEpoch || loginScreens.stage!=="game")return;
      whisperRecipient=lastWhisperRecipient=name; updateWhisperControl();ui.say.focus();
    },
  });
}

function chatLine(name,text) {
  const system=name==='系統', whisper=name.endsWith('<<')||name.endsWith('>>');
  const prefix=system?'':whisper?`${name} `:`${name} : `;
  const handle=chatHistoryPanel.append(prefix+text,system?'system':whisper?'whisper':'normal');
  return {update:value=>handle.update(prefix+value)};
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

// StatusBar bindings are configuration, not inventory items. A drag never owns a bag slot.
let quickDrag;
function quickHoverItem() {
  if (!pointerAt || systemPanel.visible || itemDialog.open || shop !== undefined ||
      inventoryWindowAt(pointerAt.x,pointerAt.y) || equipPanel.hit(pointerAt.x,pointerAt.y)) return;
  const index=quickSlotAt(pointerAt.x,pointerAt.y), itemId=quickProfile?.values()[index];
  if (!itemId) return;
  if(quickSkillAllowed(itemId)) {
    const data=combatCatalog.peekSkill(itemId.skillId);if(!data)void combatCatalog.skill(itemId.skillId);
    return data?{skill:data,level:skillPanel.level(itemId.skillId)}:undefined;
  }
  if (itemInfo.get(itemId) === undefined) void describeItem(itemId);
  return {itemId,quantity:quickItemState(inventory,itemId).quantity};
}
function beginSkillDrag(skill,p) {
  if(!quickProfile||!skillPanel.level(skill.id)||!activeSkill(skill.id)||itemDrag||quickDrag||
    shop!==undefined||slotPending||mesoPending||shopPending)return;
  localActionEpoch++;
  quickDrag={fromSkill:true,index:-1,itemId:{kind:'skill',skillId:skill.id},owner:quickOwner,
    profile:quickProfile,epoch:itemEpoch,start:p,point:p,moved:false};
}
function beginQuickDrag(p) {
  const index=quickSlotAt(p.x,p.y), itemId=quickProfile?.values()[index];
  if (!itemId || loginScreens.stage!=="game" || !visualFieldActive || !selfView || selfView.hp<=0 ||
      portalPending || modalOpen() || browserLabOpen() || shop!==undefined ||
      talkingNpc!==undefined || slotPending || mesoPending || shopPending || itemDrag) return false;
  // 4F90F0 StatusBar drag looks for a real matching USE stack first; an exhausted binding stays displayed.
  if (quickSkillAllowed(itemId)?!skillPanel.level(itemId.skillId):!quickItemState(inventory,itemId).item) return false;
  localActionEpoch++;
  quickDrag={index,itemId,owner:quickOwner,profile:quickProfile,epoch:itemEpoch,start:p,point:p,moved:false};
  inventoryPick=undefined;
  return true;
}
window.addEventListener("mousemove",e=>{
  if(!quickDrag)return;
  const p=viewPoint(e);quickDrag.point=p;pointerAt=p;
  if(!quickDrag.moved && Math.abs(p.x-quickDrag.start.x)+Math.abs(p.y-quickDrag.start.y)>3){
    quickDrag.moved=true;void audio.effect("UI/DragStart");
  }
});
window.addEventListener("mouseup",e=>{
  if(e.button!==0)return;
  const d=quickDrag;quickDrag=undefined;
  if(!d?.moved)return;
  inventorySuppressClick=e.target===canvas;
  if(e.button!==0 || e.target!==canvas || !Number.isFinite(e.clientX) || !Number.isFinite(e.clientY) ||
      d.owner!==quickOwner || d.profile!==quickProfile || d.epoch!==itemEpoch ||
      (!d.fromSkill && quickProfile.values()[d.index]!==d.itemId) || loginScreens.stage!=="game" || !visualFieldActive ||
      selfView?.hp<=0 || portalPending || modalOpen() || browserLabOpen() ||
      shop!==undefined || talkingNpc!==undefined || (quickSkillAllowed(d.itemId)?!skillPanel.level(d.itemId.skillId):!quickItemState(inventory,d.itemId).item))return;
  const p=viewPoint(e);
  if(inventoryWindowAt(p.x,p.y) || equipPanel.hit(p.x,p.y) || skillPanel.contains(p.x,p.y) ||
      statPanel.contains(p.x,p.y) || shopWindowAt(p.x,p.y))return;
  const to=quickSlotAt(p.x,p.y);
  const changed=to>=0 ? (d.fromSkill?quickProfile.bind(to,d.itemId):quickProfile.move(d.index,to,d.itemId))
    : p.x>=0 && p.x<800 && p.y>=0 && p.y<STATUS_BAR.y && !miniMapPanel.contains(p.x,p.y)
      ? !d.fromSkill&&quickProfile.clear(d.index,d.itemId) : false;
  if(changed)void audio.effect("UI/DragEnd");
});
window.addEventListener("blur",()=>{quickDrag=undefined;});
function drawQuickDrag(){
  if(!quickDrag?.moved)return;
  const id=quickDrag.itemId;
  const a=quickSkillAllowed(id)?artImage(`Skill/${Math.trunc(id.skillId/10000)}.img/skill/${id.skillId}/icon`):itemIcon(id);
  if(a.ready){ctx.save();ctx.globalAlpha=128/255;
    ctx.drawImage(a.img,quickDrag.point.x-16,quickDrag.point.y-16);ctx.restore();}
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
    modalOpen() ||
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
// sub_55B0E0: a 204 scroll dropped on an equip sends 0x1A with both slots. It shares the
// inventory window's one-at-a-time gate and 500 ms cooldown with change-slot (same native
// `*(this+6)` byte); the upgraded equip comes back as a 0x0B that clears slotPending.
function scrollRequest(scrollSlot, equipSlot) {
  if (
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
  send({ t: "scroll", scrollSlot, equipSlot });
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
  const reason = canWear(item, facts, selfView, inventory, part, nativeWornFacts);
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
  if (e.button !== 0 || !itemDrag) return;
  const d = itemDrag;
  itemDrag = undefined;
  if (!d.moved) return;
  inventorySuppressClick = d.slot > 0 && e.target === canvas;
  if (
    !Number.isFinite(e.clientX) ||
    !Number.isFinite(e.clientY) ||
    e.target?.closest?.("#stat-window") ||
    e.target?.closest?.("#skill-window") ||
    e.target?.closest?.("#dialogue")
  )
    return;
  const p = viewPoint(e);
  if (shopWindowAt(p.x, p.y)) return;
  if (tradeOpen) {
    const th = tradeWindowAt(p.x, p.y, tradeAt, tradeModel.room, tradeLogScroll);
    if (th !== undefined) {
      // sub_4D5C80: only my empty cells take a drop; equips carry no count byte.
      if (th.kind === "slot" && th.side === "mine" && !th.occupied && d.slot > 0)
        send({
          t: "trade-offer-item",
          tab: d.tab,
          slot: d.slot,
          count: tradeOfferCount(d.tab, d.item.quantity),
          roomSlot: th.roomSlot,
        });
      return;
    }
  }
  if (JSON.stringify(sourceItem(d.tab, d.slot)) !== JSON.stringify(d.item))
    return;
  const eq = equipPanel.hit(p.x, p.y);
  if (eq) {
    // A 204 scroll dropped on a worn equip: 0x1A. eq.slot is already the negative worn slot; the
    // pairing/success authority is the server's. Bag equips are not visible while the USE tab is
    // up, so the browser scrolls a worn item (equip it first) - the server also takes a positive
    // equip-tab slot for the native client.
    if (
      eq.kind === "slot" &&
      eq.item &&
      d.tab === 2 &&
      d.slot > 0 &&
      Math.floor(d.item.itemId / 10000) === 204
    ) {
      scrollRequest(d.slot, eq.slot);
      return;
    }
    if (eq.kind === "slot" && d.tab === 1 && d.slot > 0)
      void wearItem(d.item, d.slot, -eq.slot);
    return;
  }
  const bag = inventoryWindowAt(p.x, p.y);
  const quickIndex = quickSlotAt(p.x, p.y);
  if (!bag && quickIndex >= 0 && e.target === canvas) {
    if (d.tab === 2 && d.slot > 0 && selfView?.hp > 0 && !portalPending && !browserLabOpen())
      quickProfile?.bind(quickIndex, d.item.itemId);
    return; // This is never a field drop, even for an unsupported item.
  }
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
    loginScreens.stage === "game" &&
    selfView?.hp > 0 &&
    !shop &&
    talkingNpc === undefined &&
    JSON.stringify(sourceItem(d.tab, d.slot)) === snapshot;
  const facts = await describeItem(d.item.itemId);
  if (!valid() || modalOpen()) return;
  if (!facts || facts.cash || d.item.cash) {
    chatLine(
      "系統",
      facts
        ? "이 아이템은 버릴 수 없습니다."
        : "無法讀取道具原始資料，已取消丟棄。",
    );
    return;
  }
  const sendDrop = (count) => {
    if (valid()) slotRequest(d.tab, d.slot, 0, count);
  };
  const choose = () => {
    if (!valid()) return;
    const plan = inventoryDropPlan(d.tab, d.item.itemId, d.item.quantity ?? 1);
    if (plan.kind === "ask")
      itemDialog.quantity({
        text: "몇 개나 버리시겠습니까?",
        initial: plan.max,
        max: plan.max,
        at,
        accept: sendDrop,
      });
    else if (plan.kind === "send") sendDrop(plan.count);
    else chatLine("系統", "此整組數量超出原0x17可傳送範圍，已取消丟棄。");
  };
  if (isIrreplaceableItem(d.item.itemId)) {
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


/** Whether the inventory is up, and its CConfig position (not the CLOSE control coordinate). */
let inventoryOpen = false;
let inventoryAt = { ...INVENTORY.home };
/** The window the pointer is over, or the piece it is dragging. */
let inventoryHover;
let inventoryPressed;
let inventoryDrag;
/** The item a click last picked (its tooltip stays up while it is set). */
let inventoryPick;
/** 4DA810/4DA8B0: independent per-tab row positions; firstSlot = 4*row+1. */
const inventoryScroll = [0, 0, 0, 0, 0];
let inventoryScrollDrag;
/**
 * `sub_4521E0`'s held arrow for the bag. `sub_4DA810` keeps a plain row index, not a
 * `CCtrlScrollBar`, so the bar needs its own press state: the trade/messenger/skill windows get
 * theirs from the scroller in client/vscroll.ts, this one and the shop's do not.
 */
const inventoryScrollPress = { repeat: pressRepeat() };
/** CTradingRoomDlg is modeless: its sheet, press and drag live beside the shop's own. */
let tradeOpen = false;
let tradeAt = { ...TRADE_WINDOW.home };
let tradeDrag;
let tradeScrollDrag = false;
let tradeHover;
let tradeHoverOffer;
let tradeSuppressClick = false;
let tradeEnabled = false;
function inventoryScrollbarGeometry() {
  // The tab's own row position (4DA810/4DA8B0); the geometry lives in inventory-window.ts.
  return inventoryScrollGeometry(
    inventoryTabView()?.capacity ?? 0,
    inventoryScroll[inventoryTab] ?? 0,
  );
}
/**
 * `sub_4521E0` for the bag: an arrow steps one row, the track pages by the six rows the grid
 * shows. The thumb does nothing here - its press starts the drag up in the mousedown handler.
 */
function inventoryScrollAct(zone) {
  if (zone === undefined || zone === "thumb") return;
  const delta =
    zone === "prev"
      ? -1
      : zone === "next"
        ? 1
        : zone === "pageUp"
          ? -INVENTORY.grid.rows
          : INVENTORY.grid.rows;
  setInventoryScroll(inventoryScrollbarGeometry().row + delta);
}
function setInventoryScroll(row) {
  inventoryScroll[inventoryTab] = clampInventoryScroll(
    inventoryTabView()?.capacity ?? 0,
    row,
  );
  inventoryPick = inventoryHover = undefined;
}
window.addEventListener("mousemove", (event) => {
  if (!inventoryScrollDrag || modalOpen()) return;
  const g = inventoryScrollbarGeometry();
  const p = viewPoint(event);
  setInventoryScroll(
    ((p.y -
      inventoryAt.y -
      INVENTORY.scrollbar.y -
      VSCR_CELL -
      inventoryScrollDrag.offset) *
      g.max) /
      g.travel,
  );
});
window.addEventListener("mouseup", (event) => {
  if (event.button !== 0) return;
  if (inventoryScrollDrag) inventorySuppressClick = event.target === canvas;
  inventoryScrollDrag = undefined;
});
// Losing focus never produces a mouseup, so the press has to be dropped here as well.
window.addEventListener("blur", () => {
  inventoryScrollDrag = undefined;
  finishWindowPress();
});
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

// ------------------------------------------------- 1:1 exchange (CTradingRoomDlg)
//
// The room model lives in client/trade-state.ts so this page and ClientSession apply the same
// 0x50 transitions and the same native guards; the renderer in client/trade-window.ts paints the
// sheet exactly where sub_4D4960 paints it. BtTrade/BtCoin raise the two native boxes
// (sub_4D61F0's confirm, sub_4D5F50's meso input) through the shared CUtilDlgEx dialogs.
const tradeModel = tradeState();
// The log's CCtrlScrollBar state (sub_4D5900/sub_452500 arithmetic lives in trade-state.ts).
const tradeLogScroll = tradeLogScroller();
const tradeView = tradeRenderer({
  ctx,
  image: artImage,
  // The trade room's member art is parsed straight onto the sheet (sub_482340) with no live
  // avatar node - there is not one sub_421E00 caller in the whole 004Dxxxx window range, so
  // the native trade avatars never animate. Stand frame 0 is faithful.
  avatars: (look, flip) => avatarCache.get(look, "stand1", 0, flip),
  icon: itemIcon,
});
tradeView.warm();

// ------------------------------------------------- 메신저 (CUIMessenger, ADR-095)
//
// The three-person chat room: model in client/messenger-state.ts, paint in
// client/messenger-window.ts, scrollbar in client/vscroll.ts. The StatusBar's BtChat
// (sub_4F6B70 id 1004 at bar-local (65,91), the bar sits at y=392) opens a fresh room;
// the invite modal's yes re-sends the room id from 0x4D type 3 (sub_4DDF10).
const messengerModel = messengerState();
const messengerView = messengerRenderer({
  ctx,
  image: artImage,
  // sub_4DFB50 builds each cell's avatar as a live Shape2D child window (v9[1], "Shape2D#
  // Vector2D" via sub_434120) that sub_4DEAF0 ticks every 30 ms - the stand animation runs
  // from the instant the cell is filled, driven by the member's own clock (member.since).
  avatars: (look, flip, since) => {
    const profile = avatarMotionCatalog.get(weaponIdOf(look))?.data;
    const stance = profile?.stand ?? "stand1";
    const frames = profile?.actions?.[stance]?.frames ?? [];
    const frame = frames.length
      ? Math.max(0, frames.indexOf(animationFrame(frames, performance.now() - since)))
      : 0;
    return avatarCache.get(look, stance, frame, flip);
  },
});
messengerView.warm();
const messengerScroll = messengerLogScroller();
let messengerOpen = false;
let messengerAt = { ...MESSENGER_WINDOW.home };
let messengerDrag, messengerScrollDrag = false;
let messengerHover, messengerPressed;
let messengerSuppressClick = false;
let messengerTypingSent = false, messengerTypingAt = 0;
const messengerSayInput = document.getElementById("messenger-say");
function messengerButtonAt(p) {
  return (
    loginScreens.stage === "game" && visualFieldActive && !revivePanel.open && !modalOpen() &&
    messengerButtonHit(p.x, p.y)
  );
}
function drawMessengerButton() {
  if (loginScreens.stage !== "game" || !visualFieldActive) return;
  paintMessengerButton(ctx, artImage, messengerPressed === "button", messengerHover === "button");
}
function positionMessengerInput() {
  messengerSayInput.style.left = `${messengerAt.x + MESSENGER_WINDOW.edit.x}px`;
  messengerSayInput.style.top = `${messengerAt.y + MESSENGER_WINDOW.edit.y}px`;
}
/** `sub_4DDF10(roomId)`: create the window first, the wire answer fills the cells. */
function openMessengerAt(roomId) {
  if (messengerOpen || !selfView || revivePanel.open || modalOpen() ||
      shop !== undefined || talkingNpc !== undefined) return;
  messengerAt = { ...MESSENGER_WINDOW.home };
  messengerHover = messengerPressed = messengerDrag = undefined;
  messengerScroll.reset();
  messengerModel.openLocal();
  messengerOpen = true;
  messengerTypingSent = false;
  messengerTypingAt = 0;
  send({ t: "messenger-enter", roomId });
  messengerSayInput.value = "";
  messengerSayInput.hidden = false;
  positionMessengerInput();
  messengerSayInput.focus();
  void audio.effect("UI/MenuUp");
}
/** `sub_4DDFA0`: the window goes away; the room only learns through `0x24 type 2`. */
function closeMessenger(notify = true) {
  if (!messengerOpen) return;
  messengerOpen = false;
  messengerHover = messengerPressed = messengerDrag = undefined;
  messengerScrollDrag = false;
  messengerScroll.reset();
  messengerModel.closeLocal();
  messengerSayInput.hidden = true;
  messengerSayInput.blur();
  messengerTypingSent = false;
  if (notify) send({ t: "messenger-leave" });
  void audio.effect("UI/MenuDown");
}
/** `sub_4DE490` + `sub_4E24B0` for one finished edit row. */
function messengerSubmit() {
  const text = messengerSayInput.value;
  messengerSayInput.value = "";
  if (!selfView || text === "") return;
  const say = messengerModel.say(text, selfView.name);
  if (say.kind === "close") return closeMessenger();
  if (say.kind === "command") return send({ t: "messenger-command", name: say.name });
  if (say.kind === "chat") {
    // sub_4DE490 prints the row locally first, then sends type 5.
    messengerModel.receive({ kind: "chat", line: say.line }, performance.now());
    return send({ t: "messenger-say", line: say.line });
  }
  if (text.startsWith("/초대"))
    messengerModel.receive({ kind: "chat", line: MESSENGER_TEXT.otherName }, performance.now());
}
/** `sub_4DEAF0`'s 3000 ms re-check of the typing flag, once per frame. */
function messengerTypingCheck(now) {
  if (!selfView || now - messengerTypingAt < 3000) return;
  const has = messengerSayInput.value !== "";
  if (has === messengerTypingSent) return;
  messengerTypingSent = has;
  messengerTypingAt = now;
  send({ t: "messenger-say", line: messengerModel.typingLine(selfView.name, has) });
}
messengerSayInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") { event.preventDefault(); messengerSubmit(); }
  else if (event.key === "Escape") messengerSayInput.blur();
});
messengerSayInput.addEventListener("blur", () => { messengerTypingAt = 0; });
function tradeLeave() {
  if (!tradeOpen) return;
  tradeOpen = false;
  tradeHover = tradeHoverOffer = undefined;
  tradeLogScroll.reset();
  tradeModel.clear();
  send({ t: "trade-leave" });
}
function tradeConfirmAsk() {
  const room = tradeModel.room;
  if (!room || room.sides[room.myIndex].confirmed) return;
  itemDialog.confirm({
    text: TRADE_TEXT.confirm,
    accept() {
      send({ t: "trade-confirm" });
    },
  });
}
function tradeMesoAsk() {
  const room = tradeModel.room;
  if (!room || room.participants.size <= 1) return;
  const mine = room.sides[room.myIndex];
  if (mine.confirmed) return;
  const max = Math.max(0, Math.floor(selfView?.mesos ?? 0));
  if (!Number.isInteger(max)) return;
  itemDialog.quantity({
    text: TRADE_TEXT.mesos,
    initial: mine.mesos,
    min: 0,
    max,
    accept(amount) {
      send({ t: "trade-offer-mesos", amount });
    },
  });
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
  return inventorySlotAtLayout(localX, localY, inventoryScrollbarGeometry().row);
}

/**
 * What of the window is at a surface point. `kind` is `close`, `tab`, `slot` (with `slot`) or
 * `body`; a point outside is `undefined`.
 */
function inventoryWindowAt(x, y) {
  // The sheet owns only geometry; whether it is on screen is the caller's state.
  if (!inventoryOpen || !selfView) return undefined;
  return inventoryHitAt({
    position: inventoryAt,
    x,
    y,
    tabView: inventoryTabView(),
    scroll: inventoryScrollbarGeometry(),
  });
}

/** One cell's painted content: the icon, centred in the slot, and its stack count. */
function inventoryCellPaint(item) {
  const icon = itemIcon(item.itemId);
  return {
    slot: item.slot,
    icon: {
      img: icon.img,
      ready: icon.ready,
      width: icon.img.naturalWidth,
      height: icon.img.naturalHeight,
    },
    count: inventoryStackCount(item),
  };
}

/** What `paintInventoryItems` needs: the open tab's items, the first visible row, the hovered slot. */
function inventoryItemsPaint() {
  const view = inventoryTabView();
  return {
    firstRow: inventoryScrollbarGeometry().row,
    cells: (view?.items ?? []).map(inventoryCellPaint),
    hovered: inventoryHover?.kind === "slot" ? inventoryHover.slot : undefined,
  };
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
  const closeState = inventoryPressed === "close" && inventoryHover?.kind === "close" ? "pressed"
    : inventoryHover?.kind === "close" ? "mouseOver" : "normal";
  const close = artImage(`UI/UIWindow.img/BtUIClose/${closeState}/0`);
  if (close.ready) ctx.drawImage(close.img, x + INVENTORY.close.x, y + INVENTORY.close.y);

  paintInventoryTabs(
    ctx,
    entry,
    INVENTORY_TABS.map((tab) => tab.label),
    x,
    y,
    inventoryTab,
  );
  paintInventoryItems(ctx, artImage, x, y, inventoryItemsPaint());

  paintInventoryScrollbar(
    ctx,
    artImage,
    x,
    y,
    inventoryScrollbarGeometry(),
    inventoryScrollDrag !== undefined,
    inventoryScrollPress.repeat.zone,
  );
  const coinState = inventoryCoinState({
    dead: selfView.hp <= 0,
    mesos: selfView.mesos,
    busy: mesoPending || slotPending || shopPending,
    pressed: coinPressed,
    hover: inventoryHover?.kind === "coin",
  });
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
    loginScreens.stage === "game" &&
    selfView?.hp > 0 &&
    !shop &&
    talkingNpc === undefined &&
    !slotPending &&
    !shopPending &&
    !mesoPending;
  if (
    !valid() ||
    modalOpen() ||
    performance.now() < mesoNextAt ||
    selfView.mesos < 10
  )
    return;
  const bounds = mesoDropBounds(selfView.mesos);
  itemDialog.quantity({
    text: "얼마를 버리시겠습니까?",
    initial: bounds.initial,
    min: bounds.min,
    max: bounds.max,
    at,
    accept: (amount) => {
      if (
        !valid() ||
        !socket ||
        socket.readyState !== WebSocket.OPEN ||
        !mesoDropAllowed(amount, selfView.mesos) ||
        performance.now() < mesoNextAt
      )
        return;
      mesoPending = true;
      mesoNextAt = performance.now() + 200;
      send({ t: "drop-mesos", amount });
    },
  });
}

/** Original per-source anchor and native item/equipment renderer. No template rescue for
 * missing inventory stats: only buy rows explicitly request a freshly constructed shop template. */
function drawItemTooltip(x, y, item, source) {
  if (item === undefined) return;
  if (!itemInfo.has(item.itemId)) void describeItem(item.itemId);
  const at = tooltipAnchor(source, x, y);
  nativeTips.item(at.x, at.y, itemInfo.get(item.itemId), item, nativeBasis?.basic,
    {template: source === 'shop' && shopWindowAt(x, y)?.kind === 'buy-row'});
}

/** Coalesced archive metadata:404 is absent; transient failures retry, never poison facts forever. */
function describeItem(itemId) { return itemMetadata.load(itemId); }

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
/** `sub_4521E0`'s held arrow for the shop, which - like the bag - keeps two plain row indices. */
const shopScrollPress = { side: "buy", repeat: pressRepeat() };
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

// shopVisibleRows / shopListOf / shopRowAt / shopTabAt now live in shop-window.ts (pure geometry),
// injected with the rows and scroll offsets the page owns.

/**
 * What of the shop is at a surface point. `kind` is `close`, `button` (with `button`), `tab` (with
 * `index`/`tab`), `buy-row`/`sell-row` (with `index`), `face` or `body`; a point outside is
 * `undefined`. The inventory window is drawn first, so a point both windows cover belongs to this
 * one - exactly the order the desktop client stacks its modeless windows in.
 */
function shopWindowAt(x, y) {
  // The sheet is pure geometry; whether a shop is open is the caller's state.
  if (shop === undefined || selfView === undefined) return undefined;
  return shopHitAt({
    position: shopAt,
    x,
    y,
    rows: { buy: shopRowsOf("buy"), sell: shopRowsOf("sell") },
    scroll: { ...shopScroll },
  });
}

/** One row's painted content: the icon, the stack count, the name and the price. */
function shopRowPaint(side, item) {
  const facts = itemInfo.get(item.itemId);
  if (facts === undefined) describeItem(item.itemId);
  const icon = itemIcon(item.itemId);
  return {
    icon: {
      img: icon.img,
      ready: icon.ready,
      width: icon.img.naturalWidth,
      height: icon.img.naturalHeight,
      raw: facts?.iconRaw,
    },
    stack: side === "sell" ? shopRowStackCount(item) : undefined,
    name: facts?.name ?? `Item ${item.itemId}`,
    // The shelf price on the left, the stack's value on the right (`info/price +
    // ceil(count x info/unitPrice)`, 4B4AD0). This is the native display basis, not a promise of
    // the reconstructed server's 50% resale policy.
    price: shopRowPrice(side, item, facts),
  };
}

/** What `paintShopList` needs for one side: the visible rows, the pick and the scroll offset. */
function shopListPaint(side) {
  const list = shopListOf(side);
  const rows = shopRowsOf(side);
  const scroll = shopScroll[side];
  const picked =
    side === "buy"
      ? shopBuyRow
      : rows.findIndex((entry) => entry.slot === shopSellPick?.slot);
  const visible = [];
  for (let row = 0; row < list.rows; row++) {
    const item = rows[row + scroll];
    visible.push(item === undefined ? undefined : shopRowPaint(side, item));
  }
  return {
    picked,
    scroll,
    total: rows.length,
    rows: visible,
    // The press belongs to one pane: the other one's bar keeps its idle art.
    pressed: shopScrollPress.side === side ? shopScrollPress.repeat.zone : undefined,
  };
}

/**
 * `sub_4523D0`, the control's OnTimer, for the two windows that borrow only the press half of it.
 * The zone is re-hit from the live cursor every tick - never from the one the press started in -
 * so sliding off the arrow stops the repeat and sliding back resumes it, and `sub_4524C0`'s 50 ms
 * gate sets the cadence. The thumb never repeats: `sub_4526A0` moves it through the drag instead.
 */
function tickScrollPresses(now) {
  const shopZone = shopScrollPress.repeat.zone,
    bagZone = inventoryScrollPress.repeat.zone;
  // Nothing held: this runs every frame, so do not pay for two window hit tests to learn that.
  if (shopZone === undefined && bagZone === undefined) return;
  const zone = (hit) => (hit?.kind === "scrollbar" ? hit.part : undefined);
  const shopHit =
    shopZone === undefined || pointerAt === undefined ? undefined : shopWindowAt(pointerAt.x, pointerAt.y);
  const bagHit =
    bagZone === undefined || shopHit !== undefined || pointerAt === undefined
      ? undefined
      : inventoryWindowAt(pointerAt.x, pointerAt.y);
  if (shopScrollPress.repeat.tick(now, zone(shopHit)))
    shopScrollAct(shopScrollPress.side, shopScrollPress.repeat.zone);
  if (inventoryScrollPress.repeat.tick(now, zone(bagHit)))
    inventoryScrollAct(inventoryScrollPress.repeat.zone);
}

/**
 * The same press for the shop, over `shopVisibleRows(side)` - four in the buy pane, and the sell
 * pane's own count. Both panes keep a plain row index, so neither has a `CCtrlScrollBar` to own it.
 */
function shopScrollAct(side, zone) {
  if (zone === undefined || zone === "thumb") return;
  const delta =
    zone === "prev"
      ? -1
      : zone === "next"
        ? 1
        : zone === "pageUp"
          ? -shopVisibleRows(side)
          : shopVisibleRows(side);
  setShopScroll(side, shopScroll[side] + delta);
}

/** Clamp scrolling after wheel/arrow/track/drag input, including a shrinking inventory. */
function setShopScroll(side, position) {
  shopScroll[side] = clampShopScroll(side, shopRowsOf(side).length, position);
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

function shopScrollbarGeometry(side) {
  return shopScrollGeometry(side, shopRowsOf(side).length, shopScroll[side]);
}

/**
 * The four category tabs, built out of `UI/Basic.img/Tab` the way `CCtrlTab` (sub_4582A0) paints
 * them: one 4-px `left` cap, a run of 1-px `fill` columns per tab, a 14-px `middle` crease at each
 * tab's right edge, and one 12-px `right` cap that fades back into the sheet's navy strip. The
 * crease is state 1 under the lit tab and state 2 when the next tab is the lit one (its gradient
 * runs light-blue to white).
 */
function drawShopTabs(originX, originY) {
  paintShopTabs(ctx, artImage, originX, originY, shopTab);
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
  paintShopList(ctx, artImage, "buy", x, y, shopListPaint("buy"));
  paintShopList(ctx, artImage, "sell", x, y, shopListPaint("sell"));
  drawShopTabs(x, y);
  drawShopButton("buy", x, y);
  drawShopButton("sell", x, y);
  drawShopButton("recharge", x, y);
  const closeState = shopPressed === "close" && shopHover?.kind === "close" ? "pressed"
    : shopHover?.kind === "close" ? "mouseOver" : "normal";
  const close = artImage(`UI/UIWindow.img/BtUIClose/${closeState}/0`);
  if (close.ready) ctx.drawImage(close.img, x + SHOP.close.x, y + SHOP.close.y);
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
  for (const base of ["UI/UIWindow.img/BtUIClose", ...["Buy", "Sell", "Recharge"].map(name => `UI/UIWindow.img/Shop/Bt${name}`)])
    for (const state of base.endsWith("BtRecharge") ? ["normal", "mouseOver", "pressed", "disabled"] : ["normal", "mouseOver", "pressed"])
      artImage(`${base}/${state}/0`);
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
  if (!row || shopBlocked()) return;
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
    // 4B6B40's tail: once the buy goes out, the inventory flips to the item's own tab.
    const tab = inventoryTabOfItem(row.itemId);
    if (inventoryTab !== tab) {
      inventoryTab = tab;
      try {
        localStorage.setItem("kms111.inventoryTab", String(inventoryTab));
      } catch {}
      inventoryPick = undefined;
    }
  };
  const ask = shopBuyCount(row.itemId);
  if (ask === "confirm")
    itemDialog.confirm({
      text: "정말로 사시겠습니까?",
      accept: () => commit(1),
    });
  else if (ask === "one") commit(1);
  else
    itemDialog.quantity({
      text: "몇 개를 사시겠습니까?",
      ...shopBuyBounds(row.maxCount),
      accept: commit,
    });
}

/** 4B4AD0: find a matching 207 service row, then missingCharges * rowDouble. */
function rechargeQuote(item) {
  if (
    !shop ||
    shopTab !== 2 ||
    !item ||
    !isRechargeableItem(item.itemId) ||
    item.cash
  )
    return undefined;
  const row = shop.rechargeables?.find((r) => r.itemId === item.itemId);
  if (!row) return undefined;
  const total = rechargeableRefillCost(row.maxCount, row.unitPrice, item.quantity ?? 0);
  return total === undefined ? undefined : { total, maxCount: row.maxCount };
}
function rechargeShopItem(item) {
  const quote = rechargeQuote(item),
    opened = shop,
    epoch = itemEpoch;
  if (!quote || shopBlocked()) return;
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
  if (!item || !shop || shopBlocked()) return;
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
  if (isRechargeableItem(item.itemId))
    itemDialog.confirm({
      text: "정말로 파시겠습니까?",
      accept: () => commit(quantity),
    });
  else
    itemDialog.quantity({
      text: "몇 개를 파시겠습니까?",
      ...shopSellBounds(quantity),
      accept: commit,
    });
}

/** The five gates a buy, sell or recharge request passes before it can go out. */
function shopBlocked() {
  return shopActionBlocked({
    shopPending,
    slotPending,
    mesoPending,
    modalOpen: modalOpen(),
    hp: selfView?.hp,
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

/** ESC/header close is 0xFF for say/confirm, not the previous-page answer (0). */
function closeDialogue(notify = true) {
  tooltipViewer.close(notify);
  npcDialog.close(notify);
  if (!notify) talkingNpc = undefined;
}

/**
 * `I`, the ITEM button and the sheet's own CLOSE all land here. No packet is involved: the window
 * is drawn from state the page already has (`sub_4DA1C0` keeps it in the client too).
 */
function toggleInventory(force) {
  const show = force ?? !inventoryOpen;
  if (show) for (const state of ["normal", "mouseOver", "pressed"])
    artImage(`UI/UIWindow.img/BtUIClose/${state}/0`);
  if (show !== inventoryOpen)
    void audio.effect(show ? "UI/MenuUp" : "UI/MenuDown");
  inventoryOpen = show;
  if (!show) {
    inventoryHover = inventoryPressed = undefined;
    inventoryPick = undefined;
    inventoryDrag = undefined;
    inventoryScrollDrag = undefined;
    itemDrag = undefined;
  }
}


// ---------------------------------------------------------------- input

ui.logToggle.addEventListener("click", () => ui.log.classList.toggle("hidden"));
// Native F1..F7 plus explicitly browser-only helper buttons. Both go through the same gates.
function canSendEmotion() {
  return loginScreens.stage === "game" && visualFieldActive && selfView && !portalPending &&
    socket?.readyState === WebSocket.OPEN && !document.hidden &&
    !(selfSwing && performance.now() < selfSwing.start + attackDuration(selfSwing)) &&
    !revivePanel.open && !itemDialog.open && !systemPanel.visible && !browserLabOpen() &&
    !npcDialog.open && !tooltipViewer.open && !talkingNpc && !shop;
}
function requestEmotion(value) {
  if (!canSendEmotion()) return;
  const now = performance.now();
  if (setFace(selfView, value, now, -1, stanceOfEntity(selfView, now).stance)) send({t:"emotion",value});
}
ui.emotes.setAttribute("aria-label", "瀏覽器表情輔助按鈕；原快捷鍵F1–F7");
ui.emotes.replaceChildren(...EMOTE_KEYS.map((value) => {
  const button = document.createElement("button");
  button.type = "button"; button.textContent = EMOTE_NAMES[value]; button.disabled = true;
  button.title = `F${value} · ${EMOTE_NAMES[value]}（瀏覽器輔助入口）`;
  button.addEventListener("click", () => requestEmotion(value));
  return button;
}));

// Keys feed the fixed-step vecctrl reconstruction; network snapshots do not drive local physics.
window.addEventListener("keydown", (event) => {
  if (loginScreens.stage !== "game") {
    return;
  }
  if (motionSettings.open) {
    if (event.key === "Escape") { event.preventDefault(); motionSettings.close(); }
    return;
  }
  if (revivePanel.open || modalOpen() || testToolsPanel.open || npcDialog.open || tooltipViewer.open) return;
  // Input owns Enter, I and WASD as well as arrows; none should leak to the game.
  if (
    isEditingControl(document.activeElement) &&
    document.activeElement !== ui.say
  )
    return;
  if (document.activeElement === ui.say) {
    if (event.key === "Escape") ui.say.blur();
    return;
  }
  if (/^F[1-7]$/.test(event.key) && !event.altKey && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    if (!event.repeat) requestEmotion(Number(event.key.slice(1)));
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    ui.say.focus();
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    if (itemDrag || quickDrag) { itemDrag = quickDrag = undefined; return; }
    if (inventoryOpen) { toggleInventory(false); return; }
    if (equipPanel.open) { equipPanel.toggle(false); return; }
    if (statPanel.open) { statPanel.toggle(false); return; }
    if (skillPanel.open) { skillPanel.toggle(false); return; }
    if (shop !== undefined) { closeShop(); return; }
    if (talkingNpc !== undefined) { closeDialogue(); return; }
    if (!event.repeat) systemPanel.open();
    return;
  }
  const quickIndex = QUICK_SLOTS.findIndex(s => s.key === event.key);
  if (quickIndex >= 0) {
    event.preventDefault();
    const id = quickProfile?.values()[quickIndex];
    if(quickSkillAllowed(id))void swing(id.skillId);
    else if (id) useBagItem(quickItemState(inventory, id).item, quickSlotUseRoute(id));
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
  if (event.key.toLowerCase() === "k") {
    event.preventDefault();
    if (!event.repeat) skillPanel.toggle();
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
  // Ctrl is the 2003 client's attack key (511E20's basic-attack dispatch, not its F-key/emote branch). A held
  // key repeats, so the page swings on keydown and lets `swing()` own the cooldown.
  if (event.key === "Control") {
    event.preventDefault();
    swing();
    return;
  }
  // A key pressed while the login fields are focused belongs to them, not to the character.
  const focused = document.activeElement;
  if (isEditingControl(focused)) return;
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
    if ((key === "alt" || key === " ") && !event.repeat && !movementBlocked() &&
        !(selfSwing && attackFrame(selfSwing, performance.now()) >= 0)) requestPlayerJump(playerBody);
  }
});
window.addEventListener("keyup", (event) =>
  keys.delete(event.key.toLowerCase()),
);

// Selected-step controller records are batched at 10Hz; flush their ordered path before an attack.
function publishPlayerMotion() {
  if (
    !self ||
    !selfView ||
    !playerBody ||
    portalPending ||
    map?.id !== self.mapId || socket?.readyState !== WebSocket.OPEN
  )
    return false;
  const snapshot = movementSnapshot(playerBody);
  const path = drainPlayerPath(playerBody);
  const state = JSON.stringify({...snapshot, attr: 0});
  const stationary = path.elements.every(element => !element.attr &&
    ["x", "y", "vx", "vy", "action", "foothold"].every(key => element[key] === snapshot[key]));
  if (state === lastSentMotion && stationary) return true;
  lastSentMotion = state;
  send({t: "move", path});
  return true;
}
setInterval(publishPlayerMotion, MOVE_TICK_MS);
window.addEventListener("blur", () => {
  recovery.reset();
  previousContactPlayer = undefined; previousContactMobs.clear();
  keys.clear();
  if (playerBody) resetPlayerPresentation(playerBody);
  lastPhysicsAt = undefined;
});

/**
 * Browser commands; map jumps still use the native 0x0D packet and server-side operator policy.
 *
 * The ordinary-player commands are `/귓속말` and `/찾기`; the spellings never reach the wire - the
 * client translates them into `0x23` kind 0x06 / 0x05 itself - so `/w` and `/f` are this page's own
 * names for the same two requests (ADR-036). Native social commands now share the strict router;
 * a slash line never falls through to field chat (also enforced at the bridge boundary).
 *
 * @param {string} text what was typed
 * @param {() => void} local print a line in this page's own chat box
 * @returns {boolean} true when the line was a command and must not be sent as chat
 */
function runCommand(text, local) {
  if (/^\/(tools|test)$/i.test(text)) {
    if (loginScreens.stage === "game") testToolsPanel.openPanel();
    else local("系統", "請先進入地圖；體驗工具只對伺服器明確授權帳號開放。");
    return true;
  }
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
      "/tools 開啟體驗工具（非原版、需授權）、/map ID（別名 /warp、/go、/헉맵；需開放權限）、/maps [關鍵字]、/where、/w 名字 訊息（原 /귓속말）、/f 名字（原 /찾기）、/파티정보、/party info|create|leave|invite 名字|kick 名字|accept|decline、/교환 名字（原交易邀請）。舊附接端邀請／接受暫停。傳送點：地面按↑；type 3 自動進入；M 顯示／隱藏小地圖。",
    );
    return true;
  }
  if(runSocialCommand(text,{
    request:beginUserRequest,
    error:message=>local("系統",message),
    party(command,name){
      if(!socialCommandsEnabled){local("系統","此入口尚未載入派對指令，請使用新版附接入口。");return;}
      send({t:'party-command',command,name});
    },
    trade(name){
      if(!tradeEnabled){local("系統","此入口尚未載入交易房，請使用新版附接入口。");return;}
      send({t:'trade-invite',name});
    },
  }))return true;
  if(text.startsWith('/')){local("系統","未知指令，輸入 /help 查看指令。");return true;}
  return false;
}

// Shared strict edit lifecycle; gameplay and transport remain owned by this integration.
chatEntry({
  input:ui.say,
  onFocus(){keys.clear();localActionEpoch++;quickDrag=undefined;},
  command:text=>runCommand(text,chatLine),
  send(text){if(whisperRecipient)beginUserRequest(whisperRecipient,text);else send({t:'say',text});},
});

/** The first thing a user sees; also what a refresh returns to. */
loginScreens.start();
logLine(
  `page loaded; ws target ${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
);

const creationDialogs = characterDialogs({
  ctx,
  image: artImage,
  avatar: avatarFrame,
  face: sampleAvatarFace,
  bodyPose: sampleAvatarMotion,
  send,
  audio,
  log: logLine,
  busy(value) {
    loginScreens.setSelectionPending(value);
  },
  getSelected: () => loginScreens.selectedCharacter,
  isCharacterStage: () => loginScreens.stage === "characters",
});

const statPanel = statWindow({
  ctx,
  image: artImage,
  send,
  audio,
  getSelf: () => selfView,
  isInGame: () => loginScreens.stage === "game",
  point: viewPoint,
  jobName: jobNameOf,
  getBasis:()=>nativeBasis, getTemporary:()=>buffs.values(performance.now()), getAmmoPad:()=>nativeAmmoPad,
  log: logLine,
});

const skillPanel = skillWindow({
  ctx,
  onUse:id=>void swing(id),onBindDrag:beginSkillDrag,
  tooltipRenderer: nativeTips, image: artImage, send, audio, point: viewPoint,
  getSelf: () => selfView, isInGame: () => loginScreens.stage === "game",
  log: logLine, isModal: () => !visualFieldActive || !(selfView?.hp > 0) || portalPending || !!itemDrag || !!quickDrag ||
    modalOpen() || browserLabOpen() || talkingNpc !== undefined,
});

const miniMapPanel = miniMapWindow({
  ctx,
  image: artImage,
  getSelf: selfDisplayPosition,
  getUsers: () => [...users.values()],
  isInGame: () => loginScreens.stage === "game",
  point: viewPoint,
  onVisibilityChange:shown=>systemPanel.setMiniMap(shown),
  isCovered: (p) =>
    skillPanel.contains(p.x, p.y) ||
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
  isInGame: () => loginScreens.stage === "game",
  point: viewPoint,
  audio,
  beginItem: beginItemDrag,
  describe: describeItem,
  isCovered: (p) => skillPanel.contains(p.x, p.y) || shopWindowAt(p.x, p.y) !== undefined,
  hover(item, p) {
    equipHover = item;
    if (p) pointerAt = p;
  },
});

let selfDeathSettled = false, visualFieldActive = false, lastAttackTrace;
const deathFx = deathEffects({
  image: artImage, log: logLine,
  sound: point => void audio.effect("Game/Tombstone", spatialVolume(point.x, point.y, self)),
});
const speechBalloons=chatBalloons({image:artImage});
const npcBalloons=chatBalloons({image:artImage});
const npcVisuals=npcPresentation({balloons:npcBalloons,seed:globalThis.crypto?.getRandomValues(new Uint32Array(1))[0]??(Date.now()>>>0),
  send:value=>{
    if(!visualFieldActive||!self||socket?.readyState!==WebSocket.OPEN)return false;
    send({t:'npc-idle',mapId:self.mapId,...value});return true;
  },
});
const damageArt = damageNumbers({image:artImage,log:logLine});
void damageArt.preload();
const buffs = temporaryStats();

const revivePanel = reviveWindow({
  ctx,
  image: artImage,
  send,
  isInGame: () =>
    loginScreens.stage === "game" && socket?.readyState === WebSocket.OPEN,
  onOpen() {
    playerContext.close(false);
    localActionEpoch++;systemPanel.close(false,false);quickDrag=undefined;
    itemDialog.close(false);
    testToolsPanel.close();
    keys.clear();
    closeShop(false);
    closeDialogue(false);
    itemDrag =
      inventoryDrag =
      inventoryScrollDrag =
      shopDrag =
      shopScrollDrag =
        undefined;
    // The next field owns NPC-session cleanup; do not fabricate a vital mutation here.
    ui.say.blur();
  },
});

const recovery = naturalRecovery({
  getSelf:effectiveSelf, getBody:()=>playerBody, getMap:()=>map,
  getAction:()=>selfSwing && attackFrame(selfSwing,performance.now())>=0 ? selfSwing.action : nativeBodyAction(playerBody, selfView?.bodyProfile),
  isInGame:()=>loginScreens.stage==="game"&&!document.hidden,send,log:logLine,
});
/** Read-only ordinary-action inspector: its actor/look/virtual rope Y are NOT the field actor. */
function resetAvatarPreview() {
  avatarPreviewActor = {y:0}; avatarPreviewLast = undefined;
  const canvas = document.getElementById("qa-motion-canvas");
  canvas?.getContext?.("2d")?.clearRect?.(0,0,canvas.width,canvas.height);
}
function drawAvatarPreview(now, controls) {
  const canvas = document.getElementById("qa-motion-canvas"), painter = canvas?.getContext?.("2d");
  if (!painter || !selfView) return "尚未進入場地。";
  const current = lookOf(selfView), selected = controls.weapon === "self" ? weaponIdOf(current) : Number(controls.weapon);
  if (controls.weapon !== "self" && ![0,1302000,1402000,1412000,1452000,1462000,1472000].includes(selected)) return "未知閱覽模板。";
  const look = controls.weapon === "self" ? {...current,items:[...current.items]} : {...current,
    items:[...current.items.filter(id => !(id>=1300000 && id<1500000) && Math.floor(id/10000)!==109),...(selected?[selected]:[])]};
  const elapsed = avatarPreviewLast === undefined ? 0 : Math.max(0,Math.min(250,now-avatarPreviewLast));
  avatarPreviewLast = now;
  if (["rope","ladder"].includes(controls.action) && controls.climbing) avatarPreviewActor.y += elapsed * 0.1;
  const direction = controls.left ? 1 : 0;
  let pose, attack, attackOrdinal;
  const attackPreview = ["basicMelee", "basicShoot", "proneStab"].includes(controls.action);
  painter.clearRect(0,0,canvas.width,canvas.height); painter.imageSmoothingEnabled = false;
  if (attackPreview) {
    // Read-only deterministic loop: no gameplay RNG, sound, ammo, attack command or actor mutation.
    void ensureAttackProfile(look);
    const baseProfile = combatCatalog.peekAttack(selected);
    const profile=baseProfile&&attackProfileAtTier(baseProfile,attackMasteryTier(baseProfile,id=>skillPanel.level(id),controls.action==='basicShoot'));
    if (!profile) return selected ? "攻擊metadata載入中／失敗後5秒重試。" : "原版此路徑不提供徒手假劍揮。";
    const action = controls.action === "proneStab" ? profile.prone
      : controls.action === "basicShoot" ? profile.shoot[0] : profile.melee[0];
    if (!action) return "此WZ武器沒有所選普通攻擊；不拿其他姿勢替代。";
    const key = `${JSON.stringify(look)}|${direction}|${controls.action}|${profile.afterimageTier}`;
    attack = avatarPreviewActor.previewAttack;
    if (!attack || attack.key !== key || now-attack.start>=Math.max(attackDuration(attack),shotRelease(attack)+(attack.afterimage??[]).reduce((n,f)=>n+f.delay,0))+200)
      attack = avatarPreviewActor.previewAttack = {...action, key, start:now};
    delete avatarPreviewActor.animation;
    attackOrdinal = attackFrame(attack, now);
    pose = attackOrdinal>=0?{stance:attack.stance, frame:attackCanvasFrame(attack, attackOrdinal)}:{stance:avatarMotionCatalog.get(selected)?.data?.stand??"stand1",frame:0};
  } else {
    delete avatarPreviewActor.previewAttack;
    pose = sampleAvatarMotion(avatarPreviewActor,look,controls.action,now,avatarPreviewActor.y,direction);
  }
  const face = sampleAvatarFace(avatarPreviewActor,look,now);
  let image = avatarFrame(look,pose.stance,pose.frame,facingFlip(direction),face.emotion,true,face.frame);
  if (!image.ready) image = avatarFrame(look,pose.stance,pose.frame,facingFlip(direction),undefined,true);
  if (image.ready) {
    const h=image.planeHeight,w=image.img.naturalWidth,x=120+image.dx,y=118+image.dy;
    const planes=h>0 && image.img.naturalHeight===h*2;
    if (planes) painter.drawImage(image.img,0,0,w,h,x,y,w,h);
    else painter.drawImage(image.img,x,y);
    if(planes) painter.drawImage(image.img,0,h,w,h,x,y,w,h);
    const effect=attack && oneShotFrame(attack.afterimage,now-attack.start-shotRelease(attack));
    const effectImage=effect && artImage(effect.path);
    if(effectImage?.ready) {
      painter.save();painter.translate(120,118);if(facingFlip(direction))painter.scale(-1,1);
      painter.globalAlpha=effect.alpha??1;painter.drawImage(effectImage.img,-effect.ox,-effect.oy);painter.restore();
    }
  }
  const metadata=avatarPreviewActor.bodyProfile?.weaponId === selected ? avatarPreviewActor.bodyProfile : avatarMotionCatalog.get(selected)?.data;
  const timing=attack ? `；動作${attack.action}，原始縮放delay [${attack.delays.join(",")}]，身體倒數總長${attackDuration(attack)}ms；殘影從${shotRelease(attack)}ms起、獨立30ms／末格200ms淡出` : "";
  return `唯讀模板 ${selected || "無武器"}：${metadata ? `${metadata.walk}／${metadata.stand}` : "metadata載入中／失敗後5秒重試"}；`+
    `${pose.stance}/${pose.frame}；${image.ready ? "原PNG" : "PNG載入中"}${timing}。`;
}

const mobPreview=mobAttackPreview({canvas:document.getElementById('qa-mob-canvas'),image:artImage});
const testToolsPanel = testTools({
  drawMobPreview:(now,controls)=>mobPreview.draw(now,controls),resetMobPreview:()=>mobPreview.reset(),
  drawMotionPreview: drawAvatarPreview,
  resetMotionPreview: resetAvatarPreview,
  getNpcStatus() {
    const now=performance.now(),lines=[];
    for(const npc of [...npcs.values()].slice(0,8)) {
      const state=npcVisuals.snapshot(npc.npcId,now);if(!state)continue;
      const title=`${npcMetadata.get(npc.templateId)?.name||'NPC'} #${npc.templateId} (${Math.round(npc.x)},${Math.round(npc.y)})`;
      lines.push(`${title}：${state.controlled?'本頁控制':'接收端'}／${state.action}`+
        `${state.metadata?'':'／資料讀取中'}${state.waiting?'／等待回包':''}${state.speaking?'／氣泡中':''}`+
        `${state.reply?`／收 ${state.reply.action},${state.reply.speech}`:''}／方向bit ${state.facing}／${state.flip?'鏡像':'原圖'}／名牌${npcVisuals.speaking(npc.npcId,now)&&npcBalloons.visible(npc.npcId,npcVisuals.originY(npc.npcId),now)?'隨原氣泡暫隱':'顯示'}`);
    }
    return `NPC 唯讀（非原版工具，不強制演出）：${lines.join('；')||'此圖沒有NPC。'}${npcs.size>8?`；另${npcs.size-8}位`:''}`;
  },
  getCombat() {
    if (!nativeBasis) return "尚未取得有效能力。";
    const temporary = buffs.values(performance.now());
    const worn = nativeWornFacts.find(item => item.slot === 11);
    const pad = Math.max(0, Math.min(999, nativeBasis.secondary.pad + (temporary.pad ?? 0) + nativeAmmoPad));
    let text = `唯讀戰鬥資料（非原版）：STR ${nativeBasis.basic.str}／DEX ${nativeBasis.basic.dex}／LUK ${nativeBasis.basic.luk}；` +
      `有效武器 ${nativeBasis.weaponId || "無"}；裝備PAD ${nativeBasis.secondary.pad}＋藥水 ${temporary.pad ?? 0}＋彈藥 ${nativeAmmoPad}＝射擊PAD ${pad}。近戰不加彈藥。`;
    if (worn && !nativeBasis.effectiveSlots.includes(11)) text += " 目前武器未通過原有效穿戴條件，不提供能力。";
    if (worn?.stats.pad === 0) text += " 武器實例PAD為0；若是舊版全零起始裝備，可在確認後修復。";
    text += ` Detail第一列不是每次傷害或傷害上下限。射擊遠界 ${nativeShotRange}px（200＋原被動range）。`;
    if (playerBody) text += ` 移動byte ${actionOf(playerBody)}／普通body action ${nativeBodyAction(playerBody,selfView?.bodyProfile)}`+
      `／強制攻擊 ${selfSwing && attackFrame(selfSwing,performance.now())>=0 ? selfSwing.action : "無"}`+
      `／警戒倒數 ${playerBody.attackAlert?.remaining??0}ms。`;
    const t = lastAttackTrace;
    if (t) {
      const number = value => Number.isFinite(value) ? value.toFixed(2) : "—";
      text += ` 上次有目標攻擊：PAD ${t.pad}、動作 ${t.action}、等差 ${t.levelDifference}；`;
      if (t.reason !== "miss") text += `mastery ${t.mastery}、原始 ${number(t.raw)}→等差後 ${number(t.afterLevel)}→屬性後 ${number(t.afterAttribute)}−防禦 ${number(t.defense)}，` +
        `特殊倍率 ${number(t.criticalMultiplier)}→截整／限制前 ${number(t.beforeClamp)}→實際 ${t.damage}。`;
      if (t.reason === "miss") text += ` 未命中：${number(t.hitRoll)} < EVA ${t.mobEva}，傷害0；未執行後續傷害算式，不是最低傷害1。`;
      else if (t.reason === "zero-pad") text += " 原因：總PAD為0，成功命中仍被限制為1。";
      else if (t.reason === "no-effective-weapon") text += " 原因：沒有有效武器。";
      else if (t.reason === "minimum") text += " 本次低擲值／等差／防禦／特殊倍率後落在最低傷害區間。";
    }
    const now=performance.now(),near=[...mobs.values()].filter(m=>!dying.has(String(m.mobId)))
      .sort((a,b)=>Math.abs(a.x-(self?.x??0))-Math.abs(b.x-(self?.x??0))).slice(0,3);
    if(near.length)text+=' 附近怪物動作（唯讀）：'+near.map(m=>{
      const hit=mobForces.get(String(m.mobId)),frames=hit&&(mobArts.get(m.templateId)?.[mobForcedName(hit.action)]??[]);
      const remaining=hit?Math.max(0,hit.since+(hit.duration??frames.reduce((n,f)=>n+f.delay,0))-now):0;
      const reaction=Math.max(0,(m.reactionUntil??0)-now);
      return `#${m.mobId}/${m.templateId} pushed=${mobPushThreshold.get(m.templateId)??'載入中'}、${remaining>0?`${mobForcedName(hit.action)} ${Math.ceil(remaining)}ms`:'無forced窗'}、raw受擊窗=${Math.ceil(reaction)}ms、MP=${m.mp??mobMetadata.get(m.templateId)?.maxMP??'載入中'}、可用招式=${mobMetadata.get(m.templateId)?.attacks.length??'載入中'}`;
    }).join('；')+'。';
    return text;
  },
  getMovement(){
    if (loginScreens.stage!=="game") return;
    const now=performance.now();
    const active=buffs.icons(now).find(entry=>entry.values.speed!==undefined);
    const totals=statTotals(nativeBasis,buffs.values(now));
    return {...effectiveMovement(now), eva:totals?.eva,pdd:totals?.pdd,contactRemaining:contact.remaining, contactPending:!!contactPending,
      secondsLeft:active ? Math.max(0,Math.ceil((active.expiresAt-now)/1000)) : undefined};
  },
  send,getSelf:()=>selfView,isInGame:()=>loginScreens.stage==="game",log:logLine,
  onOpen(){if(tooltipViewer.open)closeDialogue(false);localActionEpoch++;systemPanel.close(false,false);quickDrag=undefined;itemDialog.close(false);keys.clear();itemDrag=undefined;inventoryDrag=inventoryScrollDrag=shopDrag=shopScrollDrag=undefined;},openSkills(){skillPanel.toggle(true);},
  openDialogue:openDialogueExample,
  openTooltip:openTooltipExample,
});
document.addEventListener?.("visibilitychange",()=>{recovery.reset();previousContactPlayer=undefined;previousContactMobs.clear();if(document.hidden){keys.clear();if(playerBody)resetPlayerPresentation(playerBody);lastPhysicsAt=undefined;}});

const itemDialog = itemDialogs({
  ctx,
  image: artImage,
  audio,
  onOpen() {
    playerContext.close(false);
    localActionEpoch++;quickDrag=undefined;
    keys.clear();
    itemDrag = undefined;
    inventoryDrag = inventoryScrollDrag = undefined;
    shopDrag = shopScrollDrag = undefined;
    inventoryPick = inventoryHover = equipHover = undefined;
  },
});

const feedback = gameFeedback({
  dialog: itemDialog, item: describeItem, now: () => performance.now(),
  chat: text => chatHistoryPanel.append(text, "notice"),
  blocked: () => creationDialogs.open || revivePanel.open || talkingNpc !== undefined || playerContext.open || systemPanel.visible || browserLabOpen(),
  onError: error => logLine(`feedback resource: ${String(error)}`),
});


const npcDialog = npcDialogue({ctx,image:artImage,audio,point:viewPoint,
  onOpen: beginContentModal,
  onReply(reply, context) {
    talkingNpc=undefined;
    if(context?.preview) {
      logLine(`UI 範例（未送封包）：${JSON.stringify(reply)}`);
      if(context.exampleKind === "say" && reply.kind === "say" && reply.answer !== 255 &&
          ((context.page === 0 && reply.answer === 1) || (context.page === 1 && reply.answer === 0)))
        openDialogueExample("say",reply.answer === 1 ? 1 : 0);
      return;
    }
    send({t:"talk",...reply});
  },
});

function beginContentModal() {
  talkingNpc = true; // Shared content-modal sentinel, not a fabricated NPC identity.
  playerContext.close(false);
  localActionEpoch++; keys.clear(); ui.say.blur();
  itemDialog.close(false); systemPanel.close(false,false); testToolsPanel.close();
  chatHistoryPanel.cancelDrag(); quickDrag=itemDrag=undefined;
  inventoryDrag=inventoryScrollDrag=shopDrag=shopScrollDrag=undefined;
  inventoryPick=inventoryHover=equipHover=pointerAt=undefined;
}

const tooltipViewer = tooltipPreview({renderer:nativeTips, point:viewPoint,
  getBasic:()=>nativeBasis?.basic,
  getInstance:()=>inventory?.worn?.find(i=>i.slot===11) ?? inventory?.worn?.[0] ?? inventory?.tabs?.find(t=>t.tab===1)?.items?.[0],
  onOpen:beginContentModal, onClose(){talkingNpc=undefined;},
});

function openTooltipExample(kind) {
  if(loginScreens.stage!=="game" || !visualFieldActive || selfView?.hp<=0 || talkingNpc!==undefined ||
      revivePanel.open || modalOpen() || shop!==undefined ||
      shopPending || slotPending || mesoPending || portalPending)return false;
  return tooltipViewer.show(kind);
}

function openDialogueExample(kind, page = 0) {
  const body=dialogueExample(kind,page);
  if(!body || loginScreens.stage!=="game" || !visualFieldActive || selfView?.hp<=0 ||
      talkingNpc!==undefined || revivePanel.open || modalOpen() ||
      shop!==undefined || shopPending || slotPending || mesoPending || portalPending)return false;
  return npcDialog.show(0,body,{preview:true,page,exampleKind:kind});
}

const systemPanel = systemMenu({ctx,image:artImage,audio,point:viewPoint,
  onGameSettings:value=>miniMapPanel.setShown(value.minimap),
  canOpen:()=>loginScreens.stage==="game" && visualFieldActive && selfView?.hp>0 && !portalPending &&
    socket?.readyState===WebSocket.OPEN && !revivePanel.open && !itemDialog.open && !browserLabOpen() &&
    shop===undefined && talkingNpc===undefined && !shopPending && !slotPending && !mesoPending &&
    !tradeOpen,
  onOpen(){
    playerContext.close(false);
    localActionEpoch++; keys.clear(); chatHistoryPanel.cancelDrag();itemDrag=quickDrag=undefined;
    inventoryDrag=inventoryScrollDrag=shopDrag=shopScrollDrag=undefined;
    inventoryPick=inventoryHover=equipHover=undefined; pointerAt=undefined;ui.say.blur();
  },
  onQuit(){
    if(socket?.readyState!==WebSocket.OPEN)return;
    quitToTitle=true;socket.close(1000,"return to title");
  },
});

/** 5128B0's user-pool hit is world-space; lens zoom only changes the inverse projection.
 * Weak keys retain the previous rendered remote pose without keeping departed actors alive.
 */
let playerMenuEnabled = false, partyInviteIdentity = false, socialCommandsEnabled = false;
const playerHitHistory = new WeakMap();
const partyMenuState = playerMenuParty();
const partyPrompt = partyInvitation({
  modal:itemDialog,
  context:()=>loginScreens.stage==='game' && visualFieldActive && selfView?.hp>0 && !portalPending ? self : undefined,
  canOpen:()=>!modalOpen() && talkingNpc===undefined && !browserLabOpen() && !tradeOpen,
  available:()=>partyInviteIdentity,
  reply:(inviterId,accepted)=>send({t:'party-response',inviterId,accepted}),
  unavailable:()=>chatHistoryPanel.append('此附接入口未證實原生server邀請身份保護，已暫停派對邀請／接受；既有世界未重啟。','fame'),
});
function canOpenPlayerMenu() {
  return playerMenuEnabled && loginScreens.stage==="game" && visualFieldActive && selfView?.hp>0 &&
    socket?.readyState===WebSocket.OPEN && map?.id===self?.mapId && !portalPending &&
    !revivePanel.open && !itemDialog.open && !systemPanel.visible && !browserLabOpen() &&
    talkingNpc===undefined && shop===undefined && !shopPending && !slotPending && !mesoPending &&
    !tradeOpen &&
    !itemDrag && !quickDrag && !inventoryDrag && !inventoryScrollDrag && !shopDrag && !shopScrollDrag;
}
const playerContext = playerMenu({
  ctx,image:artImage,point:viewPoint,canOpen:canOpenPlayerMenu,canInvite:()=>partyInviteIdentity,
  canTrade:()=>tradeEnabled,
  valid:target=>users.get(String(target.characterId))?.name===target.name,
  onOpen(){
    localActionEpoch++;keys.clear();ui.say.blur();chatHistoryPanel.cancelDrag();
    pointerAt=inventoryHover=equipHover=statusHover=hoveredPortal=undefined;
    canvasButtonPress=canvasButtonActivation=undefined;
  },
  onAction(action,target){
    if(!canOpenPlayerMenu() || users.get(String(target.characterId))?.name!==target.name)return;
    if(action==='fameUp'||action==='fameDown')send({t:'fame',name:target.name,up:action==='fameUp'});
    else if(action==='whisper'){
      const reason=whisperNameError(target.name,selfView?.name);
      if(reason){chatHistoryPanel.append(reason,'fame');return;}
      whisperRecipient=lastWhisperRecipient=target.name;updateWhisperControl();ui.say.focus();
    }else if(action==='invite' && partyInviteIdentity && partyMenuState.leader(selfView?.characterId))
      send({t:'party-invite',name:target.name});
    else if(action==='trade' && tradeEnabled)
      send({t:'trade-invite',characterId:target.characterId});
  },
  onError:logLine,
});
canvas.addEventListener('contextmenu',event=>{
  event.preventDefault();
  if(!canOpenPlayerMenu())return;
  const point=viewPoint(event);
  if(point.y>=STATUS_BAR.y || inventoryWindowAt(point.x,point.y) || equipPanel.hit(point.x,point.y) ||
      statPanel.contains(point.x,point.y) || skillPanel.contains(point.x,point.y) || miniMapPanel.contains(point.x,point.y))return;
  const world=screenToWorld(point,camera,renderSurface.viewport());
  for(const user of users.values())if(playerContains(user,playerHitHistory.get(user),world)){
    void playerContext.show({characterId:user.characterId,name:user.name},point,partyMenuState.leader(selfView?.characterId));
    break;
  }
});
void playerContext.warm();

// Signal readiness only after every UI constructor and handler has initialized.
window.dispatchEvent(new Event(CLIENT_READY_EVENT));
