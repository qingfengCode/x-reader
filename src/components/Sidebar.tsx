import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { DirFilter, ReaderSettings, Tab, ToastKind } from "../types";
import { clamp, pathKey, samePath } from "../lib/format";
import { listDirectory, pickDirectory } from "../lib/api";
import {
  DEFAULT_SIDEBAR_WIDTH,
  loadRoots,
  loadSidebarWidth,
  saveRoots,
  saveSidebarWidth,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from "../lib/storage";
import { FileTree, type DirState } from "./FileTree";
import {
  FolderPlusIcon,
  PanelLeftIcon,
  PlusIcon,
  RefreshIcon,
} from "./icons";

interface SidebarProps {
  open: boolean;
  settings: ReaderSettings;
  tabs: Tab[];
  activeId: string | null;
  onToggle: () => void;
  onOpenFile: (path: string) => void;
  onNotify: (kind: ToastKind, title: string, detail?: string) => void;
}

export function Sidebar({
  open,
  settings,
  tabs,
  activeId,
  onToggle,
  onOpenFile,
  onNotify,
}: SidebarProps) {
  const [roots, setRoots] = useState<string[]>(loadRoots);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [cache, setCache] = useState<Record<string, DirState>>({});
  const [width, setWidth] = useState<number>(loadSidebarWidth);
  const [resizing, setResizing] = useState(false);

  const cacheRef = useRef(cache);
  cacheRef.current = cache;
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const widthRef = useRef(width);
  widthRef.current = width;
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const dirFilter = useMemo<DirFilter>(() => {
    if (settings.treeFilter === "all") return { all: true, extensions: [] };
    if (settings.treeFilter === "custom") {
      return { all: false, extensions: settings.treeExtensions };
    }
    return { all: false, extensions: [] };
  }, [settings.treeFilter, settings.treeExtensions]);
  const filterRef = useRef(dirFilter);
  filterRef.current = dirFilter;
  const requestSeqRef = useRef<Map<string, number>>(new Map());

  const openKeys = useMemo(
    () => new Set(tabs.map((tab) => pathKey(tab.path))),
    [tabs],
  );
  const activeKey = useMemo(() => {
    const active = tabs.find((tab) => tab.id === activeId);
    return active ? pathKey(active.path) : null;
  }, [tabs, activeId]);

  const loadDirectory = useCallback(async (path: string) => {
    const key = pathKey(path);
    const seq = (requestSeqRef.current.get(key) ?? 0) + 1;
    requestSeqRef.current.set(key, seq);
    setCache((prev) => ({
      ...prev,
      [key]: { path, status: "loading", entries: [] },
    }));
    try {
      const entries = await listDirectory(path, filterRef.current);
      if (requestSeqRef.current.get(key) !== seq) return;
      setCache((prev) => ({
        ...prev,
        [key]: { path, status: "loaded", entries },
      }));
    } catch (error) {
      if (requestSeqRef.current.get(key) !== seq) return;
      setCache((prev) => ({
        ...prev,
        [key]: {
          path,
          status: "error",
          entries: [],
          error: String(error),
        },
      }));
    }
  }, []);

  const reloadDirectory = useCallback(
    (path: string) => {
      void loadDirectory(path);
    },
    [loadDirectory],
  );

  const toggleDir = useCallback(
    (path: string) => {
      const key = pathKey(path);
      const expanding = !expandedRef.current.has(key);
      setExpanded((prev) => {
        const next = new Set(prev);
        if (expanding) next.add(key);
        else next.delete(key);
        return next;
      });
      if (expanding) {
        // 每次展开都重新读取一层，确保能及时看到新增或删除的文档。
        void loadDirectory(path);
      }
    },
    [loadDirectory],
  );

  const handleAddRoot = useCallback(async () => {
    try {
      const directory = await pickDirectory();
      if (!directory) return;
      if (roots.some((root) => samePath(root, directory))) {
        onNotify("info", "该目录已在书库中", directory);
        return;
      }
      if (roots.length >= 20) {
        onNotify("info", "书库目录数量已达上限", "最多添加 20 个根目录");
        return;
      }
      const next = [...roots, directory];
      setRoots(next);
      saveRoots(next);
      const key = pathKey(directory);
      setExpanded((prev) => {
        const expandedNext = new Set(prev);
        expandedNext.add(key);
        return expandedNext;
      });
      void loadDirectory(directory);
    } catch (error) {
      onNotify("error", "无法添加目录", String(error));
    }
  }, [loadDirectory, onNotify, roots]);

  const handleRemoveRoot = useCallback(
    (root: string) => {
      const next = roots.filter((item) => !samePath(item, root));
      setRoots(next);
      saveRoots(next);

      const rootKey = pathKey(root);
      const prefix = `${rootKey}\\`;
      setExpanded((prev) => {
        const expandedNext = new Set(prev);
        for (const key of expandedNext) {
          if (key === rootKey || key.startsWith(prefix)) {
            expandedNext.delete(key);
          }
        }
        return expandedNext;
      });
      setCache((prev) => {
        const nextCache: Record<string, DirState> = {};
        for (const [key, state] of Object.entries(prev)) {
          if (key !== rootKey && !key.startsWith(prefix)) {
            nextCache[key] = state;
          }
        }
        return nextCache;
      });
    },
    [roots],
  );

  const refreshTree = useCallback(() => {
    const paths = Object.values(cacheRef.current)
      .filter((state) => expandedRef.current.has(pathKey(state.path)))
      .map((state) => state.path);
    setCache({});
    for (const path of paths) {
      void loadDirectory(path);
    }
  }, [loadDirectory]);

  // 阅读设置里的文件树范围变化时，重新读取已展开的层级。
  // 稍作延迟是为了让“自定义后缀”输入时合并连续的改动。
  const filterKey = useMemo(
    () => `${settings.treeFilter}|${settings.treeExtensions.join(",")}`,
    [settings.treeFilter, settings.treeExtensions],
  );
  const appliedFilterKeyRef = useRef(filterKey);
  useEffect(() => {
    if (appliedFilterKeyRef.current === filterKey) return;
    const timer = window.setTimeout(() => {
      appliedFilterKeyRef.current = filterKey;
      const paths = Object.values(cacheRef.current)
        .filter((state) => expandedRef.current.has(pathKey(state.path)))
        .map((state) => state.path);
      setCache({});
      for (const path of paths) {
        void loadDirectory(path);
      }
    }, 220);
    return () => window.clearTimeout(timer);
  }, [filterKey, loadDirectory]);

  const handleResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizeRef.current = { startX: event.clientX, startWidth: widthRef.current };
    setResizing(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleResizeMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = resizeRef.current;
    if (!state) return;
    const next = clamp(
      state.startWidth + (event.clientX - state.startX),
      SIDEBAR_MIN_WIDTH,
      SIDEBAR_MAX_WIDTH,
    );
    widthRef.current = Math.round(next);
    setWidth(widthRef.current);
  };

  const handleResizeEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizeRef.current) return;
    resizeRef.current = null;
    setResizing(false);
    saveSidebarWidth(widthRef.current);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const resetWidth = () => {
    widthRef.current = DEFAULT_SIDEBAR_WIDTH;
    setWidth(DEFAULT_SIDEBAR_WIDTH);
    saveSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
  };

  useEffect(() => {
    if (!open && resizing) {
      resizeRef.current = null;
      setResizing(false);
      saveSidebarWidth(widthRef.current);
    }
  }, [open, resizing]);

  useEffect(() => {
    if (!resizing) return;
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
    };
  }, [resizing]);

  const treeLoading = Object.values(cache).some(
    (state) => state.status === "loading",
  );

  return (
    <aside
      className={`rail ${open ? "" : "collapsed"} ${resizing ? "resizing" : ""}`}
      style={{ width: open ? width : 46 }}
      aria-label={open ? "书库" : "书库（已收起）"}
    >
      {open ? (
        <>
          <div className="rail-inner" style={{ width }}>
            <div className="rail-head">
              <button
                type="button"
                className="rail-tool primary"
                title="添加书库目录"
                aria-label="添加书库目录"
                onClick={() => void handleAddRoot()}
              >
                <PlusIcon size={14} />
              </button>
              <button
                type="button"
                className="rail-tool"
                title="刷新文件树"
                aria-label="刷新文件树"
                onClick={refreshTree}
                disabled={roots.length === 0}
              >
                <RefreshIcon size={14} className={treeLoading ? "spin" : ""} />
              </button>
              {roots.length > 0 ? (
                <span
                  className="rail-count"
                  title={`${roots.length} 个书库根目录`}
                >
                  {roots.length}
                </span>
              ) : null}
              <button
                type="button"
                className="rail-head-btn"
                title="收起书库 (Ctrl+B)"
                aria-label="收起书库"
                onClick={onToggle}
              >
                <PanelLeftIcon size={14} />
              </button>
            </div>

            <div className="rail-list">
              {roots.length === 0 ? (
                <div className="rail-empty">
                  <span className="rail-empty-icon">
                    <FolderPlusIcon size={20} />
                  </span>
                  <strong>还没有书库目录</strong>
                  <p>添加一个目录作为根，安静地浏览其中的文档、图片、视频与音频。</p>
                  <button
                    type="button"
                    className="btn rail-empty-add"
                    onClick={() => void handleAddRoot()}
                  >
                    <FolderPlusIcon size={12} />
                    添加目录
                  </button>
                </div>
              ) : (
                <FileTree
                  roots={roots}
                  expanded={expanded}
                  cache={cache}
                  openKeys={openKeys}
                  activeKey={activeKey}
                  onToggleDir={toggleDir}
                  onOpenFile={onOpenFile}
                  onReload={reloadDirectory}
                  onRemoveRoot={handleRemoveRoot}
                />
              )}
            </div>

            <div className="rail-foot">
              <span>Ctrl+B 收起书库 · 拖动边缘调整宽度</span>
            </div>
          </div>

          <div
            className="rail-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="调整书库宽度"
            title="拖动调整宽度，双击恢复默认"
            onPointerDown={handleResizeStart}
            onPointerMove={handleResizeMove}
            onPointerUp={handleResizeEnd}
            onPointerCancel={handleResizeEnd}
            onDoubleClick={resetWidth}
          />
        </>
      ) : (
        <div className="rail-collapsed">
          <button
            type="button"
            className="rail-icon-btn"
            title="展开书库 (Ctrl+B)"
            aria-label="展开书库"
            onClick={onToggle}
          >
            <PanelLeftIcon size={16} />
          </button>
          <span className="rail-collapsed-sep" />
          <button
            type="button"
            className="rail-icon-btn"
            title="添加书库目录"
            aria-label="添加书库目录"
            onClick={() => void handleAddRoot()}
          >
            <PlusIcon size={16} />
          </button>
          <button
            type="button"
            className="rail-icon-btn"
            title="刷新文件树"
            aria-label="刷新文件树"
            onClick={refreshTree}
            disabled={roots.length === 0}
          >
            <RefreshIcon size={16} className={treeLoading ? "spin" : ""} />
          </button>
          <span className="rail-collapsed-spacer" />
        </div>
      )}
    </aside>
  );
}
