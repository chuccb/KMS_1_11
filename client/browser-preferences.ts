import { isFiniteNumber, isRecord } from "./resource-validation.ts";
import type { UiPoint } from "./ui-types.ts";

export interface BrowserPreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

/** Minimum shop edge kept visible so a dragged sheet can be recovered; browser policy, not native. */
export const SHOP_POSITION_MIN_VISIBLE = { width: 48, height: 32 } as const;

const INVENTORY_POSITION_KEY = "kms111.inventoryAt";
const SHOP_POSITION_KEY = "kms111.shopAt";
const INVENTORY_TAB_KEY = "kms111.inventoryTab";

/** localStorage can be unavailable in restricted browser contexts; acquire it only when needed. */
export function browserPreferenceStorage(): BrowserPreferenceStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function readStoredPoint(
  storage: BrowserPreferenceStorage | undefined,
  key: string,
): UiPoint | undefined {
  try {
    const value: unknown = JSON.parse(storage?.getItem(key) ?? "null");
    if (!isRecord(value) || !isFiniteNumber(value.x) || !isFiniteNumber(value.y)) return undefined;
    return { x: value.x, y: value.y };
  } catch {
    return undefined;
  }
}

function writeStoredPoint(
  storage: BrowserPreferenceStorage | undefined,
  key: string,
  position: UiPoint,
): void {
  try {
    storage?.setItem(key, JSON.stringify(position));
  } catch {
    // A blocked preference store must never prevent a window from opening or releasing a drag.
  }
}

/** Inventory windows retain any finite saved point; unlike the shop, this path is not clamped. */
export function loadInventoryWindowPosition(
  storage: BrowserPreferenceStorage | undefined,
  fallback: UiPoint,
): UiPoint {
  const saved = readStoredPoint(storage, INVENTORY_POSITION_KEY);
  return saved ?? { x: fallback.x, y: fallback.y };
}

export function saveInventoryWindowPosition(
  storage: BrowserPreferenceStorage | undefined,
  position: UiPoint,
): void {
  writeStoredPoint(storage, INVENTORY_POSITION_KEY, position);
}

/** Restore the shop's rounded position while keeping the browser-defined grab strips on-screen. */
export function loadShopWindowPosition(
  storage: BrowserPreferenceStorage | undefined,
  fallback: UiPoint,
  viewport: ViewportSize,
  windowWidth: number,
): UiPoint {
  const saved = readStoredPoint(storage, SHOP_POSITION_KEY);
  if (!saved) return { x: fallback.x, y: fallback.y };

  return {
    x: Math.max(
      -windowWidth + SHOP_POSITION_MIN_VISIBLE.width,
      Math.min(viewport.width - SHOP_POSITION_MIN_VISIBLE.width, Math.round(saved.x)),
    ),
    y: Math.max(
      0,
      Math.min(viewport.height - SHOP_POSITION_MIN_VISIBLE.height, Math.round(saved.y)),
    ),
  };
}

export function saveShopWindowPosition(
  storage: BrowserPreferenceStorage | undefined,
  position: UiPoint,
): void {
  writeStoredPoint(storage, SHOP_POSITION_KEY, position);
}

/** CConfig's default tab is EQUIP (1); only the four real inventory tabs may replace it. */
export function loadInventoryTab(
  storage: BrowserPreferenceStorage | undefined,
  fallback = 1,
): number {
  try {
    const saved = Number(storage?.getItem(INVENTORY_TAB_KEY));
    return Number.isInteger(saved) && saved >= 1 && saved <= 4 ? saved : fallback;
  } catch {
    return fallback;
  }
}

export function saveInventoryTab(storage: BrowserPreferenceStorage | undefined, tab: number): void {
  try {
    storage?.setItem(INVENTORY_TAB_KEY, String(tab));
  } catch {
    // A blocked preference store must not interrupt an inventory action.
  }
}
