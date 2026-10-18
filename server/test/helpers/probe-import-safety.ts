/** Separate process: failing closed also catches imports that swallow a network/launch error. */
import { mock } from "bun:test";
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
console.log(JSON.stringify({ imported: 8, attempts }));
