/** Read-only Data.wz audit for drop-table evidence. Import is pure; CLI opens only the WZ archive. */
import { resolve } from "node:path";
import { MOB_JUNK_ITEM_BY_TEMPLATE_ID } from "../server/src/game/drops.ts";
import { WzArchive } from "../server/src/wz/archive.ts";
import { entriesOf, propertyOf } from "../server/src/wz/props.ts";
import { WzNode, type WzObject } from "../server/src/wz/img.ts";

const DROP_EVIDENCE_KEYWORD = /drop|loot|meso|money|expire|lifetime|chance/i;

export interface DropWzPolicyMapping {
  mobTemplateId: number;
  mobName: string | null;
  itemId: number;
  itemName: string | null;
}

export interface DropWzUnmappedMob {
  mobTemplateId: number;
  mobName: string | null;
}

export interface DropWzEvidenceAudit {
  archiveImages: number;
  mobImages: number;
  propertyEntries: number;
  keywordPropertyPaths: string[];
  keywordStringValuePaths: string[];
  mobInfoKeywordPropertyPaths: string[];
  policyMappings: DropWzPolicyMapping[];
  unmappedMobs: DropWzUnmappedMob[];
  policyMappingsMissingMobImages: number[];
  policyMappingsMissingItemNodes: number[];
}

function visitEntries(
  entries: ReturnType<typeof entriesOf>,
  path: string,
  seen: WeakSet<object>,
  report: Pick<
    DropWzEvidenceAudit,
    "propertyEntries" | "keywordPropertyPaths" | "keywordStringValuePaths"
  >,
): void {
  if (seen.has(entries)) return;
  seen.add(entries);
  for (const entry of entries) {
    report.propertyEntries++;
    const entryPath = `${path}/${entry.name}`;
    if (DROP_EVIDENCE_KEYWORD.test(entry.name)) report.keywordPropertyPaths.push(entryPath);
    if (typeof entry.value === "string" && DROP_EVIDENCE_KEYWORD.test(entry.value)) {
      report.keywordStringValuePaths.push(entryPath);
    }
    visitPropertyTree(entry.value, entryPath, seen, report);
  }
}

function visitPropertyTree(
  value: unknown,
  path: string,
  seen: WeakSet<object>,
  report: Pick<
    DropWzEvidenceAudit,
    "propertyEntries" | "keywordPropertyPaths" | "keywordStringValuePaths"
  >,
): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);

  if (value instanceof WzNode) {
    if (value.kind === "props") visitEntries(value.props, path, seen, report);
    else if (value.kind === "canvas") visitPropertyTree(value.canvas, path, seen, report);
    else if (Array.isArray(value.value)) {
      for (let index = 0; index < value.value.length; index++) {
        visitPropertyTree(value.value[index], `${path}[${index}]`, seen, report);
      }
    }
    return;
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      visitPropertyTree(value[index], `${path}[${index}]`, seen, report);
    }
    return;
  }

  visitEntries(entriesOf(value), path, seen, report);
}

function childByName(root: unknown, name: string): unknown {
  return propertyOf(root, name);
}

function mobIdOf(path: string): number | undefined {
  const match = /^Mob\/(\d+)\.img$/.exec(path);
  if (!match) return undefined;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) ? id : undefined;
}

function imageRoot(archive: WzArchive, path: string): WzObject | undefined {
  return archive.objects(path)[0];
}

function mobNameOf(root: WzObject | undefined): string | null {
  const value = propertyOf(propertyOf(root, "info"), "name");
  return typeof value === "string" ? value : null;
}

function itemNameOf(root: WzObject | undefined, itemId: number): string | null {
  const item = childByName(root, String(itemId).padStart(8, "0"));
  const value = propertyOf(propertyOf(item, "info"), "name");
  return typeof value === "string" ? value : null;
}

/**
 * Traverse every image with a fresh WeakSet for that image. This prevents shared parser objects in
 * one image from suppressing traversal of another. String hits are property paths, never excerpts.
 */
export function auditDropWzEvidence(archive: WzArchive): DropWzEvidenceAudit {
  const report: DropWzEvidenceAudit = {
    archiveImages: archive.images.length,
    mobImages: 0,
    propertyEntries: 0,
    keywordPropertyPaths: [],
    keywordStringValuePaths: [],
    mobInfoKeywordPropertyPaths: [],
    policyMappings: [],
    unmappedMobs: [],
    policyMappingsMissingMobImages: [],
    policyMappingsMissingItemNodes: [],
  };

  const mobRoots = new Map<number, WzObject>();
  const etcRoot = archive.images.some((image) => image.path === "Item/Etc/0400.img")
    ? imageRoot(archive, "Item/Etc/0400.img")
    : undefined;

  for (const image of archive.images) {
    const roots = archive.objects(image.path);
    const perImageSeen = new WeakSet<object>();
    for (const [index, root] of roots.entries()) {
      visitPropertyTree(root, `${image.path}[${index}]`, perImageSeen, report);
    }

    const mobTemplateId = mobIdOf(image.path);
    if (mobTemplateId === undefined) continue;
    report.mobImages++;
    const root = roots[0];
    if (root !== undefined) mobRoots.set(mobTemplateId, root);

    const infoPrefixes = roots.map((_, index) => `${image.path}[${index}]/info/`);
    report.mobInfoKeywordPropertyPaths.push(
      ...report.keywordPropertyPaths.filter((propertyPath) =>
        infoPrefixes.some((prefix) => propertyPath.startsWith(prefix)),
      ),
    );
  }

  const itemIds = new Set(entriesOf(etcRoot).map((entry) => Number(entry.name)));
  const sortedMobIds = [...mobRoots.keys()].sort((a, b) => a - b);
  for (const mobTemplateId of sortedMobIds) {
    if (MOB_JUNK_ITEM_BY_TEMPLATE_ID[mobTemplateId] !== undefined) continue;
    report.unmappedMobs.push({
      mobTemplateId,
      mobName: mobNameOf(mobRoots.get(mobTemplateId)),
    });
  }

  for (const [mobIdText, itemId] of Object.entries(MOB_JUNK_ITEM_BY_TEMPLATE_ID).sort(
    ([a], [b]) => Number(a) - Number(b),
  )) {
    const mobTemplateId = Number(mobIdText);
    const mob = mobRoots.get(mobTemplateId);
    if (mob === undefined) report.policyMappingsMissingMobImages.push(mobTemplateId);
    if (!itemIds.has(itemId)) report.policyMappingsMissingItemNodes.push(itemId);
    report.policyMappings.push({
      mobTemplateId,
      mobName: mob === undefined ? null : mobNameOf(mob),
      itemId,
      itemName: itemNameOf(etcRoot, itemId),
    });
  }

  report.keywordPropertyPaths.sort();
  report.keywordStringValuePaths.sort();
  report.mobInfoKeywordPropertyPaths.sort();
  return report;
}

if (import.meta.main) {
  const archive = WzArchive.open(resolve(import.meta.dirname, "../Data.wz"));
  console.log(JSON.stringify(auditDropWzEvidence(archive), null, 2));
}
