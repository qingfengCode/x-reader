import { useEffect, useRef, useState } from "react";
import type { ReaderSettings } from "../types";
import { SlidersIcon } from "./icons";
import { SettingsMenu } from "./SettingsMenu";

interface SettingsButtonProps {
  settings: ReaderSettings;
  onChange: (settings: ReaderSettings) => void;
}

export function SettingsButton({ settings, onChange }: SettingsButtonProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointer = (event: MouseEvent) => {
      if (!anchorRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <div className="settings-anchor" ref={anchorRef}>
      <button
        type="button"
        className={`tb-btn ${open ? "active" : ""}`}
        title="阅读设置"
        aria-label="阅读设置"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <SlidersIcon size={14} />
      </button>
      {open ? <SettingsMenu settings={settings} onChange={onChange} /> : null}
    </div>
  );
}
