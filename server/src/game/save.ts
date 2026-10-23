/**
 * Saving the world to disk: accounts, characters, items.
 *
 * The one thing a protocol cannot give back is memory. Until this module, a restart forgot every
 * account (`net/loginserver.ts` used to say so in its header), which makes "log in tomorrow" - the
 * thing an MMO is - impossible. No packet carries a save: the client only ever *receives* a character
 * record (the `0x03` character list and the `0x16` that puts it in a map - FINDINGS 4.11.2b), and
 * nothing in its client-to-server set carries one back, so what to write and when is **our** design,
 * like the drop odds or the shop prices. The decisions that matter:
 *
 *   - **The file is JSON.** `CharacterData` is already a plain data structure, three characters per
 *     account is a few kilobytes, and a save an operator can read and diff is worth more than a
 *     compact one. `bigint` (the cash-item `sn` and `unknown1A`, u64 on the wire) travels as a
 *     **decimal string**: JSON has no 64-bit integer, and rounding somebody's serial number would be
 *     a silent corruption.
 *   - **The write is atomic.** The bytes go to `<path>.tmp` first and are then renamed over the
 *     target, so a crash halfway through a save leaves the previous save intact - the one failure
 *     mode that would actually lose a character.
 *   - **A file we do not understand is refused, not overwritten.** A version this build does not
 *     know, or a record without identity (`id`, `name`), throws while the server starts: the
 *     operator sees the problem and decides, instead of the server starting empty and writing that
 *     emptiness back over the file.
 *   - **What the file holds is the whole truth, and only the truth.** `flags` is *not* stored: it is
 *     a function of what a record contains (`characterDataOf` derives it, and every call site that
 *     builds a character goes through that), so saving it would only create a second opinion about
 *     the same fact. The stat and item fields are stored as they are, and loading a record then
 *     *encodes it* once (`writeCharacterData` into a throwaway writer) to prove the client could be
 *     told about it - a save the wire cannot express is refused at startup, not in the middle of a
 *     login.
 *
 * Everything else is tolerant in one direction only: a field that is *absent* (or of the wrong
 * shape) keeps the value a fresh character would have, so a save written by an older build keeps
 * loading after a field is added. That is the same rule `wz/props.ts` uses for WZ data - a shape
 * that does not fit is not a value, and the default belongs to the caller.
 *
 * WHO CALLS IT: `LoginServer`/`GameEntryServer` take a `persist` callback and call it after a
 * mutation (character creation/deletion, AP, kill EXP/maxima, inventory/wallet changes), and when
 * a session leaves with its latest map state. They do not know about files, and this module does not know
 * about sockets, so a test persists into `MemorySaveStore` and a run persists into a directory.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  CHAR_FLAG_STATS,
  characterDataOf,
  emptyCharacterItems,
  writeCharacterData,
  zeroStats,
  type CharacterData,
  type CharacterItems,
  type CharacterStats,
  type Inventory,
} from "../protocol/chardata.ts";
import { PacketWriter } from "../protocol/packet.ts";
// The account row is the login server's type; this is a **type-only** import, so nothing here depends
// on the socket code at runtime (and `net/loginserver.ts` never imports this module).
import type { AccountRecord } from "../net/loginserver.ts";
// The fame quota table travels on the account row, so its shape is the game layer's, not the wire's.
import type { FameTable } from "./fame.ts";
import {
  EQUIP_STATS,
  type EquipStat,
  type ItemSlot,
  type ItemSlotEquip,
} from "../protocol/itemslot.ts";

/**
 * The save format this build writes. Bump it when a record changes shape in a way older code cannot
 * read back; `readSave` refuses anything else.
 */
export const SAVE_VERSION = 1;

/** Something that can keep the accounts between two runs of the server. */
export interface SaveStore {
  /**
   * The accounts on disk, or `undefined` when there is no save yet (first run). A store that cannot
   * read what it found **throws** - see the header.
   */
  load(): Map<string, AccountRecord> | undefined;
  /**
   * Writes the table back. Called after every mutation, so it must be cheap and it must **not
   * throw**: a failed save is an operator-facing log line, not a broken connection.
   */
  save(accounts: Map<string, AccountRecord>): void;
}

/**
 * A store that keeps everything in memory: `--save off`, and what tests use to avoid a disk.
 *
 * It keeps the *text* a file would hold rather than the live account table, so it behaves like a
 * file in the one way that matters: what was saved stays saved, and a later mutation of the table is
 * not visible through it. A test double that held the reference would happily pass a test whose
 * assertion is about a moment that never happened.
 */
export class MemorySaveStore implements SaveStore {
  private text: string | undefined;

  load(): Map<string, AccountRecord> | undefined {
    return this.text === undefined ? undefined : readSave(this.text);
  }

  save(accounts: Map<string, AccountRecord>): void {
    this.text = saveJson(accounts);
  }

  /** The bytes a file would hold - for a test that wants to look at the format itself. */
  get saved(): string | undefined {
    return this.text;
  }
}

export interface FileSaveStoreOptions {
  path: string;
  /** One line per event (a save, a refusal, a write failure); defaults to nothing. */
  log?(line: string): void;
}

/**
 * A save file: `{ version, accounts: { <name>: { password, characters: [...] } } }`.
 *
 * The whole table is rewritten on every save. That is deliberate at this size (a save is kilobytes
 * and a mutation happens at most every few seconds), and it is what makes the atomic rename
 * meaningful: there is exactly one file that is either the previous state or the next one.
 */
export class FileSaveStore implements SaveStore {
  readonly path: string;
  private readonly log?: (line: string) => void;

  constructor(options: FileSaveStoreOptions) {
    this.path = options.path;
    this.log = options.log;
  }

  load(): Map<string, AccountRecord> | undefined {
    let text: string;
    try {
      text = readFileSync(this.path, "utf8");
    } catch (error) {
      // No file yet is the normal first run. Anything else has to stop the start: a server that
      // came up empty would write that emptiness back over the file on its first save.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw new Error(`cannot be read (${describeError(error)})`);
    }
    const accounts = readSave(text);
    this.log?.(
      `save: ${this.path} loaded - ${accounts.size} account(s), ` +
        `${[...accounts.values()].reduce((total, account) => total + account.characters.length, 0)} character(s)`,
    );
    return accounts;
  }

  save(accounts: Map<string, AccountRecord>): void {
    const text = saveJson(accounts);
    const temporary = `${this.path}.tmp`;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(temporary, text);
      renameSync(temporary, this.path);
    } catch (error) {
      this.log?.(
        `save: ${this.path} could not be written (${describeError(error)}) - not persisted`,
      );
      return;
    }
    this.log?.(`save: ${this.path} written (${text.length} bytes)`);
  }
}

/**
 * The accounts this server runs on: the save file when it has one, else the `--account` seed.
 *
 * The file wins outright rather than merging: merging would need a rule for two records with the
 * same name and different passwords, and "the file is the world" is a rule an operator can hold in
 * their head. The seed is then only what a *first* run starts from, and the log says which one won.
 */
export function loadAccounts(
  store: SaveStore | undefined,
  seed: Map<string, AccountRecord>,
  log?: (line: string) => void,
): Map<string, AccountRecord> {
  const loaded = store?.load();
  if (loaded === undefined) return seed;
  if (seed.size > 0) {
    log?.(
      `save: ignoring ${seed.size} --account entr(ies) - the store already has ${loaded.size} account(s)`,
    );
  }
  return loaded;
}

/**
 * The file's text for a table of accounts (`FileSaveStore` writes exactly this).
 *
 * The order is **canonical**: accounts by name and each slot map by slot number, while the character
 * list keeps the order it has (that order is the three slots the client shows, so it is data, not
 * presentation). Two saves of an unchanged world are therefore byte-identical, which is what makes
 * the file worth diffing. The table is a null-prototype object so an account that is called
 * `__proto__` is a key like any other.
 */
export function saveJson(accounts: Map<string, AccountRecord>): string {
  const table: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const username of [...accounts.keys()].sort()) {
    const account = accounts.get(username)!;
    table[username] = {
      password: account.password,
      ...(account.gender !== undefined ? { gender: account.gender } : {}),
      ...(account.fame !== undefined ? { fame: fameToSave(account.fame) } : {}),
      characters: account.characters.map(characterToSave),
    };
  }
  return `${JSON.stringify({ version: SAVE_VERSION, accounts: table }, null, 2)}\n`;
}

/**
 * The accounts in a save file. Throws on a version this build does not write, on JSON that does not
 * parse, and on a record without identity - see the header.
 */
export function readSave(text: string): Map<string, AccountRecord> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`save file is not JSON: ${describeError(error)}`);
  }
  const root = objectOf(parsed);
  const version = root["version"];
  if (version !== SAVE_VERSION) {
    throw new Error(
      `save file has version ${JSON.stringify(version)}; this build writes ${SAVE_VERSION} ` +
        `(refusing to load it rather than overwrite it)`,
    );
  }
  const accounts = new Map<string, AccountRecord>();
  const ids = new Map<number, string>();
  for (const [username, value] of Object.entries(objectOf(root["accounts"]))) {
    const record = objectOf(value);
    const characters: CharacterData[] = [];
    for (const entry of arrayOf(record["characters"])) {
      const character = characterFromSave(entry);
      // A character id is a key everywhere: the handoff registry, the field's sessions, the `0x1C`
      // that tells the other players who this is. Two characters with one id would hand the wrong
      // one to a client, so a file that says so is refused rather than half-believed.
      const other = ids.get(character.stats.id);
      if (other !== undefined) {
        throw new Error(
          `two characters share id ${character.stats.id} (\"${other}\" and \"${character.stats.name}\")`,
        );
      }
      ids.set(character.stats.id, character.stats.name);
      assertSendable(character);
      characters.push(character);
    }
    accounts.set(username, {
      password: stringOf(record["password"], ""),
      characters,
      ...(record["gender"] === 0 || record["gender"] === 1
        ? { gender: record["gender"] as 0 | 1 }
        : {}),
      ...(record["fame"] === undefined ? {} : { fame: fameFromSave(record["fame"]) }),
    });
  }
  return accounts;
}

/**
 * Proves a loaded record is one the client can be told about, by encoding it and throwing the bytes
 * away.
 *
 * `writeCharacterData` is the only description of the record the client understands, so running it
 * here turns "this save has an exp of -1" from a broken login (where the failure would surface as a
 * half-sent `0x16`) into a refused start. It is also what keeps `save.ts` from having to know the
 * wire ranges at all: the codec is the authority and this is how it is asked.
 */
function assertSendable(character: CharacterData): void {
  try {
    writeCharacterData(new PacketWriter(), character);
  } catch (error) {
    throw new Error(
      `character ${character.stats.id} (\"${character.stats.name}\") cannot be sent to a client: ${describeError(error)}`,
    );
  }
}

/**
 * One character record, as the save file holds it.
 *
 * `flags` is left out on purpose - see the header: it is a function of what is here, and
 * `characterFromSave` derives it again. `items` is left out when the record has none, which is what
 * a stat-only record looks like on the wire (a flags byte and 69 bytes of stats).
 */
export function characterToSave(character: CharacterData): unknown {
  return {
    stats: { ...character.stats },
    ...(character.items === undefined ? {} : { items: itemsToSave(character.items) }),
  };
}

/**
 * One character record, read back.
 *
 * The stat block starts from `zeroStats()`, so a field the file does not mention keeps the value a
 * fresh character would have; every *numeric* field that exists on the live record is then copied
 * when the file has a number for it. That is why adding a stat field to `CharacterStats` does not
 * need a change here - and why a typo in the file is a default rather than a crash. Identity
 * (`id`, `name`) is the exception: it is required, because every table in this server is keyed by it.
 * A **rename** is the other exception: the copy is keyed by field name, so a renamed field needs an
 * explicit reading of its old key (see `spawnPortalIndex` below) or old files lose that value.
 */
export function characterFromSave(value: unknown): CharacterData {
  const record = objectOf(value);
  const source = objectOf(record["stats"]);
  const stats = zeroStats();
  const id = source["id"];
  if (typeof id !== "number" || !Number.isFinite(id)) {
    throw new Error(`save file: a character has no numeric id (${JSON.stringify(id)})`);
  }
  stats.id = Math.trunc(id);
  stats.name = requireString(source["name"], `the name of character ${stats.id}`);
  for (const key of Object.keys(stats) as (keyof CharacterStats)[]) {
    if (typeof stats[key] !== "number") continue; // `name` is the only non-number
    (stats[key] as number) = numberOf(source[key], stats[key] as number);
  }
  // A rename, not a new field: this value was called `unknown101` before `sub_511820` showed it to
  // be the spawn portal index, and files written before the rename spell the old key. The loop
  // above keys off `zeroStats()`, so on such a file it finds nothing and leaves the value at 0 -
  // which would quietly put every existing character back at portal 0 on its next login. Read the
  // old key when the new one is absent. `SAVE_VERSION` stays 1: the file format did not change.
  if (source["spawnPortalIndex"] === undefined) {
    stats.spawnPortalIndex = numberOf(source["unknown101"], stats.spawnPortalIndex);
  }
  const items = record["items"];
  if (items === undefined) {
    // No item block: `1` is the `stats` bit alone, which is what `characterDataOf` would say for such
    // a record, and what the client accepts as a bare character (`FINDINGS 4.9`).
    return { stats, flags: CHAR_FLAG_STATS };
  }
  // With an item block the flags are derived from what it holds (`characterDataOf`), so a tab with
  // slots - or an item in one - is always announced to the client.
  return characterDataOf(stats, itemsFromSave(items, stats.id));
}

function itemsToSave(items: CharacterItems): unknown {
  return {
    worn: slotsToSave(items.worn),
    wornCash: slotsToSave(items.wornCash),
    inventories: items.inventories.map(inventoryToSave),
    map32: items.map32.map((record) => ({ key: record.key, value: record.value })),
    mapString: items.mapString.map((entry) => ({ key: entry.key, value: entry.value })),
  };
}

function itemsFromSave(value: unknown, characterId: number): CharacterItems {
  const record = objectOf(value);
  const where = `character ${characterId} items`;
  const inventories = arrayOf(record["inventories"]);
  const items = emptyCharacterItems();
  items.worn = slotsFromSave(record["worn"], `${where}.worn`);
  items.wornCash = slotsFromSave(record["wornCash"], `${where}.wornCash`);
  for (let tab = 0; tab < items.inventories.length; tab++) {
    const source = inventories[tab];
    if (source === undefined) continue;
    items.inventories[tab] = inventoryFromSave(source, `${where}.inventories[${tab}]`);
  }
  items.map32 = arrayOf(record["map32"]).map((entry) => {
    const pair = objectOf(entry);
    return { key: numberOf(pair["key"], 0), value: numberOf(pair["value"], 0) };
  });
  items.mapString = arrayOf(record["mapString"]).map((entry) => {
    const pair = objectOf(entry);
    return { key: stringOf(pair["key"], ""), value: stringOf(pair["value"], "") };
  });
  return items;
}

function inventoryToSave(inventory: Inventory): unknown {
  return {
    capacity: inventory.capacity,
    items: slotsToSave(inventory.items),
    records: inventory.records.map((record) => ({ key: record.key, value: record.value })),
  };
}

function inventoryFromSave(value: unknown, where: string): Inventory {
  const record = objectOf(value);
  return {
    capacity: numberOf(record["capacity"], 0),
    items: slotsFromSave(record["items"], where),
    records: arrayOf(record["records"]).map((entry) => {
      const pair = objectOf(entry);
      return { key: numberOf(pair["key"], 0), value: numberOf(pair["value"], 0) };
    }),
  };
}

/**
 * A slot map as an array of `[slot, item]` pairs.
 *
 * Arrays, not objects: slot numbers are 1-based keys of a `Map`, and `{"1": ...}` would come back as
 * the string `"1"` - the one place where the JSON object shape would change a type behind our back.
 */
function slotsToSave(slots: Map<number, ItemSlot>): unknown[] {
  return [...slots.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([slot, item]) => [slot, slotToSave(item)]);
}

function slotsFromSave(value: unknown, where: string): Map<number, ItemSlot> {
  const slots = new Map<number, ItemSlot>();
  for (const entry of arrayOf(value)) {
    const pair = arrayOf(entry);
    if (pair.length !== 2)
      throw new Error(`save file: ${where} has an entry that is not [slot, item]`);
    slots.set(requireNumber(pair[0], `${where} slot number`), slotFromSave(pair[1], where));
  }
  return slots;
}

/** One item slot: `kind` first, then exactly the fields that kind has (`protocol/itemslot.ts`). */
function slotToSave(item: ItemSlot): unknown {
  const cash =
    item.cash === null
      ? null
      : {
          sn: item.cash.sn.toString(),
          unknown18: item.cash.unknown18,
          unknown1A: item.cash.unknown1A.toString(),
        };
  if (item.kind === "equip") {
    const stats: Record<string, number> = {};
    for (const stat of EQUIP_STATS) stats[stat] = item[stat];
    return { kind: item.kind, itemId: item.itemId, cash, ruc: item.ruc, cuc: item.cuc, stats };
  }
  return { kind: item.kind, itemId: item.itemId, cash, quantity: item.quantity };
}

function slotFromSave(value: unknown, where: string): ItemSlot {
  const record = objectOf(value);
  const kind = record["kind"];
  const itemId = requireNumber(record["itemId"], `${where} itemId`);
  const cash = record["cash"];
  const cashBlock =
    cash === null || cash === undefined
      ? null
      : (() => {
          const block = objectOf(cash);
          return {
            sn: bigintOf(block["sn"]),
            unknown18: numberOf(block["unknown18"], 0),
            unknown1A: bigintOf(block["unknown1A"]),
          };
        })();
  if (kind === "nonequip") {
    return { kind, itemId, cash: cashBlock, quantity: numberOf(record["quantity"], 0) };
  }
  if (kind !== "equip") {
    throw new Error(`save file: ${where} has item ${itemId} with kind ${JSON.stringify(kind)}`);
  }
  const source = objectOf(record["stats"]);
  const item: ItemSlotEquip = {
    kind,
    itemId,
    cash: cashBlock,
    ruc: numberOf(record["ruc"], 0),
    cuc: numberOf(record["cuc"], 0),
    ...zeroEquipStats(),
  };
  for (const stat of EQUIP_STATS) item[stat] = numberOf(source[stat], 0);
  return item;
}

/**
 * The 15 equip stats at 0, in the client's own order (`EQUIP_STATS`).
 *
 * A fresh item's stats come from WZ (`Mob/<id>.img`->`info` for the `ruc` byte, the item's own
 * `info` for the rest), so 0 here means "the file did not carry this one" - not a real value.
 */
function zeroEquipStats(): Record<EquipStat, number> {
  const stats = {} as Record<EquipStat, number>;
  for (const stat of EQUIP_STATS) stats[stat] = 0;
  return stats;
}

/** A `bigint` as a decimal string, and back; anything else is 0 (the "no serial number" value). */
function bigintOf(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value !== "string" || !/^-?\d+$/.test(value)) return 0n;
  return BigInt(value);
}

function numberOf(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

/**
 * The fame quotas, keyed by the character id exactly as `FameLedgers` spelled it.
 *
 * The order the file shows is ascending numeric **without any sorting here**, and it is worth
 * saying why, because it looks like an omission: a key that is a canonical decimal integer is an
 * "integer index" in the spec's sense, and both `Object.keys` and `JSON.stringify` enumerate those
 * in ascending numeric order ahead of every other key. So `{ "10": …, "9": … }` is written as 9
 * then 10 no matter what order it was built in. A `.sort()` and a `.reverse()` were both tried
 * here, and mutation testing showed **neither changed the bytes** - they were dead code, which is
 * the only reason a comment is allowed to make this claim instead of the code doing it.
 *
 * What *is* load-bearing is the key format: the bare decimal id, no padding, no prefix. Pad it and
 * `"007"` stops being an integer index, the ordering guarantee goes with it, and two saves of one
 * world stop being identical. `save.test.ts` pins that.
 */
function fameToSave(table: FameTable): unknown {
  const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(table)) {
    const ledger = table[key]!;
    out[key] = { day: ledger.day, month: ledger.month, targets: [...ledger.targets] };
  }
  return out;
}

/**
 * The fame quotas back from a save. Tolerant like every other field here: an entry whose shape does
 * not fit is dropped rather than refused, because a quota is a convenience and losing one is not
 * losing a character. A whole `fame` that is not an object is reported as no quota at all.
 */
function fameFromSave(value: unknown): FameTable {
  const table: FameTable = {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) return table;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!/^\d+$/.test(key)) continue; // a character id, or nothing we put there
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const row = entry as Record<string, unknown>;
    if (!Array.isArray(row["targets"])) continue;
    table[key] = {
      day: numberOf(row["day"], 0),
      month: numberOf(row["month"], 0),
      targets: row["targets"].filter(
        (id): id is number => typeof id === "number" && Number.isInteger(id),
      ),
    };
  }
  return table;
}

function stringOf(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function requireNumber(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`save file: ${what} is not a number (${JSON.stringify(value)})`);
  }
  return Math.trunc(value);
}

function requireString(value: unknown, what: string): string {
  if (typeof value !== "string") {
    throw new Error(`save file: ${what} is not a string (${JSON.stringify(value)})`);
  }
  return value;
}

function objectOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
