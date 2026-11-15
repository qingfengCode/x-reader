import { memo, useLayoutEffect, useRef, useMemo } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { joinPath } from "../lib/format";
import { handleCopyClick } from "../lib/copyCode";
import { renderMarkdown } from "../lib/markdownPipeline";

interface MarkdownProps {
  source: string;
  dir: string;
}

/**
 * Markdown 分块。解析走 unified 管线（见 lib/markdownPipeline.ts），
 * 比 react-markdown 少构建一整棵 React 元素树；复制按钮通过事件委托处理。
 */
export const Markdown = memo(function Markdown({ source, dir }: MarkdownProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const html = useMemo(() => renderMarkdown(source), [source]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // 相对路径图片：管线只标记路径，这里换成 asset 协议 URL
    for (const image of container.querySelectorAll<HTMLImageElement>(
      "img[data-local-src]",
    )) {
      const relative = image.dataset.localSrc ?? "";
      if (!relative) continue;
      image.src = convertFileSrc(joinPath(dir, relative));
    }
  }, [html, dir]);

  return (
    <div
      className="markdown-body reader-chunk"
      ref={containerRef}
      onClick={handleCopyClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});
