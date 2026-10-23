import { test } from "node:test";
import assert from "node:assert/strict";
import { PacketReader } from "../src/protocol/packet.ts";
import {
  FAME_OPCODE,
  FAME_RESULT_TYPE,
  describeClientFameRequest,
  describeFameResult,
  encodeClientFameRequest,
  encodeFameResult,
  readClientFameRequest,
  readFameResult,
  type FameResult,
} from "../src/protocol/fame.ts";
import {
  FAME_MAX,
  FAME_MIN_LEVEL,
  FameLedgers,
  applyFame,
  fameClock,
  type FameLedger,
} from "../src/game/fame.ts";
import { describeClientFieldPacket, describeFieldPacket } from "../src/protocol/field.ts";

/** `[0x20][u32 7][u8 1]`, per FINDINGS 4.38 (`sub_55D7B0`). */
const UP_SEVEN = "200700000001";
const DOWN_SEVEN = "200700000000";

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const CLOCK = { day: 20_000, month: 2026 * 12 + 9 };

test("0x20 is a u32 target and one up/down byte", () => {
  assert.equal(hex(encodeClientFameRequest({ targetId: 7, up: true })), UP_SEVEN);
  assert.equal(hex(encodeClientFameRequest({ targetId: 7, up: false })), DOWN_SEVEN);
  assert.deepEqual(
    readClientFameRequest(new PacketReader(encodeClientFameRequest({ targetId: 7, up: true }), 1)),
    {
      targetId: 7,
      up: true,
    },
  );
  assert.deepEqual(
    readClientFameRequest(new PacketReader(encodeClientFameRequest({ targetId: 7, up: false }), 1)),
    {
      targetId: 7,
      up: false,
    },
  );
  assert.equal(describeClientFameRequest({ targetId: 7, up: true }), "0x20 fame: up 7");
  assert.equal(describeClientFameRequest({ targetId: 7, up: false }), "0x20 fame: down 7");
});

test("0x12: the two shapes that carry a name, and the four that carry nothing", () => {
  assert.equal(
    hex(encodeFameResult({ kind: "changed", name: "Alt", up: true })),
    "12000300416c7401",
  );
  assert.equal(
    hex(encodeFameResult({ kind: "changed", name: "Alt", up: false })),
    "12000300416c7400",
  );
  assert.equal(
    hex(encodeFameResult({ kind: "received", name: "Hero", up: true })),
    "120504004865726f01",
  );
  assert.equal(hex(encodeFameResult({ kind: "ignored" })), "1201");
  assert.equal(hex(encodeFameResult({ kind: "beginner" })), "1202");
  assert.equal(hex(encodeFameResult({ kind: "alreadyToday" })), "1203");
  assert.equal(hex(encodeFameResult({ kind: "alreadyThisMonth" })), "1204");
  assert.equal(FAME_RESULT_TYPE.received, 5);
});

test("0x12 reads back what it wrote", () => {
  const results: FameResult[] = [
    { kind: "changed", name: "Alt", up: true },
    { kind: "received", name: "Hero", up: false },
    { kind: "ignored" },
    { kind: "beginner" },
    { kind: "alreadyToday" },
    { kind: "alreadyThisMonth" },
  ];
  for (const result of results) {
    assert.deepEqual(readFameResult(new PacketReader(encodeFameResult(result), 1)), result);
  }
  assert.equal(describeFameResult({ kind: "changed", name: "Alt", up: true }), "0x12 fame: Alt up");
  assert.equal(
    describeFameResult({ kind: "received", name: "Hero", up: false }),
    "0x12 fame: Hero down (someone famed you)",
  );
  // `type 0x09` is not one of the six: the client would take its default branch, and so does this.
  assert.deepEqual(readFameResult(new PacketReader(Uint8Array.from([0x09]), 0)), {
    kind: "unknown",
    type: 9,
  });
});

test("the two field describers know the pair", () => {
  assert.equal(
    describeClientFieldPacket(encodeClientFameRequest({ targetId: 7, up: true })),
    "0x20 fame: up 7",
  );
  assert.equal(
    describeFieldPacket(encodeFameResult({ kind: "changed", name: "Alt", up: false })),
    "0x12 fame: Alt down",
  );
});

test("a beginner cannot give fame", () => {
  const outcome = applyFame({
    giverId: 1,
    giverLevel: FAME_MIN_LEVEL - 1,
    targetId: 2,
    up: true,
    targetFame: 5,
    ledger: undefined,
    clock: CLOCK,
  });
  assert.deepEqual(outcome, { kind: "refused", reason: "beginner" });
});

test("you cannot fame yourself", () => {
  const outcome = applyFame({
    giverId: 1,
    giverLevel: 50,
    targetId: 1,
    up: true,
    targetFame: 5,
    ledger: undefined,
    clock: CLOCK,
  });
  assert.deepEqual(outcome, { kind: "refused", reason: "self" });
});

test("the first fame of the day goes through and writes the ledger", () => {
  const outcome = applyFame({
    giverId: 1,
    giverLevel: FAME_MIN_LEVEL,
    targetId: 2,
    up: true,
    targetFame: 5,
    ledger: undefined,
    clock: CLOCK,
  });
  assert.deepEqual(outcome, {
    kind: "ok",
    fame: 6,
    ledger: { day: CLOCK.day, month: CLOCK.month, targets: [2] },
  });
  // Down at zero stays zero: fame is a u16 on the wire and has no negative spelling.
  assert.deepEqual(
    applyFame({
      giverId: 1,
      giverLevel: FAME_MIN_LEVEL,
      targetId: 2,
      up: false,
      targetFame: 0,
      ledger: undefined,
      clock: CLOCK,
    }),
    { kind: "ok", fame: 0, ledger: { day: CLOCK.day, month: CLOCK.month, targets: [2] } },
  );
  // Up at the ceiling stays at the ceiling.
  assert.equal(
    (
      applyFame({
        giverId: 1,
        giverLevel: FAME_MIN_LEVEL,
        targetId: 2,
        up: true,
        targetFame: FAME_MAX,
        ledger: undefined,
        clock: CLOCK,
      }) as { fame: number }
    ).fame,
    FAME_MAX,
  );
});

test("the same target in the same month is type 4, anyone else today is type 3", () => {
  const ledger: FameLedger = { day: CLOCK.day, month: CLOCK.month, targets: [2] };
  const attempt = {
    giverId: 1,
    giverLevel: 50,
    up: true,
    targetFame: 5,
    clock: CLOCK,
  };
  assert.deepEqual(applyFame({ ...attempt, targetId: 2, ledger }), {
    kind: "refused",
    reason: "alreadyThisMonth",
  });
  assert.deepEqual(applyFame({ ...attempt, targetId: 3, ledger }), {
    kind: "refused",
    reason: "alreadyToday",
  });
  // Yesterday the day is free again, and the month still remembers who was famed.
  assert.deepEqual(
    applyFame({ ...attempt, targetId: 3, ledger, clock: { ...CLOCK, day: CLOCK.day + 1 } }),
    {
      kind: "ok",
      fame: 6,
      ledger: { day: CLOCK.day + 1, month: CLOCK.month, targets: [2, 3] },
    },
  );
  // A new month forgets the targets but keeps the day stamp (which is by definition a new day too).
  assert.deepEqual(
    applyFame({
      ...attempt,
      targetId: 2,
      ledger,
      clock: { day: CLOCK.day + 40, month: CLOCK.month + 1 },
    }),
    {
      kind: "ok",
      fame: 6,
      ledger: { day: CLOCK.day + 40, month: CLOCK.month + 1, targets: [2] },
    },
  );
});

test("fameClock is UTC days and months", () => {
  const noon = Date.UTC(2026, 9, 17, 12, 0, 0);
  assert.equal(fameClock(noon).month, 2026 * 12 + 9);
  assert.equal(fameClock(noon + 86_400_000).day, fameClock(noon).day + 1);
  const lastOfOctober = Date.UTC(2026, 9, 31, 23, 59, 0);
  const firstOfNovember = Date.UTC(2026, 10, 1, 0, 1, 0);
  assert.equal(fameClock(firstOfNovember).month, fameClock(lastOfOctober).month + 1);
});

test("FameLedgers remembers, forgets, and counts", () => {
  // The account table is the store now (ADR-148): the ledger lives on the account row, so there is
  // no second copy to fall out of step with the save.
  const accounts = new Map<string, { fame?: Record<string, FameLedger> }>([["a", {}]]);
  const ledgers = new FameLedgers(accounts);
  assert.equal(ledgers.ledgerOf("a", 1), undefined);
  const ledger: FameLedger = { day: 1, month: 2, targets: [3] };
  ledgers.remember("a", 1, ledger);
  assert.deepEqual(ledgers.ledgerOf("a", 1), ledger);
  assert.equal(ledgers.count, 1);
  // …and it is visible on the account itself, which is the point.
  assert.deepEqual(accounts.get("a")!.fame, { "1": ledger });
  // One account's quota is not another's.
  accounts.set("b", {});
  assert.equal(ledgers.ledgerOf("b", 1), undefined);
  ledgers.forget("a", 1);
  assert.equal(ledgers.ledgerOf("a", 1), undefined);
  assert.equal(ledgers.count, 0);
  assert.equal(FAME_OPCODE.request, 0x20);
  assert.equal(FAME_OPCODE.result, 0x12);
});

test("a ledger is stored per account and per character, and forget leaves no empty table", () => {
  const accounts = new Map<string, { fame?: Record<string, FameLedger> }>([
    ["a", {}],
    ["b", {}],
  ]);
  const ledgers = new FameLedgers(accounts);
  const first: FameLedger = { day: 10, month: 20, targets: [7] };
  const second: FameLedger = { day: 11, month: 20, targets: [8] };
  ledgers.remember("a", 1, first);
  ledgers.remember("a", 2, second);
  ledgers.remember("b", 3, first);
  assert.equal(ledgers.count, 3);
  assert.deepEqual(ledgers.ledgerOf("a", 1), first);
  assert.deepEqual(ledgers.ledgerOf("a", 2), second);
  assert.deepEqual(ledgers.ledgerOf("b", 3), first);

  ledgers.forget("a", 1);
  assert.equal(ledgers.ledgerOf("a", 1), undefined);
  assert.deepEqual(
    ledgers.ledgerOf("a", 2),
    second,
    "forgetting one character must not touch another",
  );

  ledgers.forget("b", 3);
  assert.equal(
    accounts.get("b")!.fame,
    undefined,
    "an account whose last quota is gone must not keep an empty table on disk",
  );
});

test("remembering for an account that does not exist is a no-op, not a crash", () => {
  const accounts = new Map<string, { fame?: Record<string, FameLedger> }>();
  const ledgers = new FameLedgers(accounts);
  ledgers.remember("ghost", 1, { day: 1, month: 1, targets: [] });
  ledgers.forget("ghost", 1);
  assert.equal(ledgers.count, 0);
  assert.equal(ledgers.ledgerOf("ghost", 1), undefined);
});
