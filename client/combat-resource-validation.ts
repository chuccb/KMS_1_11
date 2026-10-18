import type { BasicAttackAction, BasicAttackProfile } from "../server/src/game/basicattack.ts";
import type { SkillBook, SkillInfo } from "../server/src/game/skills.ts";
import type { ActiveArt } from "../server/src/game/activeskills.ts";
import type { SpriteFrame, MobArt, MobAttackArt } from "../server/src/game/sprites.ts";
import { isRecord, isFiniteNumber, isNumberRecord, isTooltipIcon } from "./resource-validation.ts";

export interface ActiveSkillMetadata extends SkillInfo {
  arts: Record<string, ActiveArt>;
}
export interface SkillCatalogue {
  job: number;
  books: SkillBook[];
}
const optional = <T>(value: unknown, valid: (value: unknown) => value is T) =>
  value === undefined || valid(value);
const string = (value: unknown): value is string => typeof value === "string";
const boolean = (value: unknown): value is boolean => typeof value === "boolean";
const integer = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value);
function numbers(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(isFiniteNumber);
}
function rect(value: unknown): value is NonNullable<BasicAttackAction["bounds"]> {
  return (
    isRecord(value) && [value.left, value.top, value.right, value.bottom].every(isFiniteNumber)
  );
}
function recordOf<T>(
  value: unknown,
  valid: (value: unknown) => value is T,
): value is Record<string, T> {
  return isRecord(value) && Object.values(value).every(valid);
}
export function isSpriteFrame(value: unknown): value is SpriteFrame {
  return (
    isRecord(value) &&
    string(value.path) &&
    isFiniteNumber(value.delay) &&
    isFiniteNumber(value.ox) &&
    isFiniteNumber(value.oy) &&
    optional(value.width, isFiniteNumber) &&
    optional(value.height, isFiniteNumber) &&
    optional(value.a0, isFiniteNumber) &&
    optional(value.a1, isFiniteNumber) &&
    optional(value.rawDelay, isFiniteNumber) &&
    optional(value.bounds, rect)
  );
}
export function isSpriteFrames(value: unknown): value is SpriteFrame[] {
  return Array.isArray(value) && value.every(isSpriteFrame);
}
function positiveFrames(value: unknown): value is SpriteFrame[] {
  return isSpriteFrames(value) && value.every((frame) => frame.delay > 0);
}
function action(value: unknown): value is BasicAttackAction {
  return (
    isRecord(value) &&
    integer(value.action) &&
    string(value.stance) &&
    numbers(value.delays) &&
    value.delays.length > 0 &&
    numbers(value.baseDelays) &&
    value.baseDelays.length === value.delays.length &&
    numbers(value.frameIndices) &&
    value.frameIndices.length === value.delays.length &&
    value.frameIndices.every(integer) &&
    recordOf(value.effects, positiveFrames) &&
    optional(value.bounds, rect) &&
    optional(value.afterimage, positiveFrames) &&
    (value.afterimages === undefined || recordOf(value.afterimages, positiveFrames)) &&
    (value.afterimageBounds === undefined || recordOf(value.afterimageBounds, rect))
  );
}
export function isBasicAttackProfile(value: unknown): value is BasicAttackProfile {
  return (
    isRecord(value) &&
    integer(value.weaponId) &&
    integer(value.group) &&
    integer(value.speed) &&
    value.speed >= 0 &&
    value.speed <= 6 &&
    optional(value.baseSpeed, integer) &&
    optional(value.sfx, string) &&
    optional(value.afterimageTier, integer) &&
    (value.masteryLevels === undefined || recordOf(value.masteryLevels, numbers)) &&
    (value.hitEffects === undefined || recordOf(value.hitEffects, positiveFrames)) &&
    Array.isArray(value.melee) &&
    value.melee.every(action) &&
    Array.isArray(value.shoot) &&
    value.shoot.every(action) &&
    (value.magic === undefined || (Array.isArray(value.magic) && value.magic.every(action))) &&
    (value.prone === undefined ||
      (action(value.prone) && value.prone.action === 32 && value.prone.stance === "proneStab"))
  );
}
function skillInfo(value: unknown): value is SkillInfo {
  return (
    isRecord(value) &&
    integer(value.id) &&
    integer(value.bookId) &&
    string(value.name) &&
    string(value.desc) &&
    string(value.path) &&
    integer(value.maxLevel) &&
    optional(value.skillType, integer) &&
    optional(value.elements, numbers) &&
    optional(value.icon, isTooltipIcon) &&
    Array.isArray(value.requirements) &&
    value.requirements.every(
      (r: unknown) => isRecord(r) && integer(r.skillId) && integer(r.level),
    ) &&
    Array.isArray(value.levels) &&
    value.levels.every(
      (r: unknown) => isRecord(r) && integer(r.level) && string(r.hs) && isNumberRecord(r.values),
    )
  );
}
export function isSkillCatalogue(value: unknown): value is SkillCatalogue {
  return (
    isRecord(value) &&
    integer(value.job) &&
    Array.isArray(value.books) &&
    value.books.every(
      (book: unknown) =>
        isRecord(book) &&
        integer(book.id) &&
        string(book.name) &&
        Array.isArray(book.skills) &&
        book.skills.every(skillInfo),
    )
  );
}
function activeArt(value: unknown): value is ActiveArt {
  return (
    isRecord(value) &&
    integer(value.skillId) &&
    isSpriteFrames(value.balls) &&
    isSpriteFrames(value.effects) &&
    isSpriteFrames(value.hits) &&
    Array.isArray(value.hitVariants) &&
    value.hitVariants.every(isSpriteFrames) &&
    boolean(value.armorFlash) &&
    optional(value.hasHitPath, boolean) &&
    optional(value.useSound, string)
  );
}
export function isActiveSkillMetadata(value: unknown): value is ActiveSkillMetadata {
  return skillInfo(value) && "arts" in value && recordOf(value.arts, activeArt);
}
function mobAttack(value: unknown): value is MobAttackArt {
  return (
    isRecord(value) &&
    integer(value.action) &&
    string(value.name) &&
    (value.type === 0 || value.type === 1 || value.type === 2) &&
    [value.conMP, value.duration, value.visualDuration, value.effectAfter, value.attackAfter].every(
      isFiniteNumber,
    ) &&
    optional(value.range, rect) &&
    optional(value.radius, isFiniteNumber) &&
    (value.sp === undefined ||
      (isRecord(value.sp) && isFiniteNumber(value.sp.x) && isFiniteNumber(value.sp.y))) &&
    isSpriteFrames(value.effect) &&
    isSpriteFrames(value.hit) &&
    isSpriteFrames(value.ball)
  );
}
export function isMobMetadata(value: unknown): value is MobArt {
  return (
    isRecord(value) &&
    integer(value.templateId) &&
    recordOf(value.actions, isSpriteFrames) &&
    optional(value.bodyAttack, boolean) &&
    optional(value.maxMP, isFiniteNumber) &&
    optional(value.pushed, isFiniteNumber) &&
    (value.attacks === undefined ||
      (Array.isArray(value.attacks) && value.attacks.every(mobAttack)))
  );
}
