import { useCallback, useEffect, useRef, useState } from "react";
import type { Tab } from "../types";
import { ContextMenu } from "./ContextMenu";
import type { MenuEntry } from "./Menu";
import { AlertTriangleIcon, CloseIcon, FileKindIcon } from "./icons";

interface TabBarProps {
  tabs: Tab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onCloseMany: (ids: string[]) => void;
}

export function TabBar({
  tabs,
  activeId,
  onSelect,
  onClose,
  onCloseMany,
}: TabBarProps) {
  const stripRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  useEffect(() => {
    stripRef.current
      ?.querySelector<HTMLElement>(".tabstrip-tab.active")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId, tabs.length]);

  useEffect(() => {
    if (contextMenu && !tabs.some((tab) => tab.id === contextMenu.id)) {
      setContextMenu(null);
    }
  }, [contextMenu, tabs]);

  const menuIndex = contextMenu
    ? tabs.findIndex((tab) => tab.id === contextMenu.id)
    : -1;
  const menuItems: MenuEntry[] =
    contextMenu && menuIndex >= 0
      ? [
          {
            label: "关闭全部",
            icon: <CloseIcon size={13} />,
            onClick: () => onCloseMany(tabs.map((tab) => tab.id)),
          },
          {
            label: "关闭当前",
            icon: <CloseIcon size={13} />,
            onClick: () => onCloseMany([contextMenu.id]),
          },
          { kind: "sep" },
          {
            label: "关闭左侧",
            icon: <CloseIcon size={13} />,
            disabled: menuIndex === 0,
            onClick: () =>
              onCloseMany(tabs.slice(0, menuIndex).map((tab) => tab.id)),
          },
          {
            label: "关闭右侧",
            icon: <CloseIcon size={13} />,
            disabled: menuIndex === tabs.length - 1,
            onClick: () =>
              onCloseMany(tabs.slice(menuIndex + 1).map((tab) => tab.id)),
          },
        ]
      : [];

  return (
    <div className="tabstrip">
      <div
        className="tabstrip-tabs"
        role="tablist"
        aria-label="已打开的文件"
        ref={stripRef}
      >
        {tabs.length === 0 ? (
          <span className="tabstrip-empty">未打开文件</span>
        ) : (
          tabs.map((tab) => (
            <div
              key={tab.id}
              role="tab"
              aria-selected={tab.id === activeId}
              className={[
                "tabstrip-tab",
                tab.id === activeId ? "active" : "",
                tab.missing ? "missing" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              title={tab.path}
              tabIndex={0}
              onClick={() => onSelect(tab.id)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(tab.id);
                }
              }}
              onAuxClick={(event) => {
                if (event.button === 1) {
                  event.preventDefault();
                  onClose(tab.id);
                }
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                setContextMenu({
                  id: tab.id,
                  x: event.clientX,
                  y: event.clientY,
                });
              }}
            >
              <span className={`tabstrip-tab-icon ${tab.kind}`}>
                <FileKindIcon kind={tab.kind} size={12} />
              </span>
              <span className="tabstrip-tab-name">{tab.fileName}</span>
              {tab.loading ? (
                <span className="tab-spinner" aria-label="正在加载" />
              ) : null}
              {tab.missing ? (
                <AlertTriangleIcon size={11} className="tabstrip-tab-warn" />
              ) : null}
              {tab.externalUpdate && !tab.missing && !tab.loading ? (
                <span className="tabstrip-tab-dot" aria-label="内容已在外部更新" />
              ) : null}
              <button
                type="button"
                className="tabstrip-tab-close"
                title="关闭标签页 (Ctrl+W)"
                aria-label={`关闭 ${tab.fileName}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(tab.id);
                }}
              >
                <CloseIcon size={11} />
              </button>
            </div>
          ))
        )}
      </div>

      {contextMenu && menuItems.length > 0 ? (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={menuItems}
          onClose={closeContextMenu}
        />
      ) : null}
    </div>
  );
}
