/** Regression SOURCES ONLY. Not run/typechecked/browser-validated, at the user's request. */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WzNode, WzCanvas, type WzEntry } from "../src/wz/img.ts";
import { WzArchive, type FootholdSegment } from "../src/wz/archive.ts";
import { mapDataFrom, loadMapData } from "../src/game/map.ts";
import {
  MobField,
  mobMoveAbility,
  mobTemplateProvider,
  loadMobTemplate,
  type MobTemplate,
} from "../src/game/mobs.ts";
import { PacketReader } from "../src/protocol/packet.ts";
import { readMobMove } from "../src/protocol/mob.ts";
import { planMobAirPath, mobLocomotion } from "../../client/mobmotion.ts";
import { backgroundDrift, backgroundLayout } from "../../client/background.ts";

import {
  beginPath,
  sampleMotion,
  collisionWorld,
  animationPose,
  actionOf,
  remoteStance,
  actorDepth,
} from "../../client/motion.ts";
import { artReaderOf, type ArtReader, type CanvasArt } from "../src/game/wzart.ts";
import { composeAvatarBitmap } from "../src/game/avatar.ts";
import { mobArtOf } from "../src/game/sprites.ts";
import { mapBacks } from "../src/game/mapart.ts";
import { mobActionImagePath } from "../src/wz/paths.ts";

const props = (...pairs: [string, unknown][]) =>
  new WzNode(
    "props",
    pairs.map(([name, value]) => ({ name, type: 9, value }) as WzEntry),
  );
const data = fileURLToPath(new URL("../../Data.wz", import.meta.url));
const needsWz = { skip: !existsSync(data) };
const floor: FootholdSegment = {
  id: 1,
  x1: -1000,
  x2: 1000,
  y1: 100,
  y2: 100,
  prev: 0,
  next: 0,
  layer: 2,
  group: 3,
};
const jumpTemplate: MobTemplate = {
  templateId: 1210102,
  name: "주황버섯",
  level: 8,
  maxHP: 80,
  maxMP: 0,
  exp: 15,
  speedPercent: 100,
  moveAbility: 2,
  dieMs: 180,
};
const fixture = (ability: 0 | 1 | 2 | 3 = 2) => {
  const map = mapDataFrom(
    {
      info: {},
      foothold: 1,
      ladderRope: 0,
      portal: [],
      life: [
        {
          type: "m",
          id: "1210102",
          x: 0,
          y: 100,
          fh: 1,
          rx0: -800,
          rx1: 800,
          cy: 100,
        },
      ],
    },
    1,
  );
  const field = new MobField({
    map,
    footholds: new Map([[1, floor]]),
    template: () => ({ ...jumpTemplate, moveAbility: ability }),
    behavior: "roam",
    random: () => 0,
  });
  return field;
};

test("48D080 classifies action subtrees; jump-only fails, fly wins, info.jump is not an ability", () => {
  assert.equal(mobMoveAbility(props(["info", props(["jump", 200])])), 0);
  assert.equal(mobMoveAbility(props(["move", props()])), 1);
  assert.equal(mobMoveAbility(props(["jump", props()])), undefined);
  assert.equal(mobMoveAbility(props(["jump", props()], ["move", props()])), 2);
  assert.equal(mobMoveAbility(props(["fly", props()], ["jump", props()])), 3);
});

test("ordinary jump uses a real gravity path and terminal zero-duration landing, not a sine sprite offset", () => {
  const points = planMobAirPath({ x: 0, y: 100, foothold: 1, facing: 0 }, [floor], {
    direction: 0,
    speedPxPerSecond: 125,
    launch: true,
  });
  assert.ok(points.length > 10);
  assert.equal(points[0]!.action, 4);
  assert.equal(points[0]!.foothold, 0);
  assert.ok(points[0]!.vy < 0);
  assert.ok(points.some((point) => point.y < 30));
  assert.ok(points.some((point) => point.vy > 0));
  assert.ok(points.every((point) => point.duration >= 0 && point.duration <= 30));
  const landing = points.findIndex((point) => point.foothold !== 0);
  assert.ok(landing > 0);
  assert.equal(points[landing]!.duration, 0);
  assert.ok(points.slice(0, landing).every((point) => point.foothold === 0));
  assert.ok(points.slice(landing).every((point) => point.foothold === 1));
  assert.deepEqual(
    [points.at(-1)!.y, points.at(-1)!.foothold, points.at(-1)!.duration, points.at(-1)!.action],
    [100, 1, 0, 2],
  );
  const moving = planMobAirPath({ x: 0, y: 100, foothold: 1, facing: 1, vx: -125 }, [floor], {
    direction: -1,
    speedPxPerSecond: 125,
    launch: true,
  });
  assert.ok(moving.at(-1)!.x < -50);
  assert.ok(moving.every((point) => (point.action & 1) === 1));
});

test("descending jump lands on the first crossed upper platform; air sampling must not pin to its floor", () => {
  const upper = { ...floor, id: 2, x1: 10, x2: 300, y1: 60, y2: 60 };
  const points = planMobAirPath({ x: 0, y: 100, foothold: 1, facing: 0, vx: 125 }, [floor, upper], {
    direction: 1,
    speedPxPerSecond: 125,
    launch: true,
  });
  assert.equal(points.at(-1)!.foothold, 2);
  assert.equal(points.at(-1)!.y, 60);
  const entity = { x: 0, y: 100 };
  beginPath(entity, { elements: points }, 0);
  sampleMotion(entity, 250, collisionWorld({ footholds: [floor, upper] }));
  assert.ok(entity.y < 60, "do not apply ground projection to a jump interval");
  const total = points.reduce((sum, point) => sum + point.duration, 0);
  sampleMotion(entity, total, collisionWorld({ footholds: [floor, upper] }));
  assert.equal(entity.y, 60);
});

test("53DAA0 jump survives wire encode/decode, server sampling, late join, death and original-spawn respawn", () => {
  const field = fixture();
  const packet = field.movePackets(0)[0]!;
  const body = readMobMove(new PacketReader(packet, 1)).body;
  assert.equal(body.actionByte, 4);
  assert.equal(body.path.elements[0]!.foothold, 0);
  assert.equal(field.mobs[0]!.decisionAt, undefined, "jump must not create a new roam timer");
  field.movePackets(250);
  const mob = field.mobs[0]!;
  assert.ok(mob.y < 40);
  assert.equal(mob.foothold, 0);
  const resume = readMobMove(new PacketReader(field.resumePackets()[0]!, 1)).body;
  assert.equal(resume.actionByte, 4);
  assert.equal(resume.path.elements.at(-1)!.foothold, 1);
  assert.equal(resume.path.elements.at(-1)!.duration, 0);
  assert.equal(field.applyDamage(mob.mobId, 80, 250)!.killed, true);
  assert.equal(field.resumePackets().length, 0);
  assert.equal(field.movePackets(400).length, 0);
  field.lifecyclePackets(mob.respawnAt);
  assert.deepEqual(
    [mob.x, mob.y, mob.foothold, mob.intent, mob.velocity],
    [0, 100, 1, undefined, undefined],
  );
  assert.equal(fixture(0).movePackets(0).length, 0, "stationary templates must not ground-roam");
  assert.equal(fixture(3).movePackets(0).length, 0, "do not invent ground roaming for flyers");
});

test("mob rendering uses mob jump action 2/facing bit; fly art is not mistaken for ground walking", () => {
  const actions = { jump: [{}], move: [{}], stand: [{}] };
  assert.equal(mobLocomotion({ action: 4 }, actions), "jump");
  assert.equal(mobLocomotion({ action: 5 }, actions), "jump");
  assert.equal(mobLocomotion({ action: 0 }, actions), "move");
  assert.equal(mobLocomotion({ action: 2 }, actions), "stand");
  assert.equal(mobLocomotion({ action: 2 }, { fly: [{}] }), "fly");
});

test("46BDA0 + Shape2D 10010C40 accumulates type4 100px periods, in both directions, not ping-pong", () => {
  assert.equal(backgroundDrift(-5, 0), 0);
  assert.equal(backgroundDrift(-5, 2000), 50);
  assert.equal(backgroundDrift(-5, 4000), 100);
  assert.equal(backgroundDrift(-5, 6000), 150);
  assert.equal(backgroundDrift(5, 6000), -150);
  assert.equal(backgroundDrift(0, 6000), 0);
  const back = { x: -16, y: -184, rx: -5, ry: -5, type: 4, cx: 0, cy: 0, ox: 0, oy: 0 };
  const a = backgroundLayout(back, 500, 200, 0, 0, 0);
  const b = backgroundLayout(back, 500, 200, 300, 100, 0);
  assert.equal(a.x, b.x, "type4 x ratio is zero, NOT rx parallax");
  assert.equal(b.y - a.y, -5, "ry remains vertical parallax");
  const c = backgroundLayout(back, 500, 200, 0, 0, 2000);
  assert.equal(c.x - a.x, 50);
  assert.equal(a.rows, 1);
  assert.equal(
    backgroundLayout({ ...back, type: 5 }, 500, 200, 0, 0, 0).rows,
    1,
    "5's low bits mean horizontal, not vertical auto-scroll",
  );
  assert.ok(backgroundLayout({ ...back, type: 6 }, 500, 200, 0, 0, 0).rows > 1);
});

test("427BF0/40D950 idle has mirrored middle frame, walks retain four frames", () => {
  const idle: Record<string, unknown> = {};
  const options = {
    profile: {
      actions: { stand1: { frames: [0, 1, 2, 1].map((index) => ({ index, delay: 500 })) } },
    },
  };
  const frames = [0];
  animationPose(idle, "stand1", false, 0, options);
  for (let now = 30; now <= 2040; now += 30) {
    const pose = animationPose(idle, "stand1", false, now, options);
    if (now % 510 === 0) frames.push(pose.frame);
  }
  assert.deepEqual(frames, [0, 1, 2, 1, 0]);
});

/** Minimal explicit ArtReader: colored single pixels make anchor identity independent of z. */
test("attack armOverHair/armBelowHead publishes the same hand as arm without changing native draw depth", () => {
  for (const z of ["arm", "armOverHair", "armBelowHead"])
    for (const flip of [false, true]) {
      const nodes = new Map<string, WzNode>(),
        arts = new Map<string, CanvasArt>();
      const add = (
        path: string,
        color: number[],
        anchors: [string, [number, number]][],
        depth: string,
      ) => {
        const entries: WzEntry[] = [
          {
            name: "map",
            type: 9,
            value: props(
              ...anchors.map(([name, xy]) => [name, new WzNode("vector", xy)] as [string, unknown]),
            ),
          },
        ];
        nodes.set(
          path,
          new WzNode(
            "canvas",
            new WzCanvas({
              width: 1,
              height: 1,
              format: 2,
              pad: 0,
              flag: 0,
              props: entries,
              pixelRaw: new Uint8Array(),
              pixels: Uint8Array.from(color),
              offset: 0,
              end: 0,
            }),
          ),
        );
        arts.set(path, {
          png: new Uint8Array(),
          rgba: Uint8Array.from(color),
          width: 1,
          height: 1,
          ox: 0,
          oy: 0,
          z: depth,
        });
      };
      const base = "Character/00002000.img/swingO1/0";
      nodes.set("Character/00002000.img/swingO1", props());
      nodes.set(base, props(["body", 0], ["arm", 0], ["face", 0]));
      add(`${base}/body`, [0, 255, 0, 255], [["navel", [0, 0]]], "body");
      add(
        `${base}/arm`,
        [0, 0, 255, 255],
        [
          ["navel", [-10, 0]],
          ["hand", [2, 0]],
        ],
        z,
      );
      const weapon = "Character/Weapon/01302000.img/swingO1/0";
      nodes.set(weapon, props(["weapon", 0]));
      add(`${weapon}/weapon`, [255, 0, 0, 255], [["hand", [0, 0]]], "weapon");
      const reader: ArtReader = {
        at: (path) => arts.get(path),
        node: (path) => nodes.get(path),
        size: 0,
        clear() {},
      };
      const composed = composeAvatarBitmap(
        { has: () => false } as unknown as WzArchive,
        { faceId: 20000, hairId: 30000, items: [1302000] },
        {
          stance: "swingO1",
          frame: 0,
          flip,
          reader,
          ranks: new Map([
            ["body", 0],
            [z, 1],
            ["weapon", 2],
          ]),
        },
      )!;
      const x = (flip ? -12 : 12) - composed.dx,
        y = -composed.dy;
      assert.deepEqual(
        [
          ...composed.bitmap.data.subarray(
            (y * composed.bitmap.width + x) * 4,
            (y * composed.bitmap.width + x) * 4 + 4,
          ),
        ],
        [255, 0, 0, 255],
      );
    }
});

test(
  "actual 1210102 jump tree, body arm z and 104040000 moving clouds all exist in original Data.wz",
  needsWz,
  () => {
    const archive = WzArchive.open(data),
      reader = artReaderOf(archive)!;
    assert.equal(mobTemplateProvider(archive)(1210102)!.moveAbility, 2);
    assert.ok(mobArtOf(1210102, reader)!.actions.jump!.length);
    assert.equal(reader.at("Character/00002000.img/swingO1/1/arm")!.z, "armOverHair");
    assert.equal(reader.at("Character/00002000.img/swingO2/0/arm")!.z, "armBelowHead");
    const map = loadMapData(archive, 104040000)!;
    assert.ok(map.mobs.some((mob) => mob.templateId === 1210102));
    const back = mapBacks(archive.objects("Map/Map/104040000.img")[0], reader).find(
      (back) => back.type === 4,
    )!;
    assert.deepEqual([back.path, back.rx, back.ry], ["Map/Back/grassySoil.img/back/1", -5, -5]);
    assert.equal(mobActionImagePath(1210102, "0120100"), "Mob/0120100.img");
  },
);

test("browser wiring shares field clock and action selection, awaits selected attack PNGs and retains authorized-only warp", () => {
  const source = readFileSync(new URL("../../client/main.js", import.meta.url), "utf8");
  assert.ok(source.includes("drawBack(back, cameraX, cameraY, now)"));
  assert.ok(source.includes("mobLocomotion(mob, actions)"));
  assert.ok(source.includes("await Promise.all([...frames,...effects,...bullets]"));
  assert.ok(
    !source.includes("SWING_COOLDOWN_MS"),
    "native group0 rejects instead of fabricated 480ms attack",
  );
  const bridge = readFileSync(new URL("../src/net/webclient.ts", import.meta.url), "utf8");
  assert.ok(bridge.includes("if (!profile || !action) return;"));
  const html = readFileSync(new URL("../../client/index.html", import.meta.url), "utf8");
  assert.ok(html.includes('id="qa-jump-cloud"'));
  assert.ok(html.includes('maxlength="70"'));
});

test(
  "linked mob takes action ability/death/art but not HP/name/speed/bodyAttack from its source",
  needsWz,
  () => {
    const original = WzArchive.open(data);
    const path = "Mob/7777777.img";
    const info = props(
      ["link", "1210102"],
      ["name", "linked fixture"],
      ["maxHP", 1234],
      ["maxMP", 7],
      ["speed", -20],
      ["bodyAttack", 0],
    );
    const source = {
      has: (p: string) => p === path || original.has(p),
      objects: (p: string) =>
        p === path
          ? [{ cls: "Property", offset: 0, end: 0, props: props(["info", info]).props }]
          : original.objects(p),
    } as WzArchive;
    const template = loadMobTemplate(source, 7777777)!;
    assert.deepEqual(
      [
        template.maxHP,
        template.maxMP,
        template.name,
        template.speedPercent,
        template.bodyAttack,
        template.moveAbility,
      ],
      [1234, 7, "linked fixture", 80, false, 2],
    );
    assert.ok(template.dieMs > 0);
    const art = mobArtOf(7777777, artReaderOf(source)!)!;
    assert.equal(art.bodyAttack, false);
    assert.equal(art.actions.jump![0]!.path, "Mob/1210102.img/jump/0");
  },
);

test("508FC0 movement states are not doubled avatar-action ids; mob hit1 is NOT a user ladder", () => {
  assert.equal(actionOf({ grounded: true, vx: 125, moveX: -1, facing: 1 }), 3);
  assert.equal(actionOf({ grounded: true, vx: 0, facing: 0 }), 4);
  assert.equal(actionOf({ grounded: false, vx: 0, facing: 1 }), 7);
  assert.equal(actionOf({ ladder: { ladder: true }, facing: 0 }), 14);
  assert.equal(actionOf({ ladder: { ladder: false }, facing: 0 }), 16);
  assert.equal(actionOf({ dead: true, facing: 0 }), 18);
  assert.equal(remoteStance({ action: 6 }), "jump");
  assert.equal(remoteStance({ action: 15 }), "ladder");
  assert.equal(remoteStance({ action: 17 }), "rope");
  assert.equal(remoteStance({ action: 8 }), "alert");
  const world = collisionWorld({
    footholds: [floor],
    ladders: [{ id: 7, x: 0, y1: 0, y2: 120, page: 5, ladder: true }],
  });
  const mob = { x: 0, y: 50, action: 14, foothold: 0, layer: 2, group: 3 };
  const user = { ...mob };
  assert.equal(actorDepth(mob, world, "mob"), 70002);
  assert.equal(actorDepth(user, world, "user"), 160008);
});
