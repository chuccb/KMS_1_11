/** Runtime guards for the server-to-browser three-person messenger event union. */
import type { MessengerEvent } from "../server/src/protocol/messenger.ts";
import { MESSENGER_ROOM_SIZE } from "./messenger-constants.ts";
import { isRecord } from "./resource-validation.ts";

const BYTE_MAX = 0xff;
const UINT32_MAX = 0xffffffff;

function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}

function byte(value: unknown): value is number {
  return integer(value, 0, BYTE_MAX);
}

function uint32(value: unknown): value is number {
  return integer(value, 0, UINT32_MAX);
}

function look(value: unknown): boolean {
  // 0 terminates the on-wire look list and is not itself an appearance item.
  return Array.isArray(value) && value.every((item: unknown) => integer(item, 1, UINT32_MAX));
}

function participant(value: unknown): boolean {
  return (
    isRecord(value) &&
    integer(value.slot, 0, MESSENGER_ROOM_SIZE - 1) &&
    typeof value.name === "string" &&
    byte(value.level) &&
    uint32(value.face) &&
    look(value.look)
  );
}

function rosterCell(value: unknown): boolean {
  if (!isRecord(value)) return false;
  switch (value.action) {
    case "clear":
    case "keep":
      return true;
    case "fill":
      return (
        byte(value.level) &&
        uint32(value.face) &&
        look(value.look) &&
        typeof value.name === "string"
      );
    default:
      return false;
  }
}

/** Validate the nested `MessengerEvent`, including its fixed three-cell roster. */
export function isMessengerEvent(value: unknown): value is MessengerEvent {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  switch (value.kind) {
    case "participant":
      return participant(value.participant) && typeof value.announce === "boolean";
    case "joinFailed":
      return byte(value.code);
    case "left":
      return integer(value.slot, 0, MESSENGER_ROOM_SIZE - 1);
    case "invite":
      return typeof value.inviterName === "string" && uint32(value.roomId);
    case "inviteResult":
      return typeof value.name === "string" && (value.ok === 0 || value.ok === 1);
    case "chat":
      return typeof value.line === "string";
    case "cellUpdate":
      return (
        integer(value.slot, 0, MESSENGER_ROOM_SIZE - 1) &&
        byte(value.level) &&
        uint32(value.face) &&
        look(value.look)
      );
    case "roster":
      return (
        Array.isArray(value.cells) &&
        value.cells.length === MESSENGER_ROOM_SIZE &&
        value.cells.every(rosterCell)
      );
    default:
      return false;
  }
}
