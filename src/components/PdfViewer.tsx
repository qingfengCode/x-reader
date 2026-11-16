import { useEffect, useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Tab } from "../types";
import { AlertTriangleIcon, FolderOpenIcon } from "./icons";

interface PdfViewerProps {
  tab: Tab;
  onReveal: () => void;
  onOpenSystem: () => void;
}

/**
 * PDF 使用 WebView2 自带的阅读器：asset 协议流式加载，支持翻页、缩放、
 * 文本选择与 PDF 内查找，避免把整份文件读进内存。
 */
export function PdfViewer({ tab, onReveal, onOpenSystem }: PdfViewerProps) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  const source = useMemo(() => {
    // asset 协议只使用 URL 的 path 部分；查询参数用于外部修改后绕过缓存。
    const base = convertFileSrc(tab.path);
    const separator = base.includes("?") ? "&" : "?";
    return `${base}${separator}v=${tab.lastUpdatedAt || tab.mtime || 0}#navpanes=0&view=FitH`;
  }, [tab.path, tab.lastUpdatedAt, tab.mtime]);

  // 个别环境下 PDF 查看器不会触发 iframe 的 load 事件，兜底收起加载层。
  useEffect(() => {
    if (ready || failed) return;
    const timer = window.setTimeout(() => setReady(true), 2500);
    return () => window.clearTimeout(timer);
  }, [ready, failed]);

  if (failed) {
    return (
      <div className="pdf-viewer">
        <div className="pdf-error-stage">
          <div className="media-error">
            <span className="media-error-mark">
              <AlertTriangleIcon size={20} />
            </span>
            <strong>无法打开这个 PDF</strong>
            <p title={tab.path}>{tab.fileName}</p>
            <span className="media-error-hint">
              文件可能已损坏，或当前环境的 PDF 查看器不可用。
            </span>
            <div className="media-error-actions">
              <button type="button" className="primary" onClick={onOpenSystem}>
                用系统应用打开
              </button>
              <button type="button" onClick={onReveal}>
                <FolderOpenIcon size={12} />
                所在位置
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pdf-viewer">
      <iframe
        className="pdf-frame"
        src={source}
        title={tab.fileName}
        allowFullScreen
        onLoad={() => setReady(true)}
        onError={() => setFailed(true)}
      />
      {!ready ? (
        <div className="pdf-loading">
          <span className="spinner" />
          正在载入 PDF…
        </div>
      ) : null}
    </div>
  );
}
