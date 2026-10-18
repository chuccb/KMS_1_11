/**
 * The picture pipeline: WZ canvases -> placements -> pixels.
 *
 * These tests exist because the renderer has no other way to be wrong *visibly* in CI: a browser
 * test would only say "a canvas painted something". The pieces below are the ones that silently
 * produce a wrong picture instead of an error, so each has a test that fails loudly:
 *
 *   - `drawCanvas` places a canvas by its origin, and mirrors it **around the origin** (the flip of
 *     an asymmetric sprite is the giveaway: a wrong pivot makes the character's sword jump);
 *   - an `origin` really is the anchor, so a canvas whose origin is not its centre lands where the
 *     archive says, not where its middle is;
 *   - a `uol` is followed relative to the node that holds it (a hair's `stand1/0/hair` is
 *     `../../default/hair`);
 *   - the map's draw depth is the client's own `30000 * layer - 10 * zM + z`, so a layer-0 object is
 *     behind a layer-1 one even when its `zM` is larger;
 *   - an avatar's parts hang off the **body's** anchors (`navel`, `neck`, `hand`, `brow`), so the
 *     head sits on the neck instead of on the feet; the real archive is used when it is checked out
 *     (the composite is checked for the body's own size, which is a number the WZ file cannot fake).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { WzArchive } from "../src/wz/archive.ts";
import { WzNode, WzCanvas, type WzEntry } from "../src/wz/img.ts";
import { encodePng } from "../src/wz/png.ts";
import { bitmapOf, boundsOf, cropBitmap, drawCanvas, type Bitmap } from "../src/game/raster.ts";
import {
  artReaderOf,
  frameNames,
  splitArtPath,
  uolTarget,
  type ArtSource,
} from "../src/game/wzart.ts";
import { mapArtFrom, mapBacks, mapSprites } from "../src/game/mapart.ts";
import {
  composeAvatar,
  lookOf,
  wornItemsOf,
  itemImagePath,
  characterFolderOf,
  faceImagePath,
  hairImagePath,
} from "../src/game/avatar.ts";
import { spriteFrames, npcImagePath, mobImagePath } from "../src/game/sprites.ts";

const DATA_WZ = fileURLToPath(new URL("../../Data.wz", import.meta.url));
const archive: WzArchive | null = existsSync(DATA_WZ) ? WzArchive.open(DATA_WZ) : null;
const needsArchive = { skip: archive === null };

// ---------------------------------------------------------------- raster

/** A canvas fixture: `width x height`, one opaque pixel at `(px, py)` and transparent elsewhere. */
function dotCanvas(
  width: number,
  height: number,
  px: number,
  py: number,
  rgba: [number, number, number] = [255, 0, 0],
): Bitmap {
  const bitmap = bitmapOf(width, height);
  const at = (py * width + px) * 4;
  bitmap.data[at] = rgba[0];
  bitmap.data[at + 1] = rgba[1];
  bitmap.data[at + 2] = rgba[2];
  bitmap.data[at + 3] = 255;
  return bitmap;
}

function pixelAt(bitmap: Bitmap, x: number, y: number): number[] {
  const at = (y * bitmap.width + x) * 4;
  return [...bitmap.data.subarray(at, at + 4)];
}

test("a canvas is placed by its origin: the origin pixel lands on the point", () => {
  const dst = bitmapOf(9, 9);
  const src = dotCanvas(3, 3, 1, 1);
  drawCanvas(dst, src, 4, 4, 1, 1); // origin (1,1) -> (4,4)
  assert.deepEqual(pixelAt(dst, 4, 4), [255, 0, 0, 255]);
  assert.deepEqual(pixelAt(dst, 4, 4), [255, 0, 0, 255]);
  assert.deepEqual(
    pixelAt(dst, 3, 3),
    [0, 0, 0, 0],
    "a transparent pixel leaves the destination alone",
  );
});

test("a flipped canvas mirrors around the origin, not around its own middle", () => {
  const dst = bitmapOf(9, 9);
  const src = dotCanvas(3, 3, 0, 1); // the dot is on the LEFT column
  drawCanvas(dst, src, 4, 4, 1, 1, 255, true);
  // Column 0 becomes column `originX + (originX - 0) = 2` at destination x = 4 + (1 - 0)... the pixel
  // lands at x = 4 + 1 - 0 = 5, y = 4 - 1 + 1 = 4.
  assert.deepEqual(pixelAt(dst, 5, 4), [255, 0, 0, 255]);
  assert.deepEqual(pixelAt(dst, 3, 4), [0, 0, 0, 0]);
});

test("alpha scales the source and source-over keeps the background visible", () => {
  const dst = bitmapOf(2, 2);
  for (let at = 0; at < dst.data.length; at += 4) {
    dst.data[at + 3] = 255;
    dst.data[at] = 0;
    dst.data[at + 1] = 0;
    dst.data[at + 2] = 255; // blue background
  }
  drawCanvas(dst, dotCanvas(1, 1, 0, 0), 0, 0, 0, 0, 128);
  const [r, g, b, a] = pixelAt(dst, 0, 0);
  assert.equal(a, 255, "an opaque background stays opaque");
  assert.ok(r > 100, `half a red pixel over blue should pull towards red (got ${r})`);
  assert.equal(g, 0);
  assert.ok(b < 200, "and the blue should be dimmed");
});

test("boundsOf and cropBitmap describe the drawn pixels, not the canvas", () => {
  const image = dotCanvas(6, 4, 2, 1);
  const bounds = boundsOf(image);
  assert.deepEqual(bounds, { left: 2, top: 1, right: 2, bottom: 1 });
  const cropped = cropBitmap(image, bounds!);
  assert.equal(cropped.width, 1);
  assert.equal(cropped.height, 1);
  assert.deepEqual(pixelAt(cropped, 0, 0), [255, 0, 0, 255]);
  assert.equal(boundsOf(bitmapOf(3, 3)), undefined, "nothing drawn is no bounds");
});

// ---------------------------------------------------------------- art paths

test("a UOL resolves relative to the node that holds it", () => {
  assert.deepEqual(uolTarget(["stand1", "0", "hair"], "../../default/hair"), ["default", "hair"]);
  assert.deepEqual(
    uolTarget(["front", "head"], "front/head"),
    ["front", "front", "head"],
    "a plain name appends",
  );
  assert.deepEqual(splitArtPath("Map/Tile/a.img/bsc/0"), {
    image: "Map/Tile/a.img",
    nodes: ["bsc", "0"],
  });
  assert.deepEqual(splitArtPath("Npc/1010100.img"), { image: "Npc/1010100.img", nodes: [] });
});

/** A tiny fake archive: image path -> a property list built from `entry` helpers. */
function props(...entries: (readonly [string, unknown])[]): WzNode {
  return new WzNode(
    "props",
    entries.map(([name, value]) => ({ name, type: 0, value })) as WzEntry[],
  );
}

/** A canvas node, the way the parser hands one out: `WzNode("canvas", <WzCanvas>)`. */
function canvasNode(canvas: WzCanvas): WzNode {
  return new WzNode("canvas", canvas);
}

function fakeCanvas(width: number, height: number, ox: number, oy: number): WzCanvas {
  const props = [
    { name: "origin", type: 9, value: new WzNode("vector", [ox, oy]) },
    { name: "z", type: 0, value: "body" },
  ] as WzEntry[];
  const pixels = new Uint8Array(width * height * 4);
  pixels[3] = 255; // one opaque pixel so `canvasToRgba` returns something
  return new WzCanvas({
    width,
    height,
    format: 1,
    pad: 0,
    flag: 0,
    props,
    pixelRaw: new Uint8Array(width * height * 2),
    pixels,
    offset: 0,
    end: 0,
  });
}

class FakeArchive implements ArtSource {
  readonly images = new Map<string, WzNode[]>();
  has(path: string): boolean {
    return this.images.has(path);
  }
  objects(path: string): never {
    return this.images.get(path)! as never;
  }
}

test("the art reader follows a UOL inside one image and caches what it decoded", () => {
  const fake = new FakeArchive();
  const hair = fakeCanvas(4, 2, 2, 1);
  fake.images.set("Character/Hair/x.img", [
    props(
      ["default", props(["hair", canvasNode(hair)])],
      ["stand1", props(["0", props(["hair", new WzNode("uol", "../../default/hair")])])],
    ),
  ]);
  const reader = artReaderOf(fake)!;
  const direct = reader.at("Character/Hair/x.img/default/hair");
  assert.equal(direct?.width, 4);
  assert.deepEqual([direct?.ox, direct?.oy], [2, 1]);
  assert.equal(direct?.z, "body");
  const viaUol = reader.at("Character/Hair/x.img/stand1/0/hair");
  assert.equal(viaUol, direct, "both paths are one cached canvas");
  assert.equal(reader.size, 1, "the UOL alias and its target share one cached canvas");
  assert.equal(reader.at("Character/Hair/x.img/nope"), undefined);
});

test("frameNames counts the archive's 0..n-1 frames", () => {
  const node = props(
    ["0", props(["delay", 180])],
    ["1", props(["delay", 180])],
    ["2", props(["delay", 300])],
  );
  assert.deepEqual(frameNames(node), ["0", "1", "2"]);
  assert.deepEqual(
    frameNames(props(["default", props()])),
    [],
    "a named folder is not a frame list",
  );
  assert.deepEqual(frameNames(props()), []);
});

// ---------------------------------------------------------------- map art

test("map sprites are ordered by the client's own depth: 30000 * layer - 10 * zM", () => {
  const fake = new FakeArchive();
  for (const path of ["Map/Tile/s.img/a/0", "Map/Obj/o.img/l0/l1/l2/0"]) {
    fake.images.set(path.includes("Tile") ? "Map/Tile/s.img" : "Map/Obj/o.img", []);
  }
  const tile = fakeCanvas(90, 60, 0, 0);
  const object = fakeCanvas(40, 40, 20, 40);
  fake.images.set("Map/Tile/s.img", [props(["a", props(["0", canvasNode(tile)])])]);
  fake.images.set("Map/Obj/o.img", [
    props(["l0", props(["l1", props(["l2", props(["0", canvasNode(object)])])])]),
  ]);
  const layer0 = props(
    ["info", props(["tS", "s"])],
    ["tile", props(["0", props(["x", 0], ["y", 0], ["u", "a"], ["no", 0], ["zM", 50])])],
  );
  const layer1 = props(
    ["info", props(["tS", "s"])],
    [
      "obj",
      props([
        "0",
        props(
          ["oS", "o"],
          ["l0", "l0"],
          ["l1", "l1"],
          ["l2", "l2"],
          ["x", 100],
          ["y", 200],
          ["z", 7],
          ["zM", 0],
          ["f", 1],
        ),
      ]),
    ],
  );
  const root = props(["0", layer0], ["1", layer1]);
  const reader = artReaderOf(fake)!;
  const sprites = mapSprites(root, reader);
  assert.equal(sprites.length, 2);
  assert.equal(sprites[0]!.kind, "tile", "layer 0 draws before layer 1 whatever zM says");
  assert.equal(sprites[0]!.z, -500);
  assert.equal(sprites[0]!.layer, 0);
  assert.equal(sprites[1]!.kind, "obj");
  assert.equal(sprites[1]!.z, 30000 + 7 - 17990);
  assert.equal(sprites[1]!.layer, 1);
  assert.equal(sprites[1]!.flip, true);
  assert.deepEqual(
    sprites[1]!.frames.map((frame) => frame.path),
    ["Map/Obj/o.img/l0/l1/l2/0"],
  );
});

test("a back entry keeps its canvas' origin and an entry with no image is dropped", () => {
  const fake = new FakeArchive();
  fake.images.set("Map/Back/grassySoil.img", [
    props(["back", props(["0", canvasNode(fakeCanvas(256, 256, 128, 128))])]),
  ]);
  const root = props([
    "back",
    props(
      ["0", props(["bS", "grassySoil"], ["no", 0], ["x", 10], ["y", 20], ["type", 3], ["a", 200])],
      ["1", props(["bS", "grassySoil"], ["no", 9], ["x", 0], ["y", 0])],
      ["2", props(["bS", ""], ["no", 0], ["x", 0], ["y", 0])],
    ),
  ]);
  const backs = mapBacks(root, artReaderOf(fake)!);
  assert.equal(backs.length, 1, "the missing canvas and the empty bS are skipped");
  assert.deepEqual(
    {
      path: backs[0]!.path,
      ox: backs[0]!.ox,
      oy: backs[0]!.oy,
      a: backs[0]!.a,
      type: backs[0]!.type,
    },
    { path: "Map/Back/grassySoil.img/back/0", ox: 128, oy: 128, a: 200, type: 3 },
  );
});

test("the map's art has the background stack and the layers of a real map", needsArchive, () => {
  const art = mapArtFrom(archive!.objects("Map/Map/100000000.img")[0], artReaderOf(archive!)!);
  assert.equal(art.backs.length, 8, "Henesys has eight background sheets");
  assert.ok(
    art.sprites.some((sprite) => sprite.kind === "tile"),
    "and a tiled ground",
  );
  assert.ok(
    art.sprites.some((sprite) => sprite.kind === "obj"),
    "and objects standing on it",
  );
  for (let index = 1; index < art.sprites.length; index++) {
    assert.ok(
      art.sprites[index - 1]!.z <= art.sprites[index]!.z,
      `sprite ${index} is drawn in depth order (${art.sprites[index - 1]!.z} > ${art.sprites[index]!.z})`,
    );
  }
  assert.ok(art.bounds.right > art.bounds.left && art.bounds.bottom > art.bounds.top);
  assert.equal(art.missingTiles, 0, "every tile Henesys places is in this Data.wz (woodMarble)");
});

test(
  "type-2 named tile sets are present and the Amherst ground is fully drawable",
  needsArchive,
  () => {
    const reader = artReaderOf(archive!)!;
    for (const set of ["darkCave", "darkWood", "dryRock", "grassySoil"]) {
      assert.ok(archive!.has(`Map/Tile/${set}.img`), set);
      assert.ok(reader.node(`Map/Tile/${set}.img`), set);
    }
    const art = mapArtFrom(archive!.objects("Map/Map/001000000.img")[0], reader);
    assert.equal(art.missingTiles, 0);
    assert.deepEqual(art.missingTileSets, []);
    assert.ok(
      art.sprites.some(
        (s) => s.kind === "tile" && s.frames[0]!.path.startsWith("Map/Tile/grassySoil.img/"),
      ),
    );
  },
);

test("the art reader does not discard complete level-4 background canvases", needsArchive, () => {
  const reader = artReaderOf(archive!)!;
  for (const name of ["dryRock", "midForest"]) {
    const art = reader.at(`Map/Back/${name}.img/back/0`);
    assert.ok(art, name);
    assert.equal(art.rgba.length, art.width * art.height * 4);
    assert.equal(art.rgba.at(-1), 255, "the bottom-right pixel is opaque, not missing");
  }
});

test(
  "all 100 maps resolve every placed ground tile in the checked-in Data.wz",
  needsArchive,
  () => {
    const reader = artReaderOf(archive!)!;
    const maps = archive!.images.filter((image) => image.path.startsWith("Map/Map/"));
    assert.equal(maps.length, 100);
    for (const image of maps) {
      const art = mapArtFrom(archive!.objects(image.path)[0], reader);
      assert.equal(art.missingTiles, 0, image.path);
      assert.deepEqual(art.missingTileSets, [], image.path);
    }
  },
);

// ---------------------------------------------------------------- avatar

test("an item id maps to its Character folder", () => {
  assert.equal(characterFolderOf(1040001), "Clothes");
  assert.equal(characterFolderOf(1060001), "Clothes");
  assert.equal(characterFolderOf(1071000), "Shoes");
  assert.equal(characterFolderOf(1082000), "Glove");
  assert.equal(characterFolderOf(1302000), "Weapon");
  assert.equal(characterFolderOf(1002000), "Cap");
  assert.equal(itemImagePath(1040001), "Character/Clothes/01040001.img");
  assert.equal(hairImagePath(30000), "Character/Hair/00030000.img");
  assert.equal(faceImagePath(20000), "Character/Face/00020000.img");
});

test("a look list's first id is the hair, and the rest are the worn equips", () => {
  assert.deepEqual(wornItemsOf([30000, 1040001, 1302000]), {
    hair: 30000,
    items: [1040001, 1302000],
  });
  assert.deepEqual(wornItemsOf([]), { hair: 30000, items: [] });
});

test(
  "an avatar frame is a picture of the real body: the head sits above the feet",
  needsArchive,
  () => {
    const frame = composeAvatar(
      archive!,
      lookOf(20000, 30000, [1040001, 1060001, 1071000, 1302000]),
      {
        stance: "stand1",
        frame: 0,
      },
    );
    assert.notEqual(frame, undefined);
    const picture = frame!;
    // A standing character of this build is about a body-and-head tall: 43 px wide, 66 px tall, with
    // the feet 66 px below the top of the head - not a 3 px sliver, not a 400 px field.
    assert.ok(picture.width >= 35 && picture.width <= 80, `width ${picture.width}`);
    assert.ok(picture.height >= 55 && picture.height <= 100, `height ${picture.height}`);
    assert.ok(
      picture.dy <= -50 && picture.dy >= -80,
      `the top of the picture is above the feet (dy=${picture.dy})`,
    );
    assert.ok(
      picture.dx < 0 && picture.dx > -60,
      `the picture starts left of the feet (dx=${picture.dx})`,
    );
    assert.ok(picture.png.length > 100, "the PNG carries the composite");
  },
);

test(
  "a flipped avatar frame is the mirror of the unflipped one, with its own offset",
  needsArchive,
  () => {
    const look = lookOf(20000, 30000, [1040001, 1302000]);
    const right = composeAvatar(archive!, look, { stance: "stand1", frame: 0 })!;
    const left = composeAvatar(archive!, look, { stance: "stand1", frame: 0, flip: true })!;
    assert.equal(left.width, right.width, "the same silhouette, mirrored");
    assert.equal(left.height, right.height);
    assert.notEqual(
      left.dx,
      right.dx,
      "the offset mirrors too, or a left-facing character would jump",
    );
  },
);

test(
  "a stance the archive does not have falls back to stand1 instead of vanishing",
  needsArchive,
  () => {
    const frame = composeAvatar(archive!, lookOf(20000, 30000), {
      stance: "noSuchStance",
      frame: 0,
    });
    assert.notEqual(frame, undefined);
  },
);

// ---------------------------------------------------------------- npc / mob

test("NPC and mob images are the archive's seven-digit names", () => {
  assert.equal(npcImagePath(1010100), "Npc/1010100.img");
  assert.equal(npcImagePath(2003), "Npc/0002003.img");
  assert.equal(mobImagePath(100100), "Mob/0100100.img");
});

test(
  "an NPC's stand frames are one canvas; a mob's move frames are an animation",
  needsArchive,
  () => {
    const reader = artReaderOf(archive!)!;
    const npc = spriteFrames(reader, "Npc/1010100.img", "stand");
    assert.equal(npc.length, 1);
    assert.deepEqual([npc[0]!.ox, npc[0]!.oy], [23, 67], "the sprite's own origin is the anchor");
    const mob = spriteFrames(reader, "Mob/0100100.img", "move");
    assert.ok(mob.length >= 2, `a snail walks with ${mob.length} frames`);
    assert.equal(mob[0]!.ox, 18);
    assert.equal(mob[0]!.oy, 26);
    // An unknown action falls back to `stand`, which is what the field draws for an NPC that has no
    // walk; with no fallbacks allowed, the same lookup is empty.
    assert.equal(
      spriteFrames(reader, "Mob/0100100.img", "noSuchAction")[0]!.path,
      "Mob/0100100.img/stand/0",
    );
    assert.equal(spriteFrames(reader, "Npc/1010100.img", "noSuchAction", []).length, 0);
  },
);

for (const stance of ["rope", "ladder"]) {
  test(
    `${stance}: backBody must not paint over clothes; no front face or standing sword`,
    needsArchive,
    () => {
      const items = [1040001, 1060001, 1071000];
      for (const frame of [0, 1]) {
        const clothed = composeAvatar(archive!, lookOf(20000, 30000, items), { stance, frame })!;
        const sword = composeAvatar(archive!, lookOf(20000, 30000, [...items, 1302000]), {
          stance,
          frame,
        })!;
        const face = composeAvatar(archive!, lookOf(20001, 30000, items), { stance, frame })!;
        const bare = composeAvatar(archive!, lookOf(20000, 30000, []), { stance, frame })!;
        assert.ok(clothed, `${stance}/${frame}`);
        assert.deepEqual(
          sword.png,
          clothed.png,
          "no rope/ladder weapon pose means no weapon, not stand1/0",
        );
        assert.deepEqual(face.png, clothed.png, "body face=0 hides all front facial expressions");
        assert.notDeepEqual(
          bare.png,
          clothed.png,
          "backBody must be below backMailChest/backPants/backShoes",
        );
        assert.ok(clothed.width < 60, "no protruding sword or duplicate front parts");
      }
    },
  );
}

test("an intermediate UOL keeps the unconsumed path suffix (equipment frames and sound families)", () => {
  const canvas = fakeCanvas(3, 2, 0, 0);
  const source: ArtSource = {
    has: (path) => path === "X.img",
    objects: () => [
      {
        cls: "Property",
        offset: 0,
        end: 0,
        props: [
          { name: "original", type: 9, value: props(["0", props(["body", canvasNode(canvas)])]) },
          { name: "alias", type: 9, value: new WzNode("uol", "original") },
        ],
      },
    ],
  };
  const reader = artReaderOf(source)!;
  assert.equal(reader.node("X.img/alias/0/body")?.canvas, canvas);
  assert.equal(reader.at("X.img/alias/0/body"), reader.at("X.img/original/0/body"));
});

test("art metadata and RGBA avoid PNG compression; first PNG access is byte-exact and cached", () => {
  const fake = new FakeArchive();
  fake.images.set("Character/Test.img", [props(["image", canvasNode(fakeCanvas(4, 3, 2, 1))])]);
  const reader = artReaderOf(fake)!;
  const art = reader.at("Character/Test.img/image")!;
  const descriptor = Object.getOwnPropertyDescriptor(art, "png");
  assert.equal(
    typeof descriptor?.get,
    "function",
    "PNG encoding must remain lazy for map metadata and avatar RGBA",
  );
  assert.equal(art.width, 4);
  assert.equal(art.rgba.length, 4 * 3 * 4);
  assert.deepEqual(
    Buffer.from(art.png),
    encodePng({ width: art.width, height: art.height, data: art.rgba }),
  );
  assert.equal(art.png, art.png, "one compressed buffer per cached canvas");
  assert.equal(reader.at("Character/Test.img/image"), art);
});
