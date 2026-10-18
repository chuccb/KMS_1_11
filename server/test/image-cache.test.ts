import test from "node:test";
import assert from "node:assert/strict";
import { archiveImages, avatarImages } from "../../client/image-cache.ts";

/** Component-only image adapter; the single cast is the explicit DOM mock boundary.
 * Production still requires real HTMLImageElement; Chromium coverage checks the real contract.
 */
class FixtureImage {
  onload: HTMLImageElement["onload"] = null;
  onerror: HTMLImageElement["onerror"] = null;
  private source = "";
  private readonly automatic: "load" | "error" | undefined;
  constructor(automatic?: "load" | "error") {
    this.automatic = automatic;
  }
  get src() {
    return this.source;
  }
  set src(value: string) {
    this.source = value;
    if (this.automatic) queueMicrotask(() => this.fire(this.automatic === "load"));
  }
  element(): HTMLImageElement {
    return this as unknown as HTMLImageElement;
  }
  fire(ok: boolean) {
    if (ok) this.onload?.call(this.element(), new Event("load"));
    else this.onerror?.call(this.element(), new Event("error"));
  }
}
function images(automatic?: "load" | "error") {
  const made: FixtureImage[] = [];
  return {
    made,
    image() {
      const image = new FixtureImage(automatic);
      made.push(image);
      return image.element();
    },
  };
}
const look = { face: 20000, hair: 30000, items: [1040001, 1302000] };
function avatarFixture(
  status = 200,
  headers: Record<string, string> = {},
  decode: "load" | "error" = "load",
) {
  const factory = images(decode),
    requests: string[] = [],
    revoked: string[] = [];
  let urls = 0;
  const cache = avatarImages({
    ...factory,
    fetcher: async (input) => {
      requests.push(String(input));
      return new Response(new Uint8Array([1, 2, 3]), { status, headers });
    },
    createUrl: () => `blob:fixture-${++urls}`,
    revokeUrl: (url) => revoked.push(url),
  });
  return { cache, requests, revoked, factory };
}

test("archive images coalesce in-flight requests, preserve encoded WZ path and expose a real completion promise", async () => {
  const factory = images(),
    cache = archiveImages(factory);
  const entry = cache.get("UI/한글.img/a b");
  assert.equal(cache.get("UI/한글.img/a b"), entry);
  assert.equal(factory.made.length, 1);
  assert.equal(entry.img.src, `/api/png/${encodeURIComponent("UI/한글.img/a b")}`);
  assert.equal(entry.ready, false);
  factory.made[0].fire(true);
  await entry.loading;
  assert.equal(entry.ready, true);
});

test("archive failures resolve cold and retry; an evicted request cannot delete its replacement", async () => {
  const factory = images(),
    cache = archiveImages({ ...factory, limit: 2 });
  const old = cache.get("a");
  cache.get("b");
  cache.get("c");
  const replacement = cache.get("a");
  assert.notEqual(old, replacement);
  factory.made[0].fire(false);
  await old.loading;
  assert.equal(cache.get("a"), replacement);
  assert.equal(old.ready, false);
  factory.made[3].fire(false);
  await replacement.loading;
  assert.notEqual(cache.get("a"), replacement);
});

test("archive preference keeps shared UI before terrain but even an all-UI workload remains bounded", () => {
  const cache = archiveImages({ ...images(), limit: 4 });
  const ui = cache.get("UI/Basic.img/button");
  cache.get("Map/1");
  cache.get("Map/2");
  cache.get("Map/3");
  cache.get("Map/4");
  assert.equal(cache.get("UI/Basic.img/button"), ui);
  for (let i = 0; i < 50; i++) {
    cache.get(`UI/${i}`);
    assert.ok(cache.size <= 4);
  }
  for (let i = 0; i < 50; i++) {
    cache.get(`Effect/BasicEff.img/NoRed/${i}`);
    assert.ok(cache.size <= 4);
  }
});

test("image budgets reject invalid values rather than silently growing or evicting everything", () => {
  for (const limit of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => archiveImages({ limit }));
    assert.throws(() => avatarImages({ limit }));
  }
});

test("avatar cache keeps HTTP/PNG decode cold until completion, validates anchors and revokes each blob URL", async () => {
  const f = avatarFixture(200, {
    "x-frame-dx": "-10",
    "x-frame-dy": "-30",
    "x-frame-plane-height": "40",
    "x-frame-damage-origin-y": "-38",
  });
  const entry = f.cache.get(look, "stand1", 3, true, "smile", true, 2);
  assert.equal(entry.ready, false);
  assert.equal(f.cache.get(look, "stand1", 3, true, "smile", true, 2), entry);
  await entry.loading;
  assert.equal(entry.ready, true);
  assert.deepEqual(
    [entry.dx, entry.dy, entry.planeHeight, entry.damageOriginY],
    [-10, -30, 40, -38],
  );
  assert.equal(f.requests.length, 1);
  const query = new URL(f.requests[0], "http://fixture").searchParams;
  for (const [key, value] of Object.entries({
    face: "20000",
    hair: "30000",
    items: "1040001,1302000",
    stance: "stand1",
    frame: "3",
    flip: "1",
    emotion: "smile",
    planes: "1",
    faceFrame: "2",
    v: "20261018-native-body-motion",
  }))
    assert.equal(query.get(key), value);
  assert.deepEqual(f.revoked, ["blob:fixture-1"]);
});

for (const kind of ["http", "decode", "bad-anchor", "bad-plane"] as const) {
  test(`avatar ${kind} failure permits retry and never exposes a ready fallback pose`, async () => {
    const f = avatarFixture(
      kind === "http" ? 404 : 200,
      kind === "bad-anchor"
        ? { "x-frame-dx": "NaN" }
        : kind === "bad-plane"
          ? { "x-frame-plane-height": "-1" }
          : {},
      kind === "decode" ? "error" : "load",
    );
    const first = f.cache.get(look, "jump", 0, false);
    await first.loading;
    assert.equal(first.ready, false);
    assert.equal(f.cache.size, 0);
    const next = f.cache.get(look, "jump", 0, false);
    assert.notEqual(next, first);
    await next.loading;
    assert.equal(f.requests.length, 2);
    assert.equal(f.revoked.length, kind === "decode" ? 2 : 0);
  });
}

test("avatar LRU retains recently used frames and eviction does not invalidate held images", async () => {
  const factory = images("load"),
    cache = avatarImages({
      ...factory,
      limit: 4,
      fetcher: async () => new Response("image"),
      createUrl: () => "blob:fixture",
      revokeUrl() {},
    });
  const active = cache.get(look, "stand1", 0, false);
  const oldest = cache.get(look, "stand1", 1, false);
  cache.get(look, "stand1", 2, false);
  cache.get(look, "stand1", 3, false);
  assert.equal(cache.get(look, "stand1", 0, false), active);
  cache.get(look, "stand1", 4, false);
  assert.equal(cache.get(look, "stand1", 0, false), active);
  assert.notEqual(cache.get(look, "stand1", 1, false), oldest);
  await oldest.loading;
  assert.equal(oldest.ready, true);
  assert.ok(cache.size <= 4);
});

test("neutral avatar warms actual blink indices, coalesces them and cannot alias a different face/plane/look", async () => {
  const factory = images("load"),
    queries: URLSearchParams[] = [];
  const cache = avatarImages({
    ...factory,
    faceProfile: (faceId) => ({
      faceId,
      actions: {
        blink: {
          duration: 120,
          frames: [
            { index: 0, delay: 60 },
            { index: 2, delay: 60 },
          ],
        },
      },
    }),
    fetcher: async (input) => {
      queries.push(new URL(String(input), "http://fixture").searchParams);
      return new Response("image");
    },
    createUrl: () => "blob:fixture",
    revokeUrl() {},
  });
  const neutral = cache.get(look, "stand1", 0, false);
  await neutral.loading;
  assert.equal(cache.size, 3);
  assert.equal(cache.get(look, "stand1", 0, false), neutral);
  assert.deepEqual(
    queries.map((query) => [query.get("emotion"), query.get("faceFrame")]),
    [
      ["blink", "0"],
      ["blink", "2"],
      ["default", "0"],
    ],
  );
  const other = cache.get({ ...look, face: 20001 }, "stand1", 0, false);
  assert.notEqual(other, neutral);
  await other.loading;
  assert.notEqual(cache.get(look, "stand1", 0, false, undefined, true), neutral);
});

test("archive source assignment failures settle cold and clear handlers rather than leak a rejection", async () => {
  const fake = new FixtureImage();
  Object.defineProperty(fake, "src", {
    set() {
      throw new Error("fixture source failure");
    },
  });
  const cache = archiveImages({ image: () => fake.element() });
  const entry = cache.get("UI/failure");
  await entry.loading;
  assert.equal(entry.ready, false);
  assert.equal(cache.size, 0);
  assert.equal(fake.onload, null);
  assert.equal(fake.onerror, null);
});

test("avatar replacement survives stale HTTP failure and decoded-image construction still revokes its URL", async () => {
  const factory = images("load"),
    pending: PromiseWithResolvers<Response>[] = [];
  const cache = avatarImages({
    ...factory,
    limit: 1,
    fetcher: () => {
      const p = Promise.withResolvers<Response>();
      pending.push(p);
      return p.promise;
    },
    createUrl: () => "blob:fixture",
    revokeUrl() {},
  });
  const old = cache.get(look, "stand1", 0, false);
  const middle = cache.get(look, "jump", 0, false);
  const replacement = cache.get(look, "stand1", 0, false);
  await Promise.resolve();
  assert.equal(pending.length, 3);
  pending[0].resolve(new Response("missing", { status: 404 }));
  await old.loading;
  assert.equal(cache.get(look, "stand1", 0, false), replacement);
  pending[1].resolve(new Response("image"));
  pending[2].resolve(new Response("image"));
  await Promise.all([middle.loading, replacement.loading]);
  let made = 0,
    revoked = 0;
  const broken = avatarImages({
    image() {
      if (++made === 2) throw new Error("image constructor failed");
      return new FixtureImage().element();
    },
    fetcher: async () => new Response("image"),
    createUrl: () => "blob:fixture",
    revokeUrl() {
      revoked++;
    },
  });
  const failed = broken.get(look, "stand1", 0, false);
  await failed.loading;
  assert.equal(failed.ready, false);
  assert.equal(revoked, 1);
  assert.equal(broken.size, 0);
});
