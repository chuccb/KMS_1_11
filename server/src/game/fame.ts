/**
 * 人氣的規則：誰能給、一天一次、同一個對象一個月一次。
 *
 * 這一層不知道封包，也不知道 socket（跟 `game/parties.ts` 一樣）：輸入是「給的人幾等、被給的人
 * 現在幾點人氣、給的人這個月給過誰、今天是幾號」，輸出是「成功（新的人氣值與新的紀錄）或哪一種
 * 拒絕」；`net/loginserver.ts` 負責把結果變成 `0x12`。
 *
 * **三條界線都是我們的選擇**（client 只證明得出訊息與順序，原伺服器的數字不在 binary 裡）：
 *
 * 1. **初學者幾等**：`FAME_MIN_LEVEL = 15`。client 自己沒有任何等級檢查（它只擋 5 分鐘的冷卻），
 *    所以「초보자는 인기도를…」那句一定是伺服器說的；15 是 2003 年的常識值，列在 ADR-031。
 * 2. **誰被算進「今天」**：`day`／`month` 是 UTC 的日序號與月序號（`fameClock`），不是「上線多久」。
 * 3. **順序**：自己 → 初學者 → 這個月給過同一個人（`type 4`）→ 今天已經給過（`type 3`）。
 *    同一個人、同一天再給一次時 client 顯示的是「這個月」那一句，所以月比日先問（ADR-031）。
 *
 * 紀錄（`FameLedger`）掛在世界層的 `FameLedgers` 上，**不進存檔**：它不是角色狀態的一部分（`0x0D`
 * 不會送它、`CharacterData` 也沒有那一格），而且 2003 年的伺服器怎麼記這件事看不出來——重開伺服器
 * 就重新開始，列在 FINDINGS §4.38 的 OPEN。
 */

/** 給人氣的配額：哪一天給過、哪一個月、這個月給過誰。 */
export interface FameLedger {
  /** UTC 日序號（`Math.floor(epochMs / 86400000)`）。 */
  day: number;
  /** UTC 月序號（`年 * 12 + 月`，月從 0 起算）。 */
  month: number;
  /** 這個月給過的角色 id。 */
  targets: readonly number[];
}

/** 一次「給人氣」的答案。 */
export type FameOutcome =
  { kind: "ok"; fame: number; ledger: FameLedger } | { kind: "refused"; reason: FameRefusal };

/** 拒絕的理由，一一對應 `0x12` 的 type（`self` 走「什麼都不顯示」那一格）。 */
export type FameRefusal = "self" | "beginner" | "alreadyThisMonth" | "alreadyToday";

/** 初學者的界線（我們的選擇，ADR-031）。 */
export const FAME_MIN_LEVEL = 15;

/** 人氣在紀錄裡是 u16（`sub_45E0D0` 的 `0x20000` 讀 4 byte、只留 2 byte）。 */
export const FAME_MAX = 0xffff;

/** 「今天」與「這個月」。 */
export interface FameClock {
  day: number;
  month: number;
}

/** 由一個時間（毫秒）算出日與月的序號；UTC，所以重開機或換時區都不會讓配額跳動。 */
export function fameClock(now: number): FameClock {
  const date = new Date(now);
  return {
    day: Math.floor(now / 86_400_000),
    month: date.getUTCFullYear() * 12 + date.getUTCMonth(),
  };
}

/** 一次請求的全部輸入。 */
export interface FameAttempt {
  giverId: number;
  giverLevel: number;
  targetId: number;
  /** true ＝ 往上（`인기도 +`），false ＝ 往下。 */
  up: boolean;
  /** 被給的人現在的人氣（`stats.fame`）。 */
  targetFame: number;
  /** 給的人上一次的紀錄，沒有就是 `undefined`。 */
  ledger: FameLedger | undefined;
  clock: FameClock;
}

/**
 * 判一次「給人氣」。成功時回新的 `fame` 與新的紀錄，呼叫端負責寫回並送包。
 *
 * 人氣夾在 `[0, FAME_MAX]`：往下給 0 分的人不會變成 −1（紀錄是 u16，負數在線上沒有表示法）。
 */
export function applyFame(attempt: FameAttempt): FameOutcome {
  const { giverId, giverLevel, targetId, up, targetFame, ledger, clock } = attempt;
  if (targetId === giverId) return { kind: "refused", reason: "self" };
  if (giverLevel < FAME_MIN_LEVEL) return { kind: "refused", reason: "beginner" };
  const thisMonth = ledger !== undefined && ledger.month === clock.month;
  if (thisMonth && ledger.targets.includes(targetId)) {
    return { kind: "refused", reason: "alreadyThisMonth" };
  }
  if (ledger !== undefined && ledger.day === clock.day) {
    return { kind: "refused", reason: "alreadyToday" };
  }
  const fame = Math.max(0, Math.min(FAME_MAX, targetFame + (up ? 1 : -1)));
  return {
    kind: "ok",
    fame,
    ledger: {
      day: clock.day,
      month: clock.month,
      targets: thisMonth ? [...ledger.targets, targetId] : [targetId],
    },
  };
}

/** 誰給過誰：世界層的一張表（`GameEntryServer` 持有，跟 `PartyRegistry` 一樣）。 */
export class FameLedgers {
  private readonly ledgers = new Map<number, FameLedger>();

  /** 這個角色上一次的紀錄。 */
  ledgerOf(characterId: number): FameLedger | undefined {
    return this.ledgers.get(characterId);
  }

  /** 記下新的一份（覆蓋舊的）。 */
  remember(characterId: number, ledger: FameLedger): void {
    this.ledgers.set(characterId, ledger);
  }

  /** 這個角色下線時可以清掉（配額跟著連線走）；目前留著，因為它很小而且重登不該洗白。 */
  forget(characterId: number): void {
    this.ledgers.delete(characterId);
  }

  /** 現在記了幾個角色（測試與日誌用）。 */
  get count(): number {
    return this.ledgers.size;
  }
}
