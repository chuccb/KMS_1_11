/** Exact, explicitly admitted manual field entry. Importing never starts a browser or session. */
import type { Page } from "playwright-core";
import {
  assertProbePackets,
  browserFixture,
  fixtureLogin,
  fixtureValue,
  type ProbeEnvironment,
} from "./browser-fixture.ts";

export function fixtureInteger(
  env: ProbeEnvironment,
  name: string,
  min: number,
  max: number,
): number {
  const raw = fixtureValue(env, name);
  if (!/^(0|[1-9]\d*)$/.test(raw))
    throw new Error(`${name} must be an explicit integer ${min}..${max}`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(`${name} must be ${min}..${max}`);
  return value;
}
export function fieldFixture(args: readonly string[], env: ProbeEnvironment) {
  // Admission and account checks precede all additional reads, launch and navigation.
  const options = browserFixture(args, env);
  return {
    ...options,
    worldIndex: fixtureInteger(env, "PROBE_WORLD_INDEX", 0, 255),
    characterId: fixtureInteger(env, "PROBE_CHARACTER_ID", 1, 0xffffffff),
    mapId: fixtureInteger(env, "PROBE_MAP_ID", 0, 0xffffffff),
  };
}
export type FieldFixture = ReturnType<typeof fieldFixture>;
export async function enterProbeField(page: Page, options: FieldFixture): Promise<void> {
  await fixtureLogin(page, options.origin, options.account);
  await page.waitForFunction(() =>
    window.__kmsProbe.messages.some((packet) => packet.t === "login"),
  );
  // Select the specified native list index, including rows outside the initial six-row viewport.
  await page.locator("#view").focus();
  for (let index = 0; index <= options.worldIndex; index++) await page.keyboard.press("ArrowDown");
  const row = page.locator(`#world-list button[data-login-index="${options.worldIndex}"]`);
  if ((await row.getAttribute("aria-pressed")) !== "true")
    throw new Error("Explicit world index unavailable");
  if (await page.locator("#world-connect").isDisabled())
    throw new Error("Explicit world is unavailable");
  const beforeWorld = await page.evaluate(() => window.__kmsProbe.sequence);
  await page.click("#world-connect");
  await page.waitForFunction(
    (after) =>
      window.__kmsProbe.messages.some(
        (packet) => packet.sequence > after && packet.t === "characters",
      ),
    beforeWorld,
  );
  const index = await page.evaluate(
    ({ after, id }) => {
      const packet = window.__kmsProbe.messages.findLast(
        (entry) => entry.sequence > after && entry.t === "characters",
      );
      return packet?.t === "characters"
        ? packet.characters.findIndex((character) => character.id === id)
        : -1;
    },
    { after: beforeWorld, id: options.characterId },
  );
  if (index < 0 || index >= 3)
    throw new Error("Explicit character id is not in the native three-slot list");
  await page.locator("#character-list button").nth(index).click();
  const beforeCharacter = await page.evaluate(() => window.__kmsProbe.sequence);
  await page.click("#character-enter");
  await page.waitForFunction(
    (after) =>
      window.__kmsProbe.messages.some((packet) => packet.sequence > after && packet.t === "field"),
    beforeCharacter,
  );
  const field = await page.evaluate(
    (after) =>
      window.__kmsProbe.messages.findLast(
        (packet) => packet.sequence > after && packet.t === "field",
      ),
    beforeCharacter,
  );
  await assertProbePackets(page);
  if (
    field?.t !== "field" ||
    field.mapId !== options.mapId ||
    field.characterId !== options.characterId
  )
    throw new Error("Entered field/character does not match the explicit disposable fixture");
}
