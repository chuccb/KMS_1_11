import type { ClientStatReport } from "../server/src/protocol/field.ts";
import type { SkillInfo } from "../server/src/game/skills.ts";
import type { SkillChange } from "../server/src/protocol/skills.ts";
import { isSkillCatalogue, type SkillCatalogue } from "./combat-resource-validation.ts";
export interface RecoveryInput {
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  action: number;
  stationary: boolean;
  rate?: number;
  hpBonus?: number;
  mpBonus?: number;
  climbMs?: number;
}
interface RecoveryOptions {
  getSelf():
    | (Pick<RecoveryInput, "hp" | "maxHp" | "mp" | "maxMp"> & { job: number; mapId: number })
    | undefined;
  getBody(): { x: number; y: number; vx: number; vy: number } | undefined;
  getMap(): { id: number; recovery?: number } | undefined;
  getAction(): number;
  isInGame(): boolean;
  send(report: ClientStatReport & { t: "recovery" }): unknown;
  log(error: string): void;
}
/** CWvsApp::558950: 30ms simulation, independent HP/MP clocks. No local vital mutation. */
export function recoveryTick(
  clock: { hp: number; mp: number },
  input: RecoveryInput,
): ClientStatReport[] {
  const {
    hp,
    maxHp,
    mp,
    maxMp,
    action,
    stationary,
    rate = 1,
    hpBonus = 0,
    mpBonus = 0,
    climbMs = 0,
  } = input;
  const reports = [];
  const climb = action === 36 || action === 37;
  const interval = climb ? climbMs : 10000;
  if (hp > 0 && maxHp > hp && stationary && (climb ? interval > 0 : action === 2 || action === 3)) {
    clock.hp += 30;
    if (clock.hp >= interval) {
      const amount = Math.min(maxHp - hp, Math.trunc((10 + hpBonus) * rate));
      if (amount > 0) reports.push({ hpDelta: amount, flag: climb ? 1 : 0 });
      clock.hp = 0;
    }
  } else clock.hp = 0;
  if (hp > 0 && maxMp > mp) {
    clock.mp += 30;
    if (clock.mp >= 10000) {
      const amount = Math.min(maxMp - mp, Math.trunc((3 + mpBonus) * rate));
      if (amount > 0) reports.push({ mpDelta: amount, flag: 0 });
      clock.mp = 0;
    }
  } else clock.mp = 0;
  return reports;
}
/** Read numerical WZ hp/mp/time at the clamped learned level, never parse hs. */
export function recoveryBonuses(
  job: number,
  learned: ReadonlyMap<number, number>,
  skills: ReadonlyMap<number, Pick<SkillInfo, "maxLevel" | "levels">>,
) {
  const value = (id: number, key: string) => {
    const s = skills.get(id),
      n = learned.get(id) ?? 0;
    if (!s || !Number.isInteger(n) || n <= 0) return 0;
    const v = s.levels.find((r) => r.level === Math.min(n, s.maxLevel))?.values[key];
    return v !== undefined && Number.isFinite(v) ? v : 0;
  };
  const climbId =
    Math.trunc(job / 100) === 1
      ? 1000002
      : Math.trunc(job / 10) === 41
        ? 4100001
        : Math.trunc(job / 10) === 42
          ? 4200001
          : 0;
  return {
    hpBonus: value(1000000, "hp"),
    mpBonus: value(2000000, "mp"),
    climbMs: 1000 * value(climbId, "time"),
  };
}
export function naturalRecovery({
  getSelf,
  getBody,
  getMap,
  getAction,
  isInGame,
  send,
  log,
}: RecoveryOptions) {
  let clock = { hp: 0, mp: 0 },
    remainder = 0,
    lastPosition: { x: number; y: number } | undefined,
    job: number | undefined,
    epoch = 0,
    ready = false,
    retryAt = 0;
  let learned = new Map<number, number>(),
    skills = new Map<number, SkillInfo>();
  const catalogs = new Map<number, SkillCatalogue>();
  function reset() {
    clock = { hp: 0, mp: 0 };
    remainder = 0;
    lastPosition = undefined;
  }
  async function load(current: number) {
    job = current;
    ready = false;
    retryAt = Infinity;
    skills = new Map();
    reset();
    const token = ++epoch;
    try {
      // Native CSkillInfo is global: retained learned recovery skills are not filtered by current job.
      const data = await Promise.all(
        [...new Set([current, 100, 200])].map(async (id) => {
          let value = catalogs.get(id);
          if (!value) {
            const r = await fetch(`/api/skills/${id}`);
            if (!r.ok) throw new Error(`恢復被動資料讀取失敗：HTTP ${r.status}`);
            const payload: unknown = await r.json();
            if (!isSkillCatalogue(payload) || payload.job !== id)
              throw new Error("Invalid skill catalogue");
            value = payload;
            catalogs.set(id, value);
          }
          return value;
        }),
      );
      if (token !== epoch) return;
      skills = new Map(
        data.flatMap((d) => d.books.flatMap((b) => b.skills.map((s) => [s.id, s] as const))),
      );
      ready = true;
    } catch (error) {
      if (token === epoch) {
        retryAt = performance.now() + 5000;
        log(String(error));
      }
    }
  }
  return {
    reset,
    receive(message: { t: string; skills?: readonly SkillChange[] }) {
      if (message.t === "skills" && message.skills)
        learned = new Map(message.skills.map((s) => [s.skillId, s.level]));
      if (["field", "disconnect", "login"].includes(message.t)) {
        ++epoch;
        job = undefined;
        ready = false;
        learned.clear();
        reset();
      }
    },
    step(elapsed: number) {
      const self = getSelf(),
        body = getBody(),
        map = getMap();
      if (!isInGame() || !self || !body || !map || map.id !== self.mapId) {
        reset();
        return;
      }
      if (job !== self.job || (!ready && performance.now() >= retryAt)) {
        void load(self.job);
        return;
      }
      if (!ready) return;
      const stationary =
        !!lastPosition &&
        body.x === lastPosition.x &&
        body.y === lastPosition.y &&
        body.vx === 0 &&
        body.vy === 0;
      lastPosition = { x: body.x, y: body.y };
      if (!stationary) clock.hp = 0;
      remainder += Math.max(0, Math.min(250, elapsed)); // Never award hours of background-tab catchup.
      const bonuses = recoveryBonuses(self.job, learned, skills);
      while (remainder >= 30) {
        remainder -= 30;
        for (const report of recoveryTick(clock, {
          ...self,
          ...bonuses,
          action: getAction(),
          stationary,
          rate: map.recovery ?? 1,
        }))
          send({ t: "recovery", ...report });
      }
    },
  };
}
