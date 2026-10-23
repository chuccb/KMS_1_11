import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { WzArchive } from "../src/wz/archive.ts";
import { artProviderOf } from "../src/game/art.ts";
import { mapCatalogOf } from "../src/game/map.ts";
import { skillCatalogOf } from "../src/game/skills.ts";
import { startWebClient } from "../src/net/webclient.ts";
import { isCreationCatalog, isMapDestinations } from "../../client/ui-resource-validation.ts";
import { isNpcMetadata } from "../../client/entity-resource-validation.ts";
import { ACTIVE_SKILLS } from "../../client/active-skills.ts";
import {
  isActiveSkillMetadata,
  isBasicAttackProfile,
  isMobMetadata,
  isSkillCatalogue,
  isSpriteFrames,
} from "../../client/combat-resource-validation.ts";

test("browser metadata guards accept original WZ HTTP responses, without a game connection", async () => {
  const archive = WzArchive.open(resolve(import.meta.dirname, "../../Data.wz"));
  const server = await startWebClient({
    host: "127.0.0.1",
    port: 0,
    loginPort: 0,
    art: artProviderOf(archive),
    mapCatalog: mapCatalogOf(archive),
    skills: skillCatalogOf(archive),
  });
  try {
    const endpoints: [string, (data: unknown) => boolean][] = [
      ...[1302000, 1332000, 1372000, 1452000, 1462000, 1472000].map(
        (id) => [`/api/attack/${id}`, isBasicAttackProfile] as [string, (data: unknown) => boolean],
      ),
      ["/api/projectile/2060000", isSpriteFrames],
      ["/api/maps", isMapDestinations],
      ["/api/creation", isCreationCatalog],
      ["/api/mob/100100", isMobMetadata],
      ...[1001000, 1002000, 1002001, 2100].map(
        (id) => [`/api/npc/${id}`, isNpcMetadata] as [string, (data: unknown) => boolean],
      ),
      ["/api/skills/100", isSkillCatalogue],
      ["/api/skills/200", isSkillCatalogue],
      ...Object.keys(ACTIVE_SKILLS).map(
        (id) =>
          [`/api/active-skill/${id}`, isActiveSkillMetadata] as [
            string,
            (data: unknown) => boolean,
          ],
      ),
    ];
    for (const [path, valid] of endpoints) {
      const response = await fetch(`http://127.0.0.1:${server.port}${path}`);
      assert.equal(response.status, 200, path);
      const data: unknown = await response.json();
      assert.equal(valid(data), true, path);
    }
  } finally {
    await server.close();
  }
});

test("metadata boundaries reject malformed geometry, skill numbers and optional art", () => {
  assert.equal(
    isSpriteFrames([{ path: "original", delay: 30 }]),
    false,
    "missing origins are not typed as drawable frames",
  );
  assert.equal(
    isBasicAttackProfile({
      weaponId: 1302000,
      speed: 2,
      group: 1,
      melee: [],
      shoot: [],
      hitEffects: { hit1: [{ path: "original", delay: NaN, ox: 0, oy: 0 }] },
    }),
    false,
  );
  assert.equal(
    isSkillCatalogue({
      job: 100,
      books: [{ id: 100, name: "warrior", skills: [{ levels: [{ values: { hp: "10" } }] }] }],
    }),
    false,
  );
  assert.equal(
    isMobMetadata({ templateId: 100100, actions: {}, attacks: [{ type: 1, sp: null }] }),
    false,
  );
});
