import {
  isBrowserMapArtResource,
  isBrowserMapName,
  isBrowserMapResource,
  type BrowserMapArtResource,
  type BrowserMapName,
  type BrowserMapResource,
} from "./map-resources.ts";

export interface MapResourceJsonResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export type MapResourceFetcher = (url: string) => Promise<MapResourceJsonResponse>;

export type BrowserMapArtResult =
  | { readonly kind: "ready"; readonly art: BrowserMapArtResource }
  | { readonly kind: "http-error"; readonly status: number }
  | { readonly kind: "stale" };

/** Resolve a map label for `/find`; absent or malformed metadata keeps the caller's ID fallback. */
export async function fetchBrowserMapName(
  mapId: number,
  fetcher: MapResourceFetcher = fetch,
): Promise<BrowserMapName | undefined> {
  try {
    const response = await fetcher(`/api/map/${mapId}`);
    if (!response.ok) return undefined;
    const payload: unknown = await response.json();
    return isBrowserMapName(payload) && payload.id === mapId ? payload : undefined;
  } catch {
    return undefined;
  }
}

/** Fetch and validate a map only while the requesting field generation still owns the response. */
export async function fetchBrowserMapResource(
  mapId: number,
  isCurrent: () => boolean,
  fetcher: MapResourceFetcher = fetch,
): Promise<BrowserMapResource | undefined> {
  const response = await fetcher(`/api/map/${mapId}`);
  if (!response.ok) throw new Error(`map ${mapId}: HTTP ${response.status}`);

  const payload: unknown = await response.json();
  if (!isCurrent()) return undefined;
  if (!isBrowserMapResource(payload) || payload.id !== mapId)
    throw new Error(`map ${mapId}: invalid map resource`);
  return payload;
}

/** Map art is optional; preserve a missing-art result separately from malformed JSON or stale work. */
export async function fetchBrowserMapArtResource(
  mapId: number,
  isCurrent: () => boolean,
  fetcher: MapResourceFetcher = fetch,
): Promise<BrowserMapArtResult> {
  const response = await fetcher(`/api/map/${mapId}/art`);
  if (!response.ok) return { kind: "http-error", status: response.status };

  const payload: unknown = await response.json();
  if (!isCurrent()) return { kind: "stale" };
  if (!isBrowserMapArtResource(payload)) throw new Error(`map ${mapId}: invalid map art resource`);
  return { kind: "ready", art: payload };
}
