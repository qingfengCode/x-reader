import { memo, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { DirEntry } from "../types";
import { isSupportedPath, kindOf, pathKey } from "../lib/format";
import {
  AlertTriangleIcon,
  ChevronRightIcon,
  CloseIcon,
  FileKindIcon,
  FolderIcon,
  FolderOpenIcon,
} from "./icons";

export type DirStatus = "loading" | "loaded" | "error";

/** 大目录分页渲染：一次只挂载 300 行，滚到尾部自动追加，展开万级目录不再一次性卡死。 */
const CHILD_PAGE_SIZE = 300;

export interface DirState {
  path: string;
  status: DirStatus;
  entries: DirEntry[];
  error?: string;
}

interface TreeSharedProps {
  expanded: Set<string>;
  cache: Record<string, DirState>;
  openKeys: Set<string>;
  activeKey: string | null;
  onToggleDir: (path: string) => void;
  onOpenFile: (path: string) => void;
  onReload: (path: string) => void;
}

interface FileTreeProps extends TreeSharedProps {
  roots: string[];
  onRemoveRoot: (path: string) => void;
}

interface TreeEntryProps extends TreeSharedProps {
  entry: DirEntry;
  depth: number;
  isRoot?: boolean;
  onRemoveRoot?: (path: string) => void;
}

export const FileTree = memo(function FileTree({
  roots,
  onRemoveRoot,
  ...shared
}: FileTreeProps) {
  return (
    <div className="file-tree" role="tree" aria-label="书库文件树">
      {roots.map((root) => (
        <TreeEntry
          key={root}
          entry={{ path: root, name: rootName(root), isDir: true }}
          depth={0}
          isRoot
          onRemoveRoot={onRemoveRoot}
          {...shared}
        />
      ))}
    </div>
  );
});

function TreeEntry({
  entry,
  depth,
  isRoot = false,
  expanded,
  cache,
  openKeys,
  activeKey,
  onToggleDir,
  onOpenFile,
  onReload,
  onRemoveRoot,
}: TreeEntryProps) {
  const key = pathKey(entry.path);
  const indentStyle: CSSProperties = { paddingLeft: `${4 + depth * 14}px` };
  const [childLimit, setChildLimit] = useState(CHILD_PAGE_SIZE);
  const revealMoreChildren = useCallback(() => {
    setChildLimit((limit) => limit + CHILD_PAGE_SIZE);
  }, []);

  if (!entry.isDir) {
    const isActive = activeKey === key;
    const isOpen = openKeys.has(key);
    const kind = kindOf(entry.path);
    const supported = isSupportedPath(entry.path);
    return (
      <div
        className={`tree-row file ${isActive ? "active" : ""} ${supported ? "" : "unsupported"}`}
        style={indentStyle}
      >
        <span className="tree-chevron-space" />
        <button
          type="button"
          className="tree-main"
          title={supported ? entry.path : `${entry.path}（暂不支持预览）`}
          onClick={() => onOpenFile(entry.path)}
        >
          <span className={`tree-icon ${kind}`}>
            <FileKindIcon kind={kind} size={13} />
          </span>
          <span className="tree-name">{entry.name}</span>
          {isOpen ? <span className="tree-open-dot" aria-label="已打开" /> : null}
        </button>
      </div>
    );
  }

  const isExpanded = expanded.has(key);
  const state = cache[key];
  const hintIndentStyle: CSSProperties = { paddingLeft: `${16 + (depth + 1) * 14}px` };

  return (
    <div className="tree-node" role="treeitem" aria-expanded={isExpanded}>
      <div className={`tree-row dir ${isRoot ? "root" : ""}`} style={indentStyle}>
        <button
          type="button"
          className={`tree-toggle ${isExpanded ? "expanded" : ""}`}
          aria-expanded={isExpanded}
          aria-label={`${isExpanded ? "折叠" : "展开"} ${entry.name}`}
          onClick={() => onToggleDir(entry.path)}
        >
          <ChevronRightIcon size={11} />
        </button>
        <button
          type="button"
          className="tree-main"
          title={entry.path}
          onClick={() => onToggleDir(entry.path)}
        >
          <span className="tree-icon folder">
            {isExpanded ? <FolderOpenIcon size={13} /> : <FolderIcon size={13} />}
          </span>
          <span className="tree-name">{entry.name}</span>
        </button>
        {isRoot && onRemoveRoot ? (
          <button
            type="button"
            className="tree-remove"
            title="从书库中移除该目录"
            aria-label={`移除根目录 ${entry.name}`}
            onClick={() => onRemoveRoot(entry.path)}
          >
            <CloseIcon size={11} />
          </button>
        ) : null}
      </div>

      {isExpanded ? (
        <div className="tree-children" role="group">
          {!state || state.status === "loading" ? (
            <div className="tree-hint" style={hintIndentStyle}>
              <span className="tab-spinner" />
              正在载入…
            </div>
          ) : state.status === "error" ? (
            <div className="tree-hint error" style={hintIndentStyle} title={state.error}>
              <AlertTriangleIcon size={11} />
              <span className="tree-hint-text">无法读取目录</span>
              <button type="button" className="tree-retry" onClick={() => onReload(entry.path)}>
                重试
              </button>
            </div>
          ) : state.entries.length === 0 ? (
            <div className="tree-hint" style={hintIndentStyle}>
              没有可查看的文件
            </div>
          ) : (
            <>
              {state.entries.slice(0, childLimit).map((child) => (
                <TreeEntry
                  key={child.path}
                  entry={child}
                  depth={depth + 1}
                  expanded={expanded}
                  cache={cache}
                  openKeys={openKeys}
                  activeKey={activeKey}
                  onToggleDir={onToggleDir}
                  onOpenFile={onOpenFile}
                  onReload={onReload}
                />
              ))}
              {state.entries.length > childLimit ? (
                <TreeMoreRow
                  indentStyle={hintIndentStyle}
                  remaining={state.entries.length - childLimit}
                  onReveal={revealMoreChildren}
                />
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function rootName(path: string): string {
  const cleaned = path.replace(/[\\/]+$/, "");
  if (/^[a-zA-Z]:$/.test(cleaned)) {
    return `${cleaned}\\`;
  }
  const index = Math.max(cleaned.lastIndexOf("\\"), cleaned.lastIndexOf("/"));
  return cleaned.slice(index + 1) || path;
}

function TreeMoreRow({
  indentStyle,
  remaining,
  onReveal,
}: {
  indentStyle: CSSProperties;
  remaining: number;
  onReveal: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const root = element.closest(".rail-list");
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onReveal();
      },
      { root: root instanceof Element ? root : null, rootMargin: "600px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [onReveal]);

  return (
    <div className="tree-hint more" style={indentStyle} ref={ref}>
      <span className="tab-spinner" />
      <span className="tree-hint-text">继续显示其余 {remaining} 项…</span>
    </div>
  );
}
