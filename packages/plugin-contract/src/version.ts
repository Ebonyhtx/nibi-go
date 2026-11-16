// 版本比较：manifest 的 `minApp` 与宿主 App 版本。
//
// 只比较数字核心（1/1.2/1.2.3 都合法）；预发布后缀不参与兼容性判断——插件不能靠
// `1.2.3-beta.9` 绕过 `1.2.3` 的下限。解析不了的版本号按不可比较处理。

export interface VersionCore {
  major: number;
  minor: number;
  patch: number;
}

const VERSION_RE = /^(\d{1,6})(?:\.(\d{1,6}))?(?:\.(\d{1,6}))?(?:[-+].*)?$/u;

export function parseVersion(value: string): VersionCore | null {
  const match = VERSION_RE.exec(value.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: match[2] === undefined ? 0 : Number(match[2]),
    patch: match[3] === undefined ? 0 : Number(match[3]),
  };
}

/** 数字核心比较：a<b 返回负数，a===b 返回 0，a>b 返回正数。 */
export function compareVersions(a: string, b: string): number | null {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

/** 宿主版本是否满足插件声明的下限；`minApp` 缺失视为满足。 */
export function satisfiesMinApp(appVersion: string, minApp: string | undefined): boolean {
  if (minApp === undefined || minApp.trim().length === 0) return true;
  const order = compareVersions(appVersion, minApp);
  return order !== null && order >= 0;
}
