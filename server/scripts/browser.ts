/** Pinned browser tooling, launched by Bun. Importing this module never opens a page or logs in. */
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import chromium, { inflate } from "@sparticuz/chromium";
import { chromium as playwright, type Browser, type Page } from "playwright-core";

/** Explicit CLI target only; no hidden default live port or credentials in a URL. */
export function browserOrigin(argument: string | undefined): string {
  if (!argument) throw new Error("Supply an explicit web port or http(s) origin");
  const url = new URL(/^\d+$/.test(argument) ? `http://127.0.0.1:${argument}` : argument);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.port === "0"
  ) {
    throw new Error("Expected a credential-free http(s) origin, without a path/query/fragment");
  }
  return url.origin;
}

export async function launchBrowser(): Promise<Browser> {
  let executablePath = process.env.CHROMIUM_EXECUTABLE;
  let libraryPath = process.env.LD_LIBRARY_PATH;
  if (!executablePath) {
    if (process.platform !== "linux" || process.arch !== "x64") {
      throw new Error(
        "Set CHROMIUM_EXECUTABLE to a local Chromium on this platform; bundled browser targets Linux x64.",
      );
    }
    // The packaged Chromium includes NSS/NSPR for minimal sandboxes. Do not require apt or a
    // second runtime, and do not mutate the game server's environment or restart its process.
    const packageDir = dirname(fileURLToPath(import.meta.resolve("@sparticuz/chromium")));
    await inflate(join(packageDir, "../bin/al2023.tar.br"));
    libraryPath = [join(tmpdir(), "al2023/lib"), libraryPath].filter(Boolean).join(":");
    executablePath = await chromium.executablePath();
  }
  const options = {
    executablePath,
    headless: true,
    timeout: 20_000,
    env: { ...process.env, ...(libraryPath ? { LD_LIBRARY_PATH: libraryPath } : {}) },
    // Keep ordinary browser origin/security behavior. The package's serverless defaults disable
    // web security; these tests must not pass only because CORS/mixed-content rules were removed.
    // Single-process mode also crashes when Playwright closes a context and opens another;
    // retain normal multi-process browser/context lifetimes for multi-DPR tools.
    args: chromium.args.filter(
      (arg) =>
        ![
          "--disable-web-security",
          "--allow-running-insecure-content",
          "--single-process",
        ].includes(arg),
    ),
  };
  // The sandboxed Chromium intermittently SIGSEGVs during launch itself (the browser process
  // exits before any page exists; observed under repeated back-to-back launches). One bounded
  // retry absorbs that launch-level flake without weakening any assertion: a persistently
  // broken browser still fails the second attempt, and page-level errors never pass through
  // here because they happen after launch resolves.
  try {
    return await playwright.launch(options);
  } catch (error) {
    console.error(`launchBrowser: one retry after launch failure: ${String(error)}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    return playwright.launch(options);
  }
}

/** Same-origin GET only, with all WebSockets intercepted before page navigation. */
export async function readOnlyBrowserPage(page: Page, target: string) {
  const origin = browserOrigin(target);
  let socketAttempts = 0;
  await page.routeWebSocket("**/*", (socket) => {
    socketAttempts++;
    socket.close({ code: 1008, reason: "Read-only probe does not authenticate" });
  });
  await page.route("**/*", (route) => {
    const request = route.request();
    return new URL(request.url()).origin === origin && request.method() === "GET"
      ? route.continue()
      : route.abort();
  });
  return {
    get socketAttempts() {
      return socketAttempts;
    },
  };
}
