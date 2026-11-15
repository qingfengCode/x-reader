import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { CloseIcon, MaximizeIcon, MinimizeIcon, RestoreIcon } from "./icons";

export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    try {
      const win = getCurrentWindow();
      win
        .isMaximized()
        .then((value) => {
          if (!disposed) setMaximized(value);
        })
        .catch(() => {
          // 浏览器预览环境没有窗口 API
        });
      win
        .onResized(() => {
          win
            .isMaximized()
            .then((value) => {
              if (!disposed) setMaximized(value);
            })
            .catch(() => undefined);
        })
        .then((fn) => {
          if (disposed) fn();
          else unlisten = fn;
        })
        .catch(() => undefined);
    } catch {
      // 浏览器预览环境没有窗口 API
    }

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const run = (action: "minimize" | "toggleMaximize" | "close") => {
    try {
      const result = getCurrentWindow()[action]();
      if (result && typeof result.catch === "function") {
        result.catch(() => undefined);
      }
    } catch {
      // 忽略不可用环境
    }
  };

  return (
    <div className="win-controls">
      <button
        type="button"
        className="win-btn"
        title="最小化"
        aria-label="最小化窗口"
        onClick={() => run("minimize")}
      >
        <MinimizeIcon size={14} />
      </button>
      <button
        type="button"
        className="win-btn"
        title={maximized ? "向下还原" : "最大化"}
        aria-label={maximized ? "向下还原窗口" : "最大化窗口"}
        onClick={() => run("toggleMaximize")}
      >
        {maximized ? <RestoreIcon size={13} /> : <MaximizeIcon size={13} />}
      </button>
      <button
        type="button"
        className="win-btn close"
        title="关闭"
        aria-label="关闭窗口"
        onClick={() => run("close")}
      >
        <CloseIcon size={14} />
      </button>
    </div>
  );
}
