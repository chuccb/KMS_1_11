/** Separate process: failing closed also catches imports that swallow a network/launch error. */
import { mock } from "bun:test";
import assert from "node:assert/strict";
let attempts = 0;
function denied(): never {
  attempts++;
  throw new Error("Tool import attempted network/server/browser work");
}
mock.module("node:net", () => ({ connect: denied }));
mock.module("playwright-core", () => ({ chromium: { launch: denied } }));
mock.module("@sparticuz/chromium", () => ({
  default: { executablePath: denied, args: [] },
  inflate: denied,
}));
Bun.connect = denied;
Bun.listen = denied;
Bun.serve = denied;
globalThis.fetch = Object.assign(denied, { preconnect: denied });
globalThis.WebSocket = class extends WebSocket {
  constructor(..._args: ConstructorParameters<typeof WebSocket>) {
    super(denied()); // Argument throws before the native WebSocket constructor can execute.
  }
};
await import("../../scripts/browser.ts");
await import("../../scripts/probe-options.ts");
await import("../../scripts/probe-session.ts");
await import("../../scripts/whisper_probe.ts");
await import("../../scripts/browser_display_probe.ts");
await import("../../scripts/browser_render_probe.ts");
await import("../../../client/display-controls.ts");
await import("../../../client/image-cache.ts");
await import("../../../client/motion-tuning.ts");
await import("../../../client/motion-controls.ts");
await import("../../scripts/browser-fixture.ts");
await import("../../scripts/browser-observation.ts");
const probes = [
  (await import("../../scripts/browser_motion_probe.ts")).probeMotion,
  (await import("../../scripts/browser_portal_probe.ts")).probePortal,
  (await import("../../scripts/browser_minimap_probe.ts")).probeMinimap,
  (await import("../../scripts/browser_stat_probe.ts")).probeStat,
  (await import("../../scripts/browser_equipment_probe.ts")).probeEquipment,
  (await import("../../scripts/browser_creation_probe.ts")).probeCreation,
  (await import("../../scripts/browser_selection_probe.ts")).probeSelection,
];
for (const run of probes) {
  await assert.rejects(run([], {}), /allow-state-changes/);
  await assert.rejects(run(["8595", "--allow-state-changes"], {}), /PROBE_ACCOUNT/);
  for (const port of [8495, 8496, 8497, 8515, 8516, 8517]) {
    await assert.rejects(run([String(port), "--allow-state-changes"], {}), /Refusing/);
    await assert.rejects(
      run([`https://${port}-fixture.e2b.app`, "--allow-state-changes"], {}),
      /Refusing/,
    );
  }
}
await import("../../../client/entity-assets.ts");
await import("../../../client/entity-resource-validation.ts");
await import("../../../client/avatar-look.ts");
console.log(JSON.stringify({ imported: 22, attempts }));
