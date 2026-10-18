/** Explicit NEW development world setup, not recovery, a game probe or an original creation rule.
 * Usage (repository root): node tools/create-isolated-preview.ts generated/<new-name>.json
 * Never overwrites an existing save. No network listeners, logins, tests or gameplay requests.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { WzArchive } from "../server/src/wz/archive.ts";
import { artReaderOf } from "../server/src/game/wzart.ts";
import { creationCatalogOf } from "../server/src/game/creation.ts";
import { itemCatalogOf } from "../server/src/game/iteminfo.ts";
import { LoginServer, type AccountRecord } from "../server/src/net/loginserver.ts";
import { saveJson } from "../server/src/game/save.ts";
const root = fileURLToPath(new URL("../", import.meta.url));
if (process.argv.length !== 3) throw new Error("Supply exactly one NEW generated/*.json path");
const path = resolve(root, process.argv[2]);
if (!path.startsWith(resolve(root,"generated") + sep) || !path.endsWith(".json"))
  throw new Error("Preview save must be a NEW JSON file inside generated/");
const archive = WzArchive.open(resolve(root,"Data.wz"));
const reader = artReaderOf(archive)!;
const catalog = creationCatalogOf(reader);
if (!catalog) throw new Error("Original MakeCharInfo unavailable; do not fabricate an appearance");
const appearance = [...catalog.male.map(group=>group[0].id),13,4,4,4];
const accounts = new Map<string,AccountRecord>();
// Build records using the real creation/template path, WITHOUT opening a server or granting skills.
const creator = new LoginServer({accounts,worlds:[],gameServer:{ip:"127.0.0.1",port:0},pingMs:0,
  itemCatalog:itemCatalogOf(archive),startMapId:101000000});
accounts.set("preview",{password:"preview",characters:[creator.createCharacter(10000,"Preview",appearance)]});
accounts.set("observer",{password:"observer",characters:[creator.createCharacter(10001,"Observer",appearance)]});
mkdirSync(dirname(path),{recursive:true});
writeFileSync(path,saveJson(accounts),{flag:"wx",mode:0o600});
console.log(`NEW isolated development save: ${path}`);
console.log("preview/preview and observer/observer; new level1 beginners, safe town 101000000; no old progress restored.");
