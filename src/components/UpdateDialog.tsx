import { useEffect } from "react";
import type { UpdateManifest } from "../types";
import { ArrowDownIcon, CloseIcon, DownloadIcon } from "./icons";

interface UpdateDialogProps {
  current: string;
  manifest: UpdateManifest;
  onClose: () => void;
  onDownload: () => void;
}

export function UpdateDialog({
  current,
  manifest,
  onClose,
  onDownload,
}: UpdateDialogProps) {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKey, true);
    return () => document.removeEventListener("keydown", handleKey, true);
  }, [onClose]);

  const notes = manifest.notes?.trim();

  return (
    <div className="modal-mask" onClick={onClose}>
      <div
        className="modal update-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <h3 id="update-title">发现新版本</h3>
          <button
            type="button"
            className="icon-btn"
            title="关闭 (Esc)"
            aria-label="关闭"
            onClick={onClose}
          >
            <CloseIcon size={13} />
          </button>
        </div>

        <div className="update-versions">
          <span className="update-version current">{current}</span>
          <ArrowDownIcon size={13} className="update-arrow" />
          <span className="update-version latest">{manifest.version}</span>
          {manifest.date ? <span className="update-date">{manifest.date}</span> : null}
        </div>

        <div className="update-notes">{notes || "本次更新没有提供说明。"}</div>
        {!manifest.url ? (
          <p className="update-hint">更新清单未提供下载地址。</p>
        ) : null}

        <div className="update-actions">
          <button type="button" className="btn" onClick={onClose}>
            稍后
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={onDownload}
            disabled={!manifest.url}
          >
            <DownloadIcon size={14} />
            下载新版本
          </button>
        </div>
      </div>
    </div>
  );
}
