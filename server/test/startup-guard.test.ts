import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLIENT_READY_EVENT,
  installStartupGuard,
  STARTUP_TIMEOUT_MS,
} from "../../client/startup-guard.ts";
import { uiFixture } from "./helpers/ui-fixture.ts";

function fixture() {
  const ui = uiFixture();
  let expire: (() => void) | undefined;
  let cancelled = 0;
  const guard = installStartupGuard({
    events: ui.window as Window,
    root: ui.document.root as unknown as HTMLElement,
    panel: ui.get("startup-error") as unknown as HTMLElement,
    message: ui.get("startup-error-message") as unknown as HTMLElement,
    login: ui.get("login") as unknown as HTMLButtonElement,
    schedule(callback, delay) {
      assert.equal(delay, STARTUP_TIMEOUT_MS);
      expire = callback;
      return 123 as unknown as ReturnType<typeof setTimeout>;
    },
    cancel() {
      cancelled++;
    },
  });
  return { ...ui, guard, expire: () => expire?.(), cancelled: () => cancelled };
}

test("startup keeps login disabled until the entire application signals readiness, then removes its watchdog", () => {
  const f = fixture();
  try {
    assert.equal(f.guard.state, "pending");
    assert.equal(f.get("login").disabled, true);
    assert.equal(f.get("startup-error").hidden, true);
    f.window.dispatchEvent(new Event(CLIENT_READY_EVENT));
    assert.equal(f.guard.state, "ready");
    assert.equal(f.document.root.dataset.clientState, "ready");
    assert.equal(f.get("login").disabled, false);
    assert.equal(f.cancelled(), 1);
    f.expire();
    f.window.dispatchEvent(new Event("error"));
    assert.equal(
      f.guard.state,
      "ready",
      "completed startup must not be changed by stale callbacks",
    );
  } finally {
    f.guard.dispose();
    f.restore();
  }
});

test("startup DOM exceptions are visible text, not HTML, and cannot later become a false ready state", () => {
  const f = fixture();
  try {
    const detail = "Expected <div> for #stat-body";
    f.window.dispatchEvent(Object.assign(new Event("error"), { message: detail }));
    assert.equal(f.guard.state, "failed");
    assert.equal(f.get("startup-error").hidden, false);
    assert.ok(f.get("startup-error-message").textContent.includes(detail));
    assert.equal(f.get("login").disabled, true);
    f.window.dispatchEvent(new Event(CLIENT_READY_EVENT));
    f.expire();
    assert.equal(f.guard.state, "failed");
    assert.equal(f.cancelled(), 1);
  } finally {
    f.guard.dispose();
    f.restore();
  }
});

test("missing modules and startup timeouts expose a reloadable failure instead of an inert login", () => {
  for (const mode of ["resource", "timeout"] as const) {
    const f = fixture();
    try {
      if (mode === "resource") f.window.dispatchEvent(new Event("error"));
      else f.expire();
      assert.equal(f.guard.state, "failed");
      assert.equal(f.get("startup-error").hidden, false);
      assert.match(
        f.get("startup-error-message").textContent,
        mode === "resource" ? /模組載入失敗/ : /啟動逾時/,
      );
      assert.equal(f.get("login").disabled, true);
      assert.equal(f.cancelled(), 1);
    } finally {
      f.guard.dispose();
      f.restore();
    }
  }
});

test("an unhandled startup rejection exposes the failure and releases its timer", () => {
  const f = fixture();
  try {
    f.window.dispatchEvent(
      Object.assign(new Event("unhandledrejection"), {
        reason: new Error("fixture startup rejected"),
      }),
    );
    assert.equal(f.guard.state, "failed");
    assert.match(f.get("startup-error-message").textContent, /fixture startup rejected/);
    assert.equal(f.cancelled(), 1);
  } finally {
    f.guard.dispose();
    f.restore();
  }
});
