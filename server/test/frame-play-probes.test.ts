import test from "node:test";
import assert from "node:assert/strict";
import { fieldFixture } from "../scripts/probe-field.ts";
import { frameProbeOptions } from "../scripts/frame_probe.ts";
import { playProbeOptions, holdPlayKeys } from "../scripts/play_probe.ts";
import { readPlayPlan, playCycle, type PlayPlan } from "../scripts/probe-play.ts";
import { analyzeFrame, frameLayers } from "../scripts/probe-frame.ts";
import type { ProbeDraw, ProbePacket, ProbeSelf } from "../scripts/browser-observation.ts";

const env = {
  PROBE_ACCOUNT: "fixture-only",
  PROBE_PASSWORD: "not-a-real-password",
  PROBE_WORLD_INDEX: "7",
  PROBE_CHARACTER_ID: "902",
  PROBE_MAP_ID: "100000000",
  PROBE_FRAME_LAYERS: "background,tile,avatar,npc,item-drop,meso-drop",
  PROBE_PLAY_PLAN: "generated/explicit-plan.json",
};
const args = ["8595", "--allow-state-changes"];
const plan: PlayPlan = {
  combatMapId: 100000000,
  targetTemplateId: 1210100,
  reward: { money: false, value: 4000019 },
  steps: [
    { kind: "hold", keys: ["Control"], durationMs: 100 },
    { kind: "await", event: "loot", timeoutMs: 1000 },
  ],
};
const self: ProbeSelf = {
  str: 4,
  dex: 4,
  int: 4,
  luk: 13,
  ap: 0,
  spawnPortal: 0,
  avatarItems: [],
  mesos: 100,
};
const inventory = (quantity: number) => ({
  worn: [],
  tabs: [{ tab: 4, items: [{ slot: 1, itemId: 4000019, quantity }] }],
});
function trace(money = false): ProbePacket[] {
  const rows: ProbePacket[] = [
    { t: "field", mapId: 100000000, characterId: 902, self, at: 0, sequence: 1 },
    { t: "inventory", inventory: inventory(2), at: 0, sequence: 2 },
    { t: "mob-enter", mob: { mobId: 44, templateId: 1210100 }, at: 0, sequence: 3 },
    { t: "hit", mobId: 44, damage: 12, at: 0, sequence: 4 },
    { t: "mob-die", mobId: 44, at: 0, sequence: 5 },
    {
      t: "drop-enter",
      drop: { dropId: 55, mobId: 44, money, value: money ? 120 : 4000019 },
      at: 0,
      sequence: 6,
    },
    { t: "drop-leave", dropId: 55, reason: "taken", characterId: 902, at: 0, sequence: 7 },
    money
      ? { t: "self", self: { ...self, mesos: 220 }, at: 0, sequence: 8 }
      : { t: "inventory", inventory: inventory(3), at: 0, sequence: 8 },
    {
      t: "loot",
      notice: money ? { kind: "mesos", amount: 120 } : { kind: "item", itemId: 4000019, count: 1 },
      at: 0,
      sequence: 9,
    },
  ];
  return rows;
}
test("manual frame/play admission has no default targets, identity, map or scenario; read-only title has no account", () => {
  assert.deepEqual(frameProbeOptions(["8515"], {}), {
    kind: "title",
    origin: "http://127.0.0.1:8515",
    layers: ["title"],
  });
  assert.equal(fieldFixture(args, env).worldIndex, 7);
  assert.equal(playProbeOptions(args, env).characterId, 902);
  for (const run of [fieldFixture, playProbeOptions]) {
    assert.throws(() => run([], env), /allow-state-changes/);
    assert.throws(() => run(args, {}), /PROBE_ACCOUNT/);
    for (const port of [8495, 8496, 8497, 8515, 8516, 8517])
      for (const target of [String(port), `https://${port}-fixture.e2b.app`])
        assert.throws(() => run([target, "--allow-state-changes"], env), /Refusing/);
  }
  for (const name of [
    "PROBE_WORLD_INDEX",
    "PROBE_CHARACTER_ID",
    "PROBE_MAP_ID",
    "PROBE_PLAY_PLAN",
  ]) {
    const bad: Record<string, string | undefined> = { ...env, [name]: undefined };
    assert.throws(() => playProbeOptions(args, bad), new RegExp(name));
  }
  for (const [key, values] of [
    ["PROBE_WORLD_INDEX", ["256", "-1", "1.5", " 1"]],
    ["PROBE_CHARACTER_ID", ["0", "4294967296", "NaN"]],
    ["PROBE_MAP_ID", ["-1", "Infinity"]],
  ] as const)
    for (const value of values) assert.throws(() => fieldFixture(args, { ...env, [key]: value }));
});
test("field frame requirements are explicit, unique and cannot replace tiles/avatar with fallback ground", () => {
  assert.deepEqual(frameLayers("background,tile,avatar"), ["background", "tile", "avatar"]);
  for (const value of [
    "",
    "background,avatar",
    "tile,avatar",
    "background,tile",
    "background,tile,avatar,tile",
    "background,tile,avatar,title",
    "background,tile,avatar,fallbackGround",
  ])
    assert.throws(() => frameLayers(value));
  assert.throws(
    () => frameProbeOptions(args, { ...env, PROBE_FRAME_LAYERS: undefined }),
    /PROBE_FRAME_LAYERS/,
  );
});
test("keyboard plans project safe keys only, reject arbitrary commands/timings and enforce diagnostic budgets", () => {
  assert.deepEqual(readPlayPlan(plan), plan);
  for (const value of [
    null,
    {},
    { ...plan, steps: [] },
    { ...plan, reward: { money: "false", value: 1 } },
    { ...plan, steps: [{ kind: "send", message: { t: "move", x: 100, y: 100 } }] },
    { ...plan, steps: [{ kind: "hold", keys: ["Delete"], durationMs: 1 }] },
    { ...plan, steps: [{ kind: "hold", keys: ["Control", "Control"], durationMs: 1 }] },
    { ...plan, steps: [{ kind: "hold", keys: ["ArrowLeft", "ArrowRight"], durationMs: 1 }] },
    { ...plan, steps: [{ kind: "await", event: "login", timeoutMs: 1 }] },
    { ...plan, steps: [{ kind: "hold", keys: ["Alt"], durationMs: 10001 }] },
    {
      ...plan,
      steps: Array.from({ length: 13 }, () => ({
        kind: "hold",
        keys: ["Control"],
        durationMs: 10000,
      })),
    },
  ])
    assert.throws(() => readPlayPlan(value));
  for (const time of [0, -1, NaN, Infinity, 0.5, "100"])
    assert.throws(() =>
      readPlayPlan({ ...plan, steps: [{ kind: "await", event: "loot", timeoutMs: time }] }),
    );
});
test("held keys are released on success, partial press failure, timeout, and even a failed key-up", async () => {
  const calls: string[] = [];
  const keyboard = {
    async down(key: string) {
      calls.push(`down:${key}`);
      if (key === "Alt") throw Error("press failed");
    },
    async up(key: string) {
      calls.push(`up:${key}`);
      if (key === "ArrowRight") throw Error("release failed");
    },
  };
  await holdPlayKeys(keyboard, { kind: "hold", keys: ["Control"], durationMs: 5 }, async (ms) => {
    calls.push(`wait:${ms}`);
  });
  assert.deepEqual(calls, ["down:Control", "wait:5", "up:Control"]);
  calls.length = 0;
  await assert.rejects(
    holdPlayKeys(
      keyboard,
      { kind: "hold", keys: ["Control", "Alt"], durationMs: 5 },
      async () => {},
    ),
    AggregateError,
  );
  assert.deepEqual(calls, ["down:Control", "down:Alt", "up:Control"]);
  calls.length = 0;
  await assert.rejects(
    holdPlayKeys(
      keyboard,
      { kind: "hold", keys: ["Control", "ArrowRight"], durationMs: 5 },
      async () => {
        throw Error("timeout");
      },
    ),
    AggregateError,
  );
  assert.deepEqual(calls, ["down:Control", "down:ArrowRight", "up:ArrowRight", "up:Control"]);
});
test("item play evidence links target/template, same drop and self pickup to matching notice and increased inventory", () => {
  const evidence = playCycle(trace(), plan, 902, 3);
  assert.ok(evidence);
  assert.deepEqual([evidence.mobId, evidence.dropId, evidence.update], [44, 55, 8]);
  assert.equal(playCycle(trace(), plan, 903, 3), undefined);
  assert.equal(playCycle(trace(), { ...plan, targetTemplateId: 999 }, 902, 3), undefined);
  assert.equal(playCycle(trace(), { ...plan, combatMapId: 999 }, 902, 3), undefined);
  assert.equal(
    playCycle(trace(), plan, 902, 6),
    undefined,
    "old combat/reward cannot satisfy a fresh scenario",
  );
  for (const kind of ["hit", "mob-die", "mob-enter", "drop-leave", "loot"] as const)
    assert.equal(
      playCycle(
        trace().filter((p) => p.t !== kind),
        plan,
        902,
        3,
      ),
      undefined,
      kind,
    );
});
test("meso pickup requires fresh increased wallet, NOT an old inventory packet", () => {
  const moneyPlan = { ...plan, reward: { money: true, value: 120 } };
  assert.ok(playCycle(trace(true), moneyPlan, 902, 3));
  assert.equal(
    playCycle(
      trace(true).filter((p) => p.t !== "self"),
      moneyPlan,
      902,
      3,
    ),
    undefined,
  );
  assert.equal(
    playCycle(
      trace(true).map((p) => (p.t === "self" ? { ...p, self: { ...p.self, mesos: 100 } } : p)),
      moneyPlan,
      902,
      3,
    ),
    undefined,
  );
});
test("stale/unchanged inventory, wrong notice, vanished/other-player pickup, field transitions and wrong mob sources cannot pass", () => {
  const variants: ProbePacket[][] = [
    trace().map((p) => (p.t === "field" ? { ...p, characterId: 999 } : p)),
    trace().map((p) =>
      p.t === "hit"
        ? { t: "mob-die", mobId: p.mobId, at: 0, sequence: p.sequence }
        : p.t === "mob-die"
          ? { t: "hit", mobId: p.mobId, damage: 12, at: 0, sequence: p.sequence }
          : p,
    ),
    trace().map((p) => (p.t === "inventory" ? { ...p, inventory: inventory(2) } : p)),
    trace().map((p) => (p.t === "drop-leave" ? { ...p, reason: "vanished" } : p)),
    trace().map((p) => (p.t === "drop-enter" ? { ...p, drop: { ...p.drop, mobId: 999 } } : p)),
    trace().map((p) =>
      p.t === "loot" ? { ...p, notice: { kind: "item", itemId: 999, count: 1 } } : p,
    ),
    trace().map((p) => (p.t === "hit" ? { ...p, damage: 0 } : p)),
    trace().map((p) =>
      p.sequence === 8 ? { t: "field", mapId: 100000000, self, at: 0, sequence: 8 } : p,
    ),
  ];
  for (const rows of variants) assert.equal(playCycle(rows, plan, 902, 3), undefined);
  assert.throws(
    () => playCycle([...trace(), { ...trace()[0]!, sequence: 1 }], plan, 902, 3),
    /sequence/,
    "trailing corruption must be checked even after a valid cycle",
  );
  assert.throws(() => playCycle([...trace().slice(0, 3), trace()[2]!], plan, 902, 3), /sequence/);
});
const draw = (changes: Partial<ProbeDraw> = {}): ProbeDraw => ({
  frame: 1,
  target: 2,
  targetGeneration: 0,
  targetId: "",
  sourceSize: [40, 40],
  alpha: 1,
  src: "http://fixture/api/png/Map/Tile/test.img/0",
  args: [0, 0],
  canvas: [800, 600],
  matrix: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
  ...changes,
});
const present = (changes: Partial<ProbeDraw> = {}) =>
  draw({
    target: 1,
    targetId: "view",
    src: "",
    sourceCanvas: 2,
    sourceGeneration: 0,
    sourceSize: [800, 600],
    ...changes,
  });
test("frame evidence requires actual presentation from the same source canvas in the same RAF", () => {
  assert.ok(analyzeFrame([draw(), present()], "http://fixture", ["tile"]));
  for (const rows of [
    [draw()],
    [draw({ frame: 0 }), present()],
    [draw({ frame: 2 }), present()],
    [draw(), present({ sourceGeneration: 1 })],
    [draw({ target: 3 }), present()],
    [present(), draw()],
    [draw({ alpha: 0 }), present()],
    [draw({ sourceSize: [0, 0] }), present()],
    [draw({ src: "blob:fake" }), present()],
    [draw({ src: "http://fixture/api/png/%zz" }), present()],
    [draw(), present({ args: [800, 0] })],
    [draw({ args: [200, 0] }), present({ args: [799, 0] })],
    [draw({ args: [80, 0, 20, 20, 0, 0, 20, 20] }), present()],
    [
      draw({ args: [30, 0, 20, 20, 0, 0, 20, 20] }),
      present({ args: [15, 0, 10, 10, 0, 0, 10, 10] }),
    ],
    [draw(), present({ args: [0, 0, 0, 600] })],
    [draw({ src: "http://other/api/png/Map/Tile/test" }), present()],
  ])
    assert.equal(analyzeFrame(rows, "http://fixture", ["tile"]), undefined);
});
test("frame evidence intersects transformed draw bounds with the presented crop and actual view", () => {
  assert.equal(
    analyzeFrame([draw({ args: [900, 0] }), present()], "http://fixture", ["tile"]),
    undefined,
  );
  assert.ok(
    analyzeFrame(
      [draw({ matrix: { a: -1, b: 0, c: 0, d: 1, e: 40, f: 0 } }), present()],
      "http://fixture",
      ["tile"],
    ),
  );
  assert.equal(
    analyzeFrame([draw(), present({ args: [50, 50, 20, 20, 0, 0, 20, 20] })], "http://fixture", [
      "tile",
    ]),
    undefined,
  );
});
