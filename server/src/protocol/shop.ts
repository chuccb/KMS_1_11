/**
 * The NPC shop: `0x4A`/`0x4B` (server -> client) and `0x16`/`0x33` (client -> server).
 *
 * EVIDENCE (MapleStory.exe.c / .lst, FINDINGS 4.22)
 * --------------------------------------------------------------------
 * SERVER -> CLIENT. `CField` routes `0x49`-`0x4C` to `sub_4B73A0(opcode, packet)`, and only two of
 * the four opcodes have a branch:
 *
 *   `0x4A` (74)  allocates a `CShopDlg` (`sub_403350` + `sub_4B7640`, RTTI `CShopDlg`, WZ "UI")
 *                and calls `sub_4B3780(dlg, packet)` - **the shop list**:
 *
 *                  u32 shopId            // stored at dlg+144
 *                  u16 count             // number of rows; 0 = an empty shop
 *                  count x {
 *                    u32 itemId
 *                    u32 price           // what the client charges *itself* when you press buy
 *                    if itemId / 10000 == 207:  u8[8]   // copied verbatim (`sub_45DD00`)
 *                    u16 maxCount        // ordinary buy upper bound; for207, the set capacity
 *                  }
 *
 *                (The 207 case is the only item family in this build that carries the extra 8 bytes.
 *                The open reader copies them verbatim to +24; 4B4AD0 later reads them as a double -
 *                so this codec carries them verbatim as `cash` and refuses to *build* a row that
 *                has none: the legacy property name is retained for capture/codec compatibility.)
 *   `0x4B` (75)  reads one `u8` and shows a message for it, from the client's own string table:
 *                  0  nothing at all (it only drops the "a request is in flight" flag)
 *                  1  "물품이 부족합니다"              (not enough items)
 *                  2  "현금이 부족합니다"              (not enough mesos)
 *                  3  "남은 슬롯이 부족하지 않은지 확인해보세요" (check your free slots)
 *                  4  "물품이 부족합니다"              (same message as 1 - the split is not located)
 *                  >4 "오류가 발생해 거래를 하지 못했습니다"     (an error occurred; the trade failed)
 *                It is also the **unlock**: the client refuses to send another shop request while
 *                `CShopDlg+184` is set, and this handler is what clears it. Every request therefore
 *                gets an answer, even a silent one.
 *   `0x49`/`0x4C`  no branch: the dispatcher falls through and reads nothing.
 *
 * CLIENT -> SERVER.
 *
 *   `0x33`  "clicked a field object": `sub_55AF20(CWvsApp, objectId)` sends `u32 objectId`, the id
 *           the field session handed to the object (`0x39`'s `npcId` for an NPC). The click handler
 *           is `sub_4A7770`, which picks the object under the mouse and only for one whose type is 3
 *           (`object+48`). It also arms the client's "a field request is pending" gate
 *           (`CWvsApp+24`), which the server has to clear - an empty `0x19` (`sub_4728B0`) or a
 *           `0x0D` with its ack byte set both do it (FINDINGS 4.11.6 / 4.21).
 *
 *   `0x16`  the four `CShopDlg` buttons all build the *same* opcode with a leading action byte:
 *
 *                  u8  0 buy       + u16 rowIndex + u32 itemId + u16 count   (`sub_4B6B40`)
 *                  u8  1 sell      + u16 slot     + u32 itemId + u16 count   (`sub_4B6E90`)
 *                  u8  2 recharge  + u16 slot                                (`sub_4B7130`)
 *                  u8  3 close     (nothing else; the window is torn down)   (`sub_4B3C80`)
 *
 *           `itemId` is what makes a request usable: the row index is the client's own index into
 *           the list it built, and the client builds two of them (nonzero-price rows and the 207 rows),
 *           so the server validates the id against the nonzero-price buy list, not the recharge-only rows. Sell carries the
 *           *inventory* slot instead, which is how the server finds the stack to take from.
 *
 * Note the opcode reuse: `0x16` is `setField` in the other direction and `0x33` is the mob's move in
 * the other direction, exactly like `0x0D`/`0x0B` (FINDINGS 4.6, 4.21.1).
 */
import { PacketReader, PacketWriter } from "./packet.ts";

/** `sub_4B73A0` case 74: open the shop window with its list (`sub_4B3780`). */
export const SHOP_OPEN_OPCODE = 0x4a;

/** `sub_4B73A0` case 75: one result byte for the request in flight. */
export const SHOP_RESULT_OPCODE = 0x4b;

/** The client's shop requests (`sub_4B6B40`/`sub_4B6E90`/`sub_4B7130`/`sub_4B3C80`). */
export const CLIENT_SHOP_OPCODE = 0x16;

/** `sub_55AF20`: the player clicked a field object (the NPC click). */
export const CLIENT_OBJECT_CLICK_OPCODE = 0x33;

/**
 * The `u8` of `0x4B`, with the client's own message for each - see the header. `silent` and the four
 * named ones are the cases the switch has; anything else lands on its default message.
 */
export const SHOP_RESULT = {
  /** No message: the request is over. This is what a successful trade answers with. */
  silent: 0,
  /** "물품이 부족합니다" - you do not have that (any more). */
  notEnoughItems: 1,
  /** "현금이 부족합니다" - the price is above the character's mesos. */
  notEnoughMesos: 2,
  /** "남은 슬롯이 부족하지 않은지 확인해보세요" - the inventory has no room. */
  notEnoughSlots: 3,
  /** The client shows the same message as `notEnoughItems`; the difference is not located. */
  notEnoughItems2: 4,
  /** Anything above 4 is the client's "오류가 발생해 거래를 하지 못했습니다". */
  error: 255,
} as const;

/** The leading `u8` of a `0x16` request. */
export const SHOP_REQUEST = {
  buy: 0,
  sell: 1,
  recharge: 2,
  close: 3,
} as const;

/** One row of a shop: `u32 itemId`, `u32 price`, optional 8 raw bytes, `u16 maxCount`. */
export interface ShopLine {
  itemId: number;
  /** What the client displays and what a buy is worth per unit. */
  price: number;
  /**
   * The maximum quantity in one purchase; the ordinary-item dialog starts at 1.
   *
   * Read off the shop list into the row's `+32` (`sub_4B3780`); `sub_4B6B40` calls
   * `sub_4B7960(prompt, 1, row[8])`, so this is the upper bound, NOT the default. It is not a
   * stock level: the client never decrements it and the server owns the real inventory of the shop.
   */
  maxCount: number;
  /** Legacy field name for the 207 row's LE float64 recharge unit price, NOT a cash serial.
   * 4B3780 copies these to +24; 4B4AD0 multiplies that double by missing charges. */
  cash?: Uint8Array;
}

/** The body of `0x4A`: which shop, and its rows. */
export interface ShopOpen {
  /** Identifies the shop to the client (`dlg+144`); the client never sends it back. */
  shopId: number;
  items: readonly ShopLine[];
}

/** `itemId / 10000` for the one family that carries the extra 8 bytes. */
const CASH_ITEM_CATEGORY = 207;

/** How many bytes that family adds between the price and the count. */
const CASH_BLOCK_BYTES = 8;

/** Pack one `0x4A` (opcode included). Throws for a 207 row without its 8 bytes, or with the wrong count. */
export function encodeShopOpen(shop: ShopOpen): Uint8Array {
  const writer = new PacketWriter(16 + shop.items.length * 16);
  writer.writeByte(SHOP_OPEN_OPCODE);
  writer.writeU32(shop.shopId);
  writer.writeU16(shop.items.length);
  for (const line of shop.items) {
    if (Math.floor(line.itemId / 10000) === CASH_ITEM_CATEGORY) {
      if (line.cash === undefined || line.cash.length !== CASH_BLOCK_BYTES) {
        throw new RangeError(
          `0x4a: item ${line.itemId} is a 207 item, which carries ${CASH_BLOCK_BYTES} bytes: supply encodeRechargeUnitPrice(info.unitPrice) or a captured raw block`,
        );
      }
    } else if (line.cash !== undefined) {
      throw new RangeError(`0x4a: item ${line.itemId} is not a 207 item but carries a cash block`);
    }
    writer.writeU32(line.itemId);
    writer.writeU32(line.price);
    if (line.cash !== undefined) writer.writeBytes(line.cash);
    writer.writeU16(line.maxCount);
  }
  return writer.toBytes();
}

/** Read one `0x4A` body (the reader must sit just past the opcode byte). */
export function readShopOpen(reader: PacketReader): ShopOpen {
  const shopId = reader.readU32();
  const count = reader.readU16();
  const items: ShopLine[] = [];
  for (let i = 0; i < count; i++) {
    const itemId = reader.readU32();
    const price = reader.readU32();
    const cash =
      Math.floor(itemId / 10000) === CASH_ITEM_CATEGORY
        ? reader.readBytes(CASH_BLOCK_BYTES)
        : undefined;
    const maxCount = reader.readU16();
    items.push(
      cash === undefined ? { itemId, price, maxCount } : { itemId, price, maxCount, cash },
    );
  }
  return { shopId, items };
}

/** One line for the `decode` tool: `shop 2003 with 4 rows (2000000 x25 ...)`. */
export function describeShopOpen(shop: ShopOpen): string {
  if (shop.items.length === 0) return `shop ${shop.shopId} (empty)`;
  const rows = shop.items.map((line) => `${line.itemId} at ${line.price} up to ${line.maxCount}`);
  return `shop ${shop.shopId} with ${shop.items.length} row(s): ${rows.join(", ")}`;
}

/** Pack one `0x4B` (opcode included). */
export function encodeShopResult(code: number): Uint8Array {
  if (!Number.isInteger(code) || code < 0 || code > 0xff) {
    throw new RangeError(`0x4b result code must be a u8, got ${code}`);
  }
  return new Uint8Array([SHOP_RESULT_OPCODE, code]);
}

/** Read one `0x4B` body (the reader must sit just past the opcode byte). */
export function readShopResult(reader: PacketReader): number {
  return reader.readByte();
}

/** One line for the `decode` tool. */
export function describeShopResult(code: number): string {
  const name =
    code === SHOP_RESULT.silent
      ? "silent"
      : code === SHOP_RESULT.notEnoughItems
        ? "not enough items"
        : code === SHOP_RESULT.notEnoughMesos
          ? "not enough mesos"
          : code === SHOP_RESULT.notEnoughSlots
            ? "not enough slots"
            : code === SHOP_RESULT.notEnoughItems2
              ? "not enough items (2)"
              : "error";
  return `shop result ${code} (${name})`;
}

/** What a `0x16` request asks for - one variant per client button. */
export type ClientShopRequest =
  | { kind: "buy"; row: number; itemId: number; count: number }
  | { kind: "sell"; slot: number; itemId: number; count: number }
  | { kind: "recharge"; slot: number }
  | { kind: "close" };

/** Build one `0x16` request (opcode included) - the client's side of the dialogue, for tests and traces. */
export function encodeClientShopRequest(request: ClientShopRequest): Uint8Array {
  const writer = new PacketWriter(12);
  writer.writeByte(CLIENT_SHOP_OPCODE);
  if (request.kind === "close") {
    writer.writeByte(SHOP_REQUEST.close);
    return writer.toBytes();
  }
  if (request.kind === "recharge") {
    writer.writeByte(SHOP_REQUEST.recharge);
    writer.writeU16(request.slot);
    return writer.toBytes();
  }
  writer.writeByte(request.kind === "buy" ? SHOP_REQUEST.buy : SHOP_REQUEST.sell);
  writer.writeU16(request.kind === "buy" ? request.row : request.slot);
  writer.writeU32(request.itemId);
  writer.writeU16(request.count);
  return writer.toBytes();
}

/** Read one `0x16` body (the reader must sit just past the opcode byte). */
export function readClientShopRequest(reader: PacketReader): ClientShopRequest {
  const action = reader.readByte();
  if (action === SHOP_REQUEST.close) return { kind: "close" };
  if (action === SHOP_REQUEST.recharge) return { kind: "recharge", slot: reader.readU16() };
  if (action === SHOP_REQUEST.buy || action === SHOP_REQUEST.sell) {
    const position = reader.readU16();
    const itemId = reader.readU32();
    const count = reader.readU16();
    return action === SHOP_REQUEST.buy
      ? { kind: "buy", row: position, itemId, count }
      : { kind: "sell", slot: position, itemId, count };
  }
  throw new RangeError(`0x16: unknown shop action ${action} (FINDINGS 4.22)`);
}

/** One line for the `decode` tool: `16 buy row 2 item 2000000 x1`. */
export function describeClientShopRequest(request: ClientShopRequest): string {
  if (request.kind === "close") return "16 shop close";
  if (request.kind === "recharge") return `16 shop recharge slot ${request.slot}`;
  if (request.kind === "buy") {
    return `16 shop buy row ${request.row} item ${request.itemId} x${request.count}`;
  }
  return `16 shop sell slot ${request.slot} item ${request.itemId} x${request.count}`;
}

/** The body of `0x33`: the id of the object the player clicked. */
export interface ClientObjectClick {
  /** The field object's runtime id - for an NPC, the id `0x39` gave it. */
  objectId: number;
}

/** Build one `0x33` (opcode included). */
export function encodeClientObjectClick(click: ClientObjectClick): Uint8Array {
  const writer = new PacketWriter(5);
  writer.writeByte(CLIENT_OBJECT_CLICK_OPCODE);
  writer.writeU32(click.objectId);
  return writer.toBytes();
}

/** Read one `0x33` body (the reader must sit just past the opcode byte). */
export function readClientObjectClick(reader: PacketReader): ClientObjectClick {
  return { objectId: reader.readU32() };
}

/** One line for the `decode` tool. */
export function describeClientObjectClick(click: ClientObjectClick): string {
  return `33 object click: id=${click.objectId}`;
}

/** The once-opaque 207 block: `4B4AD0` reads the exact +24 copied by `4B3780` as double.
 * Keep the raw `cash` property for old trace consumers, but never interpret it as a cash serial. */
export function encodeRechargeUnitPrice(price: number): Uint8Array {
  if (!Number.isFinite(price) || price <= 0) throw new RangeError("invalid recharge unit price");
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, price, true);
  return bytes;
}
export function shopRechargeUnitPrice(line: ShopLine): number | undefined {
  if (Math.floor(line.itemId / 10000) !== 207 || line.cash?.length !== 8) return undefined;
  const price = new DataView(line.cash.buffer, line.cash.byteOffset, 8).getFloat64(0, true);
  return Number.isFinite(price) && price > 0 ? price : undefined;
}
