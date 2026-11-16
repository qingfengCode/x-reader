import type { DocKind, MediaKind } from "../types";

export function baseName(path: string): string {
  const index = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return path.slice(index + 1) || path;
}

export function dirName(path: string): string {
  const index = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return index > 0 ? path.slice(0, index) : path;
}

export const DOCUMENT_EXTENSIONS = ["txt", "md", "markdown", "mdx"] as const;

/**
 * 可作为代码 / 纯文本查看的扩展名。
 * 与 src-tauri/src/lib.rs 的 TEXT_EXTENSIONS 保持一致，后端才是打开文件的最终校验。
 */
export const CODE_EXTENSIONS = [
  "go",
  "rs",
  "py",
  "pyw",
  "pyi",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "mts",
  "cts",
  "java",
  "kt",
  "kts",
  "scala",
  "sc",
  "groovy",
  "gradle",
  "clj",
  "cljs",
  "cljc",
  "edn",
  "ex",
  "exs",
  "erl",
  "hrl",
  "hs",
  "lhs",
  "ml",
  "mli",
  "fs",
  "fsi",
  "fsx",
  "cs",
  "csx",
  "vb",
  "vbs",
  "swift",
  "m",
  "mm",
  "c",
  "h",
  "cc",
  "cpp",
  "cxx",
  "hpp",
  "hxx",
  "hh",
  "ino",
  "d",
  "dart",
  "lua",
  "r",
  "jl",
  "pl",
  "pm",
  "rb",
  "rake",
  "php",
  "phtml",
  "sh",
  "bash",
  "zsh",
  "fish",
  "ksh",
  "ps1",
  "psm1",
  "bat",
  "cmd",
  "awk",
  "nim",
  "zig",
  "v",
  "sol",
  "proto",
  "thrift",
  "graphql",
  "gql",
  "sql",
  "prisma",
  "hcl",
  "tf",
  "tfvars",
  "html",
  "htm",
  "xhtml",
  "shtml",
  "css",
  "scss",
  "sass",
  "less",
  "styl",
  "vue",
  "svelte",
  "astro",
  "xml",
  "json",
  "jsonc",
  "json5",
  "jsonl",
  "ndjson",
  "yaml",
  "yml",
  "toml",
  "ini",
  "cfg",
  "conf",
  "config",
  "properties",
  "env",
  "editorconfig",
  "csv",
  "tsv",
  "diff",
  "patch",
  "rej",
  "srt",
  "vtt",
  "ass",
  "ssa",
  "nfo",
  "dockerfile",
  "makefile",
  "mk",
  "cmake",
  "ninja",
  "bzl",
  "bazel",
  "lock",
  "sum",
  "mod",
  "tex",
  "latex",
  "bib",
  "rst",
  "adoc",
  "asciidoc",
  "org",
  "log",
  "text",
] as const;

/** 没有扩展名、但通常是纯文本的文件名。 */
export const TEXT_FILE_NAMES = [
  "dockerfile",
  "containerfile",
  "makefile",
  "gnumakefile",
  "rakefile",
  "gemfile",
  "vagrantfile",
  "procfile",
  "jenkinsfile",
  "justfile",
  "brewfile",
  "license",
  "licence",
  "notice",
  "copying",
  "readme",
  "changelog",
  "authors",
  "contributing",
  "codeowners",
] as const;

/** 文件名本身就有代码语义，按代码视图渲染。 */
const CODE_FILE_NAMES = new Set<string>([
  "dockerfile",
  "containerfile",
  "makefile",
  "gnumakefile",
  "rakefile",
  "gemfile",
  "vagrantfile",
  "procfile",
  "jenkinsfile",
  "justfile",
  "brewfile",
  "cmakelists.txt",
]);

export const TEXT_EXTENSIONS = [
  ...DOCUMENT_EXTENSIONS,
  ...CODE_EXTENSIONS,
] as const;
export const PDF_EXTENSIONS = ["pdf"] as const;
export const IMAGE_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "jfif",
  "gif",
  "webp",
  "bmp",
  "svg",
  "avif",
  "apng",
  "ico",
  "tif",
  "tiff",
  "heic",
  "heif",
] as const;
export const VIDEO_EXTENSIONS = [
  "mp4",
  "webm",
  "ogv",
  "m4v",
  "mov",
  "mkv",
  "avi",
  "wmv",
  "flv",
  "mpg",
  "mpeg",
  "3gp",
  "m2ts",
] as const;
export const AUDIO_EXTENSIONS = [
  "mp3",
  "wav",
  "m4a",
  "m4b",
  "aac",
  "flac",
  "ogg",
  "oga",
  "opus",
  "wma",
  "aiff",
  "aif",
  "ape",
  "amr",
  "mid",
  "midi",
  "ac3",
] as const;
export const SUPPORTED_EXTENSIONS = [
  ...TEXT_EXTENSIONS,
  ...PDF_EXTENSIONS,
  ...IMAGE_EXTENSIONS,
  ...VIDEO_EXTENSIONS,
  ...AUDIO_EXTENSIONS,
] as const;

const DOCUMENT_SET = new Set<string>(DOCUMENT_EXTENSIONS);
const CODE_SET = new Set<string>(CODE_EXTENSIONS);
const PDF_SET = new Set<string>(PDF_EXTENSIONS);
const IMAGE_SET = new Set<string>(IMAGE_EXTENSIONS);
const VIDEO_SET = new Set<string>(VIDEO_EXTENSIONS);
const AUDIO_SET = new Set<string>(AUDIO_EXTENSIONS);
const TEXT_FILE_SET = new Set<string>(TEXT_FILE_NAMES);

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  py: "python",
  pyw: "python",
  pyi: "python",
  rb: "ruby",
  rake: "ruby",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  cs: "csharp",
  csx: "csharp",
  c: "c",
  h: "c",
  ino: "c",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hxx: "cpp",
  hh: "cpp",
  m: "objectivec",
  mm: "objectivec",
  swift: "swift",
  php: "php",
  phtml: "php",
  pl: "perl",
  pm: "perl",
  lua: "lua",
  r: "r",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  ksh: "bash",
  ps1: "powershell",
  psm1: "powershell",
  bat: "dos",
  cmd: "dos",
  sql: "sql",
  json: "json",
  jsonc: "json",
  json5: "json",
  jsonl: "json",
  ndjson: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "ini",
  ini: "ini",
  cfg: "ini",
  conf: "ini",
  config: "ini",
  properties: "ini",
  env: "ini",
  editorconfig: "ini",
  xml: "xml",
  html: "xml",
  htm: "xml",
  xhtml: "xml",
  shtml: "xml",
  vue: "xml",
  svelte: "xml",
  astro: "xml",
  svg: "xml",
  css: "css",
  scss: "scss",
  sass: "scss",
  less: "less",
  diff: "diff",
  patch: "diff",
  dockerfile: "dockerfile",
  makefile: "makefile",
  mk: "makefile",
  cmake: "cmake",
  graphql: "graphql",
  gql: "graphql",
  proto: "protobuf",
  tex: "latex",
  latex: "latex",
  csv: "plaintext",
  tsv: "plaintext",
};

const LANGUAGE_BY_FILE_NAME: Record<string, string> = {
  dockerfile: "dockerfile",
  containerfile: "dockerfile",
  makefile: "makefile",
  gnumakefile: "makefile",
  rakefile: "ruby",
  gemfile: "ruby",
  procfile: "plaintext",
  justfile: "makefile",
  brewfile: "ruby",
  "cmakelists.txt": "cmake",
};

function extensionOf(path: string): string | null {
  const name = baseName(path);
  const index = name.lastIndexOf(".");
  if (index < 0 || index === name.length - 1) return null;
  return name.slice(index + 1).toLowerCase();
}

export function mediaKindOf(path: string): MediaKind | null {
  const extension = extensionOf(path);
  if (!extension) return null;
  if (IMAGE_SET.has(extension)) return "image";
  if (VIDEO_SET.has(extension)) return "video";
  if (AUDIO_SET.has(extension)) return "audio";
  return null;
}

export function isMediaKind(kind: DocKind): kind is MediaKind {
  return kind === "image" || kind === "video" || kind === "audio";
}

export function isCodePath(path: string): boolean {
  if (CODE_FILE_NAMES.has(baseName(path).toLowerCase())) return true;
  const extension = extensionOf(path);
  return extension ? CODE_SET.has(extension) : false;
}

export function isSupportedPath(path: string): boolean {
  const extension = extensionOf(path);
  if (extension) {
    return (
      DOCUMENT_SET.has(extension) ||
      CODE_SET.has(extension) ||
      PDF_SET.has(extension) ||
      mediaKindOf(path) !== null
    );
  }
  return TEXT_FILE_SET.has(baseName(path).toLowerCase());
}

export function kindOf(path: string): DocKind {
  const media = mediaKindOf(path);
  if (media) return media;
  if (/\.(md|markdown|mdx)$/i.test(path)) return "md";
  const extension = extensionOf(path);
  if (extension && PDF_SET.has(extension)) return "pdf";
  if (isCodePath(path)) return "code";
  return "txt";
}

/** 只有文本类文件参与正文查找、复制内容等操作。 */
export function isTextKind(kind: DocKind): kind is "md" | "txt" | "code" {
  return kind === "md" || kind === "txt" || kind === "code";
}

/** 供 highlight.js（rehype-highlight）使用的语言标识。 */
export function languageOf(path: string): string {
  const extension = extensionOf(path);
  if (extension && LANGUAGE_BY_EXTENSION[extension]) {
    return LANGUAGE_BY_EXTENSION[extension];
  }
  const name = baseName(path).toLowerCase();
  return LANGUAGE_BY_FILE_NAME[name] ?? "plaintext";
}

export function kindLabel(kind: DocKind): string {
  switch (kind) {
    case "md":
      return "Markdown";
    case "txt":
      return "TXT";
    case "code":
      return "代码";
    case "pdf":
      return "PDF";
    case "image":
      return "图片";
    case "video":
      return "视频";
    case "audio":
      return "音频";
  }
}

export function pathKey(path: string): string {
  return path
    .replace(/\//g, "\\")
    .replace(/^\\\\\?\\/, "")
    .toLowerCase();
}

export function samePath(a: string, b: string): boolean {
  return pathKey(a) === pathKey(b);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function formatCount(count: number): string {
  return count.toLocaleString("zh-CN");
}

export function formatClock(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

export function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return formatDate(timestamp);
}

/** 拼接本地路径，用于 Markdown 相对图片。 */
export function joinPath(dir: string, relative: string): string {
  const target = relative.replace(/^\.\//, "");
  if (/^[a-zA-Z]:[\\/]/.test(target) || target.startsWith("\\\\")) return target;
  const separator = dir.includes("\\") ? "\\" : "/";
  const base = dir.replace(/[\\/]+$/, "");
  const tail = target.replace(/^[\\/]+/, "");
  return `${base}${separator}${tail.split("/").join(separator)}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `tab-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
