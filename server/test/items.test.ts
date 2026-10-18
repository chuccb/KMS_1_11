/**
 * What a USE-tab item does (`game/items.ts`): the `spec` node of `Item/Consume/0XXX.img`, and the
 * deltas one use is worth.
 *
 * The archive is a hand-written fixture here, so the test says what the *reader* does with a spec -
 * the real numbers (빨간 포션 `hp = 50`, 엘릭서 `hpR = mpR = 50`, 마을 귀환 주문서 `moveTo = -1`) come
 * from `Item/Consume/0200.img` / `0203.img` and are read out of the shipped `Data.wz` by the
 * archive-backed tests in `test/shops.test.ts` and `test/serve.test.ts`.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  consumeDeltas,
  consumeSpecProvider,
  consumeSpecOf,
  healsVitals,
} from "../src/game/items.ts";
import { applyVitalReport } from "../src/game/vitals.ts";
import { zeroStats, type CharacterStats } from "../src/protocol/chardata.ts";
import type { WzArchive } from "../src/wz/archive.ts";

/** One `.img`: a property list of `name`/`value` pairs, which is all `wz/props.ts` reads. */
function image(items: Record<string, Record<string, unknown>>): unknown {
  return {
    props: Object.entries(items).map(([itemId, nodes]) => ({
      name: itemId,
      value: {
        props: Object.entries(nodes).map(([nodeName, fields]) => ({
          name: nodeName,
          value: { props: [{ name: "name", value: "stub" }, ...fieldsToProps(fields)] },
        })),
      },
    })),
  };
}

function fieldsToProps(fields: unknown): { name: string; value: unknown }[] {
  return Object.entries(fields as Record<string, unknown>).map(([name, value]) => ({
    name,
    value,
  }));
}

/** The two calls `consumeSpecOf` makes: `has(path)` and `objects(path)`. */
function fakeArchive(imagePath: string, root: unknown): WzArchive {
  return {
    has: (path: string) => path === imagePath,
    objects: (path: string) => (path === imagePath ? [root] : []),
  } as unknown as WzArchive;
}

function record(overrides: Partial<CharacterStats> = {}): CharacterStats {
  const stats = zeroStats();
  stats.level = 1;
  stats.hp = 20;
  stats.maxHp = 50;
  stats.mp = 10;
  stats.maxMp = 30;
  return Object.assign(stats, overrides);
}

test("a potion's flat spec is `hp`/`mp`, and nothing else is applied", () => {
  // Item/Consume/0200.img/02000000: spec {hp: 50} (빨간 포션, info/price 25).
  const archive = fakeArchive("Item/Consume/0200.img", image({ "02000000": { spec: { hp: 50 } } }));
  const spec = consumeSpecOf(archive, 2000000);
  assert.deepEqual(spec, {
    hp: 50,
    mp: undefined,
    hpR: undefined,
    mpR: undefined,
    moveTo: undefined,
    unapplied: [],
  });
  assert.equal(healsVitals(spec!), true, "it restores a vital, so 0x18 is its opcode");

  // The deltas a use is worth, and then the *real* rule: 20 + 50 clamps to the maximum.
  const deltas = consumeDeltas(spec!, record());
  assert.deepEqual(deltas, { hpDelta: 50 });
  const stats = record();
  assert.deepEqual(applyVitalReport(stats, deltas), { hp: 50 });
  assert.deepEqual(
    [stats.hp, stats.maxHp, stats.mp],
    [50, 50, 10],
    "MP is untouched by an HP potion",
  );

  // A full bar means the use would do nothing, which is what the handler refuses an item for.
  const full = record({ hp: 50 });
  assert.deepEqual(applyVitalReport(full, consumeDeltas(spec!, full)), {});
});

test("the percentage fields are percentages of the maxima, rounded down", () => {
  // Item/Consume/0200.img/02000004 (엘릭서: hpR 50, mpR 50) and the 파워 엘릭서's 100/100.
  const elixir = consumeSpecOf(
    fakeArchive("Item/Consume/0200.img", image({ "02000004": { spec: { hpR: 50, mpR: 50 } } })),
    2000004,
  );
  assert.deepEqual(consumeDeltas(elixir!, record()), { hpDelta: 25, mpDelta: 15 });
  // 33% of 50 HP is 16.5, and a half point is not something a bar can show.
  const odd = consumeSpecOf(
    fakeArchive("Item/Consume/0200.img", image({ "02000006": { spec: { hpR: 33 } } })),
    2000006,
  );
  assert.deepEqual(consumeDeltas(odd!, record()), { hpDelta: 16 });
});

test("evasion potion has a real incoming contact consumer and is not a fake heal", () => {
  // Item/Consume/0200.img/02002000, now consumed by 4C8ED0 through the bridge's stream 2.
  const potion = consumeSpecOf(
    fakeArchive("Item/Consume/0200.img", image({ "02002000": { spec: { eva: 5, time: 180000 } } })),
    2002000,
  );
  assert.deepEqual(potion?.unapplied, []);
  assert.equal(potion?.eva, 5);
  assert.equal(potion?.time, 180000);
  assert.equal(healsVitals(potion!), false);
  assert.deepEqual(consumeDeltas(potion!, record()), {}, "nothing is restored, so nothing is sent");
});

test("a 203 item is a map change, and its destination is `spec/moveTo`", () => {
  // Item/Consume/0203.img: 마을 귀환 주문서 (-1) and 헤네시스 귀환 주문서 (100000000).
  const town = consumeSpecOf(
    fakeArchive("Item/Consume/0203.img", image({ "02030000": { spec: { moveTo: -1 } } })),
    2030000,
  );
  assert.equal(town?.moveTo, -1);
  assert.deepEqual(town?.unapplied, [], "the location field is one the server applies");
  assert.equal(healsVitals(town!), false, "a scroll restores nothing: it is the 0x19 family");
  const henesys = consumeSpecOf(
    fakeArchive("Item/Consume/0203.img", image({ "02030004": { spec: { moveTo: 100000000 } } })),
    2030004,
  );
  assert.equal(henesys?.moveTo, 100000000);
});

test("an id with no spec, no image, or no data at all has no use", () => {
  // An item whose node exists but has no `spec` (a 표창, a 207 item).
  const noSpec = fakeArchive(
    "Item/Consume/0207.img",
    image({ "02070000": { info: { price: 250 } } }),
  );
  assert.equal(consumeSpecOf(noSpec, 2070000), undefined);
  // An item the archive does not carry at all, and an equip - whose image is not even under Item/.
  const archive = fakeArchive("Item/Consume/0200.img", image({ "02000000": { spec: { hp: 50 } } }));
  assert.equal(consumeSpecOf(archive, 2000001), undefined);
  assert.equal(
    consumeSpecOf(archive, 1002000),
    undefined,
    "an equip id never throws, it just has no spec",
  );
  assert.equal(
    consumeSpecOf(undefined, 2000000),
    undefined,
    "--data off means no item does anything",
  );
  assert.equal(consumeSpecProvider(undefined)(2000000), undefined);
  assert.equal(
    consumeSpecProvider(archive)(2000000)?.hp,
    50,
    "the provider is the same reader over one archive",
  );
});

test("a hostile spec is not a use: a percent that is not a number, or an id that is not an item", () => {
  // The archive is data, not a promise: nothing here may throw inside a packet handler.
  const weird = consumeSpecOf(
    fakeArchive("Item/Consume/0200.img", image({ "02000000": { spec: { hp: "50", mpR: null } } })),
    2000000,
  );
  assert.equal(weird?.hp, undefined, "a string is not a number");
  assert.equal(weird?.mpR, undefined);
  assert.equal(healsVitals(weird!), false);
  assert.equal(consumeSpecOf(undefined, Number.NaN), undefined);
});

// New regression sources; not executed for this delivery.
test("native speed potion reads milliseconds, while mixed unknown mechanics refuse as a whole", () => {
  const spec = consumeSpecOf(
    fakeArchive(
      "Item/Consume/0200.img",
      image({
        "02002001": { spec: { speed: 8, time: 180000 } },
      }),
    ),
    2002001,
  )!;
  assert.equal(spec.speed, 8);
  assert.equal(spec.time, 180000);
  assert.deepEqual(spec.unapplied, []);
  assert.equal(healsVitals(spec), false, "speed is not a fake HP/MP restoration");
  const mixed = consumeSpecOf(
    fakeArchive(
      "Item/Consume/0200.img",
      image({
        "02002001": { spec: { speed: 8, time: 180000, mdd: 5 } },
      }),
    ),
    2002001,
  )!;
  assert.deepEqual(mixed.unapplied, ["mdd"]);
  for (const time of [0, -1, 1.5, 0x80000000]) {
    const bad = consumeSpecOf(
      fakeArchive(
        "Item/Consume/0200.img",
        image({
          "02002001": { spec: { speed: 8, time } },
        }),
      ),
      2002001,
    )!;
    assert.ok(bad.unapplied.includes("speed"));
    assert.ok(bad.unapplied.includes("time"));
  }
});

// Added as unexecuted regression sources: PAD/ACC have real physical-attack consumers now.
test("PAD and ACC timed specs are accepted; a mixed unimplemented mechanic still refuses whole use", () => {
  for (const key of ["pad", "acc"] as const) {
    const spec = consumeSpecOf(
      fakeArchive(
        "Item/Consume/0200.img",
        image({ "02002004": { spec: { [key]: 5, time: 180000 } } }),
      ),
      2002004,
    )!;
    assert.equal(spec[key], 5);
    assert.equal(spec.time, 180000);
    assert.deepEqual(spec.unapplied, []);
    const mixed = consumeSpecOf(
      fakeArchive(
        "Item/Consume/0200.img",
        image({ "02002004": { spec: { [key]: 5, time: 180000, mdd: 10 } } }),
      ),
      2002004,
    )!;
    assert.deepEqual(mixed.unapplied, ["mdd"]);
  }
});

// Unexecuted source: defensive specs are accepted only now that 4C8ED0 consumes PDD/EVA.
test("timed PDD and EVA feed contact; an unimplemented MDD still refuses a mixed item", () => {
  const spec = consumeSpecOf(
    fakeArchive(
      "Item/Consume/0200.img",
      image({
        "02002000": { spec: { pdd: 10, eva: 5, time: 180000 } },
      }),
    ),
    2002000,
  )!;
  assert.equal(spec.pdd, 10);
  assert.equal(spec.eva, 5);
  assert.deepEqual(spec.unapplied, []);
  const mixed = consumeSpecOf(
    fakeArchive(
      "Item/Consume/0200.img",
      image({
        "02002000": { spec: { pdd: 10, eva: 5, mdd: 3, time: 180000 } },
      }),
    ),
    2002000,
  )!;
  assert.deepEqual(mixed.unapplied, ["mdd"]);
});
