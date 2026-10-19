import { partyState, partyInfo, type PartyCommandFeedback } from "../../../client/party-state.ts";
import { tradeState, type TradeCommandFeedback } from "../../../client/trade-state.ts";
import { FameRequestClock, type FameFeedback } from "./fame.ts";
import {
  MINIROOM_KIND,
  MINIROOM_OPCODE,
  encodeClientMiniRoomRequest,
  readMiniRoomResult,
  type MiniRoomEvent,
} from "../protocol/miniroom.ts";
import {
  MESSENGER_OPCODE,
  encodeClientMessengerRequest,
  readMessengerResult,
  type MessengerEvent,
  type MessengerRosterCell,
} from "../protocol/messenger.ts";
import { FAME_OPCODE, encodeClientFameRequest, readFameResult } from "../protocol/fame.ts";
import { encodeClientSkillUse } from "../protocol/skilluse.ts";
import {
  PARTY_OPCODE,
  readPartyResult,
  encodeClientPartyRequest,
  type PartyResult,
  type ClientPartyRequest,
} from "../protocol/party.ts";
import { questReplyFor, type QuestReplyDetail } from "./questreply.ts";
import { SYSTEM_NOTICE_OPCODE, readSystemNotice } from "../protocol/notice.ts";
import { ClientRandom } from "../protocol/random.ts";
import type { TemporaryStatUpdate } from "../protocol/temporarystat.ts";
import { encodeClientStatReport, type ClientStatReport } from "../protocol/field.ts";
import {
  SKILL_UPDATE_OPCODE,
  encodeSkillRequest,
  readSkillUpdate,
  type SkillChange,
} from "../protocol/skills.ts";
import { learnedSkills } from "../game/skills.ts";
import { emptyCharacterItems } from "../protocol/chardata.ts";
import { encodeMesoDrop, MESO_DROP_INTERVAL_MS } from "../protocol/mesodrop.ts";
import { encodeAbilityRequest, type Ability } from "../protocol/ability.ts";
/**
 * The client half of the 2003 protocol, running in Node.
 *
 * WHY THIS EXISTS
 * ---------------
 * Phase 3 ("a client") needs something that speaks the wire format. The 2003 binary cannot run here
 * (Windows, 2003, DirectX 8), and a browser cannot open a raw TCP socket, so anything playable in a
 * browser needs a process in the middle that owns the connection: this module is that process's
 * client half. It is exactly the sequence `test/loginflow.test.ts` walks by hand, turned into an
 * object:
 *
 *   connect -> 211-byte handshake (the seeds are inside it) -> 0x01 login
 *           -> 0x02 world select -> 0x03 character select -> a second connection -> 0x04 handoff
 *           -> 0x16 set field -> the field stream
 *
 * It knows nothing about HTTP or browsers; `net/webclient.ts` is the transport adapter that turns
 * its events into JSON for `client/`. Keeping every protocol detail on this side is what makes the
 * browser client testable without a browser: `test/clientsession.test.ts` drives two of these
 * against the real `LoginServer`/`GameEntryServer` over real sockets.
 *
 * WHAT IT IS NOT
 * --------------
 * It is not the 2003 client. It does not draw, roll damage, run the mob AI, or own an inventory -
 * the 2003 client does those itself (FINDINGS 4.20). It reads only the packets a view needs and
 * reports the rest as `unknown`, so a packet this build does not understand shows up in the
 * browser's log instead of disappearing.
 *
 * ONE DELIBERATE OMISSION: the `0x03` reply carries the game server's address (`sub_432FB0` builds a
 * `sockaddr` out of it), and a browser could never use that address. The adapter is therefore given
 * the real game port up front and connects there; which character to claim still comes from the
 * reply, because that id is what the game server looks the handoff up by.
 */
import net from "node:net";
import { CipherState, SERVER_SEND_MAGIC } from "../protocol/cipher.ts";
import { encodeSessionPacket, SessionDeframer } from "../protocol/session.ts";
import { encodeClientPacket } from "../protocol/login.ts";
import { PacketReader } from "../protocol/packet.ts";
import {
  LOGIN_OPCODE,
  LOGIN_RESULT,
  NAME_CHECK_RESULT,
  type WorldEntry,
} from "../protocol/replies.ts";
import {
  readCharacterData,
  type CharacterData,
  type CharacterItems,
} from "../protocol/chardata.ts";
import {
  INVENTORY_OP,
  INVENTORY_OPCODE,
  readInventoryChange,
  type InventoryChange,
} from "../protocol/inventory.ts";
import type { ItemSlot, ItemSlotEquip } from "../protocol/itemslot.ts";
import {
  SHOP_OPEN_OPCODE,
  SHOP_RESULT_OPCODE,
  describeShopResult,
  encodeClientObjectClick,
  encodeClientShopRequest,
  readShopOpen,
  shopRechargeUnitPrice,
  readShopResult,
  type ClientShopRequest,
} from "../protocol/shop.ts";
import {
  QUEST_TALK_OPCODE,
  encodeQuestReply,
  readQuestTalk,
  type QuestTalkBody,
} from "../protocol/quest.ts";
import {
  DROP_OPCODE,
  LOOT_OPCODE,
  readDropAppear,
  readDropRemove,
  readLootNotice,
  type DropAppear,
  type LootNotice,
} from "../protocol/drop.ts";
import {
  FIELD_OPCODE,
  CLIENT_FIELD_OPCODE,
  encodeClientChat,
  encodeClientEmotion,
  encodeClientInteract,
  encodeClientAttack,
  encodeClientUserMove,
  encodeClientUserRequest,
  encodeClientUseItem,
  encodeClientChangeSlot,
  type ClientChangeSlot,
  INTERACT_KIND_CURSOR,
  INTERACT_KIND_REVIVE,
  readSetField,
  readUserChat,
  readUserBalloon,
  readUserWhisperRefused,
  USER_MESSAGE_WHISPER_REFUSED,
  readUserEffect,
  readUserEmotion,
  readUserAttack,
  type ClientAttack,
  type ClientAttackTarget,
  readUserEnterField,
  readUserFindAnswer,
  readUserMove,
  readUserLook,
  readUserWhisperAnswer,
  USER_MESSAGE_CHAT,
  USER_MESSAGE_FIND_ANSWER,
  USER_MESSAGE_WHISPER_ANSWER,
  USER_REQUEST_KIND,
} from "../protocol/field.ts";
import { decodeCp949, encodeCp949 } from "../protocol/cp949.ts";
import {
  MOB_OPCODE,
  readMobEnterField,
  readMobLeaveDelayed,
  readMobMove,
  readMobPresence,
  readMobStat,
  type MobLeaveDelayed,
} from "../protocol/mob.ts";
import {
  NPC_OPCODE,
  readNpcEnterField,
  readNpcId,
  readNpcState,
  readNpcIdle,
  encodeClientNpcIdle,
} from "../protocol/npc.ts";
import { STAT_OPCODE, readStatUpdate, type StatDiff } from "../protocol/stat.ts";
import { expToNextLevel } from "../game/exp.ts";
import type { MovePath } from "../protocol/movepath.ts";

/** The ten appearance words the create dialog sends (`CHECK_NAME_APPEARANCE_WORDS`). */
const CREATE_DIALOG_LOOK = [20000, 30000, 1040002, 1060002, 1072001, 1302000, 4, 5, 6, 10];

/** What a view needs to know about the character the connection belongs to. */
export interface SelfView {
  characterId: number;
  name: string;
  gender: number;
  level: number;
  job: number;
  str: number;
  dex: number;
  int: number;
  luk: number;
  ap: number;
  sp: number;
  fame: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  /** Experience earned toward the next level (`0..expToNext`). */
  exp: number;
  /**
   * What the next level costs (`sub_4C7190`'s table). The 2003 client has that table compiled in, so
   * it never rides the wire; a view that draws the EXP bar needs the number all the same.
   */
  expToNext: number;
  mesos: number;
  mapId: number;
  spawnPortal: number;
  face: number;
  hair: number;
  avatarItems: number[];
}

/**
 * One item, as the wire describes it.
 *
 * No archive lookup happens here: the id, the count and (for an equip) its upgrade slots are what
 * `0x0B`/`CharacterData` carried. A name or an icon is not on the wire at all - the page asks
 * `/api/item/<id>` for those, which is exactly what the 2003 client does with its own WZ archive.
 */
export interface ItemView {
  /** 1..capacity for a tab slot; negative for one of the worn slots (`-1`..`-14`). */
  slot: number;
  itemId: number;
  /** `u16 quantity` of a non-equip. */
  quantity?: number;
  /** `u8 ruc` of an equip: upgrades still available. */
  ruc?: number;
  cuc?: number;
  cash?: boolean;
  stats?: Pick<
    ItemSlotEquip,
    | "str"
    | "dex"
    | "int"
    | "luk"
    | "maxHp"
    | "maxMp"
    | "pad"
    | "mad"
    | "pdd"
    | "mdd"
    | "acc"
    | "eva"
    | "craft"
    | "speed"
    | "jump"
  >;
}

/** One of the four tabs the client keeps. */
export interface InventoryTabView {
  /** Current server grouping: 1=equip, 2=consume, 3=etc, 4=cash; native tab-label migration remains pending. */
  tab: number;
  /** `u8 capacity` from `CharacterData` - the client's array size minus one. */
  capacity: number;
  items: ItemView[];
}

/** The whole inventory, as a view draws it. */
export interface InventoryView {
  /** Slots 1..14 of the worn equipment. */
  worn: ItemView[];
  /** Slots 1..14 of the worn cash equipment. */
  wornCash: ItemView[];
  tabs: InventoryTabView[];
}

/** One item slot as a view: equip and non-equip differ only in which number matters. */
function itemViewOf(slot: number, item: ItemSlot): ItemView {
  return item.kind === "equip"
    ? {
        slot,
        itemId: item.itemId,
        ruc: item.ruc,
        cuc: item.cuc,
        cash: item.cash !== null,
        stats: {
          str: item.str,
          dex: item.dex,
          int: item.int,
          luk: item.luk,
          maxHp: item.maxHp,
          maxMp: item.maxMp,
          pad: item.pad,
          mad: item.mad,
          pdd: item.pdd,
          mdd: item.mdd,
          acc: item.acc,
          eva: item.eva,
          craft: item.craft,
          speed: item.speed,
          jump: item.jump,
        },
      }
    : {
        slot,
        itemId: item.itemId,
        quantity: item.quantity,
        ...(item.cash !== null ? { cash: true } : {}),
      };
}

/** One group of slots, in slot order - the page draws cells by index and reads `slot` for the title. */
function slotsOf(slots: Map<number, ItemSlot>): ItemView[] {
  const out: ItemView[] = [];
  for (const [slot, item] of slots) out.push(itemViewOf(slot, item));
  return out.sort((left, right) => left.slot - right.slot);
}

/**
 * The inventory a `CharacterData` block describes.
 *
 * `items` is optional in the record (a character list entry may leave it out) and a server without an
 * item model sends an empty one - both become four empty tabs, because the page's job is to draw what
 * is there, not to guess a capacity.
 */
export function inventoryViewOf(items: CharacterItems | undefined): InventoryView {
  if (items === undefined) {
    return {
      worn: [],
      wornCash: [],
      tabs: [1, 2, 3, 4].map((tab) => ({ tab, capacity: 0, items: [] })),
    };
  }
  return {
    worn: slotsOf(items.worn),
    wornCash: slotsOf(items.wornCash),
    tabs: items.inventories.map((inventory, index) => ({
      tab: index + 1,
      capacity: inventory.capacity,
      items: slotsOf(inventory.items),
    })),
  };
}

/**
 * One row of an open shop, as `0x4A` described it.
 *
 * `price` is the archive's `info/price` (the server never guesses one) and `maxCount` is the cap on a
 * *single* purchase, which is what the counted buy dialog starts at and refuses to exceed - not a
 * stock level (FINDINGS 4.22).
 */
export interface ShopItemView {
  itemId: number;
  price: number;
  maxCount: number;
}

/** The shop the server opened: which shop, and its rows. */
export interface ShopView {
  shopId: number;
  items: ShopItemView[];
  rechargeables?: { itemId: number; unitPrice: number; maxCount: number }[];
}

/** Another player in the field. */
export interface UserView {
  characterId: number;
  name: string;
  face: number;
  avatarItems: number[];
  x: number;
  y: number;
  action: number;
  foothold: number;
}

export interface MobView {
  mp?: number;
  mobId: number;
  templateId: number;
  x: number;
  y: number;
  facing: number;
}

export interface NpcView {
  /** 4990C0 stores the full spawn movement byte; facing is its low bit. */
  action?: number;
  npcId: number;
  templateId: number;
  x: number;
  y: number;
  facing: number;
  present?: boolean;
  controlled?: boolean;
}

/**
 * Everything the field stream can mean to a view. The `unknown` case carries the opcode and the
 * body, so an unimplemented packet is a log line rather than a mystery.
 */
export type ClientEvent =
  | {
      kind: "field";
      mapId: number;
      self: SelfView;
      users: UserView[];
      mobs: MobView[];
      npcs: NpcView[];
    }
  | { kind: "self"; self: SelfView }
  | { kind: "temporary-stat"; update: TemporaryStatUpdate }
  | { kind: "active-skill-result"; skillId: number; accepted: boolean }
  | { kind: "skill-effect"; characterId: number; skillId: number; skillLevel: number }
  | { kind: "party"; result: PartyResult }
  | { kind: "party-command"; feedback: PartyCommandFeedback }
  | { kind: "trade"; event: MiniRoomEvent }
  | { kind: "messenger"; event: MessengerEvent }
  | { kind: "trade-command"; feedback: TradeCommandFeedback }
  | { kind: "fame"; result: FameFeedback }
  | { kind: "user-enter"; user: UserView }
  | {
      kind: "user-look";
      characterId: number;
      face?: number;
      avatarItems?: number[];
    }
  | { kind: "user-leave"; characterId: number }
  | {
      kind: "user-move";
      characterId: number;
      x: number;
      y: number;
      action: number;
      foothold: number;
      path?: MovePath;
      local?: boolean;
    }
  | { kind: "user-emotion"; characterId: number; emotion: number }
  | { kind: "request-release" }
  | { kind: "skills"; skills: SkillChange[] }
  | { kind: "skill-result"; changed: boolean }
  | { kind: "ability-result"; changed: boolean }
  | { kind: "meso-drop-result"; changed: boolean }
  | { kind: "chat"; name: string; text: string; channel: "field" | "whisper"; characterId?: number }
  | { kind: "whisper-refused"; name: string }
  | { kind: "system-notice"; type: 0 | 1; text: string }
  | { kind: "inventory"; inventory: InventoryView; ack?: boolean }
  | { kind: "shop-open"; shop: ShopView }
  | { kind: "shop-result"; code: number; message: string }
  | { kind: "npc-say"; npcId: number; message: string; body: QuestTalkBody }
  | { kind: "whisper-answer"; name: string; delivered: boolean }
  | { kind: "find-answer"; name: string; mapId: number }
  | { kind: "level-up"; characterId: number }
  | { kind: "mob-enter"; mob: MobView }
  | {
      kind: "mob-move";
      actionByte?: number;
      value?: number;
      mobId: number;
      x: number;
      y: number;
      path?: MovePath;
      facing?: number;
    }
  /** `0x30`: the monster was hit; its selected die1/die2/dieF frames are the corpse. */
  | { kind: "mob-die"; mobId: number }
  | { kind: "mob-leave"; mobId: number }
  | { kind: "mob-stat"; mobId: number; mp: number }
  /** `0x23`/`0x24`/`0x25`: another user's melee/shot, including action, speed and projectile id. */
  | {
      kind: "user-attack";
      characterId: number;
      skillId: number;
      skillLevel: number;
      facingLeft: boolean;
      shoot: boolean;
      magic?: boolean;
      afterimage?: number;
      action: number;
      speed: number;
      projectileItemId: number;
      targets: { mobId: number; hitAnimation: number; damages: number[] }[];
    }
  /** `0x43`: a drop landed (`drop.money` picks the meso pile, otherwise `drop.value` is an item id). */
  | { kind: "drop-enter"; drop: DropAppear }
  /** `0x44`: it expired (`gone`), vanished, or was taken by `characterId` (the page flies it there). */
  | {
      kind: "drop-leave";
      dropId: number;
      reason: "gone" | "vanished" | "taken";
      characterId?: number;
    }
  /** `0x11`: the line the client prints for a pickup - mesos, an item, or "no more room". */
  | { kind: "loot"; notice: LootNotice }
  | { kind: "npc-enter"; npc: NpcView }
  | { kind: "npc-leave"; npcId: number }
  | { kind: "npc-controller"; npcId: number; on: boolean }
  | { kind: "npc-idle"; npcId: number; action: number; speech: number; path?: MovePath }
  | { kind: "unknown"; opcode: number; bytes: number }
  | { kind: "disconnect"; reason: string };

/** The three replies of the login chain, in the order they arrive. */
export interface LoginReply {
  gender?: number;
  result: number;
  /** Present only when `result` is `ok`; the client stores all three (FINDINGS 4.8). */
  worlds: WorldEntry[];
}

export interface CharacterListReply {
  result: number;
  characters: CharacterData[];
}

/**
 * What `0x06` + `0x05` came back with.
 *
 * The name check and the create are one operation here because the 2003 dialog also sends them as a
 * pair, and because the server keeps the check's appearance words for the create that follows: a
 * `0x05` with no `0x06` before it is created from the default look instead of the chosen one.
 */
export interface CreateCharacterReply {
  /** The `0x06` answer: 0 free, a positive value taken, negative "the check itself failed". */
  nameCheck: number;
  /** The record from `0x05`, present only when the server accepted the create. */
  character?: CharacterData;
}

export interface CharacterSelectReply {
  result: number;
  ip: string;
  port: number;
  characterId: number;
}

export interface ClientSessionOptions {
  host?: string;
  loginPort: number;
  /**
   * Where the game server is. The `0x03` reply also names one, and that is the value the 2003
   * client uses; an adapter that cannot reach it (a browser origin, or a server started with
   * `--game-ip 0.0.0.0`) overrides it here.
   */
  gameHost?: string;
  gamePort?: number;
  /** One line per connection-level event; defaults to nothing. */
  log?(line: string): void;
  /** How long a login reply may take. Field packets have no timeout. */
  replyTimeoutMs?: number;
}

/** A reply that never came, or one that came with an unexpected opcode. */
export class ClientTimeoutError extends Error {}

/**
 * One TCP connection with the session framing on top: `u16 header + u16 length + encrypted body`
 * (FINDINGS 3). The 211-byte handshake arrives first and seeds the cipher, so nothing may be sent
 * before it has been read - `send` waits for that.
 */
class Link {
  private readonly socket: net.Socket;
  private readonly deframer = new SessionDeframer({
    expectedMagic: SERVER_SEND_MAGIC,
  });
  private sendState = new CipherState(0);
  private readonly queue: Uint8Array[] = [];
  private waiter: (() => void) | undefined;
  private closeReason: string | undefined;
  private readonly onPacket: (plain: Uint8Array) => void;
  private readonly onClose: (reason: string) => void;
  readonly handshakeDone: Promise<void>;
  private markHandshake!: () => void;

  constructor(
    port: number,
    host: string,
    onPacket: (plain: Uint8Array) => void,
    onClose: (reason: string) => void,
  ) {
    this.onPacket = onPacket;
    this.onClose = onClose;
    this.handshakeDone = new Promise<void>((resolve) => {
      this.markHandshake = resolve;
    });
    this.socket = net.connect(port, host);
    this.socket.on("data", (chunk) =>
      this.receive(new Uint8Array(typeof chunk === "string" ? Buffer.from(chunk) : chunk)),
    );
    this.socket.on("error", (error) => this.fail((error as Error).message));
    this.socket.on("close", () => this.fail(this.closeReason ?? "the connection closed"));
  }

  private receive(chunk: Uint8Array): void {
    for (const event of this.deframer.push(chunk)) {
      if (event.kind === "handshake") {
        // The client's send state is seeded by the handshake's first seed (sub_43A410).
        this.sendState = new CipherState(event.handshake.sendSeed);
        this.markHandshake();
        continue;
      }
      // A field connection streams: hand the packet over immediately. The login stage is strictly
      // request/reply, so its packets wait in the queue instead.
      if (this.streams) this.onPacket(event.plain);
      else {
        this.queue.push(event.plain);
        this.waiter?.();
      }
    }
  }

  /** Set once the field has been entered; see `receive`. */
  streams = false;

  private fail(reason: string): void {
    if (this.closeReason === reason) return;
    this.closeReason = reason;
    this.markHandshake();
    this.waiter?.();
    this.onClose(reason);
  }

  error(): string | undefined {
    return this.closeReason;
  }

  async send(packet: Uint8Array): Promise<void> {
    await this.handshakeDone;
    if (this.closeReason !== undefined) throw new Error(this.closeReason);
    // A client writes the `0xD3` magic, not the server's `0xFF2C` (session.ts, `magicFor`).
    this.socket.write(encodeSessionPacket(packet, this.sendState, "c2s"));
  }

  /** Waits for the next packet with `opcode`, dropping the ones that do not match. */
  async take(opcode: number, timeoutMs: number): Promise<Uint8Array> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const index = this.queue.findIndex((plain) => plain[0] === opcode);
      if (index >= 0) return this.queue.splice(index, 1)[0]!;
      const left = deadline - Date.now();
      if (left <= 0) {
        throw new ClientTimeoutError(
          `no 0x${opcode.toString(16)} within ${timeoutMs} ms` +
            (this.closeReason === undefined ? "" : ` (${this.closeReason})`),
        );
      }
      await new Promise<void>((resolve) => {
        this.waiter = resolve;
        setTimeout(resolve, Math.min(20, left));
      });
    }
  }

  /** Empties the login-stage queue; see `enterGame`. */
  drainQueue(): Uint8Array[] {
    return this.queue.splice(0, this.queue.length);
  }

  close(): void {
    this.socket.destroy();
  }
}

/**
 * Reads the `0x03` reply's address. It is stored as a u32 in **network** order because the client
 * copies the four bytes into `sockaddr_in.sin_addr` (see `ipv4WireValue`).
 */
function readRedirectIp(reader: PacketReader): string {
  const value = reader.readU32();
  return `${value & 0xff}.${(value >>> 8) & 0xff}.${(value >>> 16) & 0xff}.${(value >>> 24) & 0xff}`;
}

/**
 * The item ids the character is wearing, which is what the `0x1C` look list carries for everybody
 * else (`sub_45F340` files them by id). The local character's list is built the same way so the view
 * can draw both from one shape; a slot the record does not have simply contributes nothing.
 */
function wornItemIds(character: CharacterData): number[] {
  const worn = character.items?.worn;
  if (worn === undefined) return [];
  return [...worn.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, slot]) => slot.itemId)
    .filter((itemId) => itemId !== 0);
}

function selfOf(character: CharacterData): SelfView {
  const stats = character.stats;
  return {
    characterId: stats.id,
    name: decodeByteName(stats.name),
    gender: stats.gender,
    level: stats.level,
    job: stats.job,
    str: stats.str,
    dex: stats.dex,
    int: stats.int,
    luk: stats.luk,
    ap: stats.ap,
    sp: stats.sp,
    fame: stats.fame,
    hp: stats.hp,
    maxHp: stats.maxHp,
    mp: stats.mp,
    maxMp: stats.maxMp,
    exp: stats.exp,
    expToNext: expToNextLevel(stats.level),
    mesos: stats.mesos,
    mapId: stats.mapId,
    spawnPortal: stats.unknown101,
    face: stats.appearanceA,
    hair: stats.appearanceB,
    avatarItems: wornItemIds(character),
  };
}

/**
 * The state machine the adapter drives.
 *
 * The login half is request/reply and throws on anything that is not the expected answer; the field
 * half is a stream and never throws - a packet the view cannot use becomes an `unknown` event or a
 * log line, because one malformed monster must not end the session.
 */
export class ClientSession {
  private readonly options: ClientSessionOptions;
  private readonly host: string;
  private link: Link | undefined;
  private gameLink: Link | undefined;
  private readonly listeners: ((event: ClientEvent) => void)[] = [];
  private readonly timeoutMs: number;
  private self: SelfView | undefined;
  private mapId = 0;
  private lastPosition = { x: 0, y: 0 };
  private lastMovement = { action: 6, foothold: 0 };
  private readonly users = new Map<number, UserView>();
  private readonly mobs = new Map<number, MobView>();
  private readonly npcs = new Map<number, NpcView>();
  private activeQuest: QuestTalkBody | undefined;
  private questGeneration = 0;
  private latest: CharacterData | undefined;
  /** `0x0F`'s per-swing `sequence`: it only has to differ between swings. */
  private attackSequence = 0;
  private abilityPending = false;
  private skillPending = false;
  private activeSkillPending: number | undefined;
  private nextActiveAt = 0;
  private readonly fameClock = new FameRequestClock();
  private readonly party = partyState();
  private partyInvite: number | undefined;
  /** The 1:1 exchange room this session is inside, if any (`CTradingRoomDlg`'s fields). */
  private readonly trade = tradeState();
  private nextSkillAt = 0;
  private mesoPending = false;
  private nextMesoAt = 0;
  private slotPending = false;
  private shopPending = false;
  private nextSlotAt = 0;
  private userRequestUntil = 0;

  constructor(options: ClientSessionOptions) {
    this.options = options;
    this.host = options.host ?? "127.0.0.1";
    this.timeoutMs = options.replyTimeoutMs ?? 5000;
  }

  /** Subscribes to field events. Returns an unsubscribe function. */
  onEvent(listener: (event: ClientEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) this.listeners.splice(index, 1);
    };
  }

  private emit(event: ClientEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private log(line: string): void {
    this.options.log?.(line);
  }

  /** The world list the `0x01` reply carried (empty before a successful login). */
  async login(username: string, password: string): Promise<LoginReply> {
    this.link = new Link(
      this.options.loginPort,
      this.host,
      () => undefined,
      (reason) => this.log(`login link closed: ${reason}`),
    );
    await this.link.handshakeDone;
    await this.link.send(
      encodeClientPacket({
        kind: "login-request",
        opcode: LOGIN_OPCODE.login,
        username,
        password,
      }),
    );
    const reply = await this.link.take(LOGIN_OPCODE.login, this.timeoutMs);
    const reader = new PacketReader(reply, 1);
    const result = reader.readByte();
    if (result !== LOGIN_RESULT.ok) return { result, worlds: [] };
    reader.readU32(); // app4 (the client keeps it at CWvsApp+4; no use here)
    const gender = reader.readByte(); // app8 selects CharMale/CharFemale (sub_42F160)
    reader.readByte(); // app9 is a privilege/name-filter flag, not gender
    const count = reader.readByte();
    const worlds: WorldEntry[] = [];
    for (let i = 0; i < count; i++) {
      worlds.push({
        name: reader.readAsciiString(),
        unknownId: reader.readU32(),
      });
    }
    return { result, worlds, gender };
  }

  /** `0x02`. Returns the (at most three) characters the account has in that world. */
  async selectWorld(worldId: number): Promise<CharacterListReply> {
    const link = this.requireLink();
    await link.send(
      encodeClientPacket({
        kind: "world-select",
        opcode: LOGIN_OPCODE.worldSelect,
        worldId,
      }),
    );
    const reply = await link.take(LOGIN_OPCODE.worldSelect, this.timeoutMs);
    const reader = new PacketReader(reply, 1);
    const result = reader.readByte();
    if (result !== LOGIN_RESULT.ok) return { result, characters: [] };
    const count = reader.readByte();
    const characters: CharacterData[] = [];
    for (let i = 0; i < count; i++) characters.push(readCharacterData(reader));
    return { result, characters };
  }

  /** Check the current name/look without creating anything. Caller serializes login operations. */
  async checkName(
    name: string,
    appearance: readonly number[] = CREATE_DIALOG_LOOK,
  ): Promise<number> {
    const link = this.requireLink();
    await link.send(
      encodeClientPacket({
        kind: "check-name",
        opcode: LOGIN_OPCODE.checkName,
        name,
        appearance: [...appearance],
      }),
    );
    const checked = await link.take(LOGIN_OPCODE.nameCheckResult, this.timeoutMs);
    const reader = new PacketReader(checked, 1);
    if (reader.readAsciiString() !== name)
      throw new Error("name-check reply did not match request");
    return (reader.readByte() << 24) >> 24;
  }
  /** Refresh the name/look check before committing: the selected equipment/dice may have changed. */
  async createCharacter(
    name: string,
    appearance: readonly number[] = CREATE_DIALOG_LOOK,
  ): Promise<CreateCharacterReply> {
    const nameCheck = await this.checkName(name, appearance);
    if (nameCheck !== NAME_CHECK_RESULT.available) return { nameCheck };
    const link = this.requireLink();
    await link.send(
      encodeClientPacket({
        kind: "create-character",
        opcode: LOGIN_OPCODE.createCharacter,
        name,
      }),
    );
    const created = await link.take(LOGIN_OPCODE.createCharacter, this.timeoutMs);
    if ((created[1] ?? 0) === 0) return { nameCheck };
    return {
      nameCheck,
      character: readCharacterData(new PacketReader(created, 2)),
    };
  }
  async deleteCharacter(characterId: number): Promise<boolean> {
    const link = this.requireLink();
    await link.send(
      encodeClientPacket({
        kind: "delete-character",
        opcode: LOGIN_OPCODE.deleteCharacter,
        characterId,
      }),
    );
    const reply = new PacketReader(await link.take(LOGIN_OPCODE.deleteResult, this.timeoutMs), 1);
    if (reply.readU32() !== characterId)
      throw new Error("delete reply did not match requested character");
    return reply.readByte() !== 0;
  }

  /** `0x03`: asks to enter the game with that character. */
  async selectCharacter(characterId: number): Promise<CharacterSelectReply> {
    const link = this.requireLink();
    await link.send(
      encodeClientPacket({
        kind: "select-character",
        opcode: LOGIN_OPCODE.selectCharacter,
        characterId,
      }),
    );
    const reply = await link.take(LOGIN_OPCODE.selectCharacter, this.timeoutMs);
    const reader = new PacketReader(reply, 1);
    const result = reader.readByte();
    if (result !== LOGIN_RESULT.ok) return { result, ip: "", port: 0, characterId: 0 };
    const ip = readRedirectIp(reader);
    const port = reader.readU16();
    const id = reader.readU32();
    return { result, ip, port, characterId: id };
  }

  /**
   * Opens the game connection and claims the handoff: `0x04` carries the character id the login
   * server put in its `0x03` reply (`CWvsApp+0x14`, FINDINGS 4.9).
   *
   * Resolves once the `0x16` that moves the client into a field has been read - i.e. once the
   * session is really in the game - and emits `field` with the snapshot that came with it.
   */
  async enterGame(redirect: CharacterSelectReply): Promise<void> {
    this.fameClock.reset();
    const port = this.options.gamePort ?? redirect.port;
    const host = this.options.gameHost ?? redirect.ip;
    this.link?.close();
    this.link = undefined;
    const link = new Link(
      port,
      host,
      (plain) => this.handleFieldPacket(plain),
      (reason) => {
        this.activeQuest = undefined;
        this.questGeneration++;
        this.emit({ kind: "disconnect", reason });
      },
    );
    this.gameLink = link;
    await link.handshakeDone;
    await link.send(
      encodeClientPacket({
        kind: "handshake-reply",
        opcode: 0x04,
        value: redirect.characterId,
      }),
    );
    const first = await link.take(FIELD_OPCODE.setField, this.timeoutMs);
    link.streams = true;
    // Anything that arrived between the 0x16 and this line is still in the queue (the login stage's
    // `take` only removes what it matches); the field's own packets must not be stranded there.
    // Apply setField before its queued pool/stat packets: otherwise its reset erases them.
    this.handleFieldPacket(first);
    for (const pending of link.drainQueue()) this.handleFieldPacket(pending);
  }

  private requireLink(): Link {
    if (this.link === undefined) throw new Error("login() must succeed before this call");
    return this.link;
  }

  /** The character list entry the client picked, for the adapter's own bookkeeping. */
  remember(character: CharacterData): void {
    this.latest = character;
  }

  /** One monster in the field's pool, or `undefined` when this session has never seen it. */
  mob(mobId: number): MobView | undefined {
    return this.mobs.get(mobId);
  }

  get selfPosition(): { x: number; y: number } {
    return { ...this.lastPosition };
  }

  /** Latest locally published posture, kept separate from XY for existing consumers. */
  get selfMovement(): { action: number; foothold: number } {
    return { ...this.lastMovement };
  }

  /** First native stream (CWvsApp+632); reseeded by 0x16. */
  attackRandom: ClientRandom | undefined;
  /** CWvsApp+652, seeded alongside +632 but advanced independently. */
  touchRandom: ClientRandom | undefined;
  private nextReviveAt = 0;

  /** Read-only public projection; browser bridge must not reach into private session state. */
  get selfView(): Readonly<SelfView> | undefined {
    return this.self;
  }

  /** The last snapshot itself, for callers that want more than the view. */
  get character(): CharacterData | undefined {
    return this.latest;
  }

  /**
   * One basic melee (`0x0F`) or shot (`0x10`), including empty attacks: one target record per mob, one hit
   * per target, the damage the caller already rolled (the field takes it on trust - see
   * `game/nativecombat.ts`). `sequence` is the client's per-swing counter, so it is kept here and bumps.
   */
  get characterOperationPending(): boolean {
    return (
      this.skillPending ||
      this.slotPending ||
      this.shopPending ||
      this.mesoPending ||
      this.abilityPending
    );
  }
  async useActiveSkill(skillId: number, level: number, party = false): Promise<void> {
    if (
      !this.gameLink ||
      !this.self ||
      this.self.hp <= 0 ||
      this.skillPending ||
      this.slotPending ||
      this.shopPending ||
      this.mesoPending ||
      this.abilityPending ||
      performance.now() < Math.max(this.nextActiveAt, this.nextSkillAt)
    )
      throw new Error("技能等待前一項操作完成");
    if (party && !this.party.id) throw new Error("此版本的憤怒入口需要先建立或加入隊伍");
    const targets = party
      ? this.party
          .roster()
          .filter((member) => {
            const user = this.users.get(member.characterId);
            return (
              user &&
              user.x >= this.lastPosition.x - 50 &&
              user.x < this.lastPosition.x + 50 &&
              user.y >= this.lastPosition.y - 50 &&
              user.y < this.lastPosition.y + 50
            );
          })
          .map((member) => member.characterId)
      : [];
    const packet = encodeClientSkillUse({ skillId, level, targets });
    this.activeSkillPending = skillId;
    this.skillPending = true;
    this.nextActiveAt = performance.now() + 200;
    try {
      await this.gameLink.send(packet);
    } catch (error) {
      this.activeSkillPending = undefined;
      this.skillPending = false;
      throw error;
    }
  }
  /** 5128B0 -> 55D7B0: resolve name in the current user pool BEFORE reserving cooldown.
   * Native permits the target to leave between menu-open and selection; no stale id is sent.
   * Living-session gating is a browser safety policy, not an original fame level restriction.
   */
  async giveFame(name: string, up: boolean): Promise<void> {
    if (!this.gameLink || !this.self || this.self.hp <= 0)
      throw new Error("fame needs a living field session");
    const target = [...this.users.values()].find((user) => samePlayerName(user.name, name));
    if (!target) {
      this.emit({ kind: "fame", result: { kind: "notFound" } });
      return;
    }
    if (!this.fameClock.reserve()) {
      this.emit({ kind: "fame", result: { kind: "cooldown" } });
      return;
    }
    await this.gameLink.send(encodeClientFameRequest({ targetId: target.characterId, up }));
  }

  /** Browser confirmation is bound to the inviter shown, never whichever packet arrived last.
   * Declines are local-only and may clear while dead. Stale/modal-epoch responses do nothing.
   */
  async replyToPartyInvite(inviterId: number, accepted: boolean): Promise<void> {
    if (this.partyInvite !== inviterId) return;
    if (!accepted) {
      this.partyInvite = undefined;
      return;
    }
    await this.partyCommand("accept");
  }

  async partyCommand(command: string, name = ""): Promise<void> {
    if (command === "decline") {
      this.partyInvite = undefined;
      return;
    }
    if (!this.gameLink || !this.self) throw new Error("party needs a field session");
    if (command === "info") {
      this.emit({
        kind: "party-command",
        feedback: { kind: "info", lines: partyInfo(this.party, this.self.characterId) },
      });
      return;
    }
    // Living is existing browser policy; native471CD0/471E90/472050/4722E0 checks below are separate.
    if (this.self.hp <= 0) throw new Error("party needs a living field session");
    const reject = (feedback: PartyCommandFeedback) =>
      this.emit({ kind: "party-command", feedback });
    let request: ClientPartyRequest;
    if (command === "create") {
      if (this.party.id) return reject({ kind: "alreadyInParty" });
      request = { kind: "create" };
    } else if (command === "leave") {
      if (!this.party.id) return reject({ kind: "notInParty" });
      request = { kind: "leave", unknown: 0 };
    } else if (command === "accept") {
      if (this.partyInvite === undefined) throw new Error("no current party invitation");
      request = { kind: "accept", inviterId: this.partyInvite };
      this.partyInvite = undefined;
    } else if (command === "invite" || command === "kick") {
      if (!this.party.leader(this.self.characterId)) return reject({ kind: "notLeader" });
      const targetId =
        command === "invite"
          ? [...this.users.values()].find((u) => samePlayerName(u.name, name))?.characterId
          : this.party.targetId(name);
      if (!targetId)
        return reject(
          command === "invite" ? { kind: "targetNotFound" } : { kind: "memberNotFound", name },
        );
      request = command === "invite" ? { kind: "invite", targetId } : { kind: "kick", targetId };
    } else
      throw new Error(
        "party: info | create | invite <name> | accept | decline | leave | kick <name>",
      );
    // Never optimistically change roster or partyId: only native0x10 changes membership.
    await this.gameLink.send(encodeClientPartyRequest(request));
  }

  /**
   * 1:1 exchange (`/교환`, the context menu's 교환신청, and the trade window's own buttons).
   *
   * The 2003 client guards these sends itself, and so does this session, because the browser asks
   * for them over JSON: `sub_471A40` refuses while any modeless room dialog is up, `sub_4D5C80`
   * and `sub_4D5F50` refuse while my side is locked, while I am alone in the room, and inside
   * their 500 ms throttle. Every refusal there is silent; only `/교환` prints (the two strings
   * below), which is what `trade-command` carries to the view.
   */
  async tradeInvite(name: string): Promise<void> {
    const target = [...this.users.values()].find((u) => samePlayerName(u.name, name));
    if (target === undefined) {
      this.emit({ kind: "trade-command", feedback: { kind: "notFound" } });
      return;
    }
    await this.tradeInviteId(target.characterId);
  }

  async tradeInviteId(characterId: number): Promise<void> {
    if (!this.gameLink || !this.self) throw new Error("trade needs a field session");
    if (this.trade.open) {
      this.emit({ kind: "trade-command", feedback: { kind: "windowOpen" } });
      return;
    }
    await this.gameLink.send(
      encodeClientMiniRoomRequest({
        kind: "invite",
        roomKind: MINIROOM_KIND.trade,
        targetId: characterId,
      }),
    );
  }

  /** The invitation modal's answer: yes sends `type 3`, no sends nothing (`sub_481910`). */
  async tradeReply(inviterId: number, accepted: boolean): Promise<void> {
    if (!this.trade.answerInvite(inviterId)) return;
    if (!accepted || !this.gameLink) return;
    await this.gameLink.send(encodeClientMiniRoomRequest({ kind: "accept", inviterId }));
  }

  async tradeOfferItem(request: {
    tab: number;
    slot: number;
    count: number | null;
    roomSlot: number;
  }): Promise<void> {
    if (!this.gameLink || !this.trade.canOffer(Date.now())) return;
    this.trade.markOffer(Date.now());
    await this.gameLink.send(encodeClientMiniRoomRequest({ kind: "offerItem", ...request }));
  }

  async tradeOfferMesos(amount: number): Promise<void> {
    if (!this.gameLink || !this.trade.canOffer(Date.now())) return;
    this.trade.markOffer(Date.now());
    await this.gameLink.send(encodeClientMiniRoomRequest({ kind: "offerMesos", amount }));
  }

  /** BtTrade's yes: lock my side locally (`this+63`) and send `type 13`. */
  async tradeConfirm(): Promise<void> {
    if (!this.gameLink || !this.trade.confirmLocally()) return;
    await this.gameLink.send(encodeClientMiniRoomRequest({ kind: "confirm" }));
  }

  /** Closing the window or 취소: `type 7`; the peer's cancel notice is the server's business. */
  async tradeLeave(): Promise<void> {
    if (!this.gameLink || !this.trade.open) return;
    this.trade.clear();
    await this.gameLink.send(encodeClientMiniRoomRequest({ kind: "leave" }));
  }

  /**
   * 메신저（`0x24`）: the four native senders. `roomId == 0` opens a fresh room
   * (`sub_4DDFE0` via the StatusBar's BtChat, id 1004); the invite modal's yes re-sends the
   * room id the server put in `0x4D type 3` (`sub_4DDF10`).
   */
  async messengerEnter(roomId: number): Promise<void> {
    if (!this.gameLink) throw new Error("messenger needs a field session");
    await this.gameLink.send(encodeClientMessengerRequest({ kind: "enter", roomId }));
  }

  /** `sub_4DE280`: closing the window leaves the room. */
  async messengerLeave(): Promise<void> {
    if (!this.gameLink) return;
    await this.gameLink.send(encodeClientMessengerRequest({ kind: "leave" }));
  }

  /** `sub_4E24B0`: `/초대 <name>` sends the name only. */
  async messengerCommand(name: string): Promise<void> {
    if (!this.gameLink) return;
    await this.gameLink.send(
      encodeClientMessengerRequest({ kind: "command", text: byteStringOf(name) }),
    );
  }

  /** `sub_4DE490`/`sub_4DEAF0`: a chat row or the separator-less typing row. */
  async messengerSay(line: string): Promise<void> {
    if (!this.gameLink) return;
    await this.gameLink.send(
      encodeClientMessengerRequest({ kind: "chat", line: byteStringOf(line) }),
    );
  }

  async attack(
    targets: {
      mobId: number;
      x: number;
      y: number;
      damage: number;
      damages?: number[];
      hitAnimation?: number;
    }[],
    facingLeft = false,
    options: {
      shoot?: boolean;
      magic?: boolean;
      action?: number;
      speed?: number;
      projectileSlot?: number;
      skillId?: number;
      hits?: number;
    } = {},
  ): Promise<void> {
    const link = this.gameLink;
    if (link === undefined) throw new Error("attack() needs a session in a field");
    if (
      this.skillPending ||
      this.slotPending ||
      this.shopPending ||
      this.mesoPending ||
      this.abilityPending
    )
      throw new Error("attack blocked by a pending character operation");
    if (options.magic && options.shoot)
      throw new RangeError("an attack cannot be both magic and shoot");
    if (
      options.shoot &&
      (!Number.isInteger(options.projectileSlot) || (options.projectileSlot ?? 0) <= 0)
    )
      throw new RangeError("a shot requires a positive USE slot");
    this.attackSequence = (this.attackSequence + 1) & 0xff;
    const records: ClientAttackTarget[] = targets.slice(0, 6).map((target) => ({
      mobId: target.mobId,
      hitAnimation: target.hitAnimation ?? -1,
      x: target.x,
      y: target.y,
      sequence: this.attackSequence,
      damages: target.damages ?? [target.damage],
    }));
    const attack: ClientAttack = {
      hits: options.hits ?? 1,
      targetCount: records.length,
      skillId: options.skillId ?? 0,
      facingLeft,
      action: options.action ?? 5,
      speed: options.speed ?? 1,
      ...(options.shoot ? { projectileSlot: options.projectileSlot ?? 0 } : {}),
      targets: records,
    };
    await link.send(
      encodeClientAttack(
        attack,
        options.magic
          ? CLIENT_FIELD_OPCODE.magicAttack
          : options.shoot
            ? CLIENT_FIELD_OPCODE.shootAttack
            : CLIENT_FIELD_OPCODE.attack,
      ),
    );
  }

  /** Sends a field chat line. The 2003 client writes CP949; the adapter pre-encodes. */
  async say(text: Uint8Array): Promise<void> {
    const link = this.gameLink;
    if (link === undefined) throw new Error("say() needs a session in a field");
    await link.send(encodeClientChat({ text }));
  }

  /**
   * Whispers to a player by name: `0x23` with kind `0x06` - the packet `/귓속말 <name> <text>` sends
   * (`sub_4717D0`, FINDINGS 4.31).
   *
   * The text is bytes because the client's own encoding is CP949; the adapter pre-encodes, exactly
   * as it does for `say`. `name` is the target as typed: the client never sends character ids here,
   * and the server looks the session up by name.
   *
   * Nothing about the result comes back on this call: a delivered whisper produces `0x1A` sub-op
   * `0x12` **at the receiver**, distinct from field speech (0x1F), and sub-op `0x0A` at the sender - the `whisper-answer` event, whose name is the resolved
   * character and whose flag says delivered or not found.
   */
  async whisper(name: string, text: Uint8Array): Promise<void> {
    const link = this.gameLink;
    if (link === undefined) throw new Error("whisper() needs a session in a field");
    if (name === "") throw new Error("whisper() needs a target name");
    this.reserveUserRequest();
    try {
      await link.send(encodeClientUserRequest({ kind: USER_REQUEST_KIND.whisper, name, text }));
    } catch (error) {
      this.userRequestUntil = 0;
      throw error;
    }
  }

  /** 4717D0 / 4728D0: shared find/whisper gate, expires after 3000ms. */
  private reserveUserRequest(): void {
    if (performance.now() < this.userRequestUntil) throw new Error("다른 요청을 처리 중입니다");
    this.userRequestUntil = performance.now() + 3000;
  }
  async refuseWhisper(name: string): Promise<void> {
    if (!this.gameLink || !this.self) throw new Error("refusal needs a session in a field");
    // The second string is our own character name, NOT the refused message text.
    await this.gameLink.send(
      encodeClientUserRequest({
        kind: USER_REQUEST_KIND.refuseWhisper,
        name,
        text: encodeCp949(this.self.name),
      }),
    );
  }

  /** 0x23 kind0x05 -> 0x1A sub-op0x09; mapId -1 means not found. */
  async find(name: string): Promise<void> {
    const link = this.gameLink;
    if (link === undefined) throw new Error("find() needs a session in a field");
    if (name === "") throw new Error("find() needs a name");
    this.reserveUserRequest();
    try {
      await link.send(encodeClientUserRequest({ kind: USER_REQUEST_KIND.find, name }));
    } catch (error) {
      this.userRequestUntil = 0;
      throw error;
    }
  }

  /**
   * Wears a face: `0x13` (`sub_511E20` case 10, FINDINGS 4.35). `0..8` are the client's own nine
   * faces (`EMOTION_NAMES`); its F-keys send `1..7`.
   *
   * The 2003 client applies the face **before** it sends (`CUser::SetFace` runs one instruction
   * earlier, `.text:00511FD8` vs `00511FDF`) and the server's `0x27` excludes the mover - so this
   * emits `user-emotion` for the local character itself, the same way `moveTo` echoes its own step.
   */
  /** 4DAF70/55D5F0: money request, completed only by nonzero stat ack. */
  async dropMesos(amount: number): Promise<void> {
    if (!this.gameLink || !this.self || this.self.hp <= 0)
      throw new Error("meso drop requires a living character in a field");
    if (
      this.mesoPending ||
      this.abilityPending ||
      this.skillPending ||
      this.slotPending ||
      this.shopPending ||
      performance.now() < this.nextMesoAt
    )
      throw new Error("meso request pending or too soon");
    if (amount > this.self.mesos) throw new RangeError("not enough mesos");
    const packet = encodeMesoDrop(amount);
    this.mesoPending = true;
    this.nextMesoAt = performance.now() + MESO_DROP_INTERVAL_MS;
    try {
      await this.gameLink.send(packet);
    } catch (error) {
      this.mesoPending = false;
      throw error;
    }
  }

  async increaseAbility(field: Ability): Promise<void> {
    if (!this.gameLink || !this.self) throw new Error("AP requires an active field");
    if (
      this.abilityPending ||
      this.mesoPending ||
      this.skillPending ||
      performance.now() < this.nextSkillAt
    )
      throw new Error("AP request already pending");
    const packet = encodeAbilityRequest(field);
    this.abilityPending = true;
    try {
      await this.gameLink.send(packet);
    } catch (error) {
      this.abilityPending = false;
      throw error;
    }
  }

  /** Development mutations must not race a native stat/item request. */
  assertTestToolsReady(): void {
    if (!this.gameLink || !this.self) throw new Error("請先進入地圖。");
    if (
      this.skillPending ||
      this.abilityPending ||
      this.slotPending ||
      this.shopPending ||
      this.mesoPending
    )
      throw new Error("請等待目前能力／技能／道具操作回覆。");
  }

  /** Original positive 0x1C reports from the native recovery clock; no optimistic local HP edits. */
  async recover(report: ClientStatReport): Promise<void> {
    if (!this.gameLink || !this.self || this.self.hp <= 0) return;
    if (
      ![report.hpDelta ?? 0, report.mpDelta ?? 0].every(
        (n) => Number.isInteger(n) && n >= 0 && n <= 32767,
      ) ||
      ![0, 1].includes(report.flag)
    )
      throw new Error("Invalid recovery report");
    await this.gameLink.send(
      encodeClientStatReport({
        hpDelta: report.hpDelta ?? 0,
        mpDelta: report.mpDelta ?? 0,
        flag: report.flag,
      }),
    );
  }

  /** Bridge-derived contact damage only. No JSON endpoint accepts an arbitrary negative delta. */
  async reportTouchDamage(damage: number): Promise<void> {
    if (!Number.isInteger(damage) || damage < 1 || damage > 9999)
      throw new Error("Invalid native touch damage");
    if (!this.gameLink || !this.self || this.self.hp <= 0)
      throw new Error("Touch report requires a living field session");
    await this.gameLink.send(encodeClientStatReport({ hpDelta: -damage, mpDelta: 0, flag: 0 }));
  }

  async increaseSkill(skillId: number): Promise<void> {
    if (!this.gameLink || !this.self || this.self.hp <= 0 || this.self.sp <= 0)
      throw new Error("SP requires a living character with available points");
    if (
      this.skillPending ||
      this.abilityPending ||
      this.mesoPending ||
      this.slotPending ||
      this.shopPending ||
      performance.now() < this.nextSkillAt
    )
      throw new Error("another stat/item request is pending or too soon");
    const packet = encodeSkillRequest(skillId);
    this.skillPending = true;
    try {
      await this.gameLink.send(packet);
    } catch (error) {
      this.skillPending = false;
      throw error;
    }
  }

  async emotion(value: number): Promise<void> {
    const link = this.gameLink;
    if (link === undefined) throw new Error("emotion() needs a session in a field");
    await link.send(encodeClientEmotion({ emotion: value }));
    const self = this.self;
    if (self !== undefined) {
      this.emit({
        kind: "user-emotion",
        characterId: self.characterId,
        emotion: value,
      });
    }
  }

  /**
   * Uses a USE-tab slot: `0x18` for the 200-family (potions), `0x19` for 203 (a town scroll).
   *
   * The split is the client's own: `sub_462DC0` (a double-click in the inventory window) picks the
   * sender by `itemId / 10000` - 200/201/202 -> `sub_55B2C0` `0x18`, 203 -> `sub_55B4B0` `0x19`
   * (FINDINGS 4.34). There is no result byte on either: the answer is the `0x0B` that takes the item
   * out of the slot and the `0x0D` that moves the vitals, or an empty `0x0B` when the server refused.
   *
   * `itemId` is sent because the wire sends it: the server checks the slot really holds it.
   */
  /** Original sub_55ACB0, acknowledged only by a nonzero 0x0B result. No local inventory writes. */
  async changeSlot(request: ClientChangeSlot): Promise<void> {
    const { tab, fromSlot, toSlot, count } = request;
    if (!this.gameLink || !this.self || this.self.hp <= 0)
      throw new Error("changeSlot needs a living character in a field");
    if (
      ![tab, fromSlot, toSlot, count].every(Number.isInteger) ||
      tab < 1 ||
      tab > 4 ||
      fromSlot === 0 ||
      fromSlot < -14 ||
      fromSlot > 32767 ||
      toSlot < -14 ||
      toSlot > 32767 ||
      ((fromSlot < 0 || toSlot < 0) && tab !== 1) ||
      (toSlot === 0
        ? count < 0 ||
          count > 32767 ||
          (count === 0 &&
            Math.floor(
              (this.latest?.items?.inventories[tab - 1]?.items.get(fromSlot)?.itemId ?? 0) / 10000,
            ) !== 207)
        : count !== -1)
    )
      throw new Error("invalid change-slot fields");
    if (
      this.skillPending ||
      this.slotPending ||
      this.mesoPending ||
      this.shopPending ||
      performance.now() < this.nextSlotAt
    )
      throw new Error("inventory request pending or within 500ms gate");
    this.slotPending = true;
    this.nextSlotAt = performance.now() + 500;
    try {
      await this.gameLink.send(encodeClientChangeSlot(request));
    } catch (error) {
      this.slotPending = false;
      throw error;
    }
  }

  async useItem(slot: number, itemId: number): Promise<void> {
    if (this.mesoPending) throw new Error("meso request pending");
    const link = this.gameLink;
    if (link === undefined) throw new Error("useItem() needs a session in a field");
    const family = Math.floor(itemId / 10000);
    if (family < 200 || family > 203) {
      throw new Error(`useItem(): ${itemId} is not a USE-tab consumable (200..203)`);
    }
    const opcode = family === 203 ? 0x19 : 0x18;
    await link.send(encodeClientUseItem({ slot, itemId }, opcode));
  }

  /**
   * Clicks a field object: `0x33` `[op][u32 objectId]`.
   *
   * This is the click that opens an NPC's shop (`0x4A`) or starts its conversation (`0x47`) - the
   * 2003 client's `sub_55AF20`, which also arms the "a field request is pending" gate that the
   * server clears with an empty `0x19` (the bridge already drops that byte). The id is the runtime
   * one `0x39` gave the NPC, not its `life` template id.
   */
  async clickObject(objectId: number): Promise<void> {
    const link = this.gameLink;
    if (link === undefined) throw new Error("clickObject() needs a session in a field");
    await link.send(encodeClientObjectClick({ objectId }));
  }

  /**
   * One shop button: `0x16` `[op][u8 action]...` (FINDINGS 4.22, `game/shops.ts`).
   *
   * The reply is `0x4B` for buy/sell/recharge (the three that arm the client's in-flight flag) and
   * **nothing** for close; a trade that happened is then told by `0x4B`, `0x0B` and `0x0D`.
   */
  async shop(request: ClientShopRequest): Promise<void> {
    const link = this.gameLink;
    if (link === undefined) throw new Error("shop() needs a session in a field");
    if (request.kind === "close") {
      // Original close has no 0x4B response and must not arm the trade gate.
      await link.send(encodeClientShopRequest(request));
      this.shopPending = false;
      return;
    }
    if (!this.self || this.self.hp <= 0)
      throw new Error("shop trade needs a living character in a field");
    if (this.skillPending || this.shopPending || this.slotPending || this.mesoPending)
      throw new Error("inventory or shop request pending");
    const position = request.kind === "buy" ? request.row : request.slot;
    if (
      !Number.isInteger(position) ||
      position < (request.kind === "buy" ? 0 : 1) ||
      position > 65535
    )
      throw new Error("invalid shop row or slot");
    if (
      request.kind !== "recharge" &&
      (!Number.isInteger(request.count) ||
        request.count <
          (request.kind === "sell" && Math.floor(request.itemId / 10000) === 207 ? 0 : 1) ||
        request.count > 65535 ||
        !Number.isInteger(request.itemId) ||
        request.itemId <= 0 ||
        request.itemId > 0xffffffff)
    )
      throw new Error("invalid shop item or quantity");
    this.shopPending = true;
    try {
      await link.send(encodeClientShopRequest(request));
    } catch (error) {
      this.shopPending = false;
      throw error;
    }
  }

  /** Browser CNpc sender. Map identity is a web-bridge safety guard, not original wire data. */
  async npcIdle(npcId: number, action: number, speech: number, mapId: number): Promise<void> {
    const npc = this.npcs.get(npcId),
      link = this.gameLink;
    if (!link || mapId !== this.mapId || !npc?.controlled) return;
    if (
      !Number.isInteger(action) ||
      !Number.isInteger(speech) ||
      action < -128 ||
      action > 127 ||
      speech < -128 ||
      speech > 127
    )
      return;
    await link.send(encodeClientNpcIdle({ npcId, action, speech }));
  }

  /** One validated answer to the currently open 0x47; preserve its sub-op, not always say. */
  async talk(answer: number, detail: QuestReplyDetail = {}): Promise<void> {
    const link = this.gameLink,
      body = this.activeQuest;
    if (link === undefined) throw new Error("talk() needs a session in a field");
    if (body === undefined) throw new Error("talk() needs an open NPC dialog");
    const reply = questReplyFor(body, answer, detail);
    const packet = encodeQuestReply(reply),
      generation = this.questGeneration;
    // Release before the write: a next-page 0x47 can arrive before the Promise continuation.
    this.activeQuest = undefined;
    try {
      await link.send(packet);
    } catch (error) {
      if (
        this.gameLink === link &&
        this.questGeneration === generation &&
        this.activeQuest === undefined
      )
        this.activeQuest = body;
      throw error;
    }
  }

  /**
   * Applies one `0x0B` entry to the character record the view reads (`this.latest.items`).
   *
   * The record is the same shape the server sent in `0x16`, so there is no second model to keep in
   * step: an entry is written where the packet says, and the next snapshot is just a re-read of it.
   * A negative slot is one of the worn groups (`-1` -> slot 1). Which of the two groups a negative
   * slot means is not located in the 2003 client, and nothing this server sends currently uses one
   * (cash equips remain unsupported), so they land in `worn`.
   */
  private applyInventoryChange(change: InventoryChange): void {
    const items = this.latest?.items;
    if (items === undefined) return;
    const group = change.slot < 0 ? items.worn : items.inventories[change.inventory - 1]?.items;
    if (group === undefined) return;
    const key = (slot: number): number => (slot < 0 ? -slot : slot);
    if (change.op === INVENTORY_OP.put) {
      group.set(key(change.slot), change.item);
      return;
    }
    if (change.op === INVENTORY_OP.clear) {
      group.delete(key(change.slot));
      return;
    }
    if (change.op === INVENTORY_OP.swap) {
      const left = key(change.slot);
      const right = key(change.slot2);
      const target = change.slot2 < 0 ? items.worn : items.inventories[change.inventory - 1]?.items;
      if (!target) return;
      const first = group.get(left);
      const second = target.get(right);
      if (second === undefined) group.delete(left);
      else group.set(left, second);
      if (first === undefined) target.delete(right);
      else target.set(right, first);
    }
    // `op == 1` (the obfuscation key) has no visible effect: it re-keys the client's own copy of the
    // slot, which is client state this session does not keep.
  }

  /**
   * Walks to `(x, y)`. One `CMovePath` element: the field retains the endpoint position
   * (`FieldInstance.reportMove`). Preserve the browser controller's velocity, foothold and stance.
   * Action 0 is walk1/right (sub_43FC80), not stand; defaults keep older callers compatible.
   */
  async moveTo(
    x: number,
    y: number,
    foothold = 0,
    duration = 100,
    action = 0,
    vx = 0,
    vy = 0,
    attr = 0,
  ): Promise<void> {
    return this.movePath({
      originX: x,
      originY: y,
      elements: [{ attr, x, y, vx, vy, action, foothold, duration }],
    });
  }

  /** Ordered controller records, not a synthetic single 100ms endpoint. The bridge validates
   * its untrusted JSON before this protocol-level API; callers retain the full native codec.
   */
  async movePath(path: MovePath): Promise<void> {
    const link = this.gameLink;
    if (link === undefined) throw new Error("movePath() needs a session in a field");
    const end = path.elements.at(-1);
    if (!end) throw new Error("movePath() needs at least one record");
    const { x, y, action, foothold } = end;
    await link.send(encodeClientUserMove({ stageByte: 0, path }));
    this.lastPosition = { x, y };
    this.lastMovement = { action, foothold };
    const self = this.self;
    if (self !== undefined)
      this.emit({
        kind: "user-move",
        characterId: self.characterId,
        x,
        y,
        action,
        foothold,
        local: true,
      });
  }

  /**
   * Uses a portal of the map the session is in: `0x0D` with `kind = -1` and the portal's **name**.
   *
   * sub_512510 (grounded Up) and sub_5124C0 (type-3 auto) select a native portal name.
   * The server resolves tm/tn from its own archive. Pointer activation is a browser convenience,
   * not evidence that the original had no proximity/ground checks; see FINDINGS 4.43.
   *
   * Resolves once the request has been written. The move itself arrives as a `field` event, and a
   * portal that leads nowhere produces a `request-release` event but no new `field`.
   */
  async usePortal(name: string): Promise<void> {
    const link = this.gameLink;
    if (link === undefined) throw new Error("usePortal() needs a session in a field");
    if (name === "") throw new Error("usePortal() needs a portal name");
    await link.send(encodeClientInteract({ kind: INTERACT_KIND_CURSOR, name }));
  }

  /** 4E9E70: native revive OK, not the privileged map command. HP moves only on the field reply. */
  async revive(): Promise<void> {
    if (!this.gameLink || !this.self || this.self.hp > 0)
      throw new Error("Revive requires a dead field character");
    if (performance.now() < this.nextReviveAt) throw new Error("Revive request is already pending");
    this.nextReviveAt = performance.now() + 5000;
    try {
      await this.gameLink.send(encodeClientInteract({ kind: INTERACT_KIND_REVIVE, name: "" }));
    } catch (error) {
      this.nextReviveAt = 0;
      throw error;
    }
  }

  /** Original /헉맵 sender: c2s 0x0D, s32 mapId and an empty name. Server permission is authoritative. */
  async warpTo(mapId: number): Promise<void> {
    if (!Number.isSafeInteger(mapId) || mapId < 0 || mapId > 0x7fffffff || mapId === 999999999)
      throw new Error("invalid map id");
    if (!this.gameLink || !this.self) throw new Error("map command requires an active field");
    if (this.self.hp <= 0) throw new Error("revive before using map commands");
    await this.gameLink.send(encodeClientInteract({ kind: mapId, name: "" }));
  }

  close(): void {
    this.gameLink?.close();
    this.link?.close();
    this.gameLink = undefined;
    this.activeQuest = undefined;
    this.questGeneration++;
    this.link = undefined;
    this.skillPending = false;
    this.activeSkillPending = undefined;
    this.nextActiveAt = 0;
    this.fameClock.reset();
    this.party.clear();
    this.partyInvite = undefined;
    this.trade.clear();
    this.nextSkillAt = 0;
    this.userRequestUntil = 0;
    this.slotPending = this.shopPending = this.mesoPending = this.abilityPending = false;
  }

  private handleFieldPacket(plain: Uint8Array): void {
    if (plain.length === 0) return;
    const opcode = plain[0]!;
    try {
      switch (opcode) {
        case FAME_OPCODE.result: {
          const raw = readFameResult(new PacketReader(plain, 1));
          const result =
            raw.kind === "changed" || raw.kind === "received"
              ? { ...raw, name: decodeByteName(raw.name) }
              : raw;
          this.emit({ kind: "fame", result });
          return;
        }
        case PARTY_OPCODE.result: {
          const raw = readPartyResult(new PacketReader(plain, 1));
          // Protocol names remain raw CP949 byte strings (including the fixed102-byte roster).
          const result: PartyResult =
            raw.kind === "invite"
              ? { ...raw, inviterName: decodeByteName(raw.inviterName) }
              : raw.kind === "joined" || raw.kind === "left"
                ? {
                    ...raw,
                    name: decodeByteName(raw.name),
                    members: raw.members.map((m) => ({ ...m, name: decodeByteName(m.name) })),
                  }
                : raw.kind === "sync"
                  ? {
                      ...raw,
                      members: raw.members.map((m) => ({ ...m, name: decodeByteName(m.name) })),
                    }
                  : raw;
          if (result.kind === "invite") {
            // Native processes this inside a blocking modal. Browser policy is first-inviter-wins,
            // with no unbounded queue: later offers cannot retarget the displayed confirmation.
            if (this.partyInvite !== undefined || !this.self || this.self.hp <= 0) return;
            this.partyInvite = result.inviterId;
          } else {
            this.party.receive(result, this.self?.characterId ?? 0, this.self?.name ?? "");
            if (this.party.id) this.partyInvite = undefined;
          }
          this.emit({ kind: "party", result });
          return;
        }
        case MINIROOM_OPCODE.result: {
          // `sub_4815E0`: with no dialog up only types 1/2/4 are legal; the codec throws on the
          // rest exactly like the native's AVCDisconnectException path, and the log keeps it.
          const event = decodeMiniRoomEvent(readMiniRoomResult(new PacketReader(plain, 1)));
          this.trade.receive(event);
          this.emit({ kind: "trade", event });
          return;
        }
        case MESSENGER_OPCODE.result: {
          // `sub_4E18D0`: one handler for 0x4D-0x4F; the view owns the CUIMessenger model and
          // decides modal vs printed row, exactly like the native's this_8 null check.
          this.emit({
            kind: "messenger",
            event: decodeMessengerEvent(readMessengerResult(new PacketReader(plain, 1))),
          });
          return;
        }
        case SYSTEM_NOTICE_OPCODE: {
          const notice = readSystemNotice(new PacketReader(plain, 1));
          if (notice.type === 0 || notice.type === 1)
            this.emit({
              kind: "system-notice",
              type: notice.type,
              text: decodeChatText(notice.text),
            });
          return;
        }
        case FIELD_OPCODE.setField: {
          const field = readSetField(new PacketReader(plain, 1));
          this.activeSkillPending = undefined;
          this.nextActiveAt = 0;
          this.nextReviveAt = 0;
          this.userRequestUntil = 0;
          this.partyInvite = undefined;
          this.abilityPending = false;
          this.skillPending = false;
          this.nextSkillAt = 0;
          this.mesoPending = false;
          this.nextMesoAt = 0;
          this.slotPending = false;
          this.shopPending = false;
          this.nextSlotAt = 0;
          this.attackRandom = new ClientRandom(
            field.randomSeedA,
            field.randomSeedB,
            field.randomSeedC,
          );
          this.touchRandom = new ClientRandom(
            field.randomSeedA,
            field.randomSeedB,
            field.randomSeedC,
          );
          this.latest = field.character;
          this.self = selfOf(field.character);
          this.mapId = field.character.stats.mapId;
          this.lastPosition = { x: 0, y: 0 };
          this.lastMovement = { action: 6, foothold: 0 };
          this.users.clear();
          this.mobs.clear();
          this.npcs.clear();
          this.activeQuest = undefined;
          this.questGeneration++;
          this.emit({
            kind: "field",
            mapId: this.mapId,
            self: this.self,
            users: [],
            mobs: [],
            npcs: [],
          });
          // The inventory travels inside the same record (`CharacterData.flags` bit 0x02), so it is
          // a second event rather than a field of the first: a `0x0B` updates it without a field.
          this.emit({
            kind: "inventory",
            inventory: inventoryViewOf(field.character.items),
          });
          this.emit({ kind: "skills", skills: learnedSkills(field.character.items?.map32) });
          return;
        }
        case SKILL_UPDATE_OPCODE: {
          const update = readSkillUpdate(new PacketReader(plain, 1));
          if (this.latest) {
            const items = this.latest.items ?? emptyCharacterItems();
            for (const change of update.changes) {
              items.map32 = items.map32.filter((r) => r.key !== change.skillId);
              if (change.level > 0) items.map32.push({ key: change.skillId, value: change.level });
            }
            this.latest.items = items;
            this.latest.flags |= 0x20;
            this.emit({ kind: "skills", skills: learnedSkills(items.map32) });
          }
          if (update.ack && this.skillPending) {
            this.skillPending = false;
            this.nextSkillAt = performance.now() + 500;
            this.emit({ kind: "skill-result", changed: update.changes.length > 0 });
          }
          return;
        }
        case INVENTORY_OPCODE: {
          const update = readInventoryChange(new PacketReader(plain, 1));
          for (const change of update.changes) this.applyInventoryChange(change);
          this.log(`inventory: ${update.changes.length} change(s), timer ${update.result}`);
          if (update.result) this.slotPending = false;
          this.emit({
            kind: "inventory",
            inventory: inventoryViewOf(this.latest?.items),
            ack: update.result !== 0,
          });
          // The wearer never receives its own 0x28: rebuild its look from authoritative 0x0B.
          if (
            this.latest &&
            update.changes.some(
              (c) =>
                c.inventory === 1 && (c.slot < 0 || (c.op === INVENTORY_OP.swap && c.slot2 < 0)),
            )
          ) {
            this.self = selfOf(this.latest);
            this.emit({ kind: "self", self: this.self });
          }
          return;
        }
        case SHOP_OPEN_OPCODE: {
          // The shop window this server opened: which shop, and the rows it priced from the
          // archive. `0x19` (the release byte) is dropped above - it carries nothing to draw.
          const opened = readShopOpen(new PacketReader(plain, 1));
          this.emit({
            kind: "shop-open",
            shop: {
              shopId: opened.shopId,
              ...(opened.items.some((line) => shopRechargeUnitPrice(line) !== undefined)
                ? {
                    rechargeables: opened.items.flatMap((line) => {
                      const unitPrice = shopRechargeUnitPrice(line);
                      return unitPrice === undefined
                        ? []
                        : [
                            {
                              itemId: line.itemId,
                              unitPrice,
                              maxCount: line.maxCount,
                            },
                          ];
                    }),
                  }
                : {}),
              items: opened.items
                .filter((line) => line.price !== 0)
                .map((line) => ({
                  itemId: line.itemId,
                  price: line.price,
                  maxCount: line.maxCount,
                })),
            },
          });
          return;
        }
        case SHOP_RESULT_OPCODE: {
          this.shopPending = false;
          const code = readShopResult(new PacketReader(plain, 1));
          this.emit({
            kind: "shop-result",
            code,
            message: describeShopResult(code),
          });
          return;
        }
        case QUEST_TALK_OPCODE: {
          // The packet carries its own text and one of five CUtilDlgEx bodies. The local game
          // currently sends say pages, but the bridge must not discard other original sub-ops.
          const talk = readQuestTalk(new PacketReader(plain, 1));
          if (this.activeQuest !== undefined)
            throw new Error("second 0x47 while an NPC dialog is open");
          this.activeQuest = talk.body;
          this.questGeneration++;
          // Keep the legacy event name for CLI/bridge subscribers, but retain all five bodies.
          this.emit({
            kind: "npc-say",
            npcId: talk.npcId,
            message: talk.body.message,
            body: talk.body,
          });
          return;
        }
        case FIELD_OPCODE.requestRelease: {
          // The gate release every `0x0D` is answered with (an empty `0x19`). It carries nothing a
          // view can show; an `unknown` event per portal click would be noise, not honesty.
          this.log("field: 0x19 request release");
          this.emit({ kind: "request-release" });
          return;
        }
        case FIELD_OPCODE.userEnterField: {
          const enter = readUserEnterField(new PacketReader(plain, 1));
          const user: UserView = {
            characterId: enter.characterId,
            name: decodeByteName(enter.name),
            face: enter.face,
            avatarItems: enter.avatarItems,
            x: enter.x,
            y: enter.y,
            action: enter.action,
            foothold: enter.foothold,
          };
          this.users.set(user.characterId, user);
          this.emit({ kind: "user-enter", user });
          return;
        }
        case FIELD_OPCODE.userLook: {
          const look = readUserLook(new PacketReader(plain, 1)),
            user = this.users.get(look.characterId);
          if (!user) return;
          if (look.face !== undefined) user.face = look.face;
          if (look.avatarItems !== undefined) user.avatarItems = look.avatarItems;
          this.emit({
            kind: "user-look",
            characterId: look.characterId,
            ...(look.face !== undefined ? { face: look.face } : {}),
            ...(look.avatarItems !== undefined ? { avatarItems: look.avatarItems } : {}),
          });
          return;
        }
        case FIELD_OPCODE.userLeaveField: {
          const characterId = new PacketReader(plain, 1).readU32();
          this.users.delete(characterId);
          this.emit({ kind: "user-leave", characterId });
          return;
        }
        case FIELD_OPCODE.userMove: {
          const move = readUserMove(new PacketReader(plain, 1));
          const last = move.path.elements.at(-1);
          if (last === undefined) return;
          const user = this.users.get(move.characterId);
          if (user !== undefined)
            Object.assign(user, {
              x: last.x,
              y: last.y,
              action: last.action,
              foothold: last.foothold,
            });
          this.emit({
            kind: "user-move",
            characterId: move.characterId,
            x: last.x,
            y: last.y,
            action: last.action,
            foothold: last.foothold,
            path: move.path,
          });
          return;
        }
        case FIELD_OPCODE.userEmotion: {
          const emotion = readUserEmotion(new PacketReader(plain, 1));
          this.emit({
            kind: "user-emotion",
            characterId: emotion.characterId,
            emotion: emotion.emotion,
          });
          return;
        }
        case FIELD_OPCODE.userEffect: {
          const effect = readUserEffect(new PacketReader(plain, 1));
          if (effect.effect === 1)
            this.emit({
              kind: "skill-effect",
              characterId: effect.characterId,
              skillId: effect.skillId!,
              skillLevel: effect.skillLevel!,
            });
          else if (effect.effect === 0)
            this.emit({ kind: "level-up", characterId: effect.characterId });
          else this.emit({ kind: "unknown", opcode, bytes: plain.length });
          return;
        }
        case FIELD_OPCODE.userBalloon: {
          const chat = readUserBalloon(new PacketReader(plain, 1));
          const user =
            chat.characterId === this.self?.characterId
              ? this.self
              : this.users.get(chat.characterId);
          if (user)
            this.emit({
              kind: "chat",
              channel: "field",
              characterId: chat.characterId,
              name: user.name,
              text: decodeChatText(chat.text),
            });
          return;
        }
        case FIELD_OPCODE.userMessage: {
          // Four shapes; 0x12 is a received whisper, 0x22 its later refusal notification (ADR-059).
          const subOp = plain[1];
          if (subOp === USER_MESSAGE_WHISPER_REFUSED) {
            const value = readUserWhisperRefused(new PacketReader(plain, 1));
            this.emit({ kind: "whisper-refused", name: decodeByteName(value.name) });
            return;
          }
          if (subOp === USER_MESSAGE_CHAT) {
            const chat = readUserChat(new PacketReader(plain, 1));
            this.emit({
              kind: "chat",
              channel: "whisper",
              name: decodeByteName(chat.name),
              text: decodeChatText(chat.text),
            });
            return;
          }
          if (subOp === USER_MESSAGE_WHISPER_ANSWER) {
            const answer = readUserWhisperAnswer(new PacketReader(plain, 1));
            this.userRequestUntil = 0;
            this.emit({
              kind: "whisper-answer",
              name: decodeByteName(answer.name),
              delivered: answer.delivered,
            });
            return;
          }
          if (subOp === USER_MESSAGE_FIND_ANSWER) {
            const answer = readUserFindAnswer(new PacketReader(plain, 1));
            this.userRequestUntil = 0;
            this.emit({
              kind: "find-answer",
              name: decodeByteName(answer.name),
              mapId: answer.mapId,
            });
            return;
          }
          this.emit({ kind: "unknown", opcode, bytes: plain.length });
          return;
        }
        case STAT_OPCODE: {
          const update = readStatUpdate(new PacketReader(plain, 1));
          this.applyStats(update.diff);
          if (this.self && this.self.hp <= 0) this.partyInvite = undefined;
          if (update.ack && this.activeSkillPending !== undefined) {
            const skillId = this.activeSkillPending;
            this.activeSkillPending = undefined;
            this.skillPending = false;
            this.nextActiveAt = performance.now() + 200; // 55BEB0 ACK re-stamps CWvsApp+28.
            this.emit({ kind: "active-skill-result", skillId, accepted: !!update.temporary });
          }
          if (update.temporary) this.emit({ kind: "temporary-stat", update: update.temporary });
          if (update.ack && this.mesoPending) {
            this.mesoPending = false;
            this.nextMesoAt = performance.now() + MESO_DROP_INTERVAL_MS;
            this.emit({
              kind: "meso-drop-result",
              changed: update.diff.mesos !== undefined,
            });
          }
          if (update.ack && this.abilityPending) {
            this.abilityPending = false;
            this.emit({
              kind: "ability-result",
              changed: update.diff.ap !== undefined,
            });
          }
          return;
        }
        case MOB_OPCODE.enterField: {
          const mob = readMobEnterField(new PacketReader(plain, 1));
          const view: MobView = {
            mobId: mob.mobId,
            templateId: mob.templateId,
            x: mob.x,
            y: mob.y,
            facing: mob.facing,
          };
          this.mobs.set(view.mobId, view);
          this.emit({ kind: "mob-enter", mob: view });
          return;
        }
        case MOB_OPCODE.move: {
          const move = readMobMove(new PacketReader(plain, 1));
          const actionByte = (move.body.actionByte << 24) >> 24; // 488BC0 tests the SIGN bit, 0x80 means keep.
          const last = move.body.path.elements.at(-1);
          if (last === undefined) return;
          const mob = this.mobs.get(move.mobId);
          if (mob !== undefined) Object.assign(mob, { x: last.x, y: last.y });
          this.emit({
            kind: "mob-move",
            mobId: move.mobId,
            x: last.x,
            y: last.y,
            path: move.body.path,
            ...(actionByte >= 0 ? { facing: actionByte & 1 } : {}),
            actionByte,
            value: move.body.value,
          });
          return;
        }
        case MOB_OPCODE.leaveDelayed: {
          const leave = readMobLeaveDelayed(new PacketReader(plain, 1));
          const effect = mobLeaveEvent(leave, this.mobs.has(leave.mobId));
          if (effect === undefined) return;
          if (effect.kind === "mob-leave") this.mobs.delete(leave.mobId);
          this.emit(effect);
          return;
        }
        case MOB_OPCODE.presence: {
          const presence = readMobPresence(new PacketReader(plain, 1));
          if (presence.flag === 0) this.removeMob(presence.mobId);
          return;
        }
        case FIELD_OPCODE.userAttack:
        case FIELD_OPCODE.userShootAttack:
        case FIELD_OPCODE.userMagicAttack: {
          // `0x23`/`0x24`/`0x25`: the others' half of an attack. The attacker already drew it, so this
          // only ever arrives for somebody else (`relayAttack`).
          const attack = readUserAttack(new PacketReader(plain, 1));
          this.emit({
            kind: "user-attack",
            characterId: attack.characterId,
            skillId: attack.skillId,
            skillLevel: attack.skillLevel,
            facingLeft: attack.facingLeft,
            shoot: opcode === FIELD_OPCODE.userShootAttack,
            magic: opcode === FIELD_OPCODE.userMagicAttack,
            action: attack.action,
            speed: attack.speed,
            afterimage: attack.afterimage,
            projectileItemId: attack.projectileItemId,
            targets: attack.targets.map((target) => ({
              mobId: target.mobId,
              hitAnimation: target.hitAnimation,
              damages: [...target.damages],
            })),
          });
          return;
        }
        case DROP_OPCODE.appear: {
          // A v1.11 client has no pickup request (FINDINGS 4.18): the field decides who gets a drop
          // and tells everyone, and this page only has to show it land.
          const drop = readDropAppear(new PacketReader(plain, 1));
          this.emit({ kind: "drop-enter", drop });
          return;
        }
        case DROP_OPCODE.remove: {
          const remove = readDropRemove(new PacketReader(plain, 1));
          const reason = remove.kind === 2 ? "taken" : remove.kind === 1 ? "vanished" : "gone";
          this.emit({
            kind: "drop-leave",
            dropId: remove.dropId,
            reason,
            ...(remove.characterId === undefined ? {} : { characterId: remove.characterId }),
          });
          return;
        }
        case LOOT_OPCODE: {
          // `0x11` is CWvsApp-level, not CField: it is the chat line for what was just picked up
          // (`sub_55C130`). The client builds the sentence itself from its own archive.
          this.emit({
            kind: "loot",
            notice: readLootNotice(new PacketReader(plain, 1)),
          });
          return;
        }
        case MOB_OPCODE.stat: {
          const stat = readMobStat(new PacketReader(plain, 1));
          const mob = this.mobs.get(stat.mobId);
          if (mob) mob.mp = stat.mp;
          this.emit({ kind: "mob-stat", ...stat });
          return;
        }
        case NPC_OPCODE.enterField: {
          // The client itself decides which form it is by whether the pool already has the id
          // (`sub_49F6C0`); the reader takes that answer instead of guessing from the bytes.
          const npcId = new PacketReader(plain, 1).readU32();
          const npc = readNpcEnterField(new PacketReader(plain, 1), this.npcs.has(npcId));
          if (npc.templateId === undefined) {
            const existing = this.npcs.get(npcId);
            if (existing) existing.present = true;
            return;
          } // known-id refresh
          const view: NpcView = {
            npcId: npc.npcId,
            templateId: npc.templateId,
            x: npc.x,
            y: npc.y,
            facing: npc.facing & 1,
            action: npc.facing,
            present: true,
            controlled: false,
          };
          this.npcs.set(view.npcId, view);
          this.emit({ kind: "npc-enter", npc: view });
          return;
        }
        case NPC_OPCODE.leaveField: {
          const npcId = readNpcId(new PacketReader(plain, 1));
          const npc = this.npcs.get(npcId);
          if (npc) npc.present = false;
          if (!npc?.controlled) {
            this.npcs.delete(npcId);
            this.emit({ kind: "npc-leave", npcId });
          }
          return;
        }
        case NPC_OPCODE.stateToggle: {
          const state = readNpcState(new PacketReader(plain, 1));
          let npc = this.npcs.get(state.npcId);
          if (!npc && state.on) {
            // 49F260: unknown controlled id has the full enter tail, one byte after opcode.
            const body = readNpcEnterField(new PacketReader(plain, 2), false);
            npc = {
              npcId: body.npcId,
              templateId: body.templateId!,
              x: body.x,
              y: body.y,
              facing: body.facing & 1,
              action: body.facing,
              present: false,
              controlled: true,
            };
            this.npcs.set(npc.npcId, npc);
            this.emit({ kind: "npc-enter", npc });
          }
          if (!npc) return;
          npc.controlled = state.on;
          this.emit({ kind: "npc-controller", ...state });
          if (!npc.present && !npc.controlled) {
            this.npcs.delete(npc.npcId);
            this.emit({ kind: "npc-leave", npcId: npc.npcId });
          }
          return;
        }
        case NPC_OPCODE.update: {
          const value = readNpcIdle(new PacketReader(plain, 1), plain.length > 7);
          if (this.npcs.has(value.npcId)) this.emit({ kind: "npc-idle", ...value });
          return;
        }
        default:
          this.emit({ kind: "unknown", opcode, bytes: plain.length });
          return;
      }
    } catch (error) {
      this.log(`0x${opcode.toString(16)}: ${(error as Error).message}`);
    }
  }

  private removeMob(mobId: number): void {
    if (!this.mobs.delete(mobId)) return;
    this.emit({ kind: "mob-leave", mobId });
  }

  private applyStats(diff: StatDiff): void {
    const self = this.self;
    if (self === undefined) return;
    for (const [name, value] of Object.entries(diff)) {
      if (value === undefined) continue;
      if (this.latest && name in this.latest.stats)
        (this.latest.stats as unknown as Record<string, number>)[name] = value;
      if (name in self && typeof value === "number")
        (self as unknown as Record<string, number>)[name] = value;
    }
    self.expToNext = expToNextLevel(self.level);
    this.emit({ kind: "self", self });
  }
}

/** 51D7D0 uses lstrcmpiA. Legal player names have only ASCII case or KS Hangul. */
function samePlayerName(a: string, b: string): boolean {
  const fold = (value: string) => value.replace(/[A-Z]/g, (c) => c.toLowerCase());
  return fold(a) === fold(b);
}

/**
 * `0x1A` text is CP949 bytes, never UTF-8 (`protocol/cp949.ts`): the 2003 client hands the bytes to
 * its own ANSI renderer. Decoding them as UTF-8 happens to work for ASCII - which is why the first
 * version of this line did - and turns every Korean line into replacement characters.
 */
function decodeByteName(name: string): string {
  return decodeCp949(Uint8Array.from(name, (c) => c.charCodeAt(0)));
}

/** The browser side of `0x24` speaks JS strings; the wire is CP949 bytes (writeAsciiString). */
function byteStringOf(text: string): string {
  return String.fromCharCode(...encodeCp949(text));
}

/** `0x4D` carries its names and its rows as raw CP949 bytes, exactly like `0x50` does. */
function decodeMessengerEvent(event: MessengerEvent): MessengerEvent {
  switch (event.kind) {
    case "participant":
      return {
        ...event,
        participant: { ...event.participant, name: decodeByteName(event.participant.name) },
      };
    case "invite":
      return { ...event, inviterName: decodeByteName(event.inviterName) };
    case "inviteResult":
      return { ...event, name: decodeByteName(event.name) };
    case "chat":
      return { ...event, line: decodeByteName(event.line) };
    case "roster": {
      const fix = (cell: MessengerRosterCell): MessengerRosterCell =>
        cell.action === "fill" ? { ...cell, name: decodeByteName(cell.name) } : cell;
      const [a, b, c] = event.cells;
      return { ...event, cells: [fix(a), fix(b), fix(c)] };
    }
    default:
      return event;
  }
}

/** `0x50` carries its names and its log text as raw CP949 bytes, like party and fame do. */
function decodeMiniRoomEvent(event: MiniRoomEvent): MiniRoomEvent {
  switch (event.kind) {
    case "invite":
      return { ...event, inviterName: decodeByteName(event.inviterName) };
    case "refused":
      return event.name === undefined ? event : { ...event, name: decodeByteName(event.name) };
    case "participant":
      return {
        ...event,
        participant: { ...event.participant, name: decodeByteName(event.participant.name) },
      };
    case "enter":
      return {
        ...event,
        participants: event.participants.map((p) => ({ ...p, name: decodeByteName(p.name) })),
      };
    case "message":
      return { ...event, text: decodeByteName(event.text) };
    default:
      return event;
  }
}

function decodeChatText(bytes: Uint8Array): string {
  return decodeCp949(bytes);
}

/** The events the adapter forwards, as a stable list (the JSON protocol's `t` values). */
export const CLIENT_EVENT_KINDS = [
  "field",
  "request-release",
  "self",
  "temporary-stat",
  "active-skill-result",
  "skill-effect",
  "party",
  "party-command",
  "fame",
  "ability-result",
  "skill-result",
  "skills",
  "meso-drop-result",
  "user-enter",
  "user-leave",
  "user-move",
  "user-emotion",
  "chat",
  "inventory",
  "shop-open",
  "shop-result",
  "npc-say",
  "whisper-answer",
  "whisper-refused",
  "system-notice",
  "find-answer",
  "level-up",
  "mob-enter",
  "mob-move",
  "mob-leave",
  "npc-enter",
  "npc-leave",
  "npc-controller",
  "npc-idle",
  "unknown",
  "disconnect",
] as const satisfies readonly ClientEvent["kind"][];

/**
 * `0x30` is two packets wearing one opcode: a positive delay means "start the death animation"
 * (the monster stays in the pool until `0x31` takes the corpse), and a negative one means "it is
 * already gone". The 2003 client plays `Mob/<id>.img/die1` for the first - a picture, not a removal,
 * so the page is told about it instead of silently losing the monster.
 */
export function mobLeaveEvent(leave: MobLeaveDelayed, present: boolean): ClientEvent | undefined {
  if (leave.delayMs < 0) return present ? { kind: "mob-leave", mobId: leave.mobId } : undefined;
  // The 0x30 delay is 0 for "starts now"; how long the animation runs is the monster's own
  // `die1` frames, which is the same sum the field's `dieMs` is made of (`game/mobs.ts`).
  return present ? { kind: "mob-die", mobId: leave.mobId } : undefined;
}
