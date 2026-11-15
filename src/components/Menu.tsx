import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

export interface MenuEntry {
  kind?: "item" | "sep" | "header";
  label?: string;
  icon?: ReactNode;
  /** 右侧快捷键 / 后缀提示 */
  hint?: string;
  disabled?: boolean;
  danger?: boolean;
  active?: boolean;
  onClick?: () => void;
}

interface MenuProps {
  label: string;
  items: MenuEntry[];
  width?: number;
  align?: "left" | "right";
  title?: string;
}

export function Menu({ label, items, width = 240, align = "left", title }: MenuProps) {
  const [open, setOpen] = useState(false);
  const [kbIndex, setKbIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);

  const selectable = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.kind !== "sep" && item.kind !== "header" && !item.disabled);

  useEffect(() => {
    if (!open) {
      setKbIndex(-1);
      return;
    }
    const handlePointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handlePointer);
    return () => document.removeEventListener("mousedown", handlePointer);
  }, [open]);

  const run = (entry: MenuEntry) => {
    if (entry.disabled) return;
    setOpen(false);
    entry.onClick?.();
  };

  const handleKeyDown = (event: ReactKeyboardEvent) => {
    if (!open) return;
    if (event.key === "Escape") {
      event.stopPropagation();
      setOpen(false);
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
      const hit = selectable.find((entry) => entry.index === kbIndex);
      if (hit) run(hit.item);
    }
  };

  return (
    <div className="menu-root" ref={rootRef} onKeyDown={handleKeyDown}>
      <button
        type="button"
        className={`menu-trigger ${open ? "open" : ""}`}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
        <span className="menu-caret">▾</span>
      </button>

      {open ? (
        <div
          className={`menu-panel ${align === "right" ? "align-right" : ""}`}
          role="menu"
          style={{ minWidth: width }}
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
                  entry.active ? "active" : "",
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
        </div>
      ) : null}
    </div>
  );
}
