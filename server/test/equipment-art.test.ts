import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WzArchive } from "../src/wz/archive.ts";
import { artReaderOf } from "../src/game/wzart.ts";
import { itemCatalogOf } from "../src/game/iteminfo.ts";
import { characterDataOf, startingCharacterItems, zeroStats } from "../src/protocol/chardata.ts";
import { equipSlot } from "../src/protocol/itemslot.ts";
import { ClientSession, inventoryViewOf } from "../src/client/session.ts";
const path = fileURLToPath(new URL("../../Data.wz", import.meta.url));
test(
  "original equipment/window close resources and WZ requirements/cash are exported, no fake icons",
  { skip: !existsSync(path) },
  () => {
    const a = WzArchive.open(path),
      r = artReaderOf(a)!,
      c = itemCatalogOf(a)!;
    assert.deepEqual(
      [
        r.at("UI/UIWindow.img/Equip/backgrnd")!.width,
        r.at("UI/UIWindow.img/Equip/backgrnd")!.height,
      ],
      [176, 315],
    );
    for (const state of ["normal", "mouseOver", "pressed"])
      assert.ok(r.at(`UI/UIWindow.img/BtUIClose/${state}/0`));
    assert.deepEqual(c.info(1002008)!.requirements, {
      level: 5,
      job: 0,
      str: 0,
      dex: 0,
      int: 0,
      luk: 0,
    });
    assert.equal(c.info(1002000)!.cash, true);
    assert.equal(c.info(1002008)!.cash, false);
    assert.deepEqual(c.info(1002023)!.requirements, {
      level: 30,
      job: 1,
      str: 65,
      dex: 0,
      int: 0,
      luk: 0,
    });
    assert.equal(c.info(2000000)!.requirements, undefined);
  },
);
test("inventory view keeps instance stats and upgrade counts rather than substituting WZ templates", () => {
  const items = startingCharacterItems(),
    cap = equipSlot(1002008);
  Object.assign(cap, { str: 3, pad: 7, ruc: 4, cuc: 2 });
  items.worn.set(1, cap);
  const character = characterDataOf(zeroStats(), items);
  const view = inventoryViewOf(character.items);
  assert.equal(view.worn[0]!.stats!.str, 3);
  assert.equal(view.worn[0]!.stats!.pad, 7);
  assert.equal(view.worn[0]!.cuc, 2);
  assert.equal(view.worn[0]!.ruc, 4);
  assert.doesNotThrow(() => JSON.stringify(view));
});

test("native 0x0B op2 swaps across signed bag/worn groups, even when absolute keys coincide", () => {
  const items = startingCharacterItems(),
    cap = equipSlot(1002008),
    old = equipSlot(1002019);
  items.worn.set(1, old);
  items.inventories[0]!.items.set(1, cap);
  const session = new ClientSession({ loginPort: 1, gamePort: 2 });
  Reflect.set(session, "latest", characterDataOf(zeroStats(), items));
  const apply = Reflect.get(session, "applyInventoryChange").bind(session);
  apply({ op: 2, inventory: 1, slot: 1, slot2: -1 });
  assert.equal(items.worn.get(1), cap);
  assert.equal(items.inventories[0]!.items.get(1), old);
  apply({ op: 2, inventory: 1, slot: -1, slot2: 2 });
  assert.equal(items.worn.has(1), false);
  assert.equal(items.inventories[0]!.items.get(2), cap);
});

// Source-only regression added 2026-10-18; not executed in this delivery.
test(
  "quickslot normal icon metadata must not substitute the raw/drop canvas",
  { skip: !existsSync(path) },
  () => {
    const a = WzArchive.open(path),
      r = artReaderOf(a)!,
      info = itemCatalogOf(a)!.info(2000000)!;
    assert.equal(info.icon?.path, "Item/Consume/0200.img/02000000/info/icon");
    assert.equal(info.iconRaw?.path, "Item/Consume/0200.img/02000000/info/iconRaw");
    const normal = r.at(info.icon!.path)!,
      raw = r.at(info.iconRaw!.path)!;
    assert.deepEqual(
      [info.icon!.width, info.icon!.height, info.icon!.ox, info.icon!.oy],
      [normal.width, normal.height, normal.ox, normal.oy],
    );
    assert.deepEqual([info.iconRaw!.width, info.iconRaw!.height], [raw.width, raw.height]);
    assert.ok(normal.width > raw.width || normal.height > raw.height);
  },
);
