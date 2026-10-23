/** Selected server-to-browser runtime guards. Trade and messenger unions remain explicit gaps. */
import { PARTY_MAX_MEMBERS } from "./party-state.ts";
import { readLoginCharacters, readLoginWorlds } from "./login-data.ts";
import { readFeedbackEvent } from "./feedback-data.ts";
import { parseDrop, parseDropRemoval } from "./drop-presentation.ts";
import { TEMPORARY_FIELDS } from "./temporarystats.ts";
import { isTestToolResult } from "./ui-resource-validation.ts";
import { isFiniteNumber, isRecord } from "./resource-validation.ts";
import type { WebClientServerMessage } from "../server/src/net/webclient-messages.ts";
import type { ServerEventEnvelope } from "./websocket-transport.ts";

type PayloadValidator = (message: Record<string, unknown>) => boolean;

type CoveredMessageType = WebClientServerMessage["t"];

/** Message families with full event-specific checks at the browser transport boundary. */
const GUARDED_MESSAGE_TYPES = [
  "login",
  "characters",
  "created",
  "name-checked",
  "deleted",
  "error",
  "active-hit",
  "hit",
  "touch-result",
  "stat-basis",
  "test-tools",
  "field",
  "self",
  "temporary-stat",
  "active-skill-result",
  "skill-effect",
  "party",
  "party-command",
  "trade-command",
  "fame",
  "user-enter",
  "user-look",
  "user-leave",
  "user-move",
  "user-emotion",
  "request-release",
  "skills",
  "skill-result",
  "ability-result",
  "meso-drop-result",
  "chat",
  "whisper-refused",
  "system-notice",
  "inventory",
  "shop-open",
  "shop-result",
  "npc-say",
  "whisper-answer",
  "find-answer",
  "level-up",
  "mob-enter",
  "mob-move",
  "mob-die",
  "mob-leave",
  "mob-stat",
  "user-attack",
  "drop-enter",
  "drop-leave",
  "loot",
  "npc-enter",
  "npc-leave",
  "npc-controller",
  "npc-idle",
  "unknown",
  "disconnect",
] as const satisfies readonly CoveredMessageType[];

/** These nested protocol unions are intentionally left to their domain-specific consumers for now. */
export const SERVER_MESSAGE_VALIDATION_GAPS = [
  "trade",
  "messenger",
] as const satisfies readonly CoveredMessageType[];

type ClassifiedMessageType =
  (typeof GUARDED_MESSAGE_TYPES)[number] | (typeof SERVER_MESSAGE_VALIDATION_GAPS)[number];
type AssertNever<Value extends never> = Value;
/** A new server message must be guarded or added to the explicit gap list before it can compile. */
export type AssertServerMessageCoverageComplete = AssertNever<
  Exclude<CoveredMessageType, ClassifiedMessageType>
>;

export const SERVER_MESSAGE_VALIDATED_TYPES: ReadonlySet<string> = new Set(GUARDED_MESSAGE_TYPES);

const U8_MAX = 0xff;
const U16_MAX = 0xffff;
const U32_MAX = 0xffffffff;
const S8_MIN = -0x80;
const S8_MAX = 0x7f;
const S16_MIN = -0x8000;
const S16_MAX = 0x7fff;
const S32_MIN = -0x80000000;
const S32_MAX = 0x7fffffff;
/** sub_4C8ED0's hit clamp is 1..9999; this bridge also uses 0 for a miss. */
const MAX_REPORTED_DAMAGE = 9_999;

function integer(
  value: unknown,
  min = Number.MIN_SAFE_INTEGER,
  max = Number.MAX_SAFE_INTEGER,
): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}

function uint32(value: unknown): value is number {
  return integer(value, 0, U32_MAX);
}

function signed16(value: unknown): value is number {
  return integer(value, S16_MIN, S16_MAX);
}

function string(value: unknown): value is string {
  return typeof value === "string";
}

function boolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function optional(value: unknown, validate: (candidate: unknown) => boolean): boolean {
  return value === undefined || validate(value);
}

function arrayOf(value: unknown, validate: (candidate: unknown) => boolean): boolean {
  return Array.isArray(value) && value.every((entry: unknown) => validate(entry));
}

function numberFields(value: unknown, fields: readonly string[]): boolean {
  return isRecord(value) && fields.every((field) => isFiniteNumber(value[field]));
}

function stringFields(value: unknown, fields: readonly string[]): boolean {
  return isRecord(value) && fields.every((field) => string(value[field]));
}

function readWithGuard(read: (value: unknown) => unknown, value: unknown): boolean {
  try {
    read(value);
    return true;
  } catch {
    return false;
  }
}

function validLogin(message: Record<string, unknown>): boolean {
  return (
    integer(message.result, 0, U8_MAX) &&
    integer(message.gender, 0, U8_MAX) &&
    readWithGuard(readLoginWorlds, message.worlds)
  );
}

function validCharacterSummary(value: unknown): boolean {
  return (
    isRecord(value) &&
    [value.hp, value.maxHp, value.mp, value.maxMp, value.exp, value.mesos, value.mapId].every(
      uint32,
    )
  );
}

function validCharacters(message: Record<string, unknown>): boolean {
  return (
    integer(message.result, 0, U8_MAX) &&
    readWithGuard(readLoginCharacters, message.characters) &&
    arrayOf(message.characters, validCharacterSummary)
  );
}

function validCreated(message: Record<string, unknown>): boolean {
  if (!boolean(message.ok) || !string(message.name)) return false;
  return message.ok ? uint32(message.id) : string(message.reason);
}

function validNameChecked(message: Record<string, unknown>): boolean {
  return string(message.name) && integer(message.result, S8_MIN, S8_MAX);
}

function validDeleted(message: Record<string, unknown>): boolean {
  return uint32(message.id) && boolean(message.ok);
}

function validError(message: Record<string, unknown>): boolean {
  return string(message.message);
}

function validTouchResult(message: Record<string, unknown>): boolean {
  if (!integer(message.contactId, 1) || !integer(message.contactField, 0)) return false;
  if (message.accepted === true) {
    return integer(message.damage, 0, MAX_REPORTED_DAMAGE);
  }
  return (
    message.accepted === false &&
    optional(message.message, string) &&
    optional(message.retryAfterMs, (value) => isFiniteNumber(value) && value >= 0)
  );
}

function validPhysicalTrace(value: unknown): boolean {
  return (
    isRecord(value) &&
    [
      value.weaponId,
      value.action,
      value.basePad,
      value.temporaryPad,
      value.ammoPad,
      value.pad,
      value.hitRoll,
      value.mobEva,
      value.levelDifference,
      value.mastery,
      value.raw,
      value.afterLevel,
      value.afterAttribute,
      value.defense,
      value.criticalMultiplier,
      value.beforeClamp,
      value.damage,
    ].every(isFiniteNumber) &&
    ["miss", "zero-pad", "no-effective-weapon", "minimum", "hit"].includes(String(value.reason))
  );
}

function validHit(message: Record<string, unknown>): boolean {
  return (
    integer(message.attackToken, 1, 0x7fffffff) &&
    uint32(message.mobId) &&
    integer(message.damage, 0, MAX_REPORTED_DAMAGE) &&
    isFiniteNumber(message.delayMs) &&
    message.delayMs >= 0 &&
    integer(message.contactField, 0) &&
    optional(message.trace, validPhysicalTrace) &&
    (message.trace === undefined ||
      !isRecord(message.trace) ||
      message.trace.damage === message.damage)
  );
}

function validActiveHit(message: Record<string, unknown>): boolean {
  return (
    integer(message.attackToken, 1, 0x7fffffff) &&
    uint32(message.skillId) &&
    integer(message.skillLevel, 0, U8_MAX) &&
    uint32(message.mobId) &&
    arrayOf(message.damages, (damage) => integer(damage, 0, MAX_REPORTED_DAMAGE)) &&
    integer(message.contactField, 0)
  );
}

const BASIC_STAT_KEYS = ["job", "level", "str", "dex", "int", "luk", "maxHp", "maxMp"] as const;
const SECONDARY_STAT_KEYS = [
  "pad",
  "pdd",
  "mad",
  "mdd",
  "acc",
  "eva",
  "hands",
  "speed",
  "jump",
] as const;
const WORN_FACT_STAT_KEYS = ["str", "dex", "int", "luk", "pad"] as const;
const ITEM_STAT_KEYS = [
  "str",
  "dex",
  "int",
  "luk",
  "maxHp",
  "maxMp",
  "pad",
  "mad",
  "pdd",
  "mdd",
  "acc",
  "eva",
  "craft",
  "speed",
  "jump",
] as const;
const REQUIREMENT_KEYS = ["level", "job", "str", "dex", "int", "luk"] as const;

function validRequirements(value: unknown): boolean {
  return numberFields(value, REQUIREMENT_KEYS);
}

function validWornFact(value: unknown): boolean {
  return (
    isRecord(value) &&
    integer(value.slot, 1, 14) &&
    uint32(value.itemId) &&
    integer(value.ruc, 0, U8_MAX) &&
    integer(value.cuc, 0, U8_MAX) &&
    numberFields(value.stats, WORN_FACT_STAT_KEYS) &&
    optional(value.requirements, validRequirements)
  );
}

function validStatBasis(message: Record<string, unknown>): boolean {
  const basis = message.basis;
  if (
    !isRecord(basis) ||
    !numberFields(basis.basic, BASIC_STAT_KEYS) ||
    !numberFields(basis.secondary, SECONDARY_STAT_KEYS) ||
    !uint32(basis.weaponId) ||
    !arrayOf(basis.effectiveSlots, (slot) => integer(slot, 1, 14)) ||
    !Array.isArray(basis.effectiveSlots) ||
    new Set(basis.effectiveSlots).size !== basis.effectiveSlots.length
  )
    return false;
  return (
    isFiniteNumber(message.shotRange) &&
    message.shotRange >= 0 &&
    isFiniteNumber(message.ammoPad) &&
    arrayOf(message.wornFacts, validWornFact)
  );
}

function validTestTools(message: Record<string, unknown>): boolean {
  return isTestToolResult(message);
}

function validSelfView(value: unknown): boolean {
  return (
    isRecord(value) &&
    uint32(value.characterId) &&
    string(value.name) &&
    integer(value.gender, 0, U8_MAX) &&
    integer(value.level, 0, U8_MAX) &&
    integer(value.job, 0, U16_MAX) &&
    [value.str, value.dex, value.int, value.luk, value.ap, value.sp].every(uint32) &&
    integer(value.fame, 0, U16_MAX) &&
    [value.hp, value.maxHp, value.mp, value.maxMp, value.exp, value.expToNext, value.mesos].every(
      uint32,
    ) &&
    uint32(value.mapId) &&
    integer(value.spawnPortalIndex, 0, U8_MAX) &&
    uint32(value.face) &&
    uint32(value.hair) &&
    arrayOf(value.avatarItems, uint32)
  );
}

function validUserView(value: unknown): boolean {
  return (
    isRecord(value) &&
    uint32(value.characterId) &&
    string(value.name) &&
    uint32(value.face) &&
    arrayOf(value.avatarItems, uint32) &&
    signed16(value.x) &&
    signed16(value.y) &&
    integer(value.action, 0, U8_MAX) &&
    integer(value.foothold, 0, U16_MAX)
  );
}

function validMobView(value: unknown): boolean {
  return (
    isRecord(value) &&
    optional(value.mp, uint32) &&
    uint32(value.mobId) &&
    uint32(value.templateId) &&
    signed16(value.x) &&
    signed16(value.y) &&
    integer(value.facing, 0, U8_MAX)
  );
}

function validMobPresentation(value: unknown, mobId: unknown): boolean {
  if (
    !isRecord(value) ||
    value.mobId !== mobId ||
    !uint32(value.mobId) ||
    !uint32(value.mp) ||
    !isFiniteNumber(value.reactionRemaining) ||
    value.reactionRemaining < 0
  )
    return false;
  if (value.forced !== undefined) {
    const forced = value.forced;
    if (
      !isRecord(forced) ||
      !integer(forced.action, S8_MIN, U8_MAX) ||
      !integer(forced.facing, 0, 1) ||
      !isFiniteNumber(forced.age) ||
      forced.age < 0 ||
      !isFiniteNumber(forced.duration) ||
      forced.duration < 0
    )
      return false;
  }
  return optional(value.dyingAge, (age) => isFiniteNumber(age) && age >= 0);
}

function validNpcView(value: unknown): boolean {
  return (
    isRecord(value) &&
    optional(value.action, (action) => integer(action, 0, U8_MAX)) &&
    uint32(value.npcId) &&
    uint32(value.templateId) &&
    signed16(value.x) &&
    signed16(value.y) &&
    integer(value.facing, 0, U8_MAX) &&
    optional(value.present, boolean) &&
    optional(value.controlled, boolean)
  );
}

function validField(message: Record<string, unknown>): boolean {
  return (
    uint32(message.mapId) &&
    integer(message.contactField, 0) &&
    message.playerMenu === true &&
    boolean(message.partyInviteIdentity) &&
    message.socialCommands === true &&
    message.trade === true &&
    validSelfView(message.self) &&
    arrayOf(message.users, validUserView) &&
    arrayOf(message.mobs, validMobView) &&
    arrayOf(message.npcs, validNpcView)
  );
}

function validMoveElement(value: unknown): boolean {
  return (
    isRecord(value) &&
    integer(value.attr, 0, U8_MAX) &&
    signed16(value.x) &&
    signed16(value.y) &&
    signed16(value.vx) &&
    signed16(value.vy) &&
    integer(value.action, 0, U8_MAX) &&
    integer(value.foothold, 0, U16_MAX) &&
    integer(value.duration, 0, U16_MAX)
  );
}

function validMovePath(value: unknown): boolean {
  return (
    isRecord(value) &&
    signed16(value.originX) &&
    signed16(value.originY) &&
    Array.isArray(value.elements) &&
    value.elements.length <= U8_MAX &&
    value.elements.every((element: unknown) => validMoveElement(element))
  );
}

function validTemporaryStat(message: Record<string, unknown>): boolean {
  const update = message.update;
  if (
    !isRecord(update) ||
    !integer(update.durationMs, 1, S32_MAX) ||
    !boolean(update.sourceIsSkill) ||
    !uint32(update.sourceId) ||
    !isRecord(update.values)
  )
    return false;
  return Object.entries(update.values).every(
    ([key, value]) => TEMPORARY_FIELDS.includes(key) && integer(value, S16_MIN, S16_MAX),
  );
}

function validPartyMember(value: unknown): boolean {
  return isRecord(value) && uint32(value.characterId) && string(value.name);
}

function validPartyMembers(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length === PARTY_MAX_MEMBERS &&
    value.every((member: unknown) => validPartyMember(member))
  );
}

function validPartyResult(value: unknown): boolean {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  switch (value.kind) {
    case "invite":
      return uint32(value.inviterId) && string(value.inviterName);
    case "sync":
      return uint32(value.partyId) && validPartyMembers(value.members);
    case "created":
      return uint32(value.partyId);
    case "joined":
      return uint32(value.partyId) && string(value.name) && validPartyMembers(value.members);
    case "left":
      return (
        uint32(value.partyId) &&
        uint32(value.characterId) &&
        boolean(value.kicked) &&
        string(value.name) &&
        validPartyMembers(value.members)
      );
    case "ended":
      return uint32(value.partyId) && uint32(value.leaderId);
    case "alreadyInParty":
    case "notInParty":
    case "beginnerCannotCreate":
    case "full":
    case "unknown":
      return true;
    default:
      return false;
  }
}

function validPartyCommand(message: Record<string, unknown>): boolean {
  const feedback = message.feedback;
  if (!isRecord(feedback) || typeof feedback.kind !== "string") return false;
  switch (feedback.kind) {
    case "info":
      return arrayOf(feedback.lines, string);
    case "memberNotFound":
      return string(feedback.name);
    case "notLeader":
    case "targetNotFound":
    case "alreadyInParty":
    case "notInParty":
      return true;
    default:
      return false;
  }
}

function validTradeCommand(message: Record<string, unknown>): boolean {
  return (
    isRecord(message.feedback) && ["notFound", "windowOpen"].includes(String(message.feedback.kind))
  );
}

function validFameResult(value: unknown): boolean {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  switch (value.kind) {
    case "changed":
    case "received":
      return string(value.name) && boolean(value.up);
    case "ignored":
    case "beginner":
    case "alreadyToday":
    case "alreadyThisMonth":
    case "notFound":
    case "cooldown":
      return true;
    case "unknown":
      return integer(value.type, 6, U8_MAX);
    default:
      return false;
  }
}

function validItemView(value: unknown, minSlot: number, maxSlot: number): boolean {
  if (
    !isRecord(value) ||
    !integer(value.slot, minSlot, maxSlot) ||
    !uint32(value.itemId) ||
    !optional(value.cash, boolean)
  )
    return false;
  const hasEquipFields =
    value.ruc !== undefined || value.cuc !== undefined || value.stats !== undefined;
  if (hasEquipFields) {
    return (
      value.quantity === undefined &&
      integer(value.ruc, 0, U8_MAX) &&
      integer(value.cuc, 0, U8_MAX) &&
      numberFields(value.stats, ITEM_STAT_KEYS)
    );
  }
  return integer(value.quantity, 0, U16_MAX);
}

function validInventory(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.tabs) || value.tabs.length !== 4) return false;
  const tabs = new Set<number>();
  const validTabs = value.tabs.every((entry: unknown) => {
    if (!isRecord(entry)) return false;
    const tab = entry.tab;
    const capacity = entry.capacity;
    const items = entry.items;
    if (
      !integer(tab, 1, 4) ||
      tabs.has(tab) ||
      !integer(capacity, 0, U8_MAX) ||
      !Array.isArray(items)
    )
      return false;
    tabs.add(tab);
    return items.every((item: unknown) => validItemView(item, 1, capacity));
  });
  return (
    validTabs &&
    tabs.size === 4 &&
    arrayOf(value.worn, (item) => validItemView(item, 1, 14)) &&
    arrayOf(value.wornCash, (item) => validItemView(item, 1, 14))
  );
}

function validShopItem(value: unknown): boolean {
  return (
    isRecord(value) &&
    uint32(value.itemId) &&
    isFiniteNumber(value.price) &&
    value.price >= 0 &&
    uint32(value.maxCount)
  );
}

function validShop(message: Record<string, unknown>): boolean {
  const shop = message.shop;
  if (!isRecord(shop) || !uint32(shop.shopId) || !arrayOf(shop.items, validShopItem)) return false;
  return optional(shop.rechargeables, (value) =>
    arrayOf(
      value,
      (entry) =>
        isRecord(entry) &&
        uint32(entry.itemId) &&
        isFiniteNumber(entry.unitPrice) &&
        entry.unitPrice >= 0 &&
        uint32(entry.maxCount),
    ),
  );
}

function validQuestTalkBody(value: unknown): boolean {
  if (!isRecord(value) || typeof value.kind !== "string" || !string(value.message)) return false;
  switch (value.kind) {
    case "say":
      return (
        optional(value.unknownA, (n) => integer(n, 0, U8_MAX)) &&
        optional(value.unknownB, (n) => integer(n, 0, U8_MAX))
      );
    case "confirm":
    case "menu":
      return true;
    case "askText":
      return (
        string(value.defaultText) &&
        integer(value.minLength, S16_MIN, S16_MAX) &&
        integer(value.maxLength, S16_MIN, S16_MAX)
      );
    case "askNumber":
      return uint32(value.defaultValue) && uint32(value.min) && uint32(value.max);
    default:
      return false;
  }
}

function validUserAttack(message: Record<string, unknown>): boolean {
  return (
    uint32(message.characterId) &&
    uint32(message.skillId) &&
    integer(message.skillLevel, 0, U8_MAX) &&
    boolean(message.facingLeft) &&
    boolean(message.shoot) &&
    optional(message.magic, boolean) &&
    optional(message.afterimage, (n) => integer(n, 0, U8_MAX)) &&
    integer(message.action, 0, U8_MAX) &&
    integer(message.speed, 0, U8_MAX) &&
    uint32(message.projectileItemId) &&
    arrayOf(
      message.targets,
      (target) =>
        isRecord(target) &&
        uint32(target.mobId) &&
        integer(target.hitAnimation, S8_MIN, S8_MAX) &&
        Array.isArray(target.damages) &&
        target.damages.length <= 0x0f &&
        target.damages.every((damage: unknown) => integer(damage, 0, U16_MAX)),
    )
  );
}

function validSystemNotice(message: Record<string, unknown>): boolean {
  try {
    return readFeedbackEvent(message)?.t === "system-notice";
  } catch {
    return false;
  }
}

function validLoot(message: Record<string, unknown>): boolean {
  try {
    return readFeedbackEvent(message)?.t === "loot";
  } catch {
    return false;
  }
}

const payloadValidators = {
  login: validLogin,
  characters: validCharacters,
  created: validCreated,
  "name-checked": validNameChecked,
  deleted: validDeleted,
  error: validError,
  "active-hit": validActiveHit,
  hit: validHit,
  "touch-result": validTouchResult,
  "stat-basis": validStatBasis,
  "test-tools": validTestTools,
  field: validField,
  self: (message: Record<string, unknown>) => validSelfView(message.self),
  "temporary-stat": validTemporaryStat,
  "active-skill-result": (message: Record<string, unknown>) =>
    uint32(message.skillId) && boolean(message.accepted),
  "skill-effect": (message: Record<string, unknown>) =>
    uint32(message.characterId) &&
    uint32(message.skillId) &&
    integer(message.skillLevel, 0, U8_MAX),
  party: (message: Record<string, unknown>) => validPartyResult(message.result),
  "party-command": validPartyCommand,
  "trade-command": validTradeCommand,
  fame: (message: Record<string, unknown>) => validFameResult(message.result),
  "user-enter": (message: Record<string, unknown>) => validUserView(message.user),
  "user-look": (message: Record<string, unknown>) =>
    uint32(message.characterId) &&
    optional(message.face, uint32) &&
    optional(message.avatarItems, (items) => arrayOf(items, uint32)),
  "user-leave": (message: Record<string, unknown>) => uint32(message.characterId),
  "user-move": (message: Record<string, unknown>) =>
    uint32(message.characterId) &&
    signed16(message.x) &&
    signed16(message.y) &&
    integer(message.action, 0, U8_MAX) &&
    integer(message.foothold, 0, U16_MAX) &&
    optional(message.path, validMovePath) &&
    optional(message.local, boolean),
  "user-emotion": (message: Record<string, unknown>) =>
    uint32(message.characterId) && uint32(message.emotion),
  "request-release": () => true,
  skills: (message: Record<string, unknown>) =>
    arrayOf(
      message.skills,
      (skill) => isRecord(skill) && uint32(skill.skillId) && integer(skill.level, S32_MIN, S32_MAX),
    ),
  "skill-result": (message: Record<string, unknown>) => boolean(message.changed),
  "ability-result": (message: Record<string, unknown>) => boolean(message.changed),
  "meso-drop-result": (message: Record<string, unknown>) => boolean(message.changed),
  chat: (message: Record<string, unknown>) =>
    stringFields(message, ["name", "text"]) &&
    (message.channel === "field" || message.channel === "whisper") &&
    optional(message.characterId, uint32),
  "whisper-refused": (message: Record<string, unknown>) => string(message.name),
  "system-notice": validSystemNotice,
  inventory: (message: Record<string, unknown>) =>
    validInventory(message.inventory) && optional(message.ack, boolean),
  "shop-open": validShop,
  "shop-result": (message: Record<string, unknown>) =>
    integer(message.code, 0, U8_MAX) && string(message.message),
  "npc-say": (message: Record<string, unknown>) =>
    uint32(message.npcId) && string(message.message) && validQuestTalkBody(message.body),
  "whisper-answer": (message: Record<string, unknown>) =>
    string(message.name) && boolean(message.delivered),
  "find-answer": (message: Record<string, unknown>) =>
    string(message.name) && integer(message.mapId, -1, U32_MAX),
  "level-up": (message: Record<string, unknown>) => uint32(message.characterId),
  "mob-enter": (message: Record<string, unknown>) =>
    validMobView(message.mob) &&
    optional(message.presentation, (presentation) =>
      validMobPresentation(presentation, isRecord(message.mob) ? message.mob.mobId : undefined),
    ),
  "mob-move": (message: Record<string, unknown>) =>
    uint32(message.mobId) &&
    signed16(message.x) &&
    signed16(message.y) &&
    optional(message.path, validMovePath) &&
    optional(message.actionByte, (n) => integer(n, S8_MIN, S8_MAX)) &&
    optional(message.value, uint32) &&
    optional(message.facing, (n) => integer(n, 0, U8_MAX)) &&
    optional(message.forcedDuration, (n) => isFiniteNumber(n) && n >= 0) &&
    optional(message.presentation, (presentation) =>
      validMobPresentation(presentation, message.mobId),
    ),
  "mob-die": (message: Record<string, unknown>) => uint32(message.mobId),
  "mob-leave": (message: Record<string, unknown>) => uint32(message.mobId),
  "mob-stat": (message: Record<string, unknown>) => uint32(message.mobId) && uint32(message.mp),
  "user-attack": validUserAttack,
  "drop-enter": (message: Record<string, unknown>) => parseDrop(message.drop) !== undefined,
  "drop-leave": (message: Record<string, unknown>) => parseDropRemoval(message) !== undefined,
  loot: validLoot,
  "npc-enter": (message: Record<string, unknown>) => validNpcView(message.npc),
  "npc-leave": (message: Record<string, unknown>) => uint32(message.npcId),
  "npc-controller": (message: Record<string, unknown>) =>
    uint32(message.npcId) && boolean(message.on),
  "npc-idle": (message: Record<string, unknown>) =>
    uint32(message.npcId) &&
    integer(message.action, S8_MIN, S8_MAX) &&
    integer(message.speech, S8_MIN, S8_MAX) &&
    optional(message.path, validMovePath),
  unknown: (message: Record<string, unknown>) =>
    integer(message.opcode, 0, U8_MAX) && uint32(message.bytes),
  disconnect: (message: Record<string, unknown>) => string(message.reason),
} satisfies Record<(typeof GUARDED_MESSAGE_TYPES)[number], PayloadValidator>;

type GuardedMessageType = keyof typeof payloadValidators;

/**
 * Returns false only for a malformed payload in a guarded family. Other event discriminators stay
 * pass-through by design; in this revision the nested trade and messenger protocol unions remain
 * explicitly unvalidated here. Exceptions from existing parsers fail closed as malformed messages.
 */
export function validateServerMessagePayload(message: ServerEventEnvelope): boolean {
  if (!isRecord(message) || typeof message.t !== "string") return false;
  if (!Object.hasOwn(payloadValidators, message.t)) return true;
  try {
    return payloadValidators[message.t as GuardedMessageType](message);
  } catch {
    return false;
  }
}
