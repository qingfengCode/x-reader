import { memo, useMemo } from "react";
import { renderCode } from "../lib/markdownPipeline";

interface CodeProps {
  source: string;
  language: string;
}

/**
 * 代码文件的分块。直接渲染带高亮的 <pre>，不套卡片外壳，
 * 由展示区样式让它铺满宽度；复制入口在底部状态栏。
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
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});
