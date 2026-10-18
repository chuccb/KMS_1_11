export interface GameSettings {
  minimap: boolean;
  whisper: boolean;
  messenger: boolean;
  exchange: boolean;
  party: boolean;
  game: boolean;
}
/** CConfig+20..40: 43D360 defaults to 1. CUIGameOpt 52D0B0 previews through 43DE80.
 * Only minimap/whisper have browser consumers. Remaining flags stay visible but disabled.
 */
export const GAME_DEFAULTS: Readonly<GameSettings> = Object.freeze({
  minimap: true,
  whisper: true,
  messenger: true,
  exchange: true,
  party: true,
  game: true,
});
export function gameSettings(value: unknown): GameSettings {
  const input = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const result = { ...GAME_DEFAULTS };
  for (const key of Object.keys(result) as (keyof GameSettings)[]) {
    if (typeof input[key] === "boolean") result[key] = input[key];
  }
  return result;
}
export function gameProfile(storage?: {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}): {
  values(): GameSettings;
  save(value: unknown): GameSettings;
} {
  let raw: unknown;
  try {
    raw = JSON.parse(storage?.getItem("kms111.gameSettings") ?? "null");
  } catch {}
  // Respect a user's earlier explicit M choice when migrating the browser-only minimap profile.
  if (!raw || typeof raw !== "object") {
    let minimap: unknown;
    try {
      const stored: unknown = JSON.parse(storage?.getItem("kms111.minimap") ?? "null");
      if (stored && typeof stored === "object" && "shown" in stored) minimap = stored.shown;
    } catch {}
    raw = { minimap };
  }
  let saved = gameSettings(raw);
  return {
    values: () => ({ ...saved }),
    save(value) {
      saved = gameSettings(value);
      try {
        storage?.setItem("kms111.gameSettings", JSON.stringify(saved));
      } catch {}
      return { ...saved };
    },
  };
}
