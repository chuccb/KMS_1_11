/** Shared receive-only archive metadata cache. A network/HTTP/JSON failure is NOT a missing WZ
 * item. Only404 is negatively cached; transient failures retry after a bounded browser cooldown.
 * Identity/label + existing tooltip projection are checked, not a claim of a full native item schema.
 */
import { isRecord, isTooltipFacts, isTooltipIcon } from "./resource-validation.ts";
export interface ItemMetadata extends Readonly<Record<string, unknown>> {
  readonly id: number;
  readonly name?: string;
}
interface ItemResponse {
  readonly status: number;
  json(): Promise<unknown>;
}
export const ITEM_METADATA_POLICY = { entries: 1024, pending: 64, retryMs: 1000 } as const;
export function readItemMetadata(value: unknown, id: number): ItemMetadata {
  if (
    !Number.isInteger(id) ||
    id < 0 ||
    id > 0xffffffff ||
    !isRecord(value) ||
    value.id !== id ||
    !isTooltipFacts(value)
  )
    throw Error(`Invalid archive item metadata ${id}`);
  for (const key of ["price", "unitPrice", "slotMax", "incPAD"])
    if (
      value[key] !== undefined &&
      (typeof value[key] !== "number" || !Number.isFinite(value[key]))
    )
      throw Error(`Invalid item ${key}`);
  if (value.iconRaw !== undefined && !isTooltipIcon(value.iconRaw))
    throw Error("Invalid raw item icon");
  if (value.sfx !== undefined && typeof value.sfx !== "string")
    throw Error("Invalid item sound family");
  if (value.cash !== undefined && typeof value.cash !== "boolean")
    throw Error("Invalid item cash flag");
  return Object.freeze({
    ...value,
    id,
    name: typeof value.name === "string" ? value.name : undefined,
  });
}
export function itemMetadataCache(options: {
  read(id: number, signal: AbortSignal): Promise<ItemResponse>;
  now(): number;
  onError(error: unknown): void;
}) {
  const entries = new Map<number, ItemMetadata | null>(),
    pending = new Map<number, Promise<ItemMetadata | null | undefined>>(),
    retryAt = new Map<number, number>();
  const signals = new Map<number, AbortController>();
  let epoch = 0,
    disposed = false;
  function remember<T>(map: Map<number, T>, id: number, value: T) {
    if (!map.has(id) && map.size >= ITEM_METADATA_POLICY.entries)
      map.delete(map.keys().next().value!);
    map.set(id, value);
  }
  function load(id: number): Promise<ItemMetadata | null | undefined> {
    if (disposed) return Promise.resolve(undefined);
    if (!Number.isInteger(id) || id < 0 || id > 0xffffffff) {
      options.onError(Error("Invalid item id"));
      return Promise.resolve(undefined);
    }
    if (entries.has(id)) return Promise.resolve(entries.get(id));
    const inflight = pending.get(id);
    if (inflight) return inflight;
    if ((retryAt.get(id) ?? -Infinity) > options.now()) return Promise.resolve(undefined);
    if (pending.size >= ITEM_METADATA_POLICY.pending) {
      options.onError(Error("Item metadata request budget exhausted"));
      return Promise.resolve(undefined);
    }
    const generation = epoch,
      abort = new AbortController();
    signals.set(id, abort);
    const task = Promise.resolve()
      .then(() => {
        if (disposed || epoch !== generation) return;
        return options.read(id, abort.signal);
      })
      .then(async (response) => {
        if (disposed || epoch !== generation || !response) return;
        if (response.status === 404) {
          remember(entries, id, null);
          retryAt.delete(id);
          return null;
        }
        if (response.status < 200 || response.status >= 300)
          throw Error(`Item metadata HTTP${response.status}: ${id}`);
        const facts = readItemMetadata(await response.json(), id);
        if (disposed || epoch !== generation) return;
        remember(entries, id, facts);
        retryAt.delete(id);
        return facts;
      })
      .catch((error) => {
        if (!disposed && epoch === generation) {
          remember(retryAt, id, options.now() + ITEM_METADATA_POLICY.retryMs);
          options.onError(error);
        }
        return undefined;
      })
      .finally(() => {
        if (epoch === generation) {
          pending.delete(id);
          signals.delete(id);
        }
      });
    pending.set(id, task);
    return task;
  }
  function clear() {
    epoch++;
    for (const abort of signals.values()) abort.abort();
    signals.clear();
    entries.clear();
    pending.clear();
    retryAt.clear();
  }
  const view: ReadonlyMap<number, ItemMetadata | null> = entries;
  return {
    entries: view,
    load,
    clear,
    dispose() {
      if (disposed) return;
      disposed = true;
      clear();
    },
  };
}
