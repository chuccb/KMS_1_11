/** Read-only original-WZ audit. Pure on import; explicit CLI opens Data.wz, never a save/socket. */
import { resolve } from "node:path";
import { WzArchive, footholdSegments, type FootholdSegment } from "../server/src/wz/archive.ts";
import { DropLandingIndex, type DropOrigin } from "../server/src/game/drop-landing.ts";
import { encodeDropAppear, readDropAppear } from "../server/src/protocol/drop.ts";
import { PacketReader } from "../server/src/protocol/packet.ts";
import { createDropRecord, dropPosition, DROP_HOP_MS } from "../client/drop-presentation.ts";
import { collisionWorld, actorDepth } from "../client/motion.ts";

export interface DropLandingAudit {
  maps: number;
  floors: number;
  slopes: number;
  samples: number;
  floorless: string[];
  range: { minX: number; maxX: number; minY: number; maxY: number };
}
export function auditDropLandings(archive: WzArchive): DropLandingAudit {
  const report: DropLandingAudit = {
    maps: 0,
    floors: 0,
    slopes: 0,
    samples: 0,
    floorless: [],
    range: { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
  };
  for (const image of archive.images) {
    if (!/^Map\/Map\/\d+\.img$/.test(image.path)) continue;
    report.maps++;
    const segments = footholdSegments(archive.objects(image.path)[0]),
      floors = [...segments.values()].filter((floor) => floor.x1 < floor.x2);
    if (!floors.length) {
      report.floorless.push(image.path);
      continue;
    }
    const index = new DropLandingIndex(segments),
      world = collisionWorld({ footholds: [...segments.values()] });
    const check = (source: DropOrigin, x: number) => {
      const at = index.resolve(source, x),
        support = segments.get(at.foothold);
      const fail = (reason: string): never => {
        throw new Error(`${image.path}: ${reason}: ${JSON.stringify({ source, x, at })}`);
      };
      if (!support || support.x1 >= support.x2 || at.x < support.x1 || at.x > support.x2)
        fail("not on a real directed floor");
      const floor: FootholdSegment = support!;
      const y = floor.y1 + ((at.x - floor.x1) * (floor.y2 - floor.y1)) / (floor.x2 - floor.x1);
      if (Math.abs(at.y - y) > 0.500001) fail("ground mismatch after slope quantization");
      const body = readDropAppear(
        new PacketReader(
          encodeDropAppear({
            dropId: 1,
            kind: 0,
            money: false,
            value: 4000019,
            x: at.x,
            y: at.y,
            mobId: 1,
            mobX: Math.trunc(source.x),
            mobY: Math.trunc(source.y),
          }),
          1,
        ),
      );
      if (body.x !== at.x || body.y !== at.y) fail("signed native packet overflow");
      const record = createDropRecord(body, 0),
        pose = record && dropPosition(record, DROP_HOP_MS);
      if (!pose || pose.x !== at.x || pose.y !== at.y)
        fail("browser changed authoritative landing");
      // 0x43 has no FH id: depth must still resolve to some real supporting page/group, including edges.
      const placed: { x: number; y: number; layer?: number; group?: number } = {
        x: body.x,
        y: body.y,
      };
      actorDepth(placed, world, "drop");
      if (placed.layer === undefined) fail("browser could not recover a supporting draw layer");
      report.samples++;
      report.range.minX = Math.min(report.range.minX, at.x);
      report.range.maxX = Math.max(report.range.maxX, at.x);
      report.range.minY = Math.min(report.range.minY, at.y);
      report.range.maxY = Math.max(report.range.maxY, at.y);
    };
    for (const floor of floors) {
      report.floors++;
      if (floor.y1 !== floor.y2) report.slopes++;
      for (const x of [floor.x1, (floor.x1 + floor.x2) / 2, floor.x2]) {
        const y = Math.round(
          floor.y1 + ((x - floor.x1) * (floor.y2 - floor.y1)) / (floor.x2 - floor.x1),
        );
        for (const spread of [-24, 0, 24]) {
          check({ x, y, foothold: floor.id }, x + spread);
          check({ x, y: y - 80, foothold: floor.id }, x + spread); // jump with a stale hint, not invented terrain
        }
      }
    }
  }
  return report;
}
if (import.meta.main) {
  const archive = WzArchive.open(resolve(import.meta.dirname, "../Data.wz"));
  console.log(JSON.stringify(auditDropLandings(archive), null, 2));
}
