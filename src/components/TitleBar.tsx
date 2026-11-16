import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ReaderSettings, ResolvedTheme } from "../types";
import { Menu, type MenuEntry } from "./Menu";
import { SettingsButton } from "./SettingsButton";
import { WindowControls } from "./WindowControls";
import {
  BookOpenIcon,
  CloseIcon,
  FolderOpenIcon,
  MinusIcon,
  MoonIcon,
  PanelLeftIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  SunIcon,
} from "./icons";

interface TitleBarProps {
  fileName: string;
  hasTab: boolean;
  canRefresh: boolean;
  canReveal: boolean;
  canFind: boolean;
  findOpen: boolean;
  sidebarOpen: boolean;
  theme: ResolvedTheme;
  settings: ReaderSettings;
  onOpenFile: () => void;
  onCloseTab: () => void;
  onRefresh: () => void;
  onReveal: () => void;
  onToggleFind: () => void;
  onToggleSidebar: () => void;
  onToggleTheme: () => void;
  onAdjustFont: (delta: number) => void;
  onResetFont: () => void;
  onSettingsChange: (settings: ReaderSettings) => void;
  onCheckUpdate: () => void;
  checkingUpdate: boolean;
  version: string;
}

const SHORTCUTS: [string, string][] = [
  ["Ctrl+O", "打开文件"],
  ["Ctrl+B", "显示 / 隐藏书库"],
  ["Ctrl+W", "关闭当前标签"],
  ["Ctrl+Tab / Ctrl+Shift+Tab", "切换标签"],
  ["Ctrl+1..9", "跳到第 N 个标签"],
  ["Ctrl+F", "在文档中查找"],
  ["Ctrl+R / F5", "重新加载当前文件"],
  ["Ctrl+= / Ctrl+- / Ctrl+0", "放大 / 缩小 / 重置字号"],
  ["Esc", "关闭查找、设置或菜单"],
];

export function TitleBar({
  fileName,
  hasTab,
  canRefresh,
  canReveal,
  canFind,
  findOpen,
  sidebarOpen,
  theme,
  settings,
  onOpenFile,
  onCloseTab,
  onRefresh,
  onReveal,
  onToggleFind,
  onToggleSidebar,
  onToggleTheme,
  onAdjustFont,
  onResetFont,
  onSettingsChange,
  onCheckUpdate,
  checkingUpdate,
  version,
}: TitleBarProps) {
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    if (!helpOpen) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHelpOpen(false);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [helpOpen]);

  const closeWindow = () => {
    try {
      void getCurrentWindow()
        .close()
        .catch(() => undefined);
    } catch {
      // 浏览器预览环境没有窗口 API
    }
  };

  const fileItems: MenuEntry[] = [
    { kind: "header", label: "文件" },
    {
      label: "打开文件…",
      icon: <FolderOpenIcon size={13} />,
      hint: "Ctrl+O",
      onClick: onOpenFile,
    },
    { kind: "sep" },
    {
      label: "重新加载",
      icon: <RefreshIcon size={13} />,
      hint: "Ctrl+R",
      disabled: !canRefresh,
      onClick: onRefresh,
    },
    {
      label: "在资源管理器中显示",
      icon: <FolderOpenIcon size={13} />,
      disabled: !canReveal,
      onClick: onReveal,
    },
    { kind: "sep" },
    {
      label: checkingUpdate ? "正在检查更新…" : "检查更新…",
      icon: <RefreshIcon size={13} />,
      hint: version ? `v${version}` : undefined,
      disabled: checkingUpdate,
      onClick: onCheckUpdate,
    },
    { kind: "sep" },
    {
      label: "关闭当前标签",
      icon: <CloseIcon size={13} />,
      hint: "Ctrl+W",
      disabled: !hasTab,
      onClick: onCloseTab,
    },
    {
      label: "关闭窗口",
      icon: <CloseIcon size={13} />,
      hint: "Alt+F4",
      danger: true,
      onClick: closeWindow,
    },
  ];

  const viewItems: MenuEntry[] = [
    { kind: "header", label: "视图" },
    {
      label: sidebarOpen ? "隐藏书库" : "显示书库",
      icon: <PanelLeftIcon size={13} />,
      hint: "Ctrl+B",
      active: sidebarOpen,
      onClick: onToggleSidebar,
    },
    {
      label: "在文档中查找",
      icon: <SearchIcon size={13} />,
      hint: "Ctrl+F",
      active: findOpen,
      disabled: !canFind,
      onClick: onToggleFind,
    },
    { kind: "sep" },
    { kind: "header", label: "字号" },
    {
      label: "放大字号",
      icon: <PlusIcon size={13} />,
      hint: "Ctrl+=",
      onClick: () => onAdjustFont(1),
    },
    {
      label: "缩小字号",
      icon: <MinusIcon size={13} />,
      hint: "Ctrl+-",
      onClick: () => onAdjustFont(-1),
    },
    {
      label: "重置字号",
      icon: <span className="mi-text">Aa</span>,
      hint: "Ctrl+0",
      onClick: onResetFont,
    },
    { kind: "sep" },
    {
      label: theme === "dark" ? "切换到白天配色" : "切换到暗夜配色",
      icon: theme === "dark" ? <SunIcon size={13} /> : <MoonIcon size={13} />,
      onClick: onToggleTheme,
    },
  ];

  return (
    <>
      <header className="titlebar">
        <div className="titlebar-title" data-tauri-drag-region="deep">
          <span className="tb-logo">
            <BookOpenIcon size={13} />
          </span>
          <span className="tb-brand">X-Reader</span>
          {fileName ? <span className="tb-doc">— {fileName}</span> : null}
        </div>

        <Menu label="文件" items={fileItems} width={252} title="打开、重新加载与关闭" />
        <Menu label="查看" items={viewItems} width={238} title="书库、查找、字号与配色" />

        <div className="titlebar-drag" data-tauri-drag-region="deep" />

        <div className="titlebar-actions">
          <button
            type="button"
            className="tb-btn"
            title={theme === "dark" ? "切换到白天配色" : "切换到暗夜配色"}
            aria-label={theme === "dark" ? "切换到白天配色" : "切换到暗夜配色"}
            onClick={onToggleTheme}
          >
            {theme === "dark" ? <MoonIcon size={14} /> : <SunIcon size={14} />}
          </button>
          <SettingsButton settings={settings} onChange={onSettingsChange} />
          <button
            type="button"
            className={`tb-btn ${helpOpen ? "active" : ""}`}
            title="快捷键与操作速查"
            aria-label="快捷键与操作速查"
            aria-haspopup="dialog"
            aria-expanded={helpOpen}
            onClick={() => setHelpOpen(true)}
          >
            <span className="tb-help-mark">?</span>
          </button>
          <span className="tb-divider" />
          <WindowControls />
        </div>
      </header>

      {helpOpen ? (
        <div className="modal-mask" onClick={() => setHelpOpen(false)}>
          <div
            className="modal help-modal"
            role="dialog"
            aria-modal="true"
            aria-label="快捷键与操作速查"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <h3>快捷键与操作速查</h3>
              <button
                type="button"
                className="icon-btn"
                title="关闭 (Esc)"
                aria-label="关闭"
                onClick={() => setHelpOpen(false)}
              >
                <CloseIcon size={13} />
              </button>
            </div>

            <div className="shortcut-list">
              {SHORTCUTS.map(([keys, action]) => (
                <div className="shortcut-row" key={keys}>
                  <span>{action}</span>
                  <kbd>{keys}</kbd>
                </div>
              ))}
            </div>

            <p className="modal-foot">
              {version ? `当前版本 ${version}。` : ""}
              X-Reader 是严格只读的本地查看器：不会写入、重命名或删除任何文件。把文件或文件夹拖进窗口也可以直接打开。
            </p>
          </div>
        </div>
      ) : null}
    </>
  );
}
