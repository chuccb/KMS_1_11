import { MAX_MAP_COMMAND_ID, RETURN_MAP_NONE } from "./map-constants.ts";
import { isMapDestinations } from "./ui-resource-validation.ts";

export type MapCommand =
  | { kind: "warp"; mapId: number }
  | { kind: "invalid-warp" }
  | { kind: "search"; query: string }
  | { kind: "where" };

/** Parse the browser's map commands without confusing local help with a server request. */
export function parseMapCommand(text: string): MapCommand | undefined {
  const warp = /^\/(map|warp|go|헉맵)(?:\s+(.*))?$/i.exec(text);
  if (warp) {
    const candidate = /^\d+$/.test(warp[2] ?? "") ? Number(warp[2]) : Number.NaN;
    return Number.isSafeInteger(candidate) &&
      candidate >= 0 &&
      candidate <= MAX_MAP_COMMAND_ID &&
      candidate !== RETURN_MAP_NONE
      ? { kind: "warp", mapId: candidate }
      : { kind: "invalid-warp" };
  }

  const maps = /^\/maps(?:\s+(.*))?$/i.exec(text);
  if (maps) return { kind: "search", query: maps[1] ?? "" };
  if (/^\/where$/i.test(text)) return { kind: "where" };
  return undefined;
}

export interface MapCatalogResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}
export type MapCatalogFetcher = (input: string) => Promise<MapCatalogResponse>;
export interface MapSearchMessage {
  channel: "地圖" | "系統";
  text: string;
}

const MAP_CATALOG_PATH = "/api/maps";
const MAP_SEARCH_VISIBLE_LIMIT = 20;

/** Fetch, validate and present `/maps` results; callers provide fetch for deterministic tests. */
export async function mapSearchMessages(
  query: string,
  fetcher: MapCatalogFetcher,
): Promise<MapSearchMessage[]> {
  try {
    const response = await fetcher(MAP_CATALOG_PATH);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const payload: unknown = await response.json();
    if (!isMapDestinations(payload))
      return [{ channel: "系統", text: "地圖清單讀取失敗：地圖清單格式錯誤。" }];

    const needle = query.toLowerCase();
    const matches = payload.filter((map) =>
      `${map.id} ${map.name} ${map.streetName}`.toLowerCase().includes(needle),
    );
    const messages: MapSearchMessage[] = matches.slice(0, MAP_SEARCH_VISIBLE_LIMIT).map((map) => ({
      channel: "地圖",
      text: `${map.id} · ${map.streetName} / ${map.name}`,
    }));
    messages.push({
      channel: "系統",
      text: matches.length
        ? `共 ${matches.length} 筆${
            matches.length > MAP_SEARCH_VISIBLE_LIMIT ? "，先顯示20筆；可加關鍵字縮小範圍" : ""
          }。/map ID 前往。`
        : "沒有符合的地圖。",
    });
    return messages;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return [{ channel: "系統", text: `地圖清單讀取失敗：${reason}` }];
  }
}
