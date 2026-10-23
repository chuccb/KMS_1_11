/** Compile-time server-to-browser JSON contract. Runtime payload validation remains event-specific. */
import type { StatBasis } from "../../../client/characterstats.ts";
import type { ClientEvent } from "../client/session.ts";
import type { MiniRoomEventJson } from "../../../client/trade-wire.ts";
import type { MiniRoomEvent } from "../protocol/miniroom.ts";
import type { ItemInfo } from "../game/iteminfo.ts";
import type { MobPresentation } from "../game/mobs.ts";
import type { PhysicalAttackTrace } from "../game/nativecombat.ts";
import type { TestToolResult } from "../game/testtools.ts";
import type { WorldEntry } from "../protocol/replies.ts";
export type {
  ItemSlotCashBlockJson,
  ItemSlotJson,
  MiniRoomEventJson,
} from "../../../client/trade-wire.ts";

type ClientEventProjection<Event extends ClientEvent> = Event extends {
  kind: infer Kind extends string;
}
  ? Omit<Event, "kind"> & { t: Kind }
  : never;

/** Wire events preserve the session discriminator as `t`; field and mob events add bridge metadata. */
export type ClientEventJson<Event extends ClientEvent = ClientEvent> = Event extends {
  kind: "field";
}
  ? ClientEventProjection<Event> & {
      contactField: number;
      playerMenu: true;
      socialCommands: true;
      partyInviteIdentity: boolean;
      trade: true;
    }
  : Event extends { kind: "mob-enter" }
    ? ClientEventProjection<Event> & { presentation?: MobPresentation }
    : Event extends { kind: "mob-move" }
      ? ClientEventProjection<Event> & {
          presentation?: MobPresentation;
          forcedDuration?: number;
        }
      : Event extends {
            kind: "trade";
            event: infer TradeEvent extends MiniRoomEvent;
          }
        ? Omit<ClientEventProjection<Event>, "event"> & {
            event: MiniRoomEventJson<TradeEvent>;
          }
        : ClientEventProjection<Event>;

/** The character-list projection is smaller than CharacterData and is never written back to a save. */
export interface CharacterSummary {
  id: number;
  name: string;
  level: number;
  job: number;
  face: number;
  hair: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  exp: number;
  mesos: number;
  mapId: number;
  str: number;
  dex: number;
  int: number;
  luk: number;
  /** Worn item ids, for drawing a character before it enters a field. */
  items: number[];
}

export interface WornFact {
  slot: number;
  itemId: number;
  stats: { str: number; dex: number; int: number; luk: number; pad: number };
  ruc: number;
  cuc: number;
  requirements?: NonNullable<ItemInfo["requirements"]>;
}

export interface StatBasisMessage {
  t: "stat-basis";
  basis: StatBasis;
  shotRange: number;
  wornFacts: WornFact[];
  ammoPad: number;
}

export type TouchResultMessage =
  | { t: "touch-result"; contactId: number; contactField: number; accepted: true; damage: number }
  | {
      t: "touch-result";
      contactId: number;
      contactField: number;
      accepted: false;
      message?: string;
      retryAfterMs?: number;
    };

/** Every JSON message emitted by WebClient.send. This does not claim runtime deep validation. */
export type WebClientServerMessage =
  | ClientEventJson
  | { t: "login"; result: number; worlds: WorldEntry[]; gender: number }
  | { t: "characters"; result: number; characters: CharacterSummary[] }
  | { t: "created"; ok: true; name: string; id: number }
  | { t: "created"; ok: false; name: string; reason: string }
  | { t: "name-checked"; name: string; result: number }
  | { t: "deleted"; id: number; ok: boolean }
  | { t: "error"; message: string }
  | {
      t: "active-hit";
      attackToken: number;
      skillId: number;
      skillLevel: number;
      mobId: number;
      damages: number[];
      contactField: number;
    }
  | {
      t: "hit";
      attackToken: number;
      mobId: number;
      damage: number;
      delayMs: number;
      contactField: number;
      trace?: PhysicalAttackTrace;
    }
  | TouchResultMessage
  | StatBasisMessage
  | ({ t: "test-tools" } & TestToolResult);
