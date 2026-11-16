use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};

mod update;

const MAX_FILE_BYTES: u64 = 50 * 1024 * 1024;
const WATCH_DEBOUNCE: Duration = Duration::from_millis(220);
const READ_RETRY_DELAY: Duration = Duration::from_millis(160);
const READ_ATTEMPTS: usize = 4;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentData {
    path: String,
    dir: String,
    file_name: String,
    content: String,
    encoding: String,
    size: u64,
    mtime: i64,
    lines: u64,
    chars: u64,
    watching: bool,
}

/// 文件变化通知。只携带元数据，不携带内容：
/// 前端收到后按需重新读取，避免把几十 MB 的文本反复塞进事件序列化。
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentChanged {
    path: String,
    /// "changed"（文本需要重读）| "media"（媒体元数据变化）| "missing" | "error"
    kind: String,
    size: Option<u64>,
    mtime: Option<i64>,
    error: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DirEntry {
    path: String,
    name: String,
    is_dir: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaData {
    path: String,
    dir: String,
    file_name: String,
    kind: String,
    size: u64,
    mtime: i64,
    watching: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PdfData {
    path: String,
    dir: String,
    file_name: String,
    size: u64,
    mtime: i64,
    watching: bool,
}

/// 文件树过滤参数（来自阅读设置）。
/// - `all`：显示目录下所有非隐藏文件；
/// - `extensions` 非空：只显示这些后缀（或同名文件）的文件；
/// - 两者都为空：按内置支持类型过滤（文本 / 代码 / 媒体）。
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct DirFilter {
    all: bool,
    extensions: Vec<String>,
}

impl DirFilter {
    fn allows(&self, path: &Path) -> bool {
        if self.all {
            return true;
        }
        if self.extensions.is_empty() {
            return is_supported_file(path);
        }
        let extension = path
            .extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.to_ascii_lowercase());
        if let Some(extension) = extension {
            if self
                .extensions
                .iter()
                .any(|item| normalize_filter_item(item) == extension)
            {
                return true;
            }
        }
        path.file_name()
            .and_then(|name| name.to_str())
            .map(|name| {
                let lower = name.to_ascii_lowercase();
                self.extensions
                    .iter()
                    .any(|item| normalize_filter_item(item) == lower)
            })
            .unwrap_or(false)
    }
}

fn normalize_filter_item(item: &str) -> String {
    item.trim()
        .trim_start_matches(['*', '.'])
        .to_ascii_lowercase()
}

struct WatchState {
    watcher: Option<RecommendedWatcher>,
    /// 被监听的目录 -> 该目录下正在阅读的文件
    dirs: HashMap<PathBuf, HashSet<PathBuf>>,
    /// 上次通知前端的 (size, mtime)，用于跳过没有实际变化的触碰事件
    seen: HashMap<PathBuf, (u64, i64)>,
}

impl WatchState {
    fn register(&mut self, file: PathBuf) -> Result<(), String> {
        let dir = file
            .parent()
            .ok_or_else(|| "无效的文件路径".to_string())?
            .to_path_buf();
        let is_new_dir = !self.dirs.contains_key(&dir);
        self.dirs.entry(dir.clone()).or_default().insert(file);
        if is_new_dir {
            if let Some(watcher) = self.watcher.as_mut() {
                watcher
                    .watch(&dir, RecursiveMode::NonRecursive)
                    .map_err(|error| error.to_string())?;
            }
        }
        Ok(())
    }

    fn note_seen(&mut self, file: &Path, size: u64, mtime: i64) {
        self.seen.insert(file.to_path_buf(), (size, mtime));
    }

    fn already_seen(&self, file: &Path, size: u64, mtime: i64) -> bool {
        self.seen.get(file) == Some(&(size, mtime))
    }

    fn unregister(&mut self, file: &Path) {
        self.seen.remove(file);
        let Some(dir) = file.parent() else {
            return;
        };
        let remove_dir = match self.dirs.get_mut(dir) {
            Some(files) => {
                files.remove(file);
                files.is_empty()
            }
            None => false,
        };
        if remove_dir {
            self.dirs.remove(dir);
            if let Some(watcher) = self.watcher.as_mut() {
                let _ = watcher.unwatch(dir);
            }
        }
    }

    /// 目录监听拿到的路径可能是同目录下任意文件，这里按目录映射回正在阅读的文档。
    fn candidates_for(&self, touched: &[PathBuf]) -> Vec<PathBuf> {
        let mut candidates = HashSet::new();
        for path in touched {
            if let Some(files) = self.dirs.get(path) {
                candidates.extend(files.iter().cloned());
            }
            if let Some(parent) = path.parent() {
                if let Some(files) = self.dirs.get(parent) {
                    candidates.extend(files.iter().cloned());
                }
            }
        }
        candidates.into_iter().collect()
    }
}

struct AppState {
    watch: Arc<Mutex<WatchState>>,
    launch_files: Mutex<Vec<String>>,
}

// 文件 IO 一律放到阻塞线程池执行：同步命令会占用主线程（窗口事件循环），
// 大文件读取或目录扫描期间窗口无法重绘，表现为整体卡顿甚至黑屏。
#[tauri::command]
async fn read_document(
    app: AppHandle,
    path: String,
    state: State<'_, AppState>,
) -> Result<DocumentData, String> {
    let app = app.clone();
    let watch = state.watch.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let file = canonical_document(&path)?;
        let mut document = load_document(&file)?;
        if let Some(dir) = file.parent() {
            // 允许文档目录（含子目录）里的图片经 asset 协议显示，其余目录保持不可访问。
            let _ = app.asset_protocol_scope().allow_directory(dir, true);
        }
        document.watching = match watch.lock() {
            Ok(mut state) => {
                state.note_seen(&file, document.size, document.mtime);
                state.register(file).is_ok()
            }
            Err(_) => false,
        };
        Ok(document)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn open_media(
    app: AppHandle,
    path: String,
    state: State<'_, AppState>,
) -> Result<MediaData, String> {
    let app = app.clone();
    let watch = state.watch.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let file = canonical_media(&path)?;
        let metadata =
            fs::metadata(&file).map_err(|error| format!("无法读取文件信息：{error}"))?;
        if let Some(dir) = file.parent() {
            let _ = app.asset_protocol_scope().allow_directory(dir, true);
        }
        let kind = media_kind(&file).unwrap_or("image").to_string();
        let mut media = MediaData {
            path: file.to_string_lossy().into_owned(),
            dir: file
                .parent()
                .map(|dir| dir.to_string_lossy().into_owned())
                .unwrap_or_default(),
            file_name: file
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default(),
            kind,
            size: metadata.len(),
            mtime: mtime_millis(&metadata),
            watching: false,
        };
        media.watching = match watch.lock() {
            Ok(mut state) => {
                state.note_seen(&file, media.size, media.mtime);
                state.register(file).is_ok()
            }
            Err(_) => false,
        };
        Ok(media)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn open_pdf(
    app: AppHandle,
    path: String,
    state: State<'_, AppState>,
) -> Result<PdfData, String> {
    let app = app.clone();
    let watch = state.watch.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let file = canonical_pdf(&path)?;
        let metadata =
            fs::metadata(&file).map_err(|error| format!("无法读取文件信息：{error}"))?;
        if let Some(dir) = file.parent() {
            // PDF 由 WebView2 内置查看器通过 asset 协议流式读取。
            let _ = app.asset_protocol_scope().allow_directory(dir, true);
        }
        let mut pdf = PdfData {
            path: file.to_string_lossy().into_owned(),
            dir: file
                .parent()
                .map(|dir| dir.to_string_lossy().into_owned())
                .unwrap_or_default(),
            file_name: file
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default(),
            size: metadata.len(),
            mtime: mtime_millis(&metadata),
            watching: false,
        };
        pdf.watching = match watch.lock() {
            Ok(mut state) => {
                state.note_seen(&file, pdf.size, pdf.mtime);
                state.register(file).is_ok()
            }
            Err(_) => false,
        };
        Ok(pdf)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn close_document(path: String, state: State<'_, AppState>) -> Result<(), String> {
    let watch = state.watch.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let file = dunce::canonicalize(&path).unwrap_or_else(|_| PathBuf::from(path));
        if let Ok(mut state) = watch.lock() {
            state.unregister(&file);
        }
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn take_launch_files(state: State<'_, AppState>) -> Vec<String> {
    state
        .launch_files
        .lock()
        .map(|mut files| std::mem::take(&mut *files))
        .unwrap_or_default()
}

/// 读取一层目录内容，供左侧文件树懒加载。目录总是返回，
/// 文件按 `filter`（阅读设置里的文件树显示范围）决定是否返回。
#[tauri::command]
async fn list_directory(
    path: String,
    filter: Option<DirFilter>,
) -> Result<Vec<DirEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let filter = filter.unwrap_or_default();
        let read = fs::read_dir(&path).map_err(|error| format!("无法读取目录：{error}"))?;
        let mut entries = Vec::new();

        for entry in read.flatten() {
            let entry_path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                continue;
            }
            let metadata = match fs::metadata(&entry_path) {
                Ok(metadata) => metadata,
                Err(_) => continue,
            };
            if is_hidden_entry(&metadata) {
                continue;
            }
            let is_dir = metadata.is_dir();
            if !is_dir && !filter.allows(&entry_path) {
                continue;
            }
            entries.push(DirEntry {
                path: entry_path.to_string_lossy().into_owned(),
                name,
                is_dir,
            });
        }

        entries.sort_by(|a, b| {
            b.is_dir
                .cmp(&a.is_dir)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        Ok(entries)
    })
    .await
    .map_err(|error| error.to_string())?
}

/// 把 Markdown 里的相对链接解析成真实的本地文档路径。
#[tauri::command]
async fn resolve_document_link(file: String, href: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let href = href.trim();
        if href.is_empty() || href.starts_with('#') {
            return Ok(None);
        }
        let lower = href.to_ascii_lowercase();
        if lower.starts_with("http://")
            || lower.starts_with("https://")
            || lower.starts_with("mailto:")
            || lower.starts_with("data:")
            || lower.starts_with("javascript:")
        {
            return Ok(None);
        }

        let raw = href
            .strip_prefix("file:///")
            .or_else(|| href.strip_prefix("file://"))
            .unwrap_or(href);
        let decoded = percent_encoding::percent_decode_str(raw).decode_utf8_lossy();
        let cleaned = decoded.split(['#', '?']).next().unwrap_or("").trim();
        if cleaned.is_empty() {
            return Ok(None);
        }

        let Some(base) = Path::new(&file).parent() else {
            return Ok(None);
        };
        let candidate = if Path::new(cleaned).is_absolute() {
            PathBuf::from(cleaned)
        } else {
            base.join(cleaned)
        };
        let resolved = match dunce::canonicalize(candidate) {
            Ok(resolved) => resolved,
            Err(_) => return Ok(None),
        };
        if resolved.is_file() && is_supported_file(&resolved) {
            Ok(Some(resolved.to_string_lossy().into_owned()))
        } else {
            Ok(None)
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

fn canonical_document(path: &str) -> Result<PathBuf, String> {
    let file = dunce::canonicalize(path).map_err(|_| format!("文件不存在或无法访问：{path}"))?;
    if !file.is_file() {
        return Err("该路径不是文件".to_string());
    }
    if !is_text_file(&file) {
        return Err("暂不支持查看该类型的文件".to_string());
    }
    Ok(file)
}

fn canonical_media(path: &str) -> Result<PathBuf, String> {
    let file = dunce::canonicalize(path).map_err(|_| format!("文件不存在或无法访问：{path}"))?;
    if !file.is_file() {
        return Err("该路径不是文件".to_string());
    }
    if media_kind(&file).is_none() {
        return Err("不支持的媒体格式".to_string());
    }
    Ok(file)
}

fn canonical_pdf(path: &str) -> Result<PathBuf, String> {
    let file = dunce::canonicalize(path).map_err(|_| format!("文件不存在或无法访问：{path}"))?;
    if !file.is_file() {
        return Err("该路径不是文件".to_string());
    }
    if !is_pdf(&file) {
        return Err("该文件不是 PDF".to_string());
    }
    Ok(file)
}

fn is_pdf(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("pdf"))
        .unwrap_or(false)
}

/// 可作为代码 / 纯文本查看的扩展名；与前端 src/lib/format.ts 的列表保持一致。
const TEXT_EXTENSIONS: &[&str] = &[
    // 文档
    "txt", "md", "markdown", "mdx", // 代码
    "go", "rs", "py", "pyw", "pyi", "js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts",
    "java", "kt", "kts", "scala", "sc", "groovy", "gradle", "clj", "cljs", "cljc", "edn", "ex",
    "exs", "erl", "hrl", "hs", "lhs", "ml", "mli", "fs", "fsi", "fsx", "cs", "csx", "vb",
    "vbs", "swift", "m", "mm", "c", "h", "cc", "cpp", "cxx", "hpp", "hxx", "hh", "ino", "d",
    "dart", "lua", "r", "jl", "pl", "pm", "rb", "rake", "php", "phtml", "sh", "bash", "zsh",
    "fish", "ksh", "ps1", "psm1", "bat", "cmd", "awk", "nim", "zig", "v", "sol", "proto",
    "thrift", "graphql", "gql", "sql", "prisma", "hcl", "tf", "tfvars", "html", "htm",
    "xhtml", "shtml", "css", "scss", "sass", "less", "styl", "vue", "svelte", "astro", "xml",
    "json", "jsonc", "json5", "jsonl", "ndjson", "yaml", "yml", "toml", "ini", "cfg", "conf",
    "config", "properties", "env", "editorconfig", "csv", "tsv", "diff", "patch", "rej", "srt",
    "vtt", "ass", "ssa", "nfo", "dockerfile", "makefile", "mk", "cmake", "ninja", "bzl",
    "bazel", "lock", "sum", "mod", "tex", "latex", "bib", "rst", "adoc", "asciidoc", "org",
    "log", "text",
];

/// 没有扩展名、但通常是纯文本的文件名。
const TEXT_FILE_NAMES: &[&str] = &[
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
];

fn is_text_file(path: &Path) -> bool {
    if let Some(extension) = path.extension().and_then(|extension| extension.to_str()) {
        let extension = extension.to_ascii_lowercase();
        if TEXT_EXTENSIONS.contains(&extension.as_str()) {
            return true;
        }
    }
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| {
            let lower = name.to_ascii_lowercase();
            TEXT_FILE_NAMES.contains(&lower.as_str())
        })
        .unwrap_or(false)
}

fn media_kind(path: &Path) -> Option<&'static str> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    match extension.as_str() {
        "png" | "jpg" | "jpeg" | "jfif" | "gif" | "webp" | "bmp" | "svg" | "avif" | "apng"
        | "ico" | "tif" | "tiff" | "heic" | "heif" => Some("image"),
        "mp4" | "webm" | "ogv" | "m4v" | "mov" | "mkv" | "avi" | "wmv" | "flv" | "mpg"
        | "mpeg" | "3gp" | "m2ts" => Some("video"),
        "mp3" | "wav" | "m4a" | "m4b" | "aac" | "flac" | "ogg" | "oga" | "opus" | "wma"
        | "aiff" | "aif" | "ape" | "amr" | "mid" | "midi" | "ac3" => Some("audio"),
        _ => None,
    }
}

fn is_supported_file(path: &Path) -> bool {
    is_text_file(path) || media_kind(path).is_some() || is_pdf(path)
}

#[cfg(windows)]
fn is_hidden_entry(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
    const FILE_ATTRIBUTE_SYSTEM: u32 = 0x4;
    metadata.file_attributes() & (FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM) != 0
}

#[cfg(not(windows))]
fn is_hidden_entry(_metadata: &fs::Metadata) -> bool {
    false
}

fn load_document(file: &Path) -> Result<DocumentData, String> {
    let metadata = fs::metadata(file).map_err(|error| format!("无法读取文件信息：{error}"))?;
    if metadata.len() > MAX_FILE_BYTES {
        return Err(format!(
            "文件超过 {} MB，暂不支持打开",
            MAX_FILE_BYTES / 1024 / 1024
        ));
    }
    let bytes = fs::read(file).map_err(|error| format!("无法读取文件：{error}"))?;
    let (content, encoding) = decode_text(&bytes)?;
    let (lines, chars) = document_stats(&content);
    Ok(DocumentData {
        path: file.to_string_lossy().into_owned(),
        dir: file
            .parent()
            .map(|dir| dir.to_string_lossy().into_owned())
            .unwrap_or_default(),
        file_name: file
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default(),
        content,
        encoding,
        size: bytes.len() as u64,
        mtime: mtime_millis(&metadata),
        lines,
        chars,
        watching: false,
    })
}

fn decode_text(bytes: &[u8]) -> Result<(String, String), String> {
    if let Some(rest) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF][..]) {
        return Ok((
            normalize_newlines(String::from_utf8_lossy(rest).into_owned()),
            "UTF-8".to_string(),
        ));
    }
    if let Some(rest) = bytes.strip_prefix(&[0xFF, 0xFE][..]) {
        let (text, _, _) = encoding_rs::UTF_16LE.decode(rest);
        return Ok((normalize_newlines(text.into_owned()), "UTF-16 LE".to_string()));
    }
    if let Some(rest) = bytes.strip_prefix(&[0xFE, 0xFF][..]) {
        let (text, _, _) = encoding_rs::UTF_16BE.decode(rest);
        return Ok((normalize_newlines(text.into_owned()), "UTF-16 BE".to_string()));
    }
    if bytes.is_empty() {
        return Ok((String::new(), "UTF-8".to_string()));
    }
    if bytes.iter().take(8192).any(|byte| *byte == 0) {
        return Err("无法打开：这看起来是二进制文件".to_string());
    }
    if bytes.is_ascii() {
        return Ok((
            normalize_newlines(String::from_utf8_lossy(bytes).into_owned()),
            "UTF-8".to_string(),
        ));
    }

    let mut detector = chardetng::EncodingDetector::new(chardetng::Iso2022JpDetection::Deny);
    detector.feed(bytes, true);
    let encoding = detector.guess(None, chardetng::Utf8Detection::Allow);
    let (text, _, _) = encoding.decode(bytes);
    Ok((
        normalize_newlines(text.into_owned()),
        encoding.name().to_string(),
    ))
}

fn normalize_newlines(text: String) -> String {
    if text.contains('\r') {
        text.replace("\r\n", "\n").replace('\r', "\n")
    } else {
        text
    }
}

fn mtime_millis(metadata: &fs::Metadata) -> i64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_else(|| {
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_millis() as i64)
                .unwrap_or(0)
        })
}

fn metadata_with_retry(file: &Path) -> std::io::Result<fs::Metadata> {
    let mut last_error = None;
    for attempt in 0..READ_ATTEMPTS {
        match fs::metadata(file) {
            Ok(metadata) => return Ok(metadata),
            Err(error) => {
                last_error = Some(error);
                if attempt + 1 < READ_ATTEMPTS {
                    // 编辑器常用“写临时文件再重命名”的方式保存，给文件系统一点时间。
                    std::thread::sleep(READ_RETRY_DELAY);
                }
            }
        }
    }
    Err(last_error.unwrap_or_else(|| std::io::Error::other("无法读取文件信息")))
}

/// 与状态栏的 JS 统计口径一致：行数按换行计，字数不含空白字符。
fn document_stats(content: &str) -> (u64, u64) {
    if content.is_empty() {
        return (0, 0);
    }
    let mut lines = 1u64;
    let mut chars = 0u64;
    for ch in content.chars() {
        match ch {
            '\n' => lines += 1,
            ' ' | '\t' | '\r' | '\u{a0}' | '\u{3000}' => {}
            _ => chars += 1,
        }
    }
    (lines, chars)
}

/// 构造轻量的变更通知：只带元数据，内容由前端按需重新读取。
/// size+mtime 与上次通知一致时返回 None，跳过没有实际变化的触碰事件。
fn change_payload(file: &Path, watch: &Arc<Mutex<WatchState>>) -> Option<DocumentChanged> {
    let path = file.to_string_lossy().into_owned();
    match metadata_with_retry(file) {
        Ok(metadata) => {
            let size = metadata.len();
            let mtime = mtime_millis(&metadata);
            let skip = match watch.lock() {
                Ok(mut state) => {
                    if state.already_seen(file, size, mtime) {
                        true
                    } else {
                        state.note_seen(file, size, mtime);
                        false
                    }
                }
                Err(_) => false,
            };
            if skip {
                return None;
            }
            Some(DocumentChanged {
                path,
                kind: if media_kind(file).is_some() || is_pdf(file) {
                    "media"
                } else {
                    "changed"
                }
                .to_string(),
                size: Some(size),
                mtime: Some(mtime),
                error: None,
            })
        }
        Err(error) => {
            let missing = !file.exists();
            Some(DocumentChanged {
                path,
                kind: if missing { "missing" } else { "error" }.to_string(),
                size: None,
                mtime: None,
                error: Some(if missing {
                    "文件已被删除或移动".to_string()
                } else {
                    error.to_string()
                }),
            })
        }
    }
}

fn collect_paths(event: notify::Result<notify::Event>, touched: &mut Vec<PathBuf>) {
    let Ok(event) = event else {
        return;
    };
    if matches!(event.kind, EventKind::Access(_)) {
        return;
    }
    for path in event.paths {
        if !touched.contains(&path) {
            touched.push(path);
        }
    }
}

fn watch_loop(
    app: AppHandle,
    watch: Arc<Mutex<WatchState>>,
    receiver: Receiver<notify::Result<notify::Event>>,
) {
    loop {
        let first = match receiver.recv() {
            Ok(event) => event,
            Err(_) => break,
        };
        let mut touched = Vec::new();
        collect_paths(first, &mut touched);
        loop {
            match receiver.recv_timeout(WATCH_DEBOUNCE) {
                Ok(event) => collect_paths(event, &mut touched),
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => return,
            }
        }
        if touched.is_empty() {
            continue;
        }
        let candidates = match watch.lock() {
            Ok(state) => state.candidates_for(&touched),
            Err(_) => return,
        };
        for file in candidates {
            if let Some(payload) = change_payload(&file, &watch) {
                let _ = app.emit("document-changed", payload);
            }
        }
    }
}

fn launch_files() -> Vec<String> {
    std::env::args_os()
        .skip(1)
        .filter_map(|argument| {
            let path = PathBuf::from(argument);
            if !path.is_file() || !is_supported_file(&path) {
                return None;
            }
            dunce::canonicalize(&path)
                .ok()
                .map(|path| path.to_string_lossy().into_owned())
        })
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // 只恢复尺寸/位置等状态，不恢复窗口装饰，避免旧状态把系统标题栏带回来。
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED
                        | tauri_plugin_window_state::StateFlags::VISIBLE
                        | tauri_plugin_window_state::StateFlags::FULLSCREEN,
                )
                .build(),
        )
        .setup(|app| {
            let (sender, receiver) = mpsc::channel();
            let watcher = notify::recommended_watcher(move |result| {
                let _ = sender.send(result);
            })?;
            let watch = Arc::new(Mutex::new(WatchState {
                watcher: Some(watcher),
                dirs: HashMap::new(),
                seen: HashMap::new(),
            }));
            app.manage(AppState {
                watch: watch.clone(),
                launch_files: Mutex::new(launch_files()),
            });
            let handle = app.handle().clone();
            std::thread::spawn(move || watch_loop(handle, watch, receiver));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_document,
            open_media,
            open_pdf,
            close_document,
            resolve_document_link,
            take_launch_files,
            list_directory,
            update::app_version,
            update::check_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running x-reader");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_utf8_and_normalizes_newlines() {
        let (text, encoding) = decode_text("第一行\r\n第二行\r第三行".as_bytes()).unwrap();
        assert_eq!(text, "第一行\n第二行\n第三行");
        assert_eq!(encoding, "UTF-8");
    }

    #[test]
    fn counts_document_stats() {
        assert_eq!(document_stats(""), (0, 0));
        let (lines, chars) = document_stats("第一行\n第二行  x\n\n第三行\t。");
        assert_eq!(lines, 4);
        // 换行、空格、制表符不计入字数
        let expected = "第一行第二行x第三行。".chars().count() as u64;
        assert_eq!(chars, expected);
    }

    #[test]
    fn decodes_utf8_bom() {
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice("带 BOM 的文本".as_bytes());
        let (text, encoding) = decode_text(&bytes).unwrap();
        assert_eq!(text, "带 BOM 的文本");
        assert_eq!(encoding, "UTF-8");
    }

    #[test]
    fn decodes_gbk() {
        // “中文测试” 的 GBK 编码
        let bytes = [0xD6, 0xD0, 0xCE, 0xC4, 0xB2, 0xE2, 0xCA, 0xD4];
        let (text, encoding) = decode_text(&bytes).unwrap();
        assert_eq!(text, "中文测试");
        assert!(encoding.to_ascii_lowercase().contains("gb"));
    }

    #[test]
    fn decodes_utf16_le_bom() {
        let mut bytes = vec![0xFF, 0xFE];
        for unit in "你好".encode_utf16() {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
        let (text, encoding) = decode_text(&bytes).unwrap();
        assert_eq!(text, "你好");
        assert_eq!(encoding, "UTF-16 LE");
    }

    #[test]
    fn rejects_binary_content() {
        let bytes = [0x00, 0x01, 0x02, 0x03, 0xFF];
        assert!(decode_text(&bytes).is_err());
    }

    #[test]
    fn detects_text_and_code_extensions() {
        assert!(is_text_file(Path::new("a.txt")));
        assert!(is_text_file(Path::new("b.MD")));
        assert!(is_text_file(Path::new("c.markdown")));
        assert!(is_text_file(Path::new("main.go")));
        assert!(is_text_file(Path::new("app.PY")));
        assert!(is_text_file(Path::new("index.ts")));
        assert!(is_text_file(Path::new("config.yaml")));
        assert!(is_text_file(Path::new("README")));
        assert!(is_text_file(Path::new("Dockerfile")));
        assert!(is_text_file(Path::new("Makefile")));
        assert!(!is_text_file(Path::new("d.pdf")));
        assert!(!is_text_file(Path::new("cover.png")));
        assert!(!is_text_file(Path::new("archive.zip")));
    }

    #[test]
    fn detects_pdf_files() {
        assert!(is_pdf(Path::new("book.pdf")));
        assert!(is_pdf(Path::new("BOOK.PDF")));
        assert!(!is_pdf(Path::new("book.txt")));
        assert!(!is_text_file(Path::new("book.pdf")));
        assert_eq!(media_kind(Path::new("book.pdf")), None);
        assert!(is_supported_file(Path::new("book.pdf")));
    }

    #[test]
    fn resolves_relative_document_links() {
        let root = std::env::temp_dir().join(format!(
            "x-reader-link-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_nanos())
                .unwrap_or(0)
        ));
        fs::create_dir_all(&root).unwrap();
        let from = root.join("index.md");
        let target = root.join("章节 一.md");
        fs::write(&from, "# index").unwrap();
        fs::write(&target, "内容").unwrap();

        let resolve = |file: String, href: String| {
            tauri::async_runtime::block_on(resolve_document_link(file, href))
        };
        let from_str = from.to_string_lossy().into_owned();
        let expected = target.to_string_lossy().into_owned();
        assert_eq!(
            resolve(from_str.clone(), "章节%20一.md#top".into())
                .unwrap()
                .as_deref(),
            Some(expected.as_str())
        );
        assert!(
            resolve(from_str.clone(), "https://example.com/a.md".into())
                .unwrap()
                .is_none()
        );
        assert!(resolve(from_str, "missing.md".into()).unwrap().is_none());

        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn lists_directories_and_supported_files() {
        let root = std::env::temp_dir().join(format!(
            "x-reader-tree-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_nanos())
                .unwrap_or(0)
        ));
        fs::create_dir_all(root.join("子目录")).unwrap();
        fs::write(root.join("B.txt"), "b").unwrap();
        fs::write(root.join("a.MD"), "a").unwrap();
        fs::write(root.join("cover.png"), "png").unwrap();
        fs::write(root.join("doc.pdf"), "pdf").unwrap();
        fs::write(root.join("main.go"), "package main").unwrap();
        fs::write(root.join("song.mp3"), "mp3").unwrap();
        fs::write(root.join("video.mp4"), "mp4").unwrap();
        fs::write(root.join(".hidden.md"), "hidden").unwrap();
        fs::write(root.join("note.json"), "{}").unwrap();
        fs::write(root.join("archive.zip"), "zip").unwrap();

        let entries = list_dir(&root, None);
        let names: Vec<&str> = entries.iter().map(|entry| entry.name.as_str()).collect();
        assert_eq!(
            names,
            vec![
                "子目录",
                "a.MD",
                "B.txt",
                "cover.png",
                "doc.pdf",
                "main.go",
                "note.json",
                "song.mp3",
                "video.mp4"
            ]
        );
        assert!(entries[0].is_dir);
        assert!(!entries[1].is_dir);

        // 显示全部文件：隐藏文件仍然被过滤。
        let all = list_dir(
            &root,
            Some(DirFilter {
                all: true,
                extensions: vec![],
            }),
        );
        let names: Vec<&str> = all.iter().map(|entry| entry.name.as_str()).collect();
        assert!(names.contains(&"archive.zip"));
        assert!(names.contains(&"main.go"));
        assert!(!names.contains(&".hidden.md"));

        // 自定义后缀：只显示匹配的后缀（目录始终显示）。
        let custom = list_dir(
            &root,
            Some(DirFilter {
                all: false,
                extensions: vec![".ZIP".into(), "go".into()],
            }),
        );
        let names: Vec<&str> = custom.iter().map(|entry| entry.name.as_str()).collect();
        assert_eq!(names, vec!["子目录", "archive.zip", "main.go"]);

        fs::remove_dir_all(&root).unwrap();
    }

    fn list_dir(root: &Path, filter: Option<DirFilter>) -> Vec<DirEntry> {
        tauri::async_runtime::block_on(list_directory(
            root.to_string_lossy().into_owned(),
            filter,
        ))
        .unwrap()
    }

    #[test]
    fn parses_directory_filter_payload() {
        let filter: DirFilter =
            serde_json::from_str(r#"{"all":false,"extensions":["go","py"]}"#).unwrap();
        assert!(!filter.all);
        assert_eq!(filter.extensions, vec!["go".to_string(), "py".to_string()]);
        assert!(filter.allows(Path::new("main.go")));
        assert!(!filter.allows(Path::new("cover.png")));

        let empty: DirFilter = serde_json::from_str("{}").unwrap();
        assert!(!empty.all);
        assert!(empty.extensions.is_empty());
        assert!(empty.allows(Path::new("note.md")));
        assert!(!empty.allows(Path::new("archive.zip")));
    }

    #[test]
    fn classifies_media_extensions() {
        assert_eq!(media_kind(Path::new("cover.PNG")), Some("image"));
        assert_eq!(media_kind(Path::new("photo.heic")), Some("image"));
        assert_eq!(media_kind(Path::new("icon.ico")), Some("image"));
        assert_eq!(media_kind(Path::new("demo.webm")), Some("video"));
        assert_eq!(media_kind(Path::new("movie.mkv")), Some("video"));
        assert_eq!(media_kind(Path::new("movie.avi")), Some("video"));
        assert_eq!(media_kind(Path::new("voice.mp3")), Some("audio"));
        assert_eq!(media_kind(Path::new("voice.ape")), Some("audio"));
        assert_eq!(media_kind(Path::new("chapter.md")), None);
        // .ts 是 TypeScript 文本，不能被当成 MPEG-TS 视频。
        assert_eq!(media_kind(Path::new("app.ts")), None);
        assert!(is_text_file(Path::new("app.ts")));
        assert!(is_supported_file(Path::new("chapter.txt")));
        assert!(is_supported_file(Path::new("main.py")));
        assert!(is_supported_file(Path::new("clip.mp4")));
        assert!(is_supported_file(Path::new("clip.mkv")));
        assert!(is_supported_file(Path::new("sound.flac")));
        assert!(!is_supported_file(Path::new("archive.zip")));
    }
}
