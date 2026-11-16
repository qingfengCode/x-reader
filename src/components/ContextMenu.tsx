import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import type { MenuEntry } from "./Menu";

interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuEntry[];
  onClose: () => void;
}

/**
 * 通用右键菜单。渲染到 body，避免被滚动容器裁切；
 * 打开时按视口尺寸把菜单收回可视范围内。
 */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });
  const [kbIndex, setKbIndex] = useState(-1);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const margin = 6;
    setPosition({
      x: Math.max(margin, Math.min(x, window.innerWidth - rect.width - margin)),
      y: Math.max(margin, Math.min(y, window.innerHeight - rect.height - margin)),
    });
    panel.focus({ preventScroll: true });
  }, [x, y]);

  useEffect(() => {
    const handlePointer = (event: MouseEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) onClose();
    };
    // 菜单自身内容滚动时不要关闭，只响应外部容器滚动。
    const handleScroll = (event: Event) => {
      if (panelRef.current?.contains(event.target as Node)) return;
      onClose();
    };
    const dismiss = () => onClose();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey, true);
    window.addEventListener("blur", dismiss);
    window.addEventListener("resize", dismiss);
    document.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey, true);
      window.removeEventListener("blur", dismiss);
      window.removeEventListener("resize", dismiss);
      document.removeEventListener("scroll", handleScroll, true);
    };
  }, [onClose]);

  const selectable = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.kind !== "sep" && item.kind !== "header" && !item.disabled);

  const run = (entry: MenuEntry) => {
    if (entry.disabled) return;
    onClose();
    entry.onClick?.();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (selectable.length === 0) return;
      const current = selectable.findIndex((entry) => entry.index === kbIndex);
      const next =
        event.key === "ArrowDown"
          ? selectable[(current + 1) % selectable.length]
          : selectable[(current - 1 + selectable.length) % selectable.length];
      setKbIndex(next.index);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const hit =
        selectable.find((entry) => entry.index === kbIndex) ?? selectable[0];
      if (hit) run(hit.item);
    }
  };

  return createPortal(
    <div
      ref={panelRef}
      className="menu-panel context-menu"
      role="menu"
      tabIndex={-1}
      style={{ position: "fixed", top: position.y, left: position.x, minWidth: 188 }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={handleKeyDown}
    >
      {items.map((entry, index) => {
        if (entry.kind === "sep") return <div key={index} className="menu-sep" />;
        if (entry.kind === "header") {
          return (
            <div key={index} className="menu-header">
              {entry.label}
            </div>
          );
        }
        return (
          <div
            key={index}
            role="menuitem"
            aria-disabled={entry.disabled}
            className={[
              "menu-item",
              kbIndex === index ? "kb" : "",
              entry.danger ? "danger" : "",
              entry.disabled ? "disabled" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onMouseEnter={() => setKbIndex(index)}
            onClick={() => run(entry)}
          >
            <span className="mi-icon">{entry.icon}</span>
            <span className="mi-label">{entry.label}</span>
            {entry.hint ? <span className="mi-hint">{entry.hint}</span> : null}
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
