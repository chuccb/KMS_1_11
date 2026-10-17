export interface StatRequirements {
  level: number;
  job: number;
  str: number;
  dex: number;
  int: number;
  luk: number;
}
export interface StatItem {
  slot: number;
  itemId: number;
  stats?: Partial<Record<string, number>>;
  requirements?: StatRequirements;
}
export interface StatInput {
  job: number;
  level: number;
  gender: number;
  str: number;
  dex: number;
  int: number;
  luk: number;
  maxHp: number;
  maxMp: number;
}
export interface StatBasis {
  basic: {
    job: number;
    level: number;
    str: number;
    dex: number;
    int: number;
    luk: number;
    maxHp: number;
    maxMp: number;
  };
  secondary: Record<string, number>;
  weaponId: number;
  effectiveSlots: number[];
}
export function signedEquipStat(n?: number): number;
export function effectiveWorn(
  stats: StatInput,
  worn?: StatItem[],
  excluded?: number[],
): StatItem[];
export function statBasis(
  stats: StatInput,
  worn?: StatItem[],
  passives?: {
    amazonAccuracy?: number;
    nimbleAccuracy?: number;
    nimbleAvoid?: number;
  },
): StatBasis;
export function statTotals(
  basis: StatBasis,
  temporary?: Partial<Record<string, number>>,
): Record<string, number>;
export function detailRows(
  basis: StatBasis,
  temporary?: Partial<Record<string, number>>,
  ammoPad?: number,
): string[];
