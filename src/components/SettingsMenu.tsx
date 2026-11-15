import { useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ReaderSettings } from "../types";
import { MinusIcon, MonitorIcon, MoonIcon, PlusIcon, SunIcon } from "./icons";
import {
  DEFAULT_SETTINGS,
  normalizeExtensionList,
  READER_FONT_SIZES,
} from "../lib/storage";

interface SettingsMenuProps {
  settings: ReaderSettings;
  onChange: (settings: ReaderSettings) => void;
}

interface SegmentedProps<T extends string | number> {
  value: T;
  options: { value: T; label: string; icon?: ReactNode }[];
  onChange: (value: T) => void;
}

function Segmented<T extends string | number>({ value, options, onChange }: SegmentedProps<T>) {
  return (
    <div className="segmented" role="group">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={option.value === value ? "selected" : ""}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}

function Stepper({
  value,
  display,
  min,
  max,
  step,
  onChange,
}: {
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  const decrease = () => onChange(Math.max(min, Math.round((value - step) * 100) / 100));
  const increase = () => onChange(Math.min(max, Math.round((value + step) * 100) / 100));
  return (
    <div className="stepper">
      <button
        type="button"
        onClick={decrease}
        disabled={value <= min}
        aria-label="减小"
      >
        <MinusIcon size={14} />
      </button>
      <span>{display}</span>
      <button
        type="button"
        onClick={increase}
        disabled={value >= max}
        aria-label="增大"
      >
        <PlusIcon size={14} />
      </button>
    </div>
  );
}

export function SettingsMenu({ settings, onChange }: SettingsMenuProps) {
  const [extensionDraft, setExtensionDraft] = useState(() =>
    settings.treeExtensions.join(", "),
  );
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const committedExtensionsRef = useRef(settings.treeExtensions);

  const commitExtensions = (raw: string) => {
    const next = normalizeExtensionList(raw);
    if (next.join(",") === committedExtensionsRef.current.join(",")) return;
    committedExtensionsRef.current = next;
    onChange({ ...settingsRef.current, treeExtensions: next });
  };

  const setTreeFilter = (treeFilter: ReaderSettings["treeFilter"]) => {
    if (treeFilter === "custom") {
      setExtensionDraft(settingsRef.current.treeExtensions.join(", "));
    }
    onChange({ ...settingsRef.current, treeFilter });
  };

  return (
    <div className="settings-popover" role="dialog" aria-label="阅读设置">
      <div className="settings-head">
        <span>阅读设置</span>
        <button
          type="button"
          className="text-btn"
          onClick={() => {
            setExtensionDraft("");
            committedExtensionsRef.current = [];
            onChange({ ...DEFAULT_SETTINGS });
          }}
        >
          恢复默认
        </button>
      </div>

      <div className="settings-row">
        <span className="settings-label">主题</span>
        <Segmented
          value={settings.theme}
          options={[
            { value: "system", label: "跟随系统", icon: <MonitorIcon size={11} /> },
            { value: "light", label: "白天", icon: <SunIcon size={11} /> },
            { value: "dark", label: "暗夜", icon: <MoonIcon size={11} /> },
          ]}
          onChange={(theme) => onChange({ ...settings, theme })}
        />
      </div>

      <div className="settings-row">
        <span className="settings-label">字体</span>
        <Segmented
          value={settings.font}
          options={[
            { value: "serif", label: "衬线" },
            { value: "sans", label: "无衬线" },
          ]}
          onChange={(font) => onChange({ ...settings, font })}
        />
      </div>

      <div className="settings-row">
        <span className="settings-label">字号</span>
        <Segmented
          value={settings.fontSize}
          options={READER_FONT_SIZES.map((size) => ({
            value: size,
            label: `${size}px`,
          }))}
          onChange={(fontSize) => onChange({ ...settings, fontSize })}
        />
      </div>

      <div className="settings-row">
        <span className="settings-label">行高</span>
        <Stepper
          value={settings.lineHeight}
          display={settings.lineHeight.toFixed(2)}
          min={1.3}
          max={2.4}
          step={0.05}
          onChange={(lineHeight) => onChange({ ...settings, lineHeight })}
        />
      </div>

      <div className="settings-row">
        <span className="settings-label">版心</span>
        <Segmented
          value={settings.width}
          options={[
            { value: "narrow", label: "窄" },
            { value: "medium", label: "中" },
            { value: "wide", label: "宽" },
            { value: "full", label: "全宽" },
          ]}
          onChange={(width) => onChange({ ...settings, width })}
        />
      </div>

      <div className="settings-row">
        <span className="settings-label">文件树</span>
        <Segmented
          value={settings.treeFilter}
          options={[
            { value: "default", label: "常用" },
            { value: "all", label: "全部" },
            { value: "custom", label: "自定义" },
          ]}
          onChange={setTreeFilter}
        />
      </div>

      {settings.treeFilter === "custom" ? (
        <div className="settings-col">
          <span className="settings-label">显示的后缀</span>
          <input
            className="settings-input"
            value={extensionDraft}
            placeholder="例如 md, txt, go, py"
            spellCheck={false}
            aria-label="文件树显示的后缀"
            onChange={(event) => {
              const raw = event.target.value;
              setExtensionDraft(raw);
              // 立即写入设置；目录重读由侧栏统一节流，不会逐字符重扫。
              commitExtensions(raw);
            }}
            onBlur={() => commitExtensions(extensionDraft)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitExtensions(extensionDraft);
              }
            }}
          />
          <span className="settings-hint">
            用逗号或空格分隔；留空显示常用类型。图片、视频、音频后缀同样适用。
          </span>
        </div>
      ) : null}

      <p className="settings-note">设置只影响阅读视图，不会修改文件。</p>
    </div>
  );
}
