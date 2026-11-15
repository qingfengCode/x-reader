import type { Tab } from "../types";
import {
  formatBytes,
  formatClock,
  formatCount,
  isMediaKind,
  kindLabel,
} from "../lib/format";
import {
  AlertTriangleIcon,
  FolderOpenIcon,
  LockIcon,
  RefreshIcon,
  SearchIcon,
} from "./icons";

interface StatusBarProps {
  tab: Tab | null;
  findOpen: boolean;
  onToggleFind: () => void;
  onRefresh: () => void;
  onReveal: () => void;
}

export function StatusBar({
  tab,
  findOpen,
  onToggleFind,
  onRefresh,
  onReveal,
}: StatusBarProps) {
  const media = tab ? isMediaKind(tab.kind) : false;
  const findDisabled = !tab || tab.loading || media;
  const watchState = !tab
    ? "idle"
    : tab.missing
      ? "warn"
      : tab.watching
        ? "ok"
        : "off";
  const watchLabel = !tab
    ? ""
    : tab.missing
      ? "文件缺失"
      : tab.watching
        ? "自动刷新"
        : "刷新不可用";

  return (
    <footer className="statusbar">
      <span className="status-left">
        <span className="status-readonly" title="只读模式：不会修改任何文件">
          <LockIcon size={10} />
          只读
        </span>
        <span className="status-sep" />
        {tab ? (
          <>
            {tab.missing ? (
              <AlertTriangleIcon size={10} className="status-warning" />
            ) : null}
            <span className="status-path" title={tab.path}>
              {tab.path}
            </span>
          </>
        ) : (
          <span className="status-idle">未打开文件</span>
        )}
      </span>

      <span className="status-center">
        {tab && !media
          ? `${formatCount(tab.chars)} 字 · ${formatCount(tab.lines)} 行`
          : ""}
      </span>

      <span className="status-right">
        {tab ? (
          <>
            <span className="status-meta">
              {media ? kindLabel(tab.kind) : tab.encoding || "—"}
            </span>
            <span className="status-meta">{formatBytes(tab.size)}</span>
            <span
              className={`watch-state ${watchState}`}
              title={
                tab.mtime > 0
                  ? `文件修改于 ${formatClock(tab.mtime)}，${watchLabel}`
                  : watchLabel
              }
            >
              <span className="watch-dot" />
              <span className="watch-label">{watchLabel}</span>
            </span>
            <span className="status-sep" />
            <span className="status-actions">
              <button
                type="button"
                className={`status-btn ${findOpen ? "active" : ""}`}
                title={media ? "媒体文件不支持查找" : "在文档中查找 (Ctrl+F)"}
                aria-label="查找"
                onClick={onToggleFind}
                disabled={findDisabled}
              >
                <SearchIcon size={13} />
              </button>
              <button
                type="button"
                className="status-btn"
                title="重新加载 (Ctrl+R)"
                aria-label="重新加载"
                onClick={onRefresh}
                disabled={tab.loading || tab.refreshing}
              >
                <RefreshIcon size={13} className={tab.refreshing ? "spin" : ""} />
              </button>
              <button
                type="button"
                className="status-btn"
                title="在资源管理器中显示"
                aria-label="在资源管理器中显示"
                onClick={onReveal}
                disabled={tab.missing}
              >
                <FolderOpenIcon size={13} />
              </button>
            </span>
          </>
        ) : null}
      </span>
    </footer>
  );
}
