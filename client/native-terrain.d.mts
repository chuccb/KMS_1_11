export interface PhysicalBounds { left: number; top: number; right: number; bottom: number; }
export interface TerrainSegment { id: number; x1: number; y1: number; x2: number; y2: number; prev: number; next: number; layer?: number; group?: number; }
export interface NormalizedSegment extends TerrainSegment { cos: number; sin: number; length: number; }
export interface TerrainWorld { footholds: readonly NormalizedSegment[]; byId: ReadonlyMap<number, NormalizedSegment>; }
export interface TerrainPoint { x: number; y: number; }
export interface TerrainVelocity extends TerrainPoint { vx: number; vy: number; }
export interface TerrainContact { left: NormalizedSegment; right: NormalizedSegment; numerator: number; denominator: number; fraction: number; x: number; y: number; }
export function physicalBounds(footholds: Iterable<Pick<TerrainSegment, 'x1'|'y1'|'x2'|'y2'>>): PhysicalBounds | undefined;
export function collisionRound(n: number): number;
export function cross32(ax: number, ay: number, bx: number, by: number): number;
export function clipAir(body: TerrainVelocity, old: TerrainPoint, milliseconds: number, bounds?: PhysicalBounds): number;
export function clipGround(f: NormalizedSegment, oldPosition: number, position: number, speed: number, milliseconds: number, bounds?: PhysicalBounds): {position: number; speed: number; used: number};
export function segmentPosition(f: NormalizedSegment, x: number, y: number): number;
export function terrainContact(world: TerrainWorld, old: TerrainPoint, target: TerrainPoint, group?: number): TerrainContact | undefined;
export function contactTangent(hit: TerrainContact, vx: number, vy: number): {foothold: NormalizedSegment; speed: number};

export function normalizeFootholds(footholds:readonly TerrainSegment[]):NormalizedSegment[];
