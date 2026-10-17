/** Explicit isolated fixture only. Refuses overwrite; never reads/migrates production accounts. */
import { existsSync } from "node:fs";
import { resolve, relative } from "node:path";
import { FileSaveStore } from "../src/game/save.ts";
import {
  characterDataOf,
  startingCharacterItems,
  zeroStats,
  wornOfLook,
} from "../src/protocol/chardata.ts";
import { equipSlot, nonEquipSlot } from "../src/protocol/itemslot.ts";
const base = resolve(import.meta.dirname, "../../generated/validation"),
  path = resolve(process.argv[2] ?? resolve(base, "equipment-qa-save.json"));
if (relative(base, path).startsWith("..") || path === base || existsSync(path))
  throw new Error("Only a NEW generated/validation fixture path is allowed");
const accounts = new Map();
let id = 800;
for (const user of ["gear", "watch", "travel", "climb", "stat"]) {
  const stats = zeroStats();
  Object.assign(stats, {
    id: ++id,
    name: {
      gear: "GearHero",
      watch: "WatchHero",
      travel: "TravelHero",
      climb: "ClimbHero",
      stat: "StatHero",
    }[user],
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
  if (user === "stat")
    Object.assign(stats, { str: 8, dex: 6, int: 6, luk: 5, ap: 6 });
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
  accounts.set(user, {
    password: user,
    characters: [characterDataOf(stats, items)],
  });
}
new FileSaveStore({ path, log: console.log }).save(accounts);
console.log("ISOLATED FIXTURE ONLY", path);
