/** CUINewChar: MakeCharInfo -> six combos; sub_430630 rolls four 4s + nine increments.
 * sub_430690 draws +420..432 at y293/313/333/353, matching STR/DEX/INT/LUK on newDlg. */
import type { ArtReader } from './wzart.ts';
import { decodeCp949 } from '../protocol/cp949.ts';
export interface CreationOption { id: number; name: string }
export interface CreationCatalog { male: CreationOption[][]; female: CreationOption[][]; forbidden: string[] }
const cache = new WeakMap<ArtReader, CreationCatalog>();
export function creationCatalogOf(reader: ArtReader | undefined): CreationCatalog | undefined {
  if (!reader) return undefined;
  const cached = cache.get(reader); if (cached) return cached;
  const read = (gender: string) => Array.from({ length: 6 }, (_, index) => {
    const node = reader.node(`Etc/MakeCharInfo.img/${gender}/${index}`);
    if (!node?.props.length) throw new Error(`MakeCharInfo missing ${gender}/${index}`);
    return node.props.map(({ value }) => {
      if (typeof value !== 'number') throw new Error('invalid MakeCharInfo id');
      const folder = ['Face', 'Hair', 'Clothes', 'Clothes', 'Shoes', 'Weapon'][index];
      const name = reader.node(`Character/${folder}/${String(value).padStart(8, '0')}.img/info`)?.props.find((e) => e.name === 'name')?.value;
      if (typeof name !== 'string' || !name) throw new Error(`MakeCharInfo item ${value} has no info/name`);
      return { id: value, name };
    });
  });
  const catalog = { male: read('CharMale'), female: read('CharFemale'),
    forbidden: (reader.node('Etc/ForbiddenName.img')?.props ?? []).flatMap(({ value }) => typeof value === 'string' && value ? [value] : []) };
  cache.set(reader, catalog); return catalog;
}
export function validCreationDice(dice: readonly number[]): boolean {
  return dice.length === 4 && dice.every((v) => Number.isInteger(v) && v >= 4 && v <= 13) && dice.reduce((a, b) => a + b, 0) === 25;
}
export function validateCreationLook(value: unknown, catalog?: CreationCatalog, gender = 0): number[] {
  if (!Array.isArray(value) || value.length !== 10 || !value.every((v) => Number.isInteger(v) && v >= 0 && v <= 0xffffffff)) throw new Error('appearance must contain ten u32 words');
  if (!validCreationDice(value.slice(6))) throw new Error('dice must be four values >=4 with total 25');
  const groups = gender === 1 ? catalog?.female : catalog?.male;
  if (groups && !groups.every((group, index) => group.some((option) => option.id === value[index]))) throw new Error('appearance is not offered by MakeCharInfo for this account');
  return [...value];
}
/** Wire strings contain CP949 bytes. sub_524A00 permits ASCII alphanumerics / KS Hangul, 4..12 bytes. */
export function validCreationName(name: string, forbidden: readonly string[] = []): boolean {
  if (name.length < 4 || name.length > 12 || [...name].some((c) => c.charCodeAt(0) > 255)) return false;
  for (let i = 0; i < name.length; i++) {
    const a = name.charCodeAt(i);
    if (a >= 48 && a <= 57 || a >= 65 && a <= 90 || a >= 97 && a <= 122) continue;
    const b = name.charCodeAt(++i);
    if (!(a >= 0xb0 && a <= 0xc8 && b >= 0xa1 && b < 0xff)) return false;
  }
  if ((name.match(/[Il]/g) ?? []).length >= 4) return false;
  const text = decodeCp949(Uint8Array.from(name, (c) => c.charCodeAt(0))).toLowerCase();
  return !forbidden.some((word) => text.includes(word.toLowerCase()));
}
