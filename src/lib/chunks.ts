import { clamp } from "./format";

// 分块不宜过大：每次挂载一个分块都要在一帧内完成整块的布局（txt）或
// 解析（Markdown），块越大滚动时的单次卡顿越明显。
const CHUNK_SIZES: Record<"md" | "txt", number> = {
  md: 32_000,
  txt: 16_000,
};

/**
 * 超长文档按段落边界切块渐进渲染，避免一次性布局数兆文本。
 */
export function splitChunks(content: string, kind: "md" | "txt"): string[] {
  if (!content) return [""];
  const size = CHUNK_SIZES[kind];
  if (content.length <= size) return [content];

  const chunks: string[] = [];
  let start = 0;
  while (start < content.length) {
    let end = Math.min(start + size, content.length);
    if (end < content.length) {
      const minBoundary = start + Math.floor(size * 0.6);
      let boundary = content.lastIndexOf("\n\n", end);
      if (boundary < minBoundary) boundary = content.lastIndexOf("\n", end);
      if (boundary > minBoundary) end = boundary + 1;
    }
    chunks.push(content.slice(start, end));
    start = end;
  }
  return chunks;
}

export interface ChunkWindow {
  /** 第一个已渲染分块的下标，之前的分块用占位高度代替。 */
  start: number;
  /** 已渲染分块的上界（不含）。 */
  end: number;
}

/** 文档不超过这个分块数时直接整篇渲染，无需窗口化。 */
const FULL_WINDOW_CHUNKS = 14;
/** 恢复阅读位置时，目标分块之后预渲染的分块数。 */
const WINDOW_TAIL_CHUNKS = 8;

/**
 * 计算初始渲染窗口。恢复阅读位置时只渲染目标位置附近的一小段，
 * 而不是从头渲染到目标位置——后者会把几十 MB 的文本一次性放进 DOM。
 */
export function initialWindow(total: number, ratio: number): ChunkWindow {
  if (total <= FULL_WINDOW_CHUNKS) return { start: 0, end: total };
  const target = clamp(Math.round(ratio * (total - 1)), 0, total - 1);
  return {
    start: Math.max(0, target - 1),
    end: Math.min(total, target + WINDOW_TAIL_CHUNKS),
  };
}
