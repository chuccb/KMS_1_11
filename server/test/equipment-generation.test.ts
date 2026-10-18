/** Unit regressions. Verification status: docs/BUN_MIGRATION.md. */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WzArchive } from "../src/wz/archive.ts";
import { WzNode, type WzEntry } from "../src/wz/img.ts";
import { itemCatalogOf, EQUIPMENT_WZ_FIELDS } from "../src/game/iteminfo.ts";
import {
  equipmentFromTemplate,
  planBlankStarterRepair,
  starterEquipmentIds,
} from "../src/game/equipment.ts";
import { creationCatalogOf } from "../src/game/creation.ts";
import { artReaderOf } from "../src/game/wzart.ts";
import { detailRows } from "../../client/characterstats.ts";
import { characterStatBasis, statTotals } from "../src/game/characterstats.ts";
import { rollNativePhysical, type PhysicalAttackTrace } from "../src/game/nativecombat.ts";
import { MesoWallet, grantItem, pickUpDrop } from "../src/game/rewards.ts";
import { shopKeeper, itemPrice } from "../src/game/shops.ts";
import { equipSlot, EQUIP_STATS } from "../src/protocol/itemslot.ts";
import { characterDataOf, startingCharacterItems, zeroStats } from "../src/protocol/chardata.ts";
import { encodeInventoryChange, readInventoryChange } from "../src/protocol/inventory.ts";
import { PacketReader } from "../src/protocol/packet.ts";
import { LoginServer } from "../src/net/loginserver.ts";
import { readSave, saveJson } from "../src/game/save.ts";

const data = fileURLToPath(new URL("../../Data.wz", import.meta.url));
const needsWz = { skip: !existsSync(data) };
const fixture = () =>
  characterDataOf(
    Object.assign(zeroStats(), {
      id: 1,
      name: "Hero",
      gender: 0,
      job: 100,
      level: 1,
      str: 29,
      dex: 8,
      int: 4,
      luk: 4,
      hp: 17,
      maxHp: 50,
      mp: 30,
      maxMp: 50,
    }),
    startingCharacterItems(),
  );

test("478270 maps all 15 inc* fields, signed WORDs, byte tuc and no invented defaults", () => {
  const props: WzEntry[] = Object.values(EQUIPMENT_WZ_FIELDS).map((name, index) => ({
    name,
    type: 3,
    value: index === 0 ? 65535 : index + 1,
  }));
  props.push({ name: "tuc", type: 3, value: 7 });
  const path = "Character/Weapon/01302000.img";
  const catalog = itemCatalogOf({
    images: [{ path }],
    has: (p) => p === path,
    objects: () => [
      {
        cls: "Property",
        offset: 0,
        end: 0,
        props: [{ name: "info", type: 9, value: new WzNode("props", props) }],
      },
    ],
  })!;
  const item = equipmentFromTemplate(1302000, catalog)!;
  assert.equal(item.str, -1);
  assert.equal(item.ruc, 7);
  assert.equal(item.cuc, 0);
  EQUIP_STATS.slice(1).forEach((stat, index) => assert.equal(item[stat], index + 2));
  assert.equal(equipmentFromTemplate(9999999, catalog), undefined);
});

test(
  "real starter sword gets PAD17/tuc7; new character uses same factory without rewriting an existing record",
  needsWz,
  () => {
    const catalog = itemCatalogOf(WzArchive.open(data))!;
    const item = equipmentFromTemplate(1302000, catalog)!;
    assert.equal(item.pad, 17);
    assert.equal(item.ruc, 7);
    assert.equal(item.cuc, 0);
    assert.equal(
      equipmentFromTemplate(1002000, catalog),
      undefined,
      "cash is not a normal equip grant",
    );
    const login = new LoginServer({
      accounts: new Map(),
      worlds: [],
      gameServer: { ip: "127.0.0.1", port: 0 },
      pingMs: 0,
      itemCatalog: catalog,
    });
    const character = login.createCharacter(
      1,
      "Hero",
      [20000, 30000, 1040002, 1060002, 1072001, 1302000, 9, 8, 4, 4],
    );
    assert.equal((character.items!.worn.get(11) as { pad: number }).pad, 17);
    for (const item of character.items!.worn.values()) {
      assert.equal(item.kind, "equip");
      assert.deepEqual(item, equipmentFromTemplate(item.itemId, catalog));
    }
  },
);

test(
  "legacy all-zero PAD explains Detail29 and damage1; opt-in plan yields PAD17, Detail46 and original rolled damage",
  needsWz,
  () => {
    const archive = WzArchive.open(data),
      catalog = itemCatalogOf(archive)!;
    const c = fixture();
    c.items!.worn.set(11, equipSlot(1302000));
    const before = structuredClone(c);
    const basis = characterStatBasis(c, catalog);
    assert.equal(detailRows(basis)[0], "29");
    let trace: PhysicalAttackTrace | undefined,
      draws = 0;
    assert.equal(
      rollNativePhysical(
        c,
        basis,
        statTotals(basis),
        { level: 1, pd: 0, eva: 0 },
        5,
        0,
        0,
        undefined,
        () => {
          draws++;
          return 9999999;
        },
        (t) => {
          trace = t;
        },
      ),
      1,
    );
    assert.equal(trace!.reason, "zero-pad");
    assert.equal(draws, 7);
    const starters = starterEquipmentIds(creationCatalogOf(artReaderOf(archive)));
    const plan = planBlankStarterRepair(c.items!, catalog, starters);
    assert.deepEqual(c, before, "inspection and planning are nonmutating");
    assert.equal(plan.changes.length, 1);
    const update = readInventoryChange(new PacketReader(encodeInventoryChange(plan.changes), 1));
    assert.equal(
      update.changes[0]!.slot,
      -11,
      "original negative worn slot, not a fabricated stat opcode",
    );
    c.items = plan.items;
    const fixed = characterStatBasis(c, catalog);
    assert.equal(fixed.secondary.pad, 17);
    assert.equal(detailRows(fixed)[0], "46");
    assert.equal(
      rollNativePhysical(
        c,
        fixed,
        statTotals(fixed),
        { level: 1, pd: 0, eva: 0 },
        5,
        0,
        0,
        undefined,
        () => 9999999,
        (t) => {
          trace = t;
        },
      ),
      21,
    );
    assert.ok(Math.abs(trace!.raw - 21.08) < 1e-10);
    assert.equal(
      rollNativePhysical(
        c,
        fixed,
        statTotals(fixed),
        { level: 1, pd: 0, eva: 0 },
        5,
        0,
        0,
        undefined,
        () => 0,
      ),
      3,
    );
    assert.equal(
      rollNativePhysical(
        c,
        fixed,
        statTotals(fixed),
        { level: 1, pd: 999, eva: 0 },
        5,
        0,
        0,
        undefined,
        () => 9999999,
      ),
      1,
      "legitimate defense clamp remains",
    );
    assert.equal(
      rollNativePhysical(
        c,
        fixed,
        statTotals(fixed),
        { level: 1, eva: 999 },
        5,
        0,
        0,
        undefined,
        () => 9999999,
        (t) => {
          trace = t;
        },
      ),
      0,
    );
    assert.equal(trace!.reason, "miss");
    let observedDraws = 0;
    assert.equal(
      rollNativePhysical(
        c,
        fixed,
        statTotals(fixed),
        { level: 1, pd: 0, eva: 0 },
        5,
        0,
        0,
        undefined,
        () => {
          observedDraws++;
          return 9999999;
        },
        (t) => {
          t.damage = 9999;
        },
      ),
      21,
      "trace cannot alter damage",
    );
    assert.equal(observedDraws, 7);
    assert.equal(
      planBlankStarterRepair(c.items, catalog, starters).changes.length,
      0,
      "idempotent",
    );
  },
);

test(
  "repair scope preserves nonzero, upgraded, cash and non-starter instances; load/save never auto-migrates",
  needsWz,
  () => {
    const archive = WzArchive.open(data),
      catalog = itemCatalogOf(archive)!;
    const starters = starterEquipmentIds(creationCatalogOf(artReaderOf(archive)));
    const c = fixture();
    const samples = [
      equipSlot(1302000, { pad: 1 }),
      equipSlot(1302000, { ruc: 1 }),
      equipSlot(1302000, { cuc: 1 }),
      equipSlot(1302001),
      equipSlot(1302000, { cash: { sn: 1n, unknown18: 0, unknown1A: 0n } }),
    ];
    samples.forEach((item, index) => c.items!.inventories[0]!.items.set(index + 1, item));
    c.items!.worn.set(11, equipSlot(1302000));
    const copy = readSave(
      saveJson(new Map([["user", { password: "local", characters: [c] }]])),
    ).get("user")!.characters[0]!;
    assert.equal(
      (copy.items!.worn.get(11) as { pad: number }).pad,
      0,
      "loading must not silently substitute WZ values",
    );
    const plan = planBlankStarterRepair(c.items!, catalog, starters);
    assert.equal(plan.changes.length, 1);
    assert.deepEqual(plan.items.inventories, c.items!.inventories);
    assert.deepEqual(plan.items.wornCash, c.items!.wornCash);
  },
);

test(
  "fresh drop/shop equips use templates; thrown/scrolled objects retain exact instance; equip count cannot disappear",
  needsWz,
  () => {
    const archive = WzArchive.open(data),
      catalog = itemCatalogOf(archive)!;
    const c = fixture(),
      items = c.items!,
      wallet = new MesoWallet(c.stats);
    const result = pickUpDrop(
      { money: false, amount: 0, itemId: 1302000, count: 1 },
      items,
      wallet,
      catalog,
    );
    assert.equal(result.kind, "item");
    assert.equal((items.inventories[0]!.items.get(1) as { pad: number }).pad, 17);
    const scrolled = equipSlot(1302000, { pad: 31, ruc: 3, cuc: 4, str: 2 });
    grantItem(items, 1302000, 1, scrolled, catalog);
    assert.deepEqual(items.inventories[0]!.items.get(2), scrolled);
    assert.equal(grantItem(items, 1302000, 2, undefined, catalog), undefined);
    const keeper = shopKeeper(archive),
      shop = { shopId: 1, npcTemplateId: 1, items: [{ itemId: 1302000 }] };
    assert.equal(itemPrice(archive, 1302000), 1);
    assert.equal(keeper.linesOf(shop)[0]!.maxCount, 1);
    c.stats.mesos = 10;
    assert.equal(keeper.buy(items, wallet, shop, 1302000, 2).kind, "failed");
    assert.equal(wallet.balance, 10);
    assert.equal(keeper.buy(items, wallet, shop, 1302000, 1).kind, "bought");
    assert.equal(wallet.balance, 9);
    assert.equal((items.inventories[0]!.items.get(3) as { pad: number }).pad, 17);
  },
);

// Prone chain regression SOURCE ONLY, not executed in this delivery.
test(
  "action32 uses the original weak STR branch, not normal sword coefficient or ammunition",
  needsWz,
  () => {
    const catalog = itemCatalogOf(WzArchive.open(data))!,
      c = fixture();
    c.items!.worn.set(11, equipmentFromTemplate(1302000, catalog)!);
    const basis = characterStatBasis(c, catalog),
      totals = statTotals(basis);
    let trace: PhysicalAttackTrace | undefined,
      draws = 0;
    const damage = rollNativePhysical(
      c,
      basis,
      totals,
      { level: 1, pd: 0, eva: 0 },
      32,
      0,
      0,
      undefined,
      () => {
        draws++;
        return 9999999;
      },
      (value) => {
        trace = value;
      },
    );
    assert.equal(damage, 3);
    assert.equal(trace!.action, 32);
    assert.equal(trace!.ammoPad, 0);
    assert.equal(draws, 7);
    assert.equal(
      rollNativePhysical(
        c,
        basis,
        totals,
        { level: 1, pd: 0, eva: 0 },
        5,
        0,
        0,
        undefined,
        () => 9999999,
      ),
      21,
    );
  },
);
