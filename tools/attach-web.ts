/** A separate HTTP/WS bridge onto an ALREADY RUNNING native world. Never creates/stops a game
 * server, account, ledger or save. Useful when updating client/bridge code without losing an
 * existing memory-only world's player progress. In-process test-tools/mobPresentation callbacks
 * are unavailable: do not pretend those admin/presentation capabilities were recovered remotely.
 */
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { WzArchive } from "../server/src/wz/archive.ts";
import { startWebClient, type WebClientOptions } from "../server/src/net/webclient.ts";
import { mapDataProvider, mapCatalogOf } from "../server/src/game/map.ts";
import { itemCatalogOf } from "../server/src/game/iteminfo.ts";
import { skillCatalogOf } from "../server/src/game/skills.ts";
import { mobTemplateProvider } from "../server/src/game/mobs.ts";
import { artProviderOf } from "../server/src/game/art.ts";
import { audioProviderOf } from "../server/src/game/audio.ts";
export function attachedWebOptions(args: string[]): WebClientOptions {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      port: { type: "string" },
      "login-port": { type: "string" },
      "game-port": { type: "string" },
      host: { type: "string", default: "127.0.0.1" },
      data: { type: "string", default: "Data.wz" },
    },
  });
  function port(name: "port" | "login-port" | "game-port", allowZero = false) {
    const text = values[name],
      value = Number(text);
    if (
      text === undefined ||
      !/^\d+$/.test(text) ||
      !Number.isInteger(value) ||
      value < (allowZero ? 0 : 1) ||
      value > 65535
    )
      throw new Error(`--${name} must be an integer port ${allowZero ? "0" : "1"}..65535`);
    return value;
  }
  const options: WebClientOptions = {
    partyInviteIdentity: false,
    port: port("port", true),
    loginPort: port("login-port"),
    gamePort: port("game-port"),
    host: values.host,
    gameHost: "127.0.0.1",
  };
  if (values.data !== "off") {
    const archive = WzArchive.open(resolve(values.data)),
      mapProvider = mapDataProvider(archive),
      itemCatalog = itemCatalogOf(archive),
      skills = skillCatalogOf(archive);
    Object.assign(options, {
      mapProvider,
      mapCatalog: mapCatalogOf(archive, mapProvider),
      mobTemplate: mobTemplateProvider(archive),
      ...(itemCatalog ? { itemCatalog } : {}),
      ...(skills ? { skills } : {}),
      art: artProviderOf(archive),
      audio: audioProviderOf(archive),
    });
  }
  return options;
}
if (import.meta.main) {
  try {
    const options = attachedWebOptions(process.argv.slice(2)),
      web = await startWebClient(options);
    console.log(
      `Attached web bridge http://${web.host}:${web.port}/ -> native login 127.0.0.1:${options.loginPort}, game ${options.gameHost}:${options.gamePort}`,
    );
    console.log(
      "Existing world/save untouched. Party invite/accept disabled until native identity checks are verified; in-process admin tools/private mobPresentation are unavailable.",
    );
    for (const signal of ["SIGINT", "SIGTERM"] as const)
      process.once(signal, () => {
        void web.close();
      });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
