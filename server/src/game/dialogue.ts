/**
 * Talking to an NPC: where the words come from, and the little state one conversation has.
 *
 * The `0x47` packet carries the text itself (`protocol/quest.ts`), so the server has to *have* the
 * text. It does not have to invent it: this build keeps every NPC's lines in the NPC's own image.
 *
 *   Npc/<7-digit id>.img
 *     info
 *       name    "로빈"
 *       quest   "begin5"          <- the script name this build carries for the NPC
 *       speak   0 = "여기는 몬스터들이 나오니까 특히 조심해야 해!"
 *               1 = "왼쪽 ctrl 키를 누르면 ..."
 *               ...               <- the lines, in index order
 *
 * (`wz dump Npc/0002003.img` prints exactly that; the animation groups below `info` each carry a
 * `speak` list of their own, which is what the client shows while the NPC is in that animation -
 * a wrinkle for the day the server drives NPC animation, not for `info/speak`, which is the "just
 * standing there" list this server uses.)
 *
 * `info/quest` is read but never interpreted: what a script name means is the business of a quest
 * system, and this client has none (its `0x46`/`0x48` have no handler and `0x47` is dialogs only,
 * FINDINGS 4.23). Carrying it in the template means the day one is found, the data is already here.
 *
 * The same `Npc/<id>.img` rule `game/npcs.ts` applies holds: an image that is not in the archive is
 * a data problem, and a `life` entry that has one but no `speak` list simply says nothing - the
 * server then answers a click with the release byte alone rather than with an empty dialog.
 */
import type { WzArchive } from "../wz/archive.ts";
import { asText, entriesOf, infoOf } from "../wz/props.ts";
import { npcImagePath } from "../wz/paths.ts";
import { encodeQuestTalk } from "../protocol/quest.ts";

/** What the server knows about how one NPC talks, straight out of `Npc/<id>.img -> info`. */
export interface NpcDialogue {
  templateId: number;
  /** `info.name` (the Korean name the client shows and the server's logs use). */
  name: string;
  /** `info.speak`'s lines in index order - a numeric property list, not an array. */
  lines: string[];
  /** `info/quest`, when the image names one. Read, carried, not interpreted. */
  quest?: string;
}

/**
 * Turn an `info` record (`wz/props.ts`'s `infoOf`) into the dialogue, without an archive.
 *
 * Exported because it is the whole conversion: `info/speak` is a `Property` whose entries are named
 * `"0"`, `"1"`, ... - the order in the file is index order, but the *names* are the index, so the
 * entries are sorted by the number they spell (a file may list them in any order) and non-numeric
 * names are refused rather than guessed at.
 */
export function dialogueFromInfo(templateId: number, info: Record<string, unknown>): NpcDialogue {
  const names = new Map<number, string>();
  for (const entry of entriesOf(info.speak)) {
    const index = Number(entry.name);
    if (!Number.isInteger(index) || index < 0) continue;
    const text = asText(entry.value);
    if (text !== "") names.set(index, text);
  }
  const lines: string[] = [];
  const ordered = [...names.keys()].sort((a, b) => a - b);
  for (const index of ordered) lines.push(names.get(index)!);
  const quest = asText(info.quest);
  return {
    templateId,
    name: asText(info.name),
    lines,
    ...(quest === "" ? {} : { quest }),
  };
}

/** `Npc/<id>.img -> info` as a dialogue, or `undefined` when the image does not exist. */
export function npcDialogueFrom(archive: WzArchive, templateId: number): NpcDialogue | undefined {
  const path = npcImagePath(templateId);
  if (!archive.has(path)) return undefined;
  return dialogueFromInfo(templateId, infoOf(archive.objects(path)[0]));
}

/** Caches `npcDialogueFrom` per id, the way `npcTemplateProvider` caches names. */
export function npcDialogueProvider(archive: WzArchive): (templateId: number) => NpcDialogue | undefined {
  const cache = new Map<number, NpcDialogue | undefined>();
  return (templateId: number) => {
    if (!cache.has(templateId)) cache.set(templateId, npcDialogueFrom(archive, templateId));
    return cache.get(templateId);
  };
}

/**
 * One conversation: the NPC, its lines, and how far the player has read.
 *
 * The client runs a `CUtilDlg` **modally** inside the `0x47` handler and refuses a second `0x47`
 * while it is up (`CQuestMan+4`, FINDINGS 4.23), so a conversation is a strict turn-taking pair:
 * one packet out, one `0x15` in. That is exactly what this class holds - the current line, and the
 * next one to send - and nothing else: no timers, no ids, no copy of what the client shows.
 */
export class NpcTalk {
  /** The NPC's pool id (`0x39`'s `npcId`), i.e. what the client's `0x33` named. */
  readonly npcId: number;
  /** `life.id`, for logs. */
  readonly templateId: number;
  private readonly lines: readonly string[];
  private index = 0;

  // `lines: string[]`, not `readonly string[]`: the hygiene guard reads a `readonly` inside a
  // constructor's parameter list as a parameter property, which strip-only mode rejects.
  constructor(npcId: number, templateId: number, lines: string[]) {
    if (lines.length === 0) {
      throw new RangeError(`NpcTalk for ${templateId} has no lines: there is nothing to say`);
    }
    this.npcId = npcId;
    this.templateId = templateId;
    this.lines = lines;
  }

  /** Which line `packet()` would send, 0-based. */
  get lineIndex(): number {
    return this.index;
  }

  get lineCount(): number {
    return this.lines.length;
  }

  /** The `0x47` for the line the player has not read yet. */
  packet(): Uint8Array {
    return encodeQuestTalk({
      unknownA: 0,
      npcId: this.npcId,
      body: { kind: "say", message: this.lines[this.index]! },
    });
  }

  /**
   * The next line's packet, or `undefined` once the last one has been sent - the server sends
   * nothing more and the conversation is over, which is the client's own "the dialog closed" state.
   */
  advance(): Uint8Array | undefined {
    if (this.index + 1 >= this.lines.length) return undefined;
    this.index += 1;
    return this.packet();
  }
}
