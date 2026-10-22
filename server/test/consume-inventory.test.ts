/**
 * The whole `spec` inventory of this Data.wz, read out of the shipped archive.
 *
 * Everything in `items.test.ts` is a hand-written fixture, so it can only say what the reader does
 * with a spec it is *given*. This file answers the question those fixtures cannot: **what does the
 * real data actually contain**, and is any of it being dropped?
 *
 * It exists because FINDINGS §6 item 20 used to end with "the whole WZ has exactly one unconsumed
 * field left, `mdd`, and any item carrying it is refused whole". That was checked against the data
 * and is not true: `mdd` does not occur here at all, and the `unapplied` list comes back empty for
 * every single item. The refusal machinery is therefore a safety net for a future archive, not a
 * live gap - which is a much better thing to be able to say, and a much easier thing to get wrong
 * again silently. So the inventory is pinned here instead.
 *
 * The archive is optional (`--data off`, and CI without Data.wz): every test skips when it is
 * absent rather than pretending the inventory is empty.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WzArchive } from "../src/wz/archive.ts";
import { artReaderOf } from "../src/game/wzart.ts";
import { consumeSpecOf, healsVitals } from "../src/game/items.ts";
import { itemImagePath } from "../src/wz/paths.ts";

const DATA_WZ = fileURLToPath(new URL("../../Data.wz", import.meta.url));
const archive: WzArchive | undefined = existsSync(DATA_WZ) ? WzArchive.open(DATA_WZ) : undefined;
const needsArchive = { skip: archive === undefined };

/** The consume families `Item/Consume/0XXX.img` carries in this build. */
const CONSUME_PREFIXES = ["0200", "0201", "0202", "0203", "0204", "0205", "0206", "0207"] as const;

interface InventoryEntry {
  itemId: number;
  /** Every field name under the item's `spec` node, in archive order. */
  fields: string[];
  unapplied: string[];
}

/**
 * Every spec-carrying consume item, straight off the archive.
 *
 * The fields are read from the node itself rather than from `ConsumeSpec` so that the inventory is
 * the *data*, not the reader's opinion of the data - otherwise a field the reader stopped copying
 * would quietly vanish from the census and this test would still pass.
 *
 * `null` when there is no archive, so a missing Data.wz skips instead of reporting an empty world.
 */
function inventory(): InventoryEntry[] | null {
  const reader = artReaderOf(archive);
  if (archive === undefined || reader === undefined) return null;
  const out: InventoryEntry[] = [];
  for (const prefix of CONSUME_PREFIXES) {
    const node = reader.node(`Item/Consume/${prefix}.img`);
    if (node === undefined) continue; // a family this Data.wz does not carry
    for (const child of (node.value ?? []) as { name: string; value?: { value?: unknown[] } }[]) {
      const itemId = Number(child.name);
      if (!Number.isInteger(itemId) || itemId <= 0) continue;
      const props = (child.value?.value ?? []) as { name: string; value?: { value?: unknown[] } }[];
      const spec = props.find((prop) => prop.name === "spec");
      if (spec === undefined) continue;
      const fields = ((spec.value?.value ?? []) as { name: string }[]).map((field) => field.name);
      out.push({ itemId, fields, unapplied: consumeSpecOf(archive, itemId)?.unapplied ?? [] });
    }
  }
  return out;
}

/**
 * The inventory for a test that already declared `needsArchive`.
 *
 * Every caller is skipped when Data.wz is absent, so a `null` here means the archive exists but
 * carries no consume spec at all - which is a failure of the archive, not a skip, and must be loud.
 */
function required(): InventoryEntry[] {
  const entries = inventory();
  assert.ok(entries !== null, "this test must be skipped when Data.wz is absent");
  return entries;
}

test("the shipped Data.wz carries consume specs and they are all reachable", needsArchive, () => {
  const entries = required();
  assert.ok(
    entries.length >= 40,
    `expected the four USE-tab families to carry specs, found ${entries.length}`,
  );
  // Every one must resolve through the same path the server uses at runtime, or the census and the
  // live game are looking at different data.
  for (const entry of entries) {
    assert.equal(
      itemImagePath(entry.itemId),
      `Item/Consume/${String(entry.itemId).padStart(8, "0").slice(0, 4)}.img`,
      `item ${entry.itemId} must resolve to a Consume image`,
    );
  }
});

test(
  "the complete set of spec field names is exactly the thirteen this server consumes",
  needsArchive,
  () => {
    const found = new Set<string>();
    for (const entry of required()) for (const field of entry.fields) found.add(field);

    assert.deepEqual(
      [...found].sort(),
      [
        "acc",
        "eva",
        "hp",
        "hpR",
        "mad",
        "moveTo",
        "mp",
        "mpR",
        "pad",
        "pda",
        "pdd",
        "speed",
        "time",
      ],
      "a new spec field name is a new mechanic: name it here and give it a consumer",
    );
  },
);

test(
  "no `mdd` in this archive - the old 'one unconsumed field left' note was wrong",
  needsArchive,
  () => {
    // FINDINGS §6 item 20 said `mdd` was the last field without a consumer and that items carrying it
    // were refused whole. It occurs nowhere in this Data.wz, so nothing is being refused.
    const withMdd = required().filter((entry) => entry.fields.includes("mdd"));
    assert.deepEqual(
      withMdd.map((entry) => entry.itemId),
      [],
      "`mdd` does not exist in this build; if an archive ever carries it, items.test.ts already pins the refusal",
    );
  },
);

test(
  "no item is silently refused: `unapplied` is empty for every spec in the archive",
  needsArchive,
  () => {
    // The refusal path is a safety net, not a live branch. If this ever fails, some item's effect is
    // being dropped and the player loses the item for nothing - the exact thing the design forbids.
    const dropped = required()
      .filter((entry) => entry.unapplied.length > 0)
      .map((entry) => ({ item: entry.itemId, fields: entry.unapplied }));
    assert.deepEqual(dropped, [], "every spec field in the shipped data must have a consumer");
  },
);

test("the one item whose rates are strings is refused, not coerced", needsArchive, () => {
  // `02010006` is the single item in this archive whose `hpR`/`mpR` are the *string* `"50"` instead
  // of a number (FINDINGS §4.34.3 rule 2: a value of the wrong shape is no value). The reader must
  // therefore drop them rather than coerce, and the item must not be usable as a heal.
  const odd = required().filter((entry) => {
    const wants = entry.fields.some((field) => field === "hpR" || field === "mpR");
    if (!wants) return false;
    const spec = consumeSpecOf(archive, entry.itemId)!;
    return spec.hpR === undefined && spec.mpR === undefined;
  });

  assert.deepEqual(
    odd.map((entry) => entry.itemId),
    [2010006],
    "exactly one item carries a rate the reader must refuse",
  );

  const spec = consumeSpecOf(archive, 2010006)!;
  assert.deepEqual(spec.unapplied, [], "a refused shape is not an unimplemented mechanic");
  assert.equal(healsVitals(spec), false, "a rate the reader refused must not become a heal");
  assert.equal(
    spec.moveTo,
    undefined,
    "and it must not fall through to any other branch either - the item simply does nothing",
  );
});
