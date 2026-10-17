/** Ability/skill checkpoint planner, NOT native rules. No EXP, items, mesos or map edits here.
 * The separate fixed-item preview grant is handled by the authenticated server entry point. */
import { NATIVE_JOB_NAMES } from "../../../client/jobs.mjs";
import type {
  CharacterData,
  CharacterStats,
  InventoryRecord,
} from "../protocol/chardata.ts";
import type { StatDiff } from "../protocol/stat.ts";
import type { SkillChange } from "../protocol/skills.ts";
import { learnedSkills } from "./skills.ts";
export const TEST_STAT_KEYS = [
  "job",
  "str",
  "dex",
  "int",
  "luk",
  "ap",
  "sp",
  "hp",
  "maxHp",
  "mp",
  "maxMp",
] as const;
type TestStats = Pick<CharacterStats, (typeof TEST_STAT_KEYS)[number]>;
export interface TestCheckpoint {
  level: number;
  stats: TestStats;
  skills: InventoryRecord[];
}
export interface TestToolResult {
  enabled: boolean;
  message: string;
  checkpoint: boolean;
  canMap: boolean;
  restoreAvailable: boolean;
  jobs: { id: number; name: string }[];
}
export function captureTestCheckpoint(
  character: CharacterData,
): TestCheckpoint {
  return {
    level: character.stats.level,
    stats: Object.fromEntries(
      TEST_STAT_KEYS.map((k) => [k, character.stats[k]]),
    ) as TestStats,
    skills: structuredClone(character.items?.map32 ?? []),
  };
}
export function testToolKind(value: unknown): string {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof (value as { kind?: unknown }).kind !== "string"
  )
    throw new Error("Invalid test-tool request");
  return (value as { kind: string }).kind;
}
/** Prepare and validate without mutating the live record; caller pre-encodes before applying. */
export function planTestTool(
  character: CharacterData,
  value: unknown,
  checkpoint: TestCheckpoint | undefined,
  jobAvailable: (job: number) => boolean,
  caps: Pick<CharacterStats, "maxHp" | "maxMp"> = character.stats,
) {
  const kind = testToolKind(value),
    request = value as Record<string, unknown>;
  if (request.confirmed !== true)
    throw new Error(
      "體驗工具需要明確確認；這不是原版規則，變更會保存至目前角色。",
    );
  const point = checkpoint ?? captureTestCheckpoint(character);
  const stats = {
    ...point.stats,
    ...Object.fromEntries(TEST_STAT_KEYS.map((k) => [k, character.stats[k]])),
  } as TestStats;
  let skills: InventoryRecord[] | undefined,
    nextPoint = point,
    message = "";
  switch (kind) {
    case "checkpoint":
      nextPoint = captureTestCheckpoint(character);
      message =
        "已記住目前能力與已學技能（僅本次服務存活期間；不含EXP／道具／金錢／位置）。";
      break;
    case "configure": {
      const job = request.job,
        ap = request.ap,
        sp = request.sp;
      if (
        typeof job !== "number" ||
        !Number.isInteger(job) ||
        !NATIVE_JOB_NAMES.has(job) ||
        !jobAvailable(job)
      )
        throw new Error("此職業沒有可用的原始技能書。");
      if (
        ![ap, sp].every(
          (n) =>
            typeof n === "number" &&
            Number.isInteger(n) &&
            n >= 0 &&
            n <= 32767,
        )
      )
        throw new Error("體驗AP／SP須為0–32767的整數。");
      if (typeof request.resetSkills !== "boolean")
        throw new Error("請明確選擇是否清除已學技能。");
      stats.job = job;
      stats.ap = ap as number;
      stats.sp = sp as number;
      if (request.resetSkills) skills = [];
      message = "已套用明示的體驗職業／AP／SP；沒有執行原版轉職或自然發點。";
      break;
    }
    case "heal":
      stats.hp = caps.maxHp;
      stats.mp = caps.maxMp;
      message = "體驗補滿HP／MP；死亡時回本圖出生點。";
      break;
    case "near-death":
      if (character.stats.hp <= 0) throw new Error("請先以原復活窗復活。");
      stats.hp = 1;
      message = "非原版體驗：只將HP設為1，未直接觸發死亡，MP／道具／位置不變。關閉工具後碰怪，觀看原死亡→墓碑→復活；自然恢復可能先回HP。";
      break;
    case "drain":
      if (character.stats.hp <= 0) throw new Error("請先復活或使用體驗補滿。");
      stats.hp = Math.max(1, Math.floor(caps.maxHp / 2));
      stats.mp = Math.floor(caps.maxMp / 2);
      message = "體驗HP／MP已降至上限的一半，保留至少1HP；可觀察自然恢復。";
      break;
    case "restore":
      if (!checkpoint) throw new Error("尚未建立能力／技能還原點。");
      if (checkpoint.level !== character.stats.level)
        throw new Error(
          "角色已升級，為免覆蓋自然成長，拒絕套回舊等級能力；可重新建立還原點。",
        );
      Object.assign(stats, checkpoint.stats);
      skills = structuredClone(checkpoint.skills);
      message = "已還原能力與已學技能；EXP／道具／金錢／位置不回溯。";
      break;
    default:
      throw new Error("Unsupported test tool");
  }
  const diff: StatDiff = {};
  for (const k of TEST_STAT_KEYS)
    if (stats[k] !== character.stats[k]) Object.assign(diff, { [k]: stats[k] });
  const changes: SkillChange[] = [];
  if (skills) {
    const before = new Map(
      learnedSkills(character.items?.map32).map((s) => [s.skillId, s.level]),
    );
    const after = new Map(
      learnedSkills(skills).map((s) => [s.skillId, s.level]),
    );
    for (const id of new Set([...before.keys(), ...after.keys()]))
      if (before.get(id) !== after.get(id))
        changes.push({ skillId: id, level: after.get(id) ?? 0 });
  }
  return { diff, skills, changes, checkpoint: nextPoint, message };
}
