import type {
  ReaderSettings,
  RecentFile,
  ScrollPosition,
  SessionState,
} from "../types";
import { clamp, pathKey, samePath } from "./format";

const SETTINGS_KEY = "xreader:settings:v1";
const RECENTS_KEY = "xreader:recents:v1";
const SESSION_KEY = "xreader:session:v1";
const SCROLL_KEY = "xreader:scroll:v1";
const SIDEBAR_KEY = "xreader:sidebar:v1";
const SIDEBAR_WIDTH_KEY = "xreader:sidebar-width:v1";
const ROOTS_KEY = "xreader:roots:v1";
const DISMISSED_UPDATE_KEY = "xreader:update-dismissed:v1";
const MAX_RECENTS = 15;
const MAX_SCROLL_ENTRIES = 80;
const MAX_ROOTS = 20;

export const SIDEBAR_MIN_WIDTH = 190;
export const SIDEBAR_MAX_WIDTH = 460;
export const DEFAULT_SIDEBAR_WIDTH = 240;

/** 正文字号只提供三档，避免出现 11px / 17px 这类不在设计范围内的值。 */
export const READER_FONT_SIZES = [10, 12, 14] as const;

export const DEFAULT_SETTINGS: ReaderSettings = {
  theme: "dark",
  font: "sans",
  fontSize: 12,
  lineHeight: 1.85,
  width: "full",
  treeFilter: "default",
  treeExtensions: [],
};

const MAX_TREE_EXTENSIONS = 64;

/**
 * 把“md, .go，py *.sh”这类输入整理成去重的小写后缀列表。
 * 后缀不区分大小写，允许文件名（如 Dockerfile）作为白名单项。
 */
export function normalizeExtensionList(value: unknown): string[] {
  const items: string[] = [];
  const push = (raw: string) => {
    const cleaned = raw
      .trim()
      .toLowerCase()
      .replace(/^[*]+\.?/, "")
      .replace(/^\.+/, "");
    if (!cleaned || cleaned.length > 24) return;
    if (/[\s,，;；/\\]/.test(cleaned)) return;
    if (!items.includes(cleaned)) items.push(cleaned);
  };
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string") push(item);
    }
  } else if (typeof value === "string") {
    for (const item of value.split(/[,，;；\s]+/)) push(item);
  }
  return items.slice(0, MAX_TREE_EXTENSIONS);
}

const SETTINGS_VERSION = 3;

interface StoredSettings extends Partial<ReaderSettings> {
  version?: number;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 存储不可用时静默降级，不影响阅读。
  }
}

export function normalizeSettings(value: Partial<ReaderSettings>): ReaderSettings {
  const theme =
    value.theme === "light" || value.theme === "dark" || value.theme === "system"
      ? value.theme
      : DEFAULT_SETTINGS.theme;
  const requestedSize = Math.round(Number(value.fontSize) || DEFAULT_SETTINGS.fontSize);
  const treeFilter =
    value.treeFilter === "all" || value.treeFilter === "custom"
      ? value.treeFilter
      : "default";
  return {
    theme,
    font: value.font === "sans" ? "sans" : "serif",
    fontSize: (READER_FONT_SIZES as readonly number[]).includes(requestedSize)
      ? requestedSize
      : DEFAULT_SETTINGS.fontSize,
    lineHeight: clamp(
      Math.round((Number(value.lineHeight) || DEFAULT_SETTINGS.lineHeight) * 100) / 100,
      1.3,
      2.4,
    ),
    width:
      value.width === "narrow" ||
      value.width === "wide" ||
      value.width === "full"
        ? value.width
        : DEFAULT_SETTINGS.width,
    treeFilter,
    treeExtensions: normalizeExtensionList(value.treeExtensions),
  };
}

export function loadSettings(): ReaderSettings {
  const stored = readJson<StoredSettings>(SETTINGS_KEY, {});
  const settings = normalizeSettings(stored);
  if (stored.version !== SETTINGS_VERSION) {
    if (stored.version === undefined) {
      // 旧版默认版心是 760px 居中；升级后默认占满展示区。
      settings.width = "full";
    }
    // 文档式排版改用无衬线；Windows 上的默认宋体衬线不再作为正文默认。
    settings.font = "sans";
    saveSettings(settings);
  }
  return settings;
}

export function saveSettings(settings: ReaderSettings): void {
  writeJson(SETTINGS_KEY, { ...settings, version: SETTINGS_VERSION });
}

export function loadRecents(): RecentFile[] {
  const list = readJson<RecentFile[]>(RECENTS_KEY, []);
  if (!Array.isArray(list)) return [];
  return list
    .filter(
      (item) =>
        item &&
        typeof item.path === "string" &&
        typeof item.fileName === "string" &&
        typeof item.openedAt === "number",
    )
    .slice(0, MAX_RECENTS);
}

export function rememberRecent(file: {
  path: string;
  fileName: string;
  dir: string;
}): RecentFile[] {
  const next: RecentFile[] = [
    { ...file, openedAt: Date.now() },
    ...loadRecents().filter((item) => !samePath(item.path, file.path)),
  ].slice(0, MAX_RECENTS);
  writeJson(RECENTS_KEY, next);
  return next;
}

export function clearRecents(): void {
  writeJson(RECENTS_KEY, []);
}

export function loadSession(): SessionState {
  const value = readJson<Partial<SessionState>>(SESSION_KEY, {});
  return {
    paths: Array.isArray(value.paths)
      ? value.paths.filter((path): path is string => typeof path === "string")
      : [],
    activePath: typeof value.activePath === "string" ? value.activePath : null,
  };
}

export function saveSession(paths: string[], activePath: string | null): void {
  writeJson(SESSION_KEY, { paths, activePath });
}

export function loadSidebarOpen(): boolean {
  const value = readJson<boolean | null>(SIDEBAR_KEY, null);
  return typeof value === "boolean" ? value : true;
}

export function saveSidebarOpen(open: boolean): void {
  writeJson(SIDEBAR_KEY, open);
}

export function loadSidebarWidth(): number {
  const value = Number(readJson<number>(SIDEBAR_WIDTH_KEY, DEFAULT_SIDEBAR_WIDTH));
  return Number.isFinite(value)
    ? clamp(Math.round(value), SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH)
    : DEFAULT_SIDEBAR_WIDTH;
}

export function saveSidebarWidth(width: number): void {
  writeJson(
    SIDEBAR_WIDTH_KEY,
    clamp(Math.round(width), SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH),
  );
}

export function loadRoots(): string[] {
  const list = readJson<string[]>(ROOTS_KEY, []);
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const roots: string[] = [];
  for (const path of list) {
    if (typeof path !== "string" || path.length === 0) continue;
    const key = pathKey(path);
    if (seen.has(key)) continue;
    seen.add(key);
    roots.push(path);
    if (roots.length >= MAX_ROOTS) break;
  }
  return roots;
}

export function saveRoots(roots: string[]): void {
  writeJson(ROOTS_KEY, roots.slice(0, MAX_ROOTS));
}

/** 用户点过“稍后”的版本号，避免每次启动重复弹出同一个更新。 */
export function loadDismissedUpdateVersion(): string | null {
  const version = readJson<string | null>(DISMISSED_UPDATE_KEY, null);
  return typeof version === "string" && version.length > 0 ? version : null;
}

export function saveDismissedUpdateVersion(version: string): void {
  writeJson(DISMISSED_UPDATE_KEY, version);
}

interface ScrollEntry extends ScrollPosition {
  updatedAt: number;
}

export function loadScroll(path: string): ScrollPosition | null {
  const store = readJson<Record<string, ScrollEntry>>(SCROLL_KEY, {});
  const entry = store[pathKey(path)];
  if (!entry || typeof entry.top !== "number" || typeof entry.ratio !== "number") {
    return null;
  }
  return { top: entry.top, ratio: entry.ratio };
}

export function saveScroll(path: string, position: ScrollPosition): void {
  const store = readJson<Record<string, ScrollEntry>>(SCROLL_KEY, {});
  store[pathKey(path)] = {
    top: Math.max(0, Math.round(position.top)),
    ratio: clamp(position.ratio, 0, 1),
    updatedAt: Date.now(),
  };
  const trimmed = Object.entries(store)
    .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
    .slice(0, MAX_SCROLL_ENTRIES);
  writeJson(SCROLL_KEY, Object.fromEntries(trimmed));
}
