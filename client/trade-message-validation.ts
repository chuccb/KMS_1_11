/** Runtime guards for the JSON-safe browser half of the native 1:1 trade event union. */
import type { EquipStat } from "../server/src/protocol/itemslot.ts";
import type { ItemSlotJson, MiniRoomEventJson } from "./trade-wire.ts";
import {
  MINIROOM_BUSY_REFUSAL_CODE,
  MINIROOM_TRADE_KIND,
  TRADE_PARTICIPANT_CAPACITY,
  TRADE_SLOTS,
} from "./trade-constants.ts";
import { isRecord } from "./resource-validation.ts";

type TradeParticipantJson = Extract<MiniRoomEventJson, { kind: "participant" }>["participant"];

const U8_MAX = 0xff;
const U16_MAX = 0xffff;
const U32_MAX = 0xffffffff;
const U64_MAX_DECIMAL = "18446744073709551615";
/** `sub_45E6A0` chooses the equip class for item category 1 (`itemId / 1,000,000`). */
const EQUIP_ITEM_CATEGORY = 1;
const ITEM_ID_CATEGORY_DIVISOR = 1_000_000;
const EQUIP_STAT_FIELDS = [
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
] as const satisfies readonly EquipStat[];

function integer(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max;
}

function unsigned64Decimal(value: unknown): value is string {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) return false;
  return (
    value.length < U64_MAX_DECIMAL.length ||
    (value.length === U64_MAX_DECIMAL.length && value <= U64_MAX_DECIMAL)
  );
}

function cashBlock(value: unknown): boolean {
  return (
    isRecord(value) &&
    unsigned64Decimal(value.sn) &&
    value.sn !== "0" &&
    integer(value.unknown18, U16_MAX) &&
    unsigned64Decimal(value.unknown1A)
  );
}

function itemSlot(value: unknown): value is ItemSlotJson {
  if (
    !isRecord(value) ||
    !integer(value.itemId, U32_MAX) ||
    !(value.cash === null || cashBlock(value.cash))
  )
    return false;

  const isEquipId = Math.floor(value.itemId / ITEM_ID_CATEGORY_DIVISOR) === EQUIP_ITEM_CATEGORY;
  if (value.kind === "equip") {
    return (
      isEquipId &&
      integer(value.ruc, U8_MAX) &&
      integer(value.cuc, U8_MAX) &&
      EQUIP_STAT_FIELDS.every((field) => integer(value[field], U16_MAX))
    );
  }
  return value.kind === "nonequip" && !isEquipId && integer(value.quantity, U16_MAX);
}

function participant(value: unknown): value is TradeParticipantJson {
  return (
    isRecord(value) &&
    integer(value.index, TRADE_PARTICIPANT_CAPACITY - 1) &&
    typeof value.name === "string" &&
    integer(value.face, U32_MAX) &&
    Array.isArray(value.look) &&
    value.look.every((itemId: unknown) => integer(itemId, U32_MAX) && itemId !== 0) &&
    integer(value.level, U8_MAX)
  );
}

function participants(value: unknown): value is TradeParticipantJson[] {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= TRADE_PARTICIPANT_CAPACITY &&
    value.every(participant)
  );
}

/** Validate one JSON-decoded MiniRoom event, including every nested item and decimal u64. */
export function isMiniRoomEventJson(value: unknown): value is MiniRoomEventJson {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  switch (value.kind) {
    case "invite":
      return integer(value.inviterId, U32_MAX) && typeof value.inviterName === "string";
    case "refused":
      return (
        integer(value.code, U8_MAX) &&
        (value.code === MINIROOM_BUSY_REFUSAL_CODE
          ? typeof value.name === "string"
          : value.name === undefined)
      );
    case "participant":
      return participant(value.participant);
    case "enter": {
      if (
        value.roomKind !== MINIROOM_TRADE_KIND ||
        !integer(value.myIndex, TRADE_PARTICIPANT_CAPACITY - 1) ||
        !participants(value.participants)
      )
        return false;
      const indexes = new Set(value.participants.map((entry) => entry.index));
      return indexes.size === value.participants.length && indexes.has(value.myIndex);
    }
    case "message":
      return typeof value.text === "string";
    case "finish":
      return integer(value.code, U8_MAX);
    case "item":
      return (
        integer(value.index, TRADE_PARTICIPANT_CAPACITY - 1) &&
        integer(value.roomSlot, TRADE_SLOTS) &&
        value.roomSlot > 0 &&
        itemSlot(value.item)
      );
    case "mesos":
      return integer(value.index, TRADE_PARTICIPANT_CAPACITY - 1) && integer(value.amount, U32_MAX);
    case "lock":
    case "ready":
      return true;
    default:
      return false;
  }
}
