/**
 * The save file (`src/game/save.ts`).
 *
 * A save has exactly one promise - a character comes back the way it left - so most of this is round
 * trips: every stat field, a full item block (worn equips, cash serial numbers as `bigint`, four
 * tabs, the two record maps), two accounts, and the account order. The rest is the refusals, because
 * those are what stands between a save and a silently emptied world: a version this build does not
 * write, a record without identity, two characters with one id, a record the *wire* cannot express
 * (the codec is asked, not re-implemented), and a file that exists but cannot be read at all.
 *
 * The file store's filesystem contract is checked for real (in a temp directory): the save lands,
 * the `.tmp` is gone, and a write that fails is a log line rather than an exception thrown into
 * whatever connection happened to trigger it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CHAR_FLAG_INVENTORY_2,
  CHAR_FLAG_INVENTORY_3,
  CHAR_FLAG_INVENTORY_4,
  CHAR_FLAG_ITEMS,
  CHAR_FLAG_MAP32,
  CHAR_FLAG_MAPSTR,
  CHAR_FLAG_STATS,
  characterDataOf,
  emptyCharacterItems,
  startingCharacterItems,
  zeroStats,
  type CharacterData,
  type CharacterItems,
} from "../src/protocol/chardata.ts";
import { EQUIP_STATS, equipSlot, nonEquipSlot } from "../src/protocol/itemslot.ts";
import {
  FileSaveStore,
  MemorySaveStore,
  SAVE_VERSION,
  loadAccounts,
  readSave,
  saveJson,
} from "../src/game/save.ts";
import type { AccountRecord } from "../src/net/loginserver.ts";

/** An item block with something in every place a save has to carry one. */
function sampleItems(): CharacterItems {
  const items = startingCharacterItems(24);
  items.worn.set(
    5,
    equipSlot(0x0013de30, {
      ruc: 7,
      cuc: 2,
      str: 11,
      dex: 3,
      pad: 5,
      speed: 2,
      // A cash item's serial number does not fit a `u32`, which is why the file holds it as text.
      cash: { sn: 0x1122334455667788n, unknown18: 7, unknown1A: 0x99aabbccddeeff00n },
    }),
  );
  items.wornCash.set(2, equipSlot(0x00100000, { cash: { sn: 1n, unknown18: 0, unknown1A: 0n } }));
  const use = items.inventories[1]!;
  use.items.set(3, nonEquipSlot(2000000, 50));
  use.items.set(24, nonEquipSlot(4000019, 1));
  use.records.push({ key: 9, value: 11 });
  items.inventories[3]!.items.set(
    1,
    nonEquipSlot(4000019, 3, { cash: { sn: 5n, unknown18: 1, unknown1A: 6n } }),
  );
  items.map32.push({ key: 1, value: 2 });
  items.mapString.push({ key: "quest", value: "done" });
  return items;
}

/** A character with a distinct value in every stat field, so any reorder shows up as a diff. */
function sampleCharacter(
  id: number,
  name: string,
  items: CharacterItems = sampleItems(),
): CharacterData {
  const stats = zeroStats();
  stats.id = id;
  stats.name = name;
  stats.gender = 1;
  stats.appearanceA = 0x0b0c0d0e;
  stats.appearanceB = 0x01020304;
  stats.unknown26 = 9;
  stats.hair = 30030;
  stats.level = 12;
  stats.job = 0;
  stats.str = 25;
  stats.dex = 13;
  stats.int = 4;
  stats.luk = 6;
  stats.hp = 321;
  stats.maxHp = 400;
  stats.mp = 90;
  stats.maxMp = 120;
  stats.ap = 3;
  stats.sp = 1;
  stats.exp = 3456;
  stats.fame = 17;
  stats.mesos = 1_234_567;
  stats.mapId = 1010000;
  stats.spawnPortalIndex = 7;
  return characterDataOf(stats, items);
}

/** Two accounts, three characters, one of them stat-only (no item block at all). */
function sampleTable(): Map<string, AccountRecord> {
  return new Map<string, AccountRecord>([
    [
      "admin",
      {
        password: "hunter2",
        characters: [
          sampleCharacter(3, "Hero"),
          characterDataOf({ ...zeroStats(), id: 4, name: "Bare" }),
        ],
      },
    ],
    ["guest", { password: "", characters: [sampleCharacter(9, "Guest", emptyCharacterItems())] }],
  ]);
}

/** A throwaway directory that is removed when the test ends. */
function tempDir(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), "kms111-save-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("a character comes back exactly as it was saved", () => {
  const table = sampleTable();
  const back = readSave(saveJson(table));
  assert.deepEqual([...back.keys()], ["admin", "guest"]);
  assert.deepEqual(back.get("admin"), table.get("admin"));
  assert.deepEqual(back.get("guest"), table.get("guest"));
});

test("every stat field survives, a name included", () => {
  const stats = zeroStats();
  stats.id = 77;
  stats.name = "AllFields";
  // Distinct values, so a field written into the wrong slot cannot pass: the values are assigned by
  // key rather than by position on purpose.
  for (const key of Object.keys(stats) as (keyof typeof stats)[]) {
    if (typeof stats[key] !== "number") continue;
    (stats[key] as number) = 1000 + key.length;
  }
  const character = characterDataOf(stats);
  const back = readSave(saveJson(new Map([["a", { password: "p", characters: [character] }]]))).get(
    "a",
  )!.characters[0]!;
  assert.deepEqual(back.stats, character.stats);
  assert.equal(back.stats.name, "AllFields");
});

test("every equip stat survives", () => {
  const item = equipSlot(0x0013de30);
  for (const [index, stat] of EQUIP_STATS.entries()) item[stat] = 100 + index;
  const items = startingCharacterItems(24);
  items.worn.set(1, item);
  const table = new Map([
    [
      "a",
      { password: "p", characters: [characterDataOf({ ...zeroStats(), id: 1, name: "E" }, items)] },
    ],
  ]);
  const back = readSave(saveJson(table)).get("a")!.characters[0]!.items!.worn.get(1)!;
  assert.deepEqual(back, item);
});

test("flags are derived on load, not stored: an item block is announced to the client", () => {
  const table = sampleTable();
  const text = saveJson(table);
  assert.equal(
    text.includes('"flags"'),
    false,
    "the flags byte is a function of the record, not a field",
  );
  const hero = readSave(text).get("admin")!.characters[0]!;
  // Every block that holds something (or that has slots) is announced: `sampleItems` uses both worn
  // groups, tabs 2 and 4, and both record maps, so the derived byte is all seven bits.
  assert.equal(
    hero.flags,
    CHAR_FLAG_STATS |
      CHAR_FLAG_ITEMS |
      CHAR_FLAG_INVENTORY_2 |
      CHAR_FLAG_INVENTORY_3 |
      CHAR_FLAG_INVENTORY_4 |
      CHAR_FLAG_MAP32 |
      CHAR_FLAG_MAPSTR,
  );
  // …and a stat-only record is the bare flags byte plus the 69-byte stat block (FINDINGS 4.9).
  const bare = readSave(text).get("admin")!.characters[1]!;
  assert.equal(bare.flags, CHAR_FLAG_STATS);
  assert.equal(bare.items!.worn.size, 0);
  assert.equal(bare.items!.inventories[0]!.capacity, 0);
});

test("a hand-written file with items but no flags still announces them", () => {
  const save = {
    version: SAVE_VERSION,
    accounts: {
      admin: {
        password: "p",
        characters: [
          {
            stats: { id: 5, name: "Hand" },
            // The minimum a worn equip can be: `stats` is a partial map, so a field it does not
            // mention stays 0 ("a shape that does not fit is not a value").
            items: {
              worn: [
                [
                  5,
                  { kind: "equip", itemId: 1000000, cash: null, ruc: 7, cuc: 0, stats: { str: 3 } },
                ],
              ],
              // Tab 0 is the equip tab (the codec passes the equip hint for it), so the consumable
              // goes into tab 1 - the array index *is* the tab, like `CharacterData.inventories`.
              inventories: [
                { capacity: 0, items: [] },
                {
                  capacity: 24,
                  items: [[2, { kind: "nonequip", itemId: 2000000, cash: null, quantity: 2 }]],
                },
              ],
            },
          },
        ],
      },
    },
  };
  const character = readSave(JSON.stringify(save)).get("admin")!.characters[0]!;
  assert.equal(character.flags, CHAR_FLAG_STATS | CHAR_FLAG_ITEMS | CHAR_FLAG_INVENTORY_2);
  const worn = character.items!.worn.get(5)!;
  assert.equal(worn.kind, "equip");
  assert.equal(worn.kind === "equip" ? worn.str : -1, 3);
  assert.equal(worn.kind === "equip" ? worn.dex : -1, 0);
  assert.equal(character.items!.inventories[1]!.items.get(2)!.kind, "nonequip");
});

test("a save whose records hold nothing the file mentions keeps the fresh values", () => {
  const save = {
    version: SAVE_VERSION,
    accounts: { admin: { password: "p", characters: [{ stats: { id: 3, name: "Solo" } }] } },
  };
  const character = readSave(JSON.stringify(save)).get("admin")!.characters[0]!;
  assert.deepEqual({ ...character.stats, id: 0, name: "" }, zeroStats());
  assert.equal(character.stats.id, 3);
  assert.equal(character.stats.name, "Solo");
  assert.equal(character.items, undefined, "a record with no item block stays one");
});

test("a file from before the spawn portal index was named keeps its portal, not 0", () => {
  // The field was called `unknown101` while its meaning was still open; `sub_511820` showed it is
  // the spawn portal index (FINDINGS 4.43) and the record was renamed to that. The reader keys off
  // `zeroStats()`, so without an explicit reading of the old name the value would silently fall to
  // 0 and every character in an older file would wake up at portal 0 on its next login.
  const legacy = readSave(
    JSON.stringify({
      version: SAVE_VERSION,
      accounts: {
        admin: { password: "p", characters: [{ stats: { id: 3, name: "Legacy", unknown101: 7 } }] },
      },
    }),
  ).get("admin")!.characters[0]!;
  assert.equal(legacy.stats.spawnPortalIndex, 7, "the old key is still read");

  // The old name is a fallback, never an override: a file holding both is read by its new name.
  const both = readSave(
    JSON.stringify({
      version: SAVE_VERSION,
      accounts: {
        admin: {
          password: "p",
          characters: [{ stats: { id: 3, name: "Both", spawnPortalIndex: 4, unknown101: 7 } }],
        },
      },
    }),
  ).get("admin")!.characters[0]!;
  assert.equal(both.stats.spawnPortalIndex, 4, "the new key wins when both are present");

  // A file this build writes spells the new name, and a round trip keeps the value.
  const text = saveJson(
    new Map<string, AccountRecord>([
      ["admin", { password: "p", characters: [sampleCharacter(3, "Hero")] }],
    ]),
  );
  assert.match(text, /"spawnPortalIndex": 7/);
  assert.equal(readSave(text).get("admin")!.characters[0]!.stats.spawnPortalIndex, 7);
});

test("a version this build does not write is refused, not loaded halfway", () => {
  assert.throws(
    () => readSave(JSON.stringify({ version: SAVE_VERSION + 1, accounts: {} })),
    /version 2/,
  );
  assert.throws(
    () => readSave(JSON.stringify({ version: undefined, accounts: {} })),
    /version undefined/,
  );
  assert.throws(() => readSave("{ not json"), /not JSON/);
});

test("a character without identity is refused", () => {
  const wrap = (stats: unknown): string =>
    JSON.stringify({
      version: SAVE_VERSION,
      accounts: { admin: { password: "p", characters: [{ stats }] } },
    });
  assert.throws(() => readSave(wrap({ name: "NoId" })), /no numeric id/);
  assert.throws(() => readSave(wrap({ id: 4 })), /name of character 4 is not a string/);
});

test("two characters with one id are refused: every table in the server is keyed by it", () => {
  const table = new Map<string, AccountRecord>([
    ["admin", { password: "p", characters: [sampleCharacter(7, "One", emptyCharacterItems())] }],
    ["guest", { password: "p", characters: [sampleCharacter(7, "Two", emptyCharacterItems())] }],
  ]);
  assert.throws(() => readSave(saveJson(table)), /two characters share id 7/);
});

test("a record the client could not be told about is refused at load, not at login", () => {
  // An item above the declared capacity: the codec is the authority on this (`writeInventory`), so
  // the file has to be refused rather than sent as a truncated `0x16`.
  const items = startingCharacterItems(24);
  items.inventories[1]!.items.set(30, nonEquipSlot(2000000, 1));
  const overfull = new Map([
    [
      "a",
      { password: "p", characters: [characterDataOf({ ...zeroStats(), id: 1, name: "X" }, items)] },
    ],
  ]);
  assert.throws(() => readSave(saveJson(overfull)), /cannot be sent to a client.*capacity/s);

  // A name the 13-byte field cannot hold (the same check the create path uses, `nameFieldBytes`).
  const longName = new Map([
    [
      "a",
      { password: "p", characters: [sampleCharacter(2, "A".repeat(13), emptyCharacterItems())] },
    ],
  ]);
  assert.throws(() => readSave(saveJson(longName)), /cannot be sent to a client.*allows 12/s);

  // A slot that is neither of the two kinds the client knows cannot be guessed at either.
  const badKind = {
    version: SAVE_VERSION,
    accounts: {
      a: {
        password: "p",
        characters: [
          {
            stats: { id: 2, name: "K" },
            items: { worn: [[1, { kind: "maybe", itemId: 1000000 }]] },
          },
        ],
      },
    },
  };
  assert.throws(() => readSave(JSON.stringify(badKind)), /item 1000000 with kind "maybe"/);
});

test("the same world saves to the same bytes, whatever order the accounts arrived in", () => {
  const first = saveJson(sampleTable());
  assert.equal(saveJson(sampleTable()), first, "an unchanged world is byte-identical");
  const reversed = new Map([...sampleTable().entries()].reverse());
  assert.equal(
    saveJson(reversed),
    first,
    "accounts are written by name, so a diff is about the world",
  );
  // And an account whose name JSON would treat specially is a key like any other.
  const odd = new Map<string, AccountRecord>([["__proto__", { password: "p", characters: [] }]]);
  assert.equal(saveJson(odd).includes('"__proto__"'), true);
  assert.deepEqual([...readSave(saveJson(odd)).keys()], ["__proto__"]);
});

test("the file store writes the file, leaves no .tmp, and reads it back", (t) => {
  const dir = tempDir(t);
  const path = join(dir, "world.json");
  const store = new FileSaveStore({ path });
  assert.equal(store.load(), undefined, "no file yet is the normal first run");
  store.save(sampleTable());
  assert.equal(existsSync(path), true);
  assert.equal(
    existsSync(`${path}.tmp`),
    false,
    "the temporary file is renamed away, not left behind",
  );
  assert.deepEqual(store.load(), sampleTable());
});

test("the file store makes the directory it was pointed at", (t) => {
  const dir = tempDir(t);
  const path = join(dir, "saves", "world.json");
  new FileSaveStore({ path }).save(sampleTable());
  assert.equal(existsSync(path), true);
});

test("a file that exists but cannot be read stops the start instead of becoming an empty world", (t) => {
  const dir = tempDir(t);
  // A directory where the save should be: the failure is not "there is no save yet", so a server
  // that carried on would rename its emptiness over whatever the operator meant to keep.
  const path = join(dir, "world.json");
  mkdirSync(path);
  assert.throws(() => new FileSaveStore({ path }).load(), /cannot be read/);
});

test("a save that cannot be written is a log line, not an exception into the connection", (t) => {
  const dir = tempDir(t);
  const blocker = join(dir, "file");
  writeFileSync(blocker, "not a directory\n");
  const lines: string[] = [];
  const store = new FileSaveStore({
    path: join(blocker, "world.json"),
    log: (line) => lines.push(line),
  });
  store.save(sampleTable()); // must not throw: this runs inside a socket's event handler
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /could not be written/);
});

test("the load is logged with what came back", (t) => {
  const dir = tempDir(t);
  const lines: string[] = [];
  const store = new FileSaveStore({
    path: join(dir, "world.json"),
    log: (line) => lines.push(line),
  });
  store.save(sampleTable());
  lines.length = 0;
  store.load();
  assert.match(lines.join("\n"), /loaded - 2 account\(s\), 3 character\(s\)/);
});

test("--account seeds a first run, and the file wins over it on every run after that", () => {
  const seed = new Map<string, AccountRecord>([["admin", { password: "admin", characters: [] }]]);
  const lines: string[] = [];

  const empty = new MemorySaveStore();
  assert.equal(
    loadAccounts(empty, seed, (line) => lines.push(line)),
    seed,
    "no save yet: the seed is the world",
  );

  const store = new MemorySaveStore();
  store.save(sampleTable());
  const loaded = loadAccounts(store, seed, (line) => lines.push(line));
  assert.deepEqual([...loaded.keys()], ["admin", "guest"]);
  assert.match(lines.join("\n"), /ignoring 1 --account entr\(ies\)/);
});

test("the save file is JSON a person can read: named stats, and serial numbers that are not rounded", () => {
  const text = saveJson(sampleTable());
  assert.equal(text.startsWith('{\n  "version": 1,\n'), true);
  const parsed = JSON.parse(text) as {
    accounts: Record<string, { characters: { stats: Record<string, unknown> }[] }>;
  };
  const hero = parsed.accounts["admin"]!.characters[0]!.stats;
  assert.equal(hero["level"], 12, "the stat block is spelled out field by field");
  assert.equal(hero["name"], "Hero");
  assert.equal(hero["id"], 3);
  // The one shape JSON has no number for: a `u64` serial number is text, so it cannot be rounded.
  assert.match(text, /"sn": "1234605616436508552"/);
  assert.equal(0x1122334455667788n.toString(), "1234605616436508552");
});
