/** Shared manual-probe admission and browser geometry. No import-time I/O or implicit accounts. */
import type { Locator, Page } from "playwright-core";
import { browserProbeOptions, type ProbeAccount } from "./probe-options.ts";

export type ProbeEnvironment = Readonly<Record<string, string | undefined>>;
export function probeFlag(args: readonly string[], flag: "--climb" | "--auto") {
  if (args.filter((arg) => arg === flag).length > 1) throw new Error(`Duplicate ${flag}`);
  return { args: args.filter((arg) => arg !== flag), enabled: args.includes(flag) };
}
export function fixtureValue(env: ProbeEnvironment, name: string): string {
  const value = env[name];
  if (!value?.trim()) throw new Error(`Set ${name} explicitly for a disposable fixture`);
  return value;
}
export function browserFixture(
  args: readonly string[],
  env: ProbeEnvironment,
  extraAccount = false,
) {
  const options = browserProbeOptions(args, env);
  const other: ProbeAccount | undefined = extraAccount
    ? {
        user: fixtureValue(env, "PROBE_ALT_ACCOUNT"),
        password: fixtureValue(env, "PROBE_ALT_PASSWORD"),
      }
    : undefined;
  if (other?.user === options.account.user)
    throw new Error("Supply distinct disposable fixture accounts");
  return { ...options, other };
}
export async function probeBox(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Probe requires a visible element with a bounding box");
  return box;
}
export async function fixtureLogin(page: Page, origin: string, account: ProbeAccount) {
  // A redirect or an embedded script must not send fixture credentials to another origin.
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin ? route.fallback() : route.abort(),
  );
  await page.routeWebSocket("**/*", (socket) => {
    const url = new URL(socket.url());
    const expected = new URL(origin);
    expected.protocol = expected.protocol === "https:" ? "wss:" : "ws:";
    if (
      url.origin === expected.origin &&
      url.pathname === "/ws" &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password
    )
      socket.connectToServer();
    else socket.close({ code: 1008, reason: "Outside admitted fixture" });
  });
  await page.goto(origin);
  if (new URL(page.url()).origin !== origin) throw new Error("Navigation left admitted fixture");
  await page.click("#title-continue");
  if (new URL(page.url()).origin !== origin) throw new Error("Navigation left admitted fixture");
  await page.fill("#user", account.user);
  await page.fill("#pass", account.password);
  await page.click("#login");
}

/** A malformed relevant packet cannot silently make a probe's assertions pass. */
export async function assertProbePackets(page: Page) {
  const invalid = await page.evaluate(() => window.__kmsProbe.invalid);
  if (invalid.length) throw new Error(`Invalid probe observations: ${JSON.stringify(invalid)}`);
}
