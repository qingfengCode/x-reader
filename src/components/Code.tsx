import { memo, useMemo } from "react";
import { handleCopyClick } from "../lib/copyCode";
import { renderCode } from "../lib/markdownPipeline";

interface CodeProps {
  source: string;
  language: string;
}

/**
 * 代码文件的分块。复用 Markdown 的代码块结构（高亮、语言标签、复制按钮）
 * 与 .markdown-body 下的 hljs 主题样式。
 */
export const Code = memo(function Code({ source, language }: CodeProps) {
  const html = useMemo(() => renderCode(source, language), [source, language]);
  // 高亮管线异常时退回纯文本，保证内容不会变成空白。
  if (!html && source) {
    return <pre className="reader-text reader-chunk">{source}</pre>;
  }
  return (
    <div
      className="markdown-body code-file"
      onClick={handleCopyClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});
