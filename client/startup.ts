import { requireElement } from "./dom.ts";
import { installStartupGuard } from "./startup-guard.ts";

// A separate, ordered module entry installs the guard before main's dependency graph executes.
// Module-link errors must be visible too; importing main from this module would lose that guard.
installStartupGuard({
  events: window,
  root: document.documentElement,
  panel: requireElement("startup-error", "aside"),
  message: requireElement("startup-error-message", "p"),
  login: requireElement("login", "button"),
});
