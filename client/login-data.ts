/** Login-list JSON boundary and native selection state. No DOM, transport or account side effects. */
import type { AvatarActor, AvatarProfile } from "./avatar-motion.ts";
import type { FaceActor } from "./faces.ts";
import { isRecord } from "./resource-validation.ts";
import { CHARACTER_UI, WORLD_UI, worldPopulation } from "./selection.ts";

export interface LoginWorld {
  readonly name: string;
  /** Original WorldEntry LONG, transported as u32; interpreted as signed only by WorldSelect. */
  readonly unknownId: number;
}
export interface LoginLook {
  readonly face: number;
  readonly hair: number;
  readonly items: readonly number[];
}
/** Only fields consumed by this screen; animation clocks belong to the retained local actor. */
export interface LoginCharacter extends LoginLook, AvatarActor, FaceActor {
  /** Filled synchronously by the injected body sampler, never accepted from login-list JSON. */
  bodyProfile?: AvatarProfile;
  readonly id: number;
  readonly name: string;
  readonly job: number;
  readonly level: number;
  readonly str: number;
  readonly dex: number;
  readonly int: number;
  readonly luk: number;
}
export type LoginSelectionRequest = { t: "world"; index: number } | { t: "character"; id: number };

function integer(value: unknown, maximum: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= maximum;
}
function u32(value: unknown): value is number {
  return integer(value, 0xffffffff);
}
export function readLoginWorlds(value: unknown): LoginWorld[] {
  if (!Array.isArray(value)) throw new Error("Invalid login worlds: expected an array");
  return value.map((entry: unknown, index) => {
    if (!isRecord(entry) || typeof entry.name !== "string" || !u32(entry.unknownId))
      throw new Error(`Invalid login world at index ${index}`);
    return { name: entry.name, unknownId: entry.unknownId };
  });
}
export function readLoginCharacters(value: unknown): LoginCharacter[] {
  if (!Array.isArray(value)) throw new Error("Invalid login characters: expected an array");
  const ids = new Set<number>();
  const characters = value.map((entry: unknown, index): LoginCharacter => {
    if (
      !isRecord(entry) ||
      !u32(entry.id) ||
      ids.has(entry.id) ||
      typeof entry.name !== "string" ||
      !integer(entry.job, 0xffff) ||
      !integer(entry.level, 0xff) ||
      !integer(entry.str, 0xffff) ||
      !integer(entry.dex, 0xffff) ||
      !integer(entry.int, 0xffff) ||
      !integer(entry.luk, 0xffff) ||
      !u32(entry.face) ||
      !u32(entry.hair) ||
      !Array.isArray(entry.items) ||
      !entry.items.every(u32)
    )
      throw new Error(`Invalid login character at index ${index}`);
    ids.add(entry.id);
    return {
      id: entry.id,
      name: entry.name,
      job: entry.job,
      level: entry.level,
      str: entry.str,
      dex: entry.dex,
      int: entry.int,
      luk: entry.luk,
      face: entry.face,
      hair: entry.hair,
      items: [...entry.items],
    };
  });
  // The original client has three slots. Validate the complete reply before publishing any of it.
  return characters.slice(0, CHARACTER_UI.slots);
}

export function loginSelection() {
  let worlds: LoginWorld[] = [],
    characters: LoginCharacter[] = [];
  let worldIndex = -1,
    characterIndex = -1,
    scroll = 0,
    pending = false,
    blocked = false;
  const lastScroll = () => Math.max(0, worlds.length - WORLD_UI.visibleRows);
  const selected = () => characters[characterIndex];
  const canConnect = () =>
    !pending && !blocked && !!worlds[worldIndex] && worldPopulation(worlds[worldIndex]) >= 0;
  const canEnter = () => !pending && !blocked && !!selected();
  return {
    get worlds(): readonly LoginWorld[] {
      return worlds;
    },
    get characters(): readonly LoginCharacter[] {
      return characters;
    },
    get worldIndex() {
      return worldIndex;
    },
    get characterIndex() {
      return characterIndex;
    },
    get scroll() {
      return scroll;
    },
    get pending() {
      return pending;
    },
    get selected() {
      return selected();
    },
    get canConnect() {
      return canConnect();
    },
    get canEnter() {
      return canEnter();
    },
    get canCreate() {
      return !pending && !blocked && characters.length < CHARACTER_UI.slots;
    },
    block() {
      blocked = true;
    },
    setPending(value: boolean) {
      pending = value;
    },
    replaceWorlds(value: unknown) {
      const next = readLoginWorlds(value);
      worlds = next;
      worldIndex = -1;
      scroll = 0;
      pending = false;
      blocked = false;
    },
    replaceCharacters(value: unknown) {
      const next = readLoginCharacters(value);
      const priorId = selected()?.id;
      const retained = next.findIndex((character) => character.id === priorId);
      characters = next;
      characterIndex =
        retained >= 0
          ? retained
          : next.length
            ? Math.min(Math.max(characterIndex, 0), next.length - 1)
            : -1;
      pending = false;
      blocked = false;
    },
    selectWorld(index: number) {
      if (pending || blocked || !Number.isInteger(index) || !worlds[index]) return false;
      worldIndex = index;
      return true;
    },
    selectCharacter(index: number) {
      if (pending || blocked || !Number.isInteger(index) || !characters[index]) return false;
      characterIndex = index;
      return true;
    },
    moveWorld(delta: -1 | 1) {
      if (pending || blocked || !worlds.length) return false;
      worldIndex = Math.max(0, Math.min(worlds.length - 1, worldIndex + delta));
      scroll = Math.max(
        0,
        Math.min(worldIndex, Math.max(scroll, worldIndex - WORLD_UI.visibleRows + 1)),
      );
      return true;
    },
    moveCharacter(delta: -1 | 1) {
      if (pending || blocked || !characters.length) return false;
      characterIndex = Math.max(0, Math.min(characters.length - 1, characterIndex + delta));
      return true;
    },
    scrollWorlds(delta: number) {
      if (pending || blocked || !Number.isFinite(delta)) return false;
      scroll = Math.max(0, Math.min(lastScroll(), scroll + Math.sign(delta)));
      return true;
    },
    connectWorld(): LoginSelectionRequest | undefined {
      if (!canConnect()) return undefined;
      pending = true;
      return { t: "world", index: worldIndex };
    },
    enterCharacter(): LoginSelectionRequest | undefined {
      const character = selected();
      if (!canEnter() || !character) return undefined;
      pending = true;
      return { t: "character", id: character.id };
    },
  };
}
export type LoginSelection = ReturnType<typeof loginSelection>;
