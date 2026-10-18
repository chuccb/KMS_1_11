/** Explicit isolated fixture only. Import is pure; CLI refuses overwrite and production paths.
 * bun server/scripts/equipment_fixture.ts generated/validation/<new-name>.json
 */
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import type { AccountRecord } from "../src/net/loginserver.ts";
import { saveJson } from "../src/game/save.ts";
import {
  characterDataOf,
  startingCharacterItems,
  zeroStats,
  wornOfLook,
} from "../src/protocol/chardata.ts";
import { equipSlot, nonEquipSlot } from "../src/protocol/itemslot.ts";

const root = resolve(import.meta.dirname, "../..");
const base = resolve(root, "generated/validation");
const names = {
  gear: "GearHero",
  watch: "WatchHero",
  travel: "TravelHero",
  climb: "ClimbHero",
  stat: "StatHero",
} as const;

/** Preserve the historical, explicitly synthetic equipment test data; these are not creation rules. */
export function equipmentFixtureAccounts(): Map<string, AccountRecord> {
  const accounts = new Map<string, AccountRecord>();
  let id = 800; // Isolated test-store IDs only; never merged with live accounts.
  for (const [user, name] of Object.entries(names)) {
    const stats = zeroStats();
    Object.assign(stats, {
      id: ++id,
      name,
      appearanceA: 20000,
      appearanceB: 30000,
      gender: 0,
      level: 12,
      str: 12,
      dex: 5,
      int: 4,
      luk: 4,
      hp: 50,
      maxHp: 50,
      mp: 30,
      maxMp: 30,
      mapId: 1000000,
    });
    if (user === "stat") Object.assign(stats, { str: 8, dex: 6, int: 6, luk: 5, ap: 6 });
    const items = startingCharacterItems();
    items.worn = wornOfLook([20000, 30000, 1040002, 1060002, 1072001, 1302000]);
    if (user === "gear") {
      const cap = equipSlot(1002008);
      Object.assign(cap, { str: 3, pdd: 5, cuc: 2, ruc: 4 });
      items.inventories[0].items.set(1, cap);
      items.inventories[0].items.set(2, equipSlot(1002019));
      items.inventories[0].items.set(3, equipSlot(1002023));
      items.inventories[1].items.set(1, nonEquipSlot(2000000, 3));
      items.inventories[1].items.set(2, nonEquipSlot(2000001, 2));
    }
    accounts.set(user, { password: user, characters: [characterDataOf(stats, items)] });
  }
  return accounts;
}

export function writeEquipmentFixture(argument: string): string {
  const path = resolve(root, argument);
  if (!path.startsWith(base + sep) || !path.endsWith(".json")) {
    throw new Error("Only an explicit NEW generated/validation/*.json fixture is allowed");
  }
  mkdirSync(base, { recursive: true });
  if (realpathSync(base) !== base) throw new Error("Fixture base must not traverse symlinks");
  // Restrict to an existing real parent before writing; never follow a nested symlink out of base.
  const parent = realpathSync(dirname(path));
  if (parent !== base && !parent.startsWith(base + sep))
    throw new Error("Fixture parent escapes validation directory");
  writeFileSync(path, saveJson(equipmentFixtureAccounts()), { flag: "wx", mode: 0o600 });
  return path;
}
if (import.meta.main) {
  if (process.argv.length !== 3)
    throw new Error("Supply exactly one NEW generated/validation/*.json path");
  console.log("ISOLATED FIXTURE ONLY", writeEquipmentFixture(process.argv[2]));
}
