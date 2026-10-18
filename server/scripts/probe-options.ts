/** Explicit manual-tool admission. Acknowledgement is NOT proof that a target/save is isolated.
 * Never execute state-changing probes against the user-facing service. No implicit credentials.
 */
import { browserOrigin } from "./browser.ts";

type Environment = Readonly<Record<string, string | undefined>>;
export interface ProbeAccount {
  user: string;
  password: string;
}
export interface NativeProbeOptions {
  loginPort: number;
  gamePort: number;
  account: ProbeAccount;
  other: ProbeAccount;
}
export interface BrowserProbeOptions {
  origin: string;
  account: ProbeAccount;
}
function required(env: Environment, name: string): string {
  const value = env[name];
  if (!value?.trim()) throw new Error(`Set ${name} explicitly for a disposable fixture`);
  return value;
}
function account(env: Environment, prefix: string): ProbeAccount {
  return { user: required(env, `${prefix}ACCOUNT`), password: required(env, `${prefix}PASSWORD`) };
}
function admittedArguments(args: readonly string[], count: number): string[] {
  if (args.filter((arg) => arg === "--allow-state-changes").length !== 1)
    throw new Error(
      "Manual fixture only: supply --allow-state-changes; this may mutate characters/saves",
    );
  const targets = args.filter((arg) => arg !== "--allow-state-changes");
  if (targets.length !== count || targets.some((arg) => arg.startsWith("--")))
    throw new Error(`Supply exactly ${count} explicit target argument(s)`);
  return targets;
}
export function fixturePort(value: string): number {
  if (!/^\d+$/.test(value)) throw new Error("Expected an integer TCP port");
  const number = Number(value);
  if (number < 1 || number > 65535) throw new Error("Expected TCP port 1..65535");
  // Reserved for the existing user-facing preview; the flag cannot bypass this guard.
  if ([8515, 8516, 8517].includes(number))
    throw new Error("Refusing the user-facing preview ports");
  return number;
}
export function nativeProbeOptions(args: readonly string[], env: Environment): NativeProbeOptions {
  const targets = admittedArguments(args, 2);
  const loginPort = fixturePort(targets[0]!),
    gamePort = fixturePort(targets[1]!);
  if (loginPort === gamePort) throw new Error("Login/game ports must be different");
  const first = account(env, "PROBE_"),
    other = account(env, "PROBE_ALT_");
  if (first.user === other.user) throw new Error("Supply two distinct disposable fixture accounts");
  return { loginPort, gamePort, account: first, other };
}
export function browserProbeOptions(
  args: readonly string[],
  env: Environment,
): BrowserProbeOptions {
  const targets = admittedArguments(args, 1);
  const origin = fixtureBrowserOrigin(targets[0]);
  return { origin, account: account(env, "PROBE_") };
}

export function fixtureBrowserOrigin(target: string | undefined): string {
  const origin = browserOrigin(target),
    url = new URL(origin);
  fixturePort(url.port || (url.protocol === "https:" ? "443" : "80"));
  if (/^851[567]-[^.]+\.e2b\.app$/i.test(url.hostname))
    throw new Error("Refusing the user-facing preview proxy");
  return origin;
}
