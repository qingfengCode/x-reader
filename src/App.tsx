import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  DocumentChanged,
  DocumentData,
  MediaData,
  ReaderSettings,
  RecentFile,
  ResolvedTheme,
  Tab,
  ToastItem,
  ToastKind,
} from "./types";
import {
  closeDocument,
  onDocumentChanged,
  onDragDrop,
  openExternal,
  openMedia,
  openWithSystem,
  pickFiles,
  readDocument,
  resolveDocumentLink,
  revealFile,
  takeLaunchFiles,
} from "./lib/api";
import {
  baseName,
  createId,
  dirName,
  isMediaKind,
  isSupportedPath,
  kindOf,
  pathKey,
  samePath,
} from "./lib/format";
import {
  clearRecents,
  DEFAULT_SETTINGS,
  loadRecents,
  loadSession,
  loadSettings,
  loadSidebarOpen,
  normalizeSettings,
  READER_FONT_SIZES,
  rememberRecent,
  saveSession,
  saveSettings,
  saveSidebarOpen,
} from "./lib/storage";
import { MediaViewer } from "./components/MediaViewer";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { TabBar } from "./components/TabBar";
import { TitleBar } from "./components/TitleBar";
import { Viewer } from "./components/Viewer";
import { Welcome } from "./components/Welcome";
import { Toasts } from "./components/Toasts";
import { AlertTriangleIcon, BookOpenIcon } from "./components/icons";
function pendingTab(id: string, path: string): Tab {
  return {
    id,
    path,
    fileName: baseName(path),
    dir: dirName(path),
    kind: kindOf(path),
    content: "",
    encoding: "",
    size: 0,
    mtime: 0,
    lines: 0,
    chars: 0,
    watching: false,
    missing: false,
    loading: true,
    refreshing: false,
    externalUpdate: false,
    lastUpdatedAt: 0,
  };
}

function documentToTab(id: string, doc: DocumentData): Tab {
  return {
    id,
    path: doc.path,
    fileName: doc.fileName,
    dir: doc.dir,
    kind: kindOf(doc.path),
    content: doc.content,
    encoding: doc.encoding,
    size: doc.size,
    mtime: doc.mtime,
    lines: doc.lines,
    chars: doc.chars,
    watching: doc.watching,
    missing: false,
    loading: false,
    refreshing: false,
    externalUpdate: false,
    lastUpdatedAt: Date.now(),
  };
}

function mediaToTab(id: string, media: MediaData): Tab {
  return {
    id,
    path: media.path,
    fileName: media.fileName,
    dir: media.dir,
    kind: media.kind,
    content: "",
    encoding: "",
    size: media.size,
    mtime: media.mtime,
    lines: 0,
    chars: 0,
    watching: media.watching,
    missing: false,
    loading: false,
    refreshing: false,
    externalUpdate: false,
    lastUpdatedAt: Date.now(),
  };
}

function App() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveIdState] = useState<string | null>(null);
  const [settings, setSettings] = useState<ReaderSettings>(loadSettings);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(loadSidebarOpen);
  const [recents, setRecents] = useState<RecentFile[]>(loadRecents);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [findOpen, setFindOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [booting, setBooting] = useState(true);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );

  const tabsRef = useRef<Tab[]>([]);
  const activeIdRef = useRef<string | null>(null);
  const inflightRef = useRef<Map<string, string>>(new Map());
  const openPathsMapRef = useRef<Map<string, string>>(new Map());
  const closedTabIdsRef = useRef<Set<string>>(new Set());
  const toastSeqRef = useRef(0);
  const lastErrorToastRef = useRef<Record<string, number>>({});

  const theme: ResolvedTheme =
    settings.theme === "system" ? (systemDark ? "dark" : "light") : settings.theme;

  const pushToast = useCallback((kind: ToastKind, title: string, detail?: string) => {
    const id = (toastSeqRef.current += 1);
    setToasts((prev) => [...prev.slice(-3), { id, kind, title, detail }]);
    window.setTimeout(
      () => setToasts((prev) => prev.filter((item) => item.id !== id)),
      kind === "error" ? 5200 : 2800,
    );
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const noteRecent = useCallback((file: { path: string; fileName: string; dir: string }) => {
    setRecents(
      rememberRecent({ path: file.path, fileName: file.fileName, dir: file.dir }),
    );
  }, []);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    getCurrentWindow()
      .setTheme(theme)
      .catch(() => {
        // 原生标题栏主题不可用时忽略
      });
  }, [theme]);

  useEffect(() => {
    // 窗口状态插件可能恢复历史的“有边框”设置，这里强制保持无边框。
    getCurrentWindow()
      .setDecorations(false)
      .catch(() => {
        // 旧版权限或非桌面环境不可用时忽略
      });
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  const updateSettings = useCallback((next: ReaderSettings) => {
    const normalized = normalizeSettings(next);
    setSettings(normalized);
    saveSettings(normalized);
  }, []);

  const toggleTheme = useCallback(() => {
    updateSettings({ ...settings, theme: theme === "dark" ? "light" : "dark" });
  }, [settings, theme, updateSettings]);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => {
      const next = !prev;
      saveSidebarOpen(next);
      return next;
    });
  }, []);

  const toggleFind = useCallback(() => {
    const active = tabsRef.current.find((tab) => tab.id === activeIdRef.current);
    if (!active || active.loading || isMediaKind(active.kind)) return;
    setFindOpen((value) => !value);
  }, []);

  const openPaths = useCallback(
    async (paths: string[], options?: { focusPath?: string | null }) => {
      const loads: Promise<void>[] = [];
      let lastId: string | null = null;

      for (const rawPath of paths) {
        if (!isSupportedPath(rawPath)) {
          pushToast(
            "info",
            `暂不支持预览 ${baseName(rawPath)}`,
            "文件树设置只影响显示范围；该文件类型暂不支持预览。",
          );
          continue;
        }
        const key = pathKey(rawPath);
        const mappedId = openPathsMapRef.current.get(key);
        if (mappedId) {
          lastId = mappedId;
          continue;
        }
        if (inflightRef.current.has(key)) continue;

        const id = createId();
        inflightRef.current.set(key, id);
        openPathsMapRef.current.set(key, id);
        setTabs((prev) => {
          if (prev.some((tab) => tab.id === id || samePath(tab.path, rawPath))) return prev;
          return [...prev, pendingTab(id, rawPath)];
        });
        lastId = id;

        loads.push(
          (async () => {
            try {
              if (isMediaKind(kindOf(rawPath))) {
                const media = await openMedia(rawPath);
                if (closedTabIdsRef.current.has(id)) {
                  closeDocument(media.path).catch(() => {
                    // 标签页在读取期间被关闭，清理后台监听即可
                  });
                  return;
                }
                const canonicalKey = pathKey(media.path);
                if (openPathsMapRef.current.get(key) === id) {
                  openPathsMapRef.current.delete(key);
                }
                openPathsMapRef.current.set(canonicalKey, id);
                setTabs((prev) =>
                  prev.map((tab) =>
                    tab.id === id ? { ...tab, ...mediaToTab(id, media) } : tab,
                  ),
                );
                noteRecent(media);
                return;
              }

              const doc = await readDocument(rawPath);
              if (closedTabIdsRef.current.has(id)) {
                closeDocument(doc.path).catch(() => {
                  // 标签页在读取期间被关闭，清理后台监听即可
                });
                return;
              }
              const canonicalKey = pathKey(doc.path);
              if (openPathsMapRef.current.get(key) === id) {
                openPathsMapRef.current.delete(key);
              }
              openPathsMapRef.current.set(canonicalKey, id);
              setTabs((prev) =>
                prev.map((tab) => (tab.id === id ? { ...tab, ...documentToTab(id, doc) } : tab)),
              );
              noteRecent(doc);
            } catch (error) {
              if (closedTabIdsRef.current.has(id)) return;
              if (openPathsMapRef.current.get(key) === id) {
                openPathsMapRef.current.delete(key);
              }
              setTabs((prev) => prev.filter((tab) => tab.id !== id));
              pushToast("error", `无法打开 ${baseName(rawPath)}`, String(error));
            } finally {
              if (inflightRef.current.get(key) === id) {
                inflightRef.current.delete(key);
              }
            }
          })(),
        );
      }

      if (lastId) {
        setActiveIdState(lastId);
        activeIdRef.current = lastId;
      }

      await Promise.all(loads);

      if (options?.focusPath) {
        const targetId =
          openPathsMapRef.current.get(pathKey(options.focusPath)) ?? lastId;
        if (targetId) {
          setActiveIdState(targetId);
          activeIdRef.current = targetId;
        }
      }
    },
    [noteRecent, pushToast],
  );

  const openTreeFile = useCallback(
    (path: string) => {
      void openPaths([path]);
    },
    [openPaths],
  );

  const openDialog = useCallback(async () => {
    try {
      const paths = await pickFiles();
      if (paths.length > 0) await openPaths(paths);
    } catch (error) {
      pushToast("error", "无法打开文件选择器", String(error));
    }
  }, [openPaths, pushToast]);

  const selectTab = useCallback((id: string) => {
    setActiveIdState(id);
    activeIdRef.current = id;
    setFindOpen(false);
  }, []);

  const closeTab = useCallback((id: string) => {
    const current = tabsRef.current;
    const index = current.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    const closing = current[index];
    const remaining = current.filter((tab) => tab.id !== id);
    setTabs(remaining);
    tabsRef.current = remaining;
    closedTabIdsRef.current.add(id);
    for (const [key, value] of inflightRef.current) {
      if (value === id) inflightRef.current.delete(key);
    }
    if (openPathsMapRef.current.get(pathKey(closing.path)) === id) {
      openPathsMapRef.current.delete(pathKey(closing.path));
    }
    if (activeIdRef.current === id) {
      const next = remaining[Math.max(0, index - 1)] ?? remaining[0] ?? null;
      setActiveIdState(next?.id ?? null);
      activeIdRef.current = next?.id ?? null;
    }
    setFindOpen(false);
    closeDocument(closing.path).catch(() => {
      // 关闭监听失败不影响界面
    });
  }, []);

  const refreshTab = useCallback(
    async (id: string) => {
      const tab = tabsRef.current.find((item) => item.id === id);
      if (!tab || tab.loading) return;
      setTabs((prev) =>
        prev.map((item) => (item.id === id ? { ...item, refreshing: true } : item)),
      );
      try {
        if (isMediaKind(tab.kind)) {
          const media = await openMedia(tab.path);
          setTabs((prev) =>
            prev.map((item) =>
              item.id === id
                ? { ...item, ...mediaToTab(id, media), refreshing: false }
                : item,
            ),
          );
          noteRecent(media);
        } else {
          const doc = await readDocument(tab.path);
          setTabs((prev) =>
            prev.map((item) =>
              item.id === id ? { ...item, ...documentToTab(id, doc) } : item,
            ),
          );
          noteRecent(doc);
        }
      } catch (error) {
        const message = String(error);
        const missing = message.includes("不存在") || message.includes("删除");
        setTabs((prev) =>
          prev.map((item) =>
            item.id === id ? { ...item, refreshing: false, missing } : item,
          ),
        );
        pushToast("error", `重新加载失败：${tab.fileName}`, message);
      }
    },
    [noteRecent, pushToast],
  );

  const revealTab = useCallback(
    async (tab: Tab) => {
      try {
        await revealFile(tab.path);
      } catch (error) {
        pushToast("error", "无法在资源管理器中显示", String(error));
      }
    },
    [pushToast],
  );

  const openTabWithSystem = useCallback(
    async (tab: Tab) => {
      try {
        await openWithSystem(tab.path);
      } catch (error) {
        pushToast("error", "无法用系统应用打开", String(error));
      }
    },
    [pushToast],
  );

  const handleOpenLink = useCallback(
    async (href: string) => {
      if (/^(https?:|mailto:)/i.test(href)) {
        try {
          await openExternal(href);
        } catch (error) {
          pushToast("error", "无法打开链接", String(error));
        }
        return;
      }
      const tab = tabsRef.current.find((item) => item.id === activeIdRef.current);
      if (!tab) return;
      try {
        const target = await resolveDocumentLink(tab.path, href);
        if (target) await openPaths([target]);
        else pushToast("info", "无法打开此链接", href);
      } catch (error) {
        pushToast("error", "无法打开链接", String(error));
      }
    },
    [openPaths, pushToast],
  );

  // 传给 Viewer 的回调保持稳定引用，配合 memo 避免无关渲染（提示、拖动侧栏）
  // 触发大文档的整棵重渲染。
  const closeFind = useCallback(() => setFindOpen(false), []);
  const openLinkFromViewer = useCallback(
    (href: string) => {
      void handleOpenLink(href);
    },
    [handleOpenLink],
  );

  const adjustFontSize = useCallback((delta: number) => {
    setSettings((prev) => {
      const current = READER_FONT_SIZES.findIndex((size) => size === prev.fontSize);
      const base = current >= 0 ? current : READER_FONT_SIZES.indexOf(12);
      const nextIndex = Math.min(
        READER_FONT_SIZES.length - 1,
        Math.max(0, base + delta),
      );
      const next = normalizeSettings({
        ...prev,
        fontSize: READER_FONT_SIZES[nextIndex],
      });
      saveSettings(next);
      return next;
    });
  }, []);

  const resetFontSize = useCallback(() => {
    setSettings((prev) => {
      const next = normalizeSettings({ ...prev, fontSize: DEFAULT_SETTINGS.fontSize });
      saveSettings(next);
      return next;
    });
  }, []);

  const refreshFetchSeqRef = useRef<Map<string, number>>(new Map());

  const handleDocumentChanged = useCallback(
    (payload: DocumentChanged) => {
      const target = tabsRef.current.find((tab) => samePath(tab.path, payload.path));
      if (!target) return;
      const { id, fileName } = target;

      if (payload.kind === "missing") {
        setTabs((prev) =>
          prev.map((tab) =>
            tab.id === id ? { ...tab, missing: true, watching: false } : tab,
          ),
        );
        const now = Date.now();
        if (now - (lastErrorToastRef.current[id] ?? 0) > 5000) {
          lastErrorToastRef.current[id] = now;
          pushToast("error", "文件已被删除或移动", fileName);
        }
        return;
      }

      if (payload.kind === "error") {
        const now = Date.now();
        if (now - (lastErrorToastRef.current[id] ?? 0) > 5000) {
          lastErrorToastRef.current[id] = now;
          pushToast("error", `自动刷新失败：${fileName}`, payload.error ?? "未知错误");
        }
        return;
      }

      if (payload.kind === "media") {
        const changed =
          target.missing ||
          (payload.size != null && payload.size !== target.size) ||
          (payload.mtime != null && payload.mtime !== target.mtime);
        const isActive = activeIdRef.current === id;
        setTabs((prev) =>
          prev.map((tab) => {
            if (tab.id !== id) return tab;
            return {
              ...tab,
              size: payload.size ?? tab.size,
              mtime: payload.mtime ?? tab.mtime,
              missing: false,
              watching: true,
              externalUpdate: changed && !isActive ? true : tab.externalUpdate,
              lastUpdatedAt: changed ? Date.now() : tab.lastUpdatedAt,
            };
          }),
        );
        return;
      }

      // 文本变更：事件只携带元数据，这里按需重新读取内容。
      // 读取在阻塞线程池上执行，超大文件也不会卡住界面。
      if (target.loading) return;
      if (
        payload.size != null &&
        payload.size === target.size &&
        payload.mtime != null &&
        payload.mtime === target.mtime
      ) {
        return;
      }
      const seq = (refreshFetchSeqRef.current.get(id) ?? 0) + 1;
      refreshFetchSeqRef.current.set(id, seq);
      void (async () => {
        try {
          const doc = await readDocument(payload.path);
          if (closedTabIdsRef.current.has(id)) {
            closeDocument(doc.path).catch(() => {
              // 标签页在读取期间被关闭，清理后台监听即可
            });
            return;
          }
          if (refreshFetchSeqRef.current.get(id) !== seq) return;
          const current = tabsRef.current.find((tab) => tab.id === id);
          const changed = !!current && doc.content !== current.content;
          const isActive = activeIdRef.current === id;
          setTabs((prev) =>
            prev.map((tab) =>
              tab.id === id
                ? {
                    ...tab,
                    ...documentToTab(id, doc),
                    externalUpdate: changed ? !isActive : tab.externalUpdate,
                  }
                : tab,
            ),
          );
          if (changed && isActive) {
            pushToast("info", "文档已自动刷新", fileName);
          }
        } catch (error) {
          if (refreshFetchSeqRef.current.get(id) !== seq) return;
          const message = String(error);
          const missing = message.includes("不存在") || message.includes("删除");
          if (missing) {
            setTabs((prev) =>
              prev.map((tab) =>
                tab.id === id ? { ...tab, missing: true, watching: false } : tab,
              ),
            );
          }
          const now = Date.now();
          if (now - (lastErrorToastRef.current[id] ?? 0) > 5000) {
            lastErrorToastRef.current[id] = now;
            pushToast("error", `自动刷新失败：${fileName}`, message);
          }
        }
      })();
    },
    [pushToast],
  );

  const handleDocumentChangedRef = useRef(handleDocumentChanged);
  useEffect(() => {
    handleDocumentChangedRef.current = handleDocumentChanged;
  }, [handleDocumentChanged]);

  const openPathsRef = useRef(openPaths);
  useEffect(() => {
    openPathsRef.current = openPaths;
  }, [openPaths]);

  const pushToastRef = useRef(pushToast);
  useEffect(() => {
    pushToastRef.current = pushToast;
  }, [pushToast]);

  // 启动：注册监听、恢复上次的标签页、处理命令行传入的文件
  useEffect(() => {
    let disposed = false;
    let unlistenDoc: UnlistenFn | undefined;
    let unlistenDrag: UnlistenFn | undefined;

    (async () => {
      try {
        unlistenDoc = await onDocumentChanged((payload) =>
          handleDocumentChangedRef.current(payload),
        );
        unlistenDrag = await onDragDrop((payload) => {
          if (disposed) return;
          if (payload.type === "enter" || payload.type === "over") {
            setDragActive(true);
            return;
          }
          if (payload.type === "leave") {
            setDragActive(false);
            return;
          }
          if (payload.type !== "drop") return;
          setDragActive(false);
          const paths = payload.paths ?? [];
          const supported = paths.filter(isSupportedPath);
          if (supported.length > 0) void openPathsRef.current(supported);
          if (supported.length < paths.length) {
            pushToastRef.current(
              "info",
              "已忽略不支持的文件",
              "支持文档、代码、图片、视频与音频",
            );
          }
        });

        if (disposed) {
          unlistenDoc?.();
          unlistenDrag?.();
          return;
        }

        const session = loadSession();
        if (session.paths.length > 0) {
          await openPathsRef.current(session.paths, {
            focusPath: session.activePath,
          });
        }
        const launch = await takeLaunchFiles();
        if (launch.length > 0) {
          await openPathsRef.current(launch);
        }
      } catch (error) {
        pushToastRef.current("error", "启动时遇到问题", String(error));
      } finally {
        if (!disposed) setBooting(false);
      }
    })();

    return () => {
      disposed = true;
      unlistenDoc?.();
      unlistenDrag?.();
    };
  }, []);

  useEffect(() => {
    if (activeId && !tabs.some((tab) => tab.id === activeId)) {
      const fallback = tabs[tabs.length - 1] ?? null;
      setActiveIdState(fallback?.id ?? null);
      activeIdRef.current = fallback?.id ?? null;
    }
  }, [tabs, activeId]);

  useEffect(() => {
    setFindOpen(false);
  }, [activeId]);

  useEffect(() => {
    if (!activeId) return;
    setTabs((prev) => {
      let modified = false;
      const next = prev.map((tab) => {
        if (tab.id === activeId && tab.externalUpdate) {
          modified = true;
          return { ...tab, externalUpdate: false };
        }
        return tab;
      });
      return modified ? next : prev;
    });
  }, [activeId]);

  useEffect(() => {
    if (booting) return;
    const timer = window.setTimeout(() => {
      const paths = tabsRef.current.map((tab) => tab.path);
      const active =
        tabsRef.current.find((tab) => tab.id === activeIdRef.current)?.path ?? null;
      saveSession(paths, active);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [tabs, activeId, booting]);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeId) ?? null,
    [tabs, activeId],
  );
  const activeFileName = activeTab?.fileName ?? "";
  const activeMedia = activeTab ? isMediaKind(activeTab.kind) : false;

  useEffect(() => {
    const title = activeFileName ? `${activeFileName} — X-Reader` : "X-Reader";
    document.title = title;
    getCurrentWindow()
      .setTitle(title)
      .catch(() => {
        // 标题设置失败不影响使用
      });
  }, [activeFileName]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (modifier && key === "o") {
        event.preventDefault();
        void openDialog();
        return;
      }
      if (modifier && key === "b") {
        event.preventDefault();
        toggleSidebar();
        return;
      }
      if (modifier && key === "w") {
        if (activeIdRef.current) {
          event.preventDefault();
          closeTab(activeIdRef.current);
        }
        return;
      }
      if (event.ctrlKey && event.key === "Tab") {
        event.preventDefault();
        const current = tabsRef.current;
        if (current.length < 2) return;
        const index = current.findIndex((tab) => tab.id === activeIdRef.current);
        const nextIndex =
          (index + (event.shiftKey ? -1 : 1) + current.length) % current.length;
        const next = current[nextIndex];
        if (next) selectTab(next.id);
        return;
      }
      if (modifier && key === "f") {
        event.preventDefault();
        const active = tabsRef.current.find(
          (tab) => tab.id === activeIdRef.current,
        );
        if (!active || isMediaKind(active.kind)) return;
        setFindOpen(true);
        window.setTimeout(() => {
          const input = document.querySelector<HTMLInputElement>(".findbar input");
          input?.focus();
          input?.select();
        }, 30);
        return;
      }
      if (modifier && key === "r") {
        event.preventDefault();
        if (activeIdRef.current) void refreshTab(activeIdRef.current);
        return;
      }
      if (event.key === "F5") {
        event.preventDefault();
        if (activeIdRef.current) void refreshTab(activeIdRef.current);
        return;
      }
      if (modifier && (key === "=" || key === "+")) {
        event.preventDefault();
        adjustFontSize(1);
        return;
      }
      if (modifier && key === "-") {
        event.preventDefault();
        adjustFontSize(-1);
        return;
      }
      if (modifier && key === "0") {
        event.preventDefault();
        resetFontSize();
        return;
      }
      if (modifier && /^[1-9]$/.test(event.key)) {
        const index = Number(event.key) - 1;
        const target = tabsRef.current[index];
        if (target) {
          event.preventDefault();
          selectTab(target.id);
        }
        return;
      }
      if (event.key === "Escape") {
        setFindOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    openDialog,
    closeTab,
    selectTab,
    refreshTab,
    adjustFontSize,
    resetFontSize,
    toggleSidebar,
  ]);

  return (
    <div className="app">
      <TitleBar
        fileName={activeFileName}
        hasTab={!!activeTab}
        canRefresh={!!activeTab && !activeTab.loading}
        canReveal={!!activeTab && !activeTab.missing}
        canFind={!!activeTab && !activeMedia && !activeTab.loading}
        findOpen={findOpen}
        sidebarOpen={sidebarOpen}
        theme={theme}
        settings={settings}
        onOpenFile={() => void openDialog()}
        onCloseTab={() => {
          if (activeId) closeTab(activeId);
        }}
        onRefresh={() => {
          if (activeTab) void refreshTab(activeTab.id);
        }}
        onReveal={() => {
          if (activeTab) void revealTab(activeTab);
        }}
        onToggleFind={toggleFind}
        onToggleSidebar={toggleSidebar}
        onToggleTheme={toggleTheme}
        onAdjustFont={adjustFontSize}
        onResetFont={resetFontSize}
        onSettingsChange={updateSettings}
      />

      <div className="app-row">
        <Sidebar
          open={sidebarOpen}
          settings={settings}
          tabs={tabs}
          activeId={activeId}
          onToggle={toggleSidebar}
          onOpenFile={openTreeFile}
          onNotify={pushToast}
        />

        <div className="main">
          <TabBar
            tabs={tabs}
            activeId={activeId}
            onSelect={selectTab}
            onClose={closeTab}
          />

          <div className="main-view">
            {/* 所有标签页常驻挂载，切换标签不再销毁重建内容，也保留了各自的滚动位置。 */}
            {tabs.map((tab) => {
              const isActive = tab.id === activeId;
              return (
                <div
                  key={tab.id}
                  className={`tab-pane${isActive ? "" : " hidden"}`}
                  aria-hidden={isActive ? undefined : true}
                >
                  {tab.missing ? (
                    <div className="doc-banner">
                      <AlertTriangleIcon size={13} />
                      <span>文件已被删除或移动，恢复后会自动重新加载。</span>
                      <button type="button" onClick={() => void refreshTab(tab.id)}>
                        重试
                      </button>
                    </div>
                  ) : null}
                  {isMediaKind(tab.kind) ? (
                    tab.loading ? (
                      <div className="viewer-loading">
                        <span className="spinner" />
                        正在读取文件…
                      </div>
                    ) : (
                      <MediaViewer
                        key={`${tab.id}-${tab.lastUpdatedAt}`}
                        tab={tab}
                        onReveal={() => void revealTab(tab)}
                        onOpenSystem={() => void openTabWithSystem(tab)}
                      />
                    )
                  ) : (
                    <Viewer
                      tab={tab}
                      settings={settings}
                      active={isActive}
                      findOpen={findOpen && isActive}
                      onCloseFind={closeFind}
                      onOpenLink={openLinkFromViewer}
                    />
                  )}
                </div>
              );
            })}

            {!activeTab ? (
              booting ? (
                <div className="boot-splash">
                  <span className="boot-mark">
                    <BookOpenIcon size={22} />
                  </span>
                  <span className="spinner" />
                </div>
              ) : (
                <Welcome
                  recents={recents}
                  onOpen={() => void openDialog()}
                  onOpenPath={(path) => void openPaths([path])}
                  onClearRecents={() => {
                    clearRecents();
                    setRecents([]);
                  }}
                />
              )
            ) : null}
          </div>

          <StatusBar
            tab={activeTab}
            findOpen={findOpen}
            onToggleFind={toggleFind}
            onRefresh={() => {
              if (activeTab) void refreshTab(activeTab.id);
            }}
            onReveal={() => {
              if (activeTab) void revealTab(activeTab);
            }}
          />
        </div>
      </div>

      <Toasts items={toasts} onDismiss={dismissToast} />

      {dragActive ? (
        <div className="drop-overlay">
          <div className="drop-card">
            <BookOpenIcon size={34} />
            <strong>松开以打开文件</strong>
            <span>支持文档、代码、图片、视频与音频，可一次拖入多个文件</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default App;
