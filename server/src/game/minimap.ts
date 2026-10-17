/** CUIMiniMap::sub_4E52C0 loads miniMap/{canvas,width,height,centerX,centerY,mag}.
 * Its picture is supplied by the map itself, not a thumbnail generated from footholds. */
import { propertyOf, entriesOf, asNumber, asText } from '../wz/props.ts';
import type { ArtReader } from './wzart.ts';
export interface MiniMapArt {
  path: string;
  canvasWidth: number;
  canvasHeight: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  mag: number;
  /** Native stores life.type=n's original x/y, not the NPC's animated position or cy. */
  npcs: {x: number; y: number}[];
}
export function miniMapArt(root: unknown, reader: ArtReader, imagePath: string): MiniMapArt | undefined {
  const node = propertyOf(root,'miniMap');
  if (node === undefined) return undefined; // 20 original maps deliberately have no miniMap node.
  const path = `${imagePath}/miniMap/canvas`, canvas = reader.at(path);
  if (!canvas) throw new Error(`miniMap node exists but its canvas cannot be read: ${path}`);
  const number = (name: string) => asNumber(propertyOf(node,name),NaN);
  const width=number('width'),height=number('height'),mag=number('mag'),centerX=number('centerX'),centerY=number('centerY');
  if (!(width>0&&height>0&&Number.isInteger(mag)&&mag>=0&&mag<=30&&Number.isFinite(centerX)&&Number.isFinite(centerY))) throw new Error(`invalid miniMap geometry: ${imagePath}`);
  return {path,canvasWidth:canvas.width,canvasHeight:canvas.height,width,height,centerX,centerY,mag,
    npcs:entriesOf(propertyOf(root,'life')).flatMap(({value})=>asText(propertyOf(value,'type'))==='n'?[{x:asNumber(propertyOf(value,'x')),y:asNumber(propertyOf(value,'y'))}]:[])};
}
