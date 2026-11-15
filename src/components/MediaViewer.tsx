import { useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Tab } from "../types";
import { formatBytes, kindLabel } from "../lib/format";
import { AlertTriangleIcon, AudioIcon, FolderOpenIcon } from "./icons";

interface MediaViewerProps {
  tab: Tab;
  onReveal: () => void;
  onOpenSystem: () => void;
}

export function MediaViewer({ tab, onReveal, onOpenSystem }: MediaViewerProps) {
  const [failed, setFailed] = useState(false);
  const [fitMode, setFitMode] = useState<"fit" | "actual">("fit");
  const [imageLoading, setImageLoading] = useState(tab.kind === "image");
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(
    null,
  );

  const source = useMemo(() => {
    // asset 协议只使用 URL 的 path 部分，查询参数仅用于绕过媒体缓存。
    const base = convertFileSrc(tab.path);
    const separator = base.includes("?") ? "&" : "?";
    return `${base}${separator}v=${tab.lastUpdatedAt || tab.mtime || 0}`;
  }, [tab.path, tab.lastUpdatedAt, tab.mtime]);

  const showError = failed || tab.missing;

  if (tab.kind === "image") {
    return (
      <div className="media-viewer">
        <div className={`media-stage image ${fitMode}`}>
          {showError ? (
            <MediaError tab={tab} onReveal={onReveal} onOpenSystem={onOpenSystem} />
          ) : (
            <>
              <img
                className={`media-image ${fitMode}`}
                src={source}
                alt={tab.fileName}
                draggable={false}
                onLoad={(event) => {
                  const image = event.currentTarget;
                  setDimensions({
                    width: image.naturalWidth,
                    height: image.naturalHeight,
                  });
                  setImageLoading(false);
                }}
                onError={() => {
                  setFailed(true);
                  setImageLoading(false);
                }}
              />
              {imageLoading ? (
                <div className="media-loading">
                  <span className="spinner" />
                  正在加载图片…
                </div>
              ) : null}
            </>
          )}
        </div>

        {!showError ? (
          <div className="media-bar">
            <span className="media-dimensions">
              {dimensions ? `${dimensions.width} × ${dimensions.height}` : "—"}
            </span>
            <span className="media-bar-sep" />
            <button
              type="button"
              className={fitMode === "fit" ? "active" : ""}
              onClick={() => setFitMode("fit")}
            >
              适应窗口
            </button>
            <button
              type="button"
              className={fitMode === "actual" ? "active" : ""}
              onClick={() => setFitMode("actual")}
            >
              1:1
            </button>
            <span className="media-bar-sep" />
            <button type="button" onClick={onReveal}>
              所在位置
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  if (tab.kind === "video") {
    return (
      <div className="media-viewer">
        <div className="media-stage video">
          {showError ? (
            <MediaError tab={tab} onReveal={onReveal} onOpenSystem={onOpenSystem} />
          ) : (
            <video
              className="media-video"
              src={source}
              controls
              preload="metadata"
              onError={() => setFailed(true)}
            >
              当前环境无法播放这个视频。
            </video>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="media-viewer">
      <div className="media-stage audio">
        {showError ? (
          <MediaError tab={tab} onReveal={onReveal} onOpenSystem={onOpenSystem} />
        ) : (
          <div className="audio-card">
            <span className="audio-art">
              <AudioIcon size={28} />
            </span>
            <strong className="audio-name" title={tab.path}>
              {tab.fileName}
            </strong>
            <span className="audio-meta">
              {kindLabel(tab.kind)} · {formatBytes(tab.size)}
            </span>
            <audio
              src={source}
              controls
              preload="metadata"
              onError={() => setFailed(true)}
            >
              当前环境无法播放这个音频。
            </audio>
            <button type="button" className="audio-reveal" onClick={onReveal}>
              <FolderOpenIcon size={12} />
              在资源管理器中显示
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function MediaError({
  tab,
  onReveal,
  onOpenSystem,
}: {
  tab: Tab;
  onReveal: () => void;
  onOpenSystem: () => void;
}) {
  const missing = tab.missing;
  const isImage = tab.kind === "image";
  return (
    <div className="media-error">
      <span className="media-error-mark">
        <AlertTriangleIcon size={20} />
      </span>
      <strong>
        {missing
          ? "文件已被删除或移动"
          : isImage
            ? "无法显示这张图片"
            : "无法播放这个文件"}
      </strong>
      <p title={tab.path}>{tab.fileName}</p>
      <span className="media-error-hint">
        {missing
          ? "恢复文件后可重新加载。"
          : isImage
            ? "格式可能不受支持，可在资源管理器中用系统看图工具打开。"
            : "编码或容器格式可能不受 WebView2 支持，可在系统播放器中尝试播放。"}
      </span>
      {missing ? null : (
        <div className="media-error-actions">
          <button type="button" className="primary" onClick={onOpenSystem}>
            用系统应用打开
          </button>
          <button type="button" onClick={onReveal}>
            <FolderOpenIcon size={12} />
            所在位置
          </button>
        </div>
      )}
    </div>
  );
}
