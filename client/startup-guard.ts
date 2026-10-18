/** Startup infrastructure only: no authentication, player state or storage access. */
export const CLIENT_READY_EVENT = "kms:client-ready";
export const STARTUP_TIMEOUT_MS = 15_000;
type StartupState = "pending" | "ready" | "failed";
/** All authentication entry points (including Enter) require completed application startup. */
export function clientStartupReady(root: Pick<HTMLElement, "dataset">): boolean {
  return root.dataset.clientState === "ready";
}
export interface StartupGuardOptions {
  events: Pick<Window, "addEventListener" | "removeEventListener">;
  root: HTMLElement;
  panel: HTMLElement;
  message: HTMLElement;
  login: HTMLButtonElement;
  schedule?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
  timeoutMs?: number;
}
export function installStartupGuard({
  events,
  root,
  panel,
  message,
  login,
  schedule = setTimeout,
  cancel = clearTimeout,
  timeoutMs = STARTUP_TIMEOUT_MS,
}: StartupGuardOptions) {
  let state: StartupState = "pending";
  root.dataset.clientState = state;
  panel.hidden = true;
  login.disabled = true;
  function cleanup() {
    cancel(timer);
    events.removeEventListener(CLIENT_READY_EVENT, ready);
    events.removeEventListener("error", failed, true);
    events.removeEventListener("unhandledrejection", rejected);
  }
  function report(detail: string) {
    if (state !== "pending") return;
    state = "failed";
    root.dataset.clientState = state;
    message.textContent = `頁面初始化失敗，登入尚未啟用。請重新整理；若仍發生，請回報下列訊息：\n${detail}`;
    panel.hidden = false;
    login.disabled = true;
    cleanup();
  }
  function ready() {
    if (state !== "pending") return;
    state = "ready";
    root.dataset.clientState = state;
    login.disabled = false;
    cleanup();
  }
  function failed(event: Event) {
    report(
      "message" in event && typeof event.message === "string" && event.message
        ? event.message
        : "啟動模組載入失敗，請確認服務及網路連線。",
    );
  }
  function rejected(event: PromiseRejectionEvent) {
    const reason: unknown = event.reason;
    report(reason instanceof Error ? reason.message : "啟動作業未能完成。");
  }
  const timer = schedule(() => report("啟動逾時，請確認服務及網路連線。"), timeoutMs);
  events.addEventListener(CLIENT_READY_EVENT, ready);
  events.addEventListener("error", failed, true);
  events.addEventListener("unhandledrejection", rejected);
  return {
    get state() {
      return state;
    },
    dispose: cleanup,
  };
}
