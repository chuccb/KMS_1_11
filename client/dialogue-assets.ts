import type { DialogueRun, DialogueIconRun, DialogueAsset } from "./npcdialogue-layout.ts";
interface DialogueAssetOptions {
  fetch?: (url: string, options: { signal: AbortSignal }) => Promise<Response>;
  image: (path: string) => { loading?: Promise<unknown> } | undefined;
  capacity?: number;
  concurrency?: number;
}
import { dialogueAssetKey } from "./npcdialogue-layout.ts";

/** Browser transport only: normal item/skill canvases, never inventory iconRaw or generated art.
 * Four metadata requests at a time; successful results bounded across pages. Per-open AbortSignal
 * prevents a closed/old map's requests from being reused as the next modal's pending work.
 */
export function dialogueAssets({
  fetch: request = globalThis.fetch,
  image,
  capacity = 128,
  concurrency = 4,
}: DialogueAssetOptions) {
  const cache = new Map<string, DialogueAsset>();
  const maxEntries = Math.max(1, Math.min(128, Math.trunc(capacity) || 128));
  const workers = Math.max(1, Math.min(4, Math.trunc(concurrency) || 4));
  async function load(runs: readonly DialogueRun[], signal: AbortSignal) {
    const unique = new Map(
      runs
        .filter((run): run is DialogueIconRun => Boolean(run.kind))
        .map((run) => [dialogueAssetKey(run), run]),
    );
    const queue = [...unique],
      result = new Map<string, DialogueAsset>();
    let cursor = 0;
    async function worker() {
      while (cursor < queue.length && !signal.aborted) {
        const [key, run] = queue[cursor++];
        let asset = cache.get(key);
        if (!asset) {
          try {
            const response = await request(
              `/api/${run.kind === "item" ? "item" : "skill"}/${run.id}`,
              { signal },
            );
            if (!response.ok) continue;
            const info = await response.json();
            if (signal.aborted) break;
            const icon = info.icon;
            // HTTP resource facts still must match the requested id/family; never evaluate markup/HTML.
            if (
              info.id !== run.id ||
              !icon ||
              typeof icon.path !== "string" ||
              !(run.kind === "item" ? /^(Item|Character)\// : /^Skill\//).test(icon.path) ||
              !Number.isInteger(icon.width) ||
              !Number.isInteger(icon.height) ||
              icon.width <= 0 ||
              icon.height <= 0 ||
              icon.width > 4096 ||
              icon.height > 4096
            )
              continue;
            asset = {
              name: typeof info.name === "string" ? info.name : "",
              icon: { path: icon.path, width: icon.width, height: icon.height },
            };
            cache.delete(key);
            cache.set(key, asset);
            while (cache.size > maxEntries) cache.delete(cache.keys().next().value!);
          } catch {
            // A failed/aborted read is not a permanent negative cache and does not block other icons.
            continue;
          }
        } else {
          cache.delete(key);
          cache.set(key, asset);
        }
        if (signal.aborted) break;
        const art = image(asset.icon.path); // No icon-only hit target before its first PNG attempt ends.
        if (art?.loading)
          await new Promise<void>((resolve) => {
            const done = () => {
              signal.removeEventListener("abort", done);
              resolve();
            };
            signal.addEventListener("abort", done, { once: true });
            Promise.resolve(art.loading).then(done, done);
            if (signal.aborted) done();
          });
        if (signal.aborted) break;
        result.set(key, asset);
      }
    }
    await Promise.all(Array.from({ length: Math.min(workers, queue.length) }, worker));
    return result;
  }
  return { load };
}
