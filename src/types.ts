export type MediaKind = "image" | "video" | "audio";
export type DocKind = "md" | "txt" | "code" | MediaKind;
export type ThemeMode = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";
export type ReaderFont = "sans" | "serif";
export type ContentWidth = "narrow" | "medium" | "wide" | "full";
/** 文件树显示范围：常用类型 / 自定义后缀 / 全部文件。 */
export type TreeFileFilter = "default" | "custom" | "all";

export interface MediaData {
  path: string;
  dir: string;
  fileName: string;
  kind: MediaKind;
  size: number;
  mtime: number;
  watching: boolean;
}

export interface DocumentData {
  path: string;
  dir: string;
  fileName: string;
  content: string;
  encoding: string;
  size: number;
  mtime: number;
  lines: number;
  chars: number;
  watching: boolean;
}

export interface DirEntry {
  path: string;
  name: string;
  isDir: boolean;
}

export interface DocumentChanged {
  path: string;
  kind: "changed" | "missing" | "error" | "media";
  size?: number | null;
  mtime?: number | null;
  error?: string | null;
}

export interface Tab {
  id: string;
  path: string;
  fileName: string;
  dir: string;
  kind: DocKind;
  content: string;
  encoding: string;
  size: number;
  mtime: number;
  lines: number;
  chars: number;
  watching: boolean;
  missing: boolean;
  loading: boolean;
  refreshing: boolean;
  externalUpdate: boolean;
  lastUpdatedAt: number;
  error?: string;
}

export interface ReaderSettings {
  theme: ThemeMode;
  font: ReaderFont;
  fontSize: number;
  lineHeight: number;
  width: ContentWidth;
  treeFilter: TreeFileFilter;
  treeExtensions: string[];
}

/** 与后端 list_directory 的过滤参数对应；extensions 为空表示按内置支持类型过滤。 */
export interface DirFilter {
  all: boolean;
  extensions: string[];
}

export interface RecentFile {
  path: string;
  fileName: string;
  dir: string;
  openedAt: number;
}

export interface ScrollPosition {
  top: number;
  ratio: number;
}

export type ToastKind = "info" | "error" | "success";

export interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  detail?: string;
}

export interface SessionState {
  paths: string[];
  activePath: string | null;
}
