/** Native sub_43FF00 table at PE VA005B40D4, decoded CP949. Not later-version job names.
 * Shared pure data for server validation and browser labels; no DOM dependencies. */
export const NATIVE_JOB_NAMES: ReadonlyMap<number, string> = new Map([
  [0, "초보자"],
  [100, "검사"],
  [110, "전사"],
  [111, "크루세이더"],
  [112, "영웅"],
  [120, "견습기사"],
  [121, "기사"],
  [122, "성기사"],
  [130, "창병"],
  [131, "용기사"],
  [132, "흑기사"],
  [200, "매지션"],
  [210, "위자드"],
  [211, "메이지"],
  [212, "디바이너"],
  [220, "위자드"],
  [221, "메이지"],
  [222, "워록"],
  [230, "성직자"],
  [231, "프리스트"],
  [232, "세인트"],
  [300, "궁수"],
  [310, "헌터"],
  [311, "레인저"],
  [312, "명궁"],
  [320, "사수"],
  [321, "저격수"],
  [322, "신궁"],
  [400, "방랑자"],
  [410, "자객"],
  [411, "은둔자"],
  [412, "나이트로드"],
  [420, "도둑"],
  [421, "대도둑"],
  [422, "고스트"],
]);
/** sub_43FFB0: root, second job, then third/fourth ancestors; beginners have no book. */
export function nativeSkillBooks(job: number): number[] {
  if (!Number.isInteger(job) || !NATIVE_JOB_NAMES.has(job) || job === 0) return [];
  const root = Math.trunc(job / 100) * 100,
    branch = Math.trunc((job % 100) / 10);
  const ids = [root];
  if (branch) {
    const second = root + 10 * branch;
    ids.push(second);
    if (job % 10 >= 1) ids.push(second + 1);
    if (job % 10 >= 2) ids.push(second + 2);
  }
  return ids;
}
