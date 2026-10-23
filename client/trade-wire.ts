import type { ItemSlot, ItemSlotCashBlock } from "../server/src/protocol/itemslot.ts";
import type { MiniRoomEvent } from "../server/src/protocol/miniroom.ts";

/** Wire DTO: cash-block u64s are canonical decimal strings; raw protocol values remain BigInt. */
export type ItemSlotCashBlockJson = Omit<ItemSlotCashBlock, "sn" | "unknown1A"> & {
  sn: string;
  unknown1A: string;
};

/** An ItemSlot whose optional native cash block can cross JSON without precision loss. */
export type ItemSlotJson<Item extends ItemSlot = ItemSlot> = Item extends ItemSlot
  ? Omit<Item, "cash"> & { cash: ItemSlotCashBlockJson | null }
  : never;

/** MiniRoom events are unchanged except for the JSON-safe item cash-block representation. */
export type MiniRoomEventJson<Event extends MiniRoomEvent = MiniRoomEvent> = Event extends {
  kind: "item";
  item: infer Item extends ItemSlot;
}
  ? Omit<Event, "item"> & { item: ItemSlotJson<Item> }
  : Event;

/** Project one native MiniRoom event, preserving u64 values exactly in canonical base 10. */
export function miniRoomEventJson(event: MiniRoomEvent): MiniRoomEventJson {
  if (event.kind !== "item") return event;
  if (event.item.cash === null) {
    const item = { ...event.item, cash: null } satisfies ItemSlotJson;
    return { ...event, item };
  }

  const { cash } = event.item;
  const item = {
    ...event.item,
    cash: {
      ...cash,
      sn: cash.sn.toString(10),
      unknown1A: cash.unknown1A.toString(10),
    },
  } satisfies ItemSlotJson;
  return { ...event, item };
}
