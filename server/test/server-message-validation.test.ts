import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SERVER_MESSAGE_VALIDATED_TYPES,
  SERVER_MESSAGE_VALIDATION_GAPS,
  validateServerMessagePayload,
} from "../../client/server-message-validation.ts";

const self = {
  characterId: 7,
  name: "preview",
  gender: 0,
  level: 1,
  job: 0,
  str: 4,
  dex: 4,
  int: 4,
  luk: 4,
  ap: 0,
  sp: 0,
  fame: 0,
  hp: 50,
  maxHp: 50,
  mp: 50,
  maxMp: 50,
  exp: 0,
  expToNext: 15,
  mesos: 0,
  mapId: 101000000,
  spawnPortalIndex: 0,
  face: 20000,
  hair: 30000,
  avatarItems: [30000],
};

const equipStats = {
  str: 0,
  dex: 0,
  int: 0,
  luk: 0,
  maxHp: 0,
  maxMp: 0,
  pad: 0,
  mad: 0,
  pdd: 0,
  mdd: 0,
  acc: 0,
  eva: 0,
  craft: 0,
  speed: 0,
  jump: 0,
};

const wornEquip = {
  slot: 11,
  itemId: 1302000,
  ruc: 7,
  cuc: 0,
  cash: false,
  stats: equipStats,
};

function validCharacterSummary() {
  return {
    id: 7,
    name: "preview",
    level: 1,
    job: 0,
    face: 20000,
    hair: 30000,
    hp: 50,
    maxHp: 50,
    mp: 50,
    maxMp: 50,
    exp: 0,
    mesos: 0,
    mapId: 101000000,
    str: 4,
    dex: 4,
    int: 4,
    luk: 4,
    items: [1302000],
  };
}

function validStatBasisMessage() {
  return {
    t: "stat-basis",
    basis: {
      basic: { job: 0, level: 1, str: 4, dex: 4, int: 4, luk: 4, maxHp: 50, maxMp: 50 },
      secondary: {
        pad: 0,
        pdd: 0,
        mad: 4,
        mdd: 4,
        acc: 6,
        eva: 3,
        hands: 12,
        speed: 100,
        jump: 100,
      },
      weaponId: 1302000,
      effectiveSlots: [11],
    },
    shotRange: 200,
    wornFacts: [
      {
        slot: 11,
        itemId: 1302000,
        stats: { str: 0, dex: 0, int: 0, luk: 0, pad: 0 },
        ruc: 7,
        cuc: 0,
        requirements: { level: 0, job: 0, str: 0, dex: 0, int: 0, luk: 0 },
      },
    ],
    ammoPad: 0,
  };
}

function validFieldMessage() {
  return {
    t: "field",
    mapId: 101000000,
    contactField: 2,
    playerMenu: true,
    partyInviteIdentity: false,
    socialCommands: true,
    trade: true,
    self,
    users: [
      {
        characterId: 8,
        name: "other",
        face: 20000,
        avatarItems: [30000],
        x: 12,
        y: -4,
        action: 0,
        foothold: 1,
      },
    ],
    mobs: [{ mobId: 10, templateId: 130101, x: 60, y: -40, facing: 0 }],
    npcs: [
      {
        npcId: 20,
        templateId: 1012000,
        x: 100,
        y: 0,
        facing: 1,
        present: true,
        controlled: false,
      },
    ],
  };
}

test("validation coverage and remaining nested-union gaps are explicit", () => {
  assert.equal(SERVER_MESSAGE_VALIDATED_TYPES.has("login"), true);
  assert.equal(SERVER_MESSAGE_VALIDATED_TYPES.has("field"), true);
  assert.equal(SERVER_MESSAGE_VALIDATED_TYPES.has("stat-basis"), true);
  assert.equal(SERVER_MESSAGE_VALIDATED_TYPES.has("unknown"), true);
  assert.equal(SERVER_MESSAGE_VALIDATED_TYPES.has("trade"), false);
  assert.equal(SERVER_MESSAGE_VALIDATED_TYPES.has("messenger"), false);
  assert.deepEqual(SERVER_MESSAGE_VALIDATION_GAPS, ["trade", "messenger"]);
  assert.equal(validateServerMessagePayload({ t: "unknown", opcode: 0x42, bytes: 3 }), true);
  assert.equal(validateServerMessagePayload({ t: "unknown", opcode: 0x100, bytes: 3 }), false);
  assert.equal(validateServerMessagePayload({ t: "future-event" }), true);
});

test("login, character-list and account-control payloads reject malformed fields", () => {
  assert.equal(
    validateServerMessagePayload({
      t: "login",
      result: 0,
      gender: 0,
      worlds: [{ name: "Scania", unknownId: 1 }],
    }),
    true,
  );
  assert.equal(
    validateServerMessagePayload({
      t: "login",
      result: 0,
      gender: 0,
      worlds: [{ name: "Scania", unknownId: "1" }],
    }),
    false,
  );
  assert.equal(
    validateServerMessagePayload({
      t: "characters",
      result: 0,
      characters: [validCharacterSummary()],
    }),
    true,
  );
  assert.equal(
    validateServerMessagePayload({
      t: "characters",
      result: 0,
      characters: [{ ...validCharacterSummary(), hp: -1 }],
    }),
    false,
  );
  assert.equal(
    validateServerMessagePayload({ t: "created", ok: true, name: "newbie", id: 9 }),
    true,
  );
  assert.equal(
    validateServerMessagePayload({ t: "created", ok: false, name: "newbie", reason: "taken" }),
    true,
  );
  assert.equal(
    validateServerMessagePayload({ t: "created", ok: true, name: "newbie", reason: "bad" }),
    false,
  );
  assert.equal(
    validateServerMessagePayload({ t: "name-checked", name: "newbie", result: -1 }),
    true,
  );
  assert.equal(validateServerMessagePayload({ t: "deleted", id: 9, ok: false }), true);
  assert.equal(validateServerMessagePayload({ t: "error", message: "request failed" }), true);
  assert.equal(validateServerMessagePayload({ t: "error", message: 3 }), false);
});

test("attack, collision and stat-basis payloads validate discriminators and numeric ranges", () => {
  assert.equal(
    validateServerMessagePayload({
      t: "touch-result",
      contactId: 1,
      contactField: 2,
      accepted: true,
      damage: 0,
    }),
    true,
  );
  assert.equal(
    validateServerMessagePayload({
      t: "touch-result",
      contactId: 1,
      contactField: 2,
      accepted: false,
      retryAfterMs: 250,
      message: "try again",
    }),
    true,
  );
  assert.equal(
    validateServerMessagePayload({
      t: "touch-result",
      contactId: 1,
      contactField: 2,
      accepted: true,
      damage: 10_000,
    }),
    false,
  );
  assert.equal(
    validateServerMessagePayload({
      t: "active-hit",
      attackToken: 3,
      skillId: 1001004,
      skillLevel: 1,
      mobId: 10,
      damages: [12, 0],
      contactField: 2,
    }),
    true,
  );
  assert.equal(
    validateServerMessagePayload({
      t: "active-hit",
      attackToken: 3,
      skillId: 1001004,
      skillLevel: 1,
      mobId: 10,
      damages: [12, "bad"],
      contactField: 2,
    }),
    false,
  );
  const trace = {
    weaponId: 1302000,
    action: 0,
    basePad: 10,
    temporaryPad: 0,
    ammoPad: 0,
    pad: 10,
    hitRoll: 5,
    mobEva: 1,
    levelDifference: 0,
    mastery: 0,
    raw: 2,
    afterLevel: 2,
    afterAttribute: 2,
    defense: 0,
    criticalMultiplier: 1,
    beforeClamp: 2,
    damage: 2,
    reason: "hit",
  };
  assert.equal(
    validateServerMessagePayload({
      t: "hit",
      attackToken: 4,
      mobId: 10,
      damage: 2,
      delayMs: 125,
      contactField: 2,
      trace,
    }),
    true,
  );
  assert.equal(
    validateServerMessagePayload({
      t: "hit",
      attackToken: 4,
      mobId: 10,
      damage: 3,
      delayMs: 125,
      contactField: 2,
      trace,
    }),
    false,
  );
  assert.equal(validateServerMessagePayload(validStatBasisMessage()), true);
  const malformedStats = validStatBasisMessage();
  malformedStats.basis.secondary.pad = Number.NaN;
  assert.equal(validateServerMessagePayload(malformedStats), false);
});

test("field snapshots, paths, temporary stats and simple events reject malformed nested data", () => {
  assert.equal(validateServerMessagePayload(validFieldMessage()), true);
  assert.equal(
    validateServerMessagePayload({ ...validFieldMessage(), self: { ...self, mapId: "bad" } }),
    false,
  );
  const path = {
    originX: 1,
    originY: 2,
    elements: [{ attr: 0, x: 10, y: 20, vx: 0, vy: 0, action: 0, foothold: 1, duration: 100 }],
  };
  assert.equal(
    validateServerMessagePayload({
      t: "user-move",
      characterId: 8,
      x: 10,
      y: 20,
      action: 0,
      foothold: 1,
      path,
      local: false,
    }),
    true,
  );
  assert.equal(
    validateServerMessagePayload({
      t: "user-move",
      characterId: 8,
      x: 10,
      y: 20,
      action: 0,
      foothold: 1,
      path: { ...path, elements: [{ ...path.elements[0], duration: -1 }] },
    }),
    false,
  );
  assert.equal(
    validateServerMessagePayload({
      t: "temporary-stat",
      update: {
        durationMs: 1000,
        sourceId: 2002000,
        sourceIsSkill: false,
        values: { speed: 10, jump: 5 },
      },
    }),
    true,
  );
  assert.equal(
    validateServerMessagePayload({
      t: "temporary-stat",
      update: {
        durationMs: 1000,
        sourceId: 2002000,
        sourceIsSkill: false,
        values: { invented: 10 },
      },
    }),
    false,
  );
  assert.equal(
    validateServerMessagePayload({
      t: "user-attack",
      characterId: 8,
      skillId: 0,
      skillLevel: 0,
      facingLeft: false,
      shoot: false,
      afterimage: 0,
      action: 0,
      speed: 4,
      projectileItemId: 0,
      targets: [{ mobId: 10, hitAnimation: -1, damages: [12] }],
    }),
    true,
  );
  assert.equal(
    validateServerMessagePayload({ t: "user-emotion", characterId: 8, emotion: -1 }),
    false,
  );
});

test("inventory, shop, NPC dialogue, party and feedback payloads use their local shapes", () => {
  const inventory = {
    worn: [wornEquip],
    wornCash: [],
    tabs: [
      { tab: 1, capacity: 24, items: [wornEquip] },
      { tab: 2, capacity: 24, items: [{ slot: 1, itemId: 2000000, quantity: 10 }] },
      { tab: 3, capacity: 24, items: [] },
      { tab: 4, capacity: 24, items: [] },
    ],
  };
  assert.equal(validateServerMessagePayload({ t: "inventory", inventory, ack: true }), true);
  assert.equal(
    validateServerMessagePayload({
      t: "inventory",
      inventory: { ...inventory, tabs: inventory.tabs.slice(1) },
    }),
    false,
  );
  assert.equal(
    validateServerMessagePayload({
      t: "shop-open",
      shop: {
        shopId: 4,
        items: [{ itemId: 2000000, price: 50, maxCount: 100 }],
        rechargeables: [{ itemId: 2070000, unitPrice: 1, maxCount: 1000 }],
      },
    }),
    true,
  );
  assert.equal(
    validateServerMessagePayload({
      t: "npc-say",
      npcId: 20,
      message: "How many?",
      body: { kind: "askNumber", message: "How many?", defaultValue: 1, min: 1, max: 50 },
    }),
    true,
  );
  assert.equal(
    validateServerMessagePayload({
      t: "npc-say",
      npcId: 20,
      message: "Choose",
      body: { kind: "askNumber", message: "Choose", defaultValue: 1, min: 0, max: "many" },
    }),
    false,
  );
  const members = Array.from({ length: 6 }, (_, index) => ({
    characterId: index + 1,
    name: `p${index}`,
  }));
  assert.equal(
    validateServerMessagePayload({ t: "party", result: { kind: "sync", partyId: 3, members } }),
    true,
  );
  assert.equal(
    validateServerMessagePayload({
      t: "party",
      result: { kind: "sync", partyId: 3, members: members.slice(0, 5) },
    }),
    false,
  );
  assert.equal(
    validateServerMessagePayload({ t: "system-notice", type: 1, text: "Welcome" }),
    true,
  );
  assert.equal(
    validateServerMessagePayload({
      t: "loot",
      notice: { kind: "item", itemId: 2000000, count: 1 },
    }),
    true,
  );
  assert.equal(
    validateServerMessagePayload({ t: "loot", notice: { kind: "item", itemId: "bad", count: 1 } }),
    false,
  );
});

test("drop guards preserve valid optional blocks and reject malformed removals", () => {
  assert.equal(
    validateServerMessagePayload({
      t: "drop-enter",
      drop: { kind: 2, dropId: 5, money: true, value: 10, x: -1, y: 0 },
    }),
    true,
  );
  assert.equal(
    validateServerMessagePayload({
      t: "drop-enter",
      drop: { kind: 0, dropId: 5, money: false, value: 10, x: 0, y: 0 },
    }),
    false,
  );
  assert.equal(
    validateServerMessagePayload({ t: "drop-leave", dropId: 5, reason: "taken", characterId: 7 }),
    true,
  );
  assert.equal(
    validateServerMessagePayload({ t: "drop-leave", dropId: 5, reason: "taken" }),
    false,
  );
});
