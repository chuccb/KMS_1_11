import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import type { Page } from "playwright-core";
import { launchBrowser } from "../scripts/browser.ts";
import { startWebClient } from "../src/net/webclient.ts";
import { WzArchive } from "../src/wz/archive.ts";
import { artProviderOf } from "../src/game/art.ts";
import { isRecord } from "../../client/resource-validation.ts";

interface FixtureOptions {
  root?: string;
  state?: "ready" | "failed";
  beforeLoad?(page: Page): Promise<void>;
}
async function withBrowser(
  options: FixtureOptions,
  run: (page: Page, errors: string[], messages: unknown[]) => Promise<void>,
) {
  // HTTP only, ephemeral port, no LoginServer/GameEntryServer/accounts/save store. Even a test
  // mistake cannot authenticate: Playwright intercepts every /ws locally, never connectToServer.
  const archive = WzArchive.open(resolve(import.meta.dirname, "../../Data.wz"));
  const server = await startWebClient({
    host: "127.0.0.1",
    port: 0,
    loginPort: 0,
    root: options.root,
    art: artProviderOf(archive),
  });
  let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    const errors: string[] = [],
      messages: unknown[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const origin = `http://127.0.0.1:${server.port}`;
    await page.route("**/*", (route) => {
      const request = route.request();
      return new URL(request.url()).origin === origin && request.method() === "GET"
        ? route.continue()
        : route.abort();
    });
    await page.routeWebSocket("**/*", (socket) => {
      assert.equal(new URL(socket.url()).pathname, "/ws");
      socket.onMessage((data) => {
        assert.equal(typeof data, "string");
        const message: unknown = JSON.parse(String(data));
        assert.ok(
          isRecord(message) && message.t === "login",
          "only mock authentication is allowed",
        );
        messages.push(message);
        socket.send(JSON.stringify({ t: "login", result: 5, gender: 0, worlds: [] }));
      });
    });
    await options.beforeLoad?.(page);
    await page.goto(origin, { waitUntil: "load" });
    await page.waitForFunction(
      (state) => document.documentElement.dataset.clientState === state,
      options.state ?? "ready",
      { timeout: 10_000 },
    );
    await run(page, errors, messages);
  } finally {
    await browser?.close();
    await server.close();
  }
}

test("actual HTML and the complete source and bundled module graphs finish startup without a game connection", async () => {
  const build = Bun.spawn([process.execPath, "tools/build-client.ts"], {
    cwd: resolve(import.meta.dirname, "../.."),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [status, output, error] = await Promise.all([
    build.exited,
    new Response(build.stdout).text(),
    new Response(build.stderr).text(),
  ]);
  assert.equal(status, 0, output + error);
  for (const root of [
    resolve(import.meta.dirname, "../../client"),
    resolve(import.meta.dirname, "../../dist/client"),
  ]) {
    await withBrowser({ root }, async (page, errors, messages) => {
      // Readiness alone is insufficient: exercise the first real rendering callbacks as well.
      await page.evaluate(
        () =>
          new Promise<void>((done) =>
            requestAnimationFrame(() => requestAnimationFrame(() => done())),
          ),
      );
      assert.equal(
        await page.locator("#stat-body").evaluate((element) => element.localName),
        "button",
      );
      assert.equal(await page.locator("#startup-error").isVisible(), false);
      assert.equal(await page.locator("#login").isDisabled(), false);
      assert.deepEqual(messages, []);
      assert.deepEqual(errors, []);
    });
  }
});

test("login click and Enter reach only an intercepted mock transport, show refusal and allow retry", async () => {
  await withBrowser({}, async (page, errors, messages) => {
    await page.locator("#title-continue").click();
    await page.locator("#user").fill("browser-fixture-only");
    await page.locator("#pass").fill("mock-only");
    await page.locator("#login").click();
    await page.waitForFunction(() =>
      document.getElementById("status")?.textContent?.includes("結果 5"),
    );
    assert.equal(messages.length, 1);
    assert.equal(await page.locator("#login").isDisabled(), false);
    assert.equal(await page.locator("#pass").isDisabled(), false);
    await page.locator("#pass").press("Enter");
    await page.waitForFunction(
      () =>
        document.getElementById("login") instanceof HTMLButtonElement &&
        !(document.getElementById("login") as HTMLButtonElement).disabled,
    );
    assert.equal(messages.length, 2);
    assert.deepEqual(errors, []);
    assert.equal(await page.locator("#startup-error").isVisible(), false);
  });
});

test("the original stat-body tag regression is caught during actual module evaluation, not hidden by parser success", async () => {
  await withBrowser(
    {
      state: "failed",
      async beforeLoad(page) {
        await page.addInitScript(() => {
          let attempts = 0;
          Object.defineProperty(window, "startupSocketAttempts", { get: () => attempts });
          window.WebSocket = new Proxy(window.WebSocket, {
            construct(target, args) {
              attempts++;
              return Reflect.construct(target, args);
            },
          });
        });
        await page.route("**/statwindow.ts", async (route) => {
          const response = await route.fetch();
          const original = await response.text();
          const mutant = original.replaceAll(
            'requireElement("stat-body", "button")',
            'requireElement("stat-body", "div")',
          );
          assert.notEqual(
            mutant,
            original,
            "fault injection must really restore the erroneous tag contract",
          );
          await route.fulfill({ response, body: mutant });
        });
      },
    },
    async (page, errors, messages) => {
      assert.ok(errors.some((message) => message.includes("Expected <div> for #stat-body")));
      assert.match(
        await page.locator("#startup-error-message").innerText(),
        /Expected <div> for #stat-body/,
      );
      assert.equal(await page.locator("#startup-error").isVisible(), true);
      assert.equal(await page.locator("#login").isDisabled(), true);
      await page
        .locator("#pass")
        .evaluate((input) =>
          input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
        );
      assert.equal(
        await page.evaluate(() => Reflect.get(window, "startupSocketAttempts")),
        0,
        "Enter must not bypass the failed-startup authentication guard",
      );
      assert.deepEqual(messages, []);
    },
  );
});

test("a missing entry module displays an actionable startup error without attempting authentication", async () => {
  await withBrowser(
    {
      state: "failed",
      async beforeLoad(page) {
        await page.route("**/main.js", (route) =>
          route.fulfill({ status: 404, contentType: "text/plain", body: "fixture missing entry" }),
        );
      },
    },
    async (page, _errors, messages) => {
      assert.equal(await page.locator("#startup-error").isVisible(), true);
      assert.match(await page.locator("#startup-error-message").innerText(), /啟動模組載入失敗/);
      assert.equal(await page.locator("#login").isDisabled(), true);
      assert.deepEqual(messages, []);
    },
  );
});
