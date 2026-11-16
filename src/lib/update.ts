import type { UpdateManifest } from "../types";
import { checkUpdate, getAppVersion } from "./api";

export type UpdateCheck =
  | { status: "latest"; current: string }
  | { status: "available"; current: string; manifest: UpdateManifest }
  | { status: "error"; message: string };

/** semver 风格比较（兼容 "v" 前缀与两段/三段版本号）。 */
export function compareVersions(a: string, b: string): number {
  const parse = (value: string) =>
    value
      .trim()
      .replace(/^v/i, "")
      .split(".")
      .map((segment) => parseInt(segment, 10) || 0);
  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.length, right.length, 3);
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** 拉取远端清单并与当前版本比较（网络请求走 Rust，不受 WebView CORS 限制）。 */
export async function checkForUpdate(): Promise<UpdateCheck> {
  try {
    const [current, result] = await Promise.all([getAppVersion(), checkUpdate()]);
    if (result.error) {
      return { status: "error", message: result.error };
    }
    if (!result.manifest) {
      return { status: "error", message: "更新信息为空" };
    }
    if (!result.manifest.version) {
      return { status: "error", message: "更新信息缺少 version 字段" };
    }
    return compareVersions(result.manifest.version, current) > 0
      ? { status: "available", current, manifest: result.manifest }
      : { status: "latest", current };
  } catch (error) {
    return { status: "error", message: `检查更新失败：${String(error)}` };
  }
}
