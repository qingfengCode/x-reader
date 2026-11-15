import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import type { ReaderSettings, Tab } from "../types";
import { initialWindow, splitChunks, type ChunkWindow } from "../lib/chunks";
import { languageOf } from "../lib/format";
import { loadScroll, saveScroll } from "../lib/storage";
import { ArrowDownIcon, ArrowUpIcon, CloseIcon, SearchIcon } from "./icons";

// Markdown 渲染器（含代码高亮）体积较大，按需加载，避免拖慢纯文本场景的首屏。
const Markdown = lazy(() =>
  import("./Markdown").then((module) => ({ default: module.Markdown })),
);
const Code = lazy(() =>
  import("./Code").then((module) => ({ default: module.Code })),
);

const READER_WIDTHS: Record<ReaderSettings["width"], string> = {
  narrow: "620px",
  medium: "760px",
  wide: "940px",
  full: "100%",
};

const FIND_ALL = "xreader-find";
const FIND_ACTIVE = "xreader-find-active";
const MAX_MATCHES = 2000;

/** 向上补载：距窗口顶部多近时触发、每次补几块。 */
const EXPAND_UP_CHUNKS = 2;
const EXPAND_UP_THRESHOLD = 4800;
/** 占位高度的初始字符高度比（px/字符），完成首次测量后校正。 */
const DEFAULT_PX_PER_CHAR = 0.26;

interface ViewerProps {
  tab: Tab;
  settings: ReaderSettings;
  active: boolean;
  findOpen: boolean;
  onCloseFind: () => void;
  onOpenLink: (href: string) => void;
}

interface SearchState {
  query: string;
  count: number;
  active: number;
}

const EMPTY_SEARCH: SearchState = { query: "", count: 0, active: -1 };

export const Viewer = memo(function Viewer({
  tab,
  settings,
  active,
  findOpen,
  onCloseFind,
  onOpenLink,
}: ViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const isCode = tab.kind === "code";
  const textKind = tab.kind === "md" ? "md" : "txt";
  const language = useMemo(() => languageOf(tab.path), [tab.path]);
  const chunks = useMemo(
    () => splitChunks(tab.content, textKind),
    [tab.content, textKind],
  );
  const chunkChars = useMemo(() => chunks.map((chunk) => chunk.length), [chunks]);
  const chunksRef = useRef(chunks);
  chunksRef.current = chunks;
  const chunkCharsRef = useRef(chunkChars);
  chunkCharsRef.current = chunkChars;
  const savedScroll = useMemo(() => loadScroll(tab.path), [tab.path]);
  // 只渲染 [start, end) 窗口内的分块；窗口之前的分块用估算高度的占位块代替，
  // 向上滚动时再逐步补载，这样恢复到长文档中部时不必把前半篇全部渲染出来。
  const [range, setRange] = useState<ChunkWindow>(() =>
    initialWindow(chunks.length, savedScroll?.ratio ?? 0),
  );
  const rangeRef = useRef(range);
  rangeRef.current = range;
  const [pxPerChar, setPxPerChar] = useState(DEFAULT_PX_PER_CHAR);
  const pxMeasuredRef = useRef(false);
  const nearBottomRef = useRef(false);
  const latestScrollRef = useRef({ top: 0, ratio: 0 });
  const saveTimerRef = useRef<number | undefined>(undefined);
  const followTimerRef = useRef<number | undefined>(undefined);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const previousContentRef = useRef(tab.content);
  const findInputRef = useRef<HTMLInputElement>(null);
  const searchStateRef = useRef<SearchState>(EMPTY_SEARCH);
  const pendingSearchRef = useRef<string | null>(null);
  const appliedSpacerRef = useRef<number | null>(null);
  const expandPendingRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(
    null,
  );
  const lastScrollTopRef = useRef(0);
  const [findQuery, setFindQuery] = useState("");
  const [findHint, setFindHint] = useState("");
  const [findCount, setFindCount] = useState(0);
  const [findActive, setFindActive] = useState(-1);

  const documentStyle = {
    "--reader-size": `${settings.fontSize}px`,
    "--reader-line-height": String(settings.lineHeight),
    "--reader-width": isCode ? "100%" : READER_WIDTHS[settings.width],
  } as CSSProperties;

  const topSpacerPx = useMemo(() => {
    if (range.start <= 0) return 0;
    let chars = 0;
    for (let index = 0; index < range.start; index += 1) {
      chars += chunkChars[index] ?? 0;
    }
    return Math.round(chars * pxPerChar);
  }, [range.start, chunkChars, pxPerChar]);
  const spacerPxRef = useRef(topSpacerPx);
  spacerPxRef.current = topSpacerPx;

  // 内容首次就绪时恢复阅读位置。标签页常驻挂载，挂载时内容往往还在读取
  // （或面板处于隐藏状态），此时定位滚动没有意义，因此推迟到内容就绪。
  const restoredRef = useRef(false);
  useLayoutEffect(() => {
    if (restoredRef.current || tab.loading || tab.content.length === 0) return;
    restoredRef.current = true;
    const next = initialWindow(chunks.length, savedScroll?.ratio ?? 0);
    if (next.start !== range.start || next.end !== range.end) {
      setRange(next);
    }
    const frame = requestAnimationFrame(() => {
      const element = scrollRef.current;
      if (!element) return;
      element.focus({ preventScroll: true });
      if (!savedScroll) return;
      // 长文档直接定位到窗口首块（占位高度此时已完成测量校正）；
      // 小文档全部渲染，按保存的像素位置还原。
      element.scrollTop =
        next.start > 0 ? spacerPxRef.current : savedScroll.top;
      const max = Math.max(0, element.scrollHeight - element.clientHeight);
      latestScrollRef.current = {
        top: element.scrollTop,
        ratio: max > 0 ? element.scrollTop / max : 0,
      };
      nearBottomRef.current = max > 0 && max - element.scrollTop < 120;
      lastScrollTopRef.current = element.scrollTop;
    });
    return () => cancelAnimationFrame(frame);
  }, [tab.loading, tab.content, chunks, savedScroll, range.start, range.end]);

  useEffect(() => {
    return () => {
      window.clearTimeout(saveTimerRef.current);
      window.clearTimeout(followTimerRef.current);
      if (latestScrollRef.current.top > 0) {
        saveScroll(tab.path, latestScrollRef.current);
      }
    };
  }, [tab.path]);

  useEffect(() => {
    setRange((range) => {
      const total = chunks.length;
      if (range.end <= total && range.start < Math.max(1, total)) return range;
      return {
        start: Math.min(range.start, Math.max(0, total - 1)),
        end: Math.min(range.end, total),
      };
    });
  }, [chunks.length]);

  useEffect(() => {
    if (range.end >= chunks.length) return;
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setRange((range) =>
            range.end >= chunks.length
              ? range
              : { ...range, end: Math.min(chunks.length, range.end + 1) },
          );
        }
      },
      { root, rootMargin: "1600px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [range, chunks.length]);

  // 占位高度或窗口起点变化时保持视口内容稳定，避免内容跳动。
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const pending = expandPendingRef.current;
    const previousSpacer = appliedSpacerRef.current;
    appliedSpacerRef.current = topSpacerPx;
    if (pending) {
      expandPendingRef.current = null;
      const delta = element.scrollHeight - pending.scrollHeight;
      if (delta !== 0 && element.scrollTop > 0) {
        element.scrollTop = pending.scrollTop + delta;
      }
      return;
    }
    if (
      previousSpacer !== null &&
      previousSpacer !== topSpacerPx &&
      element.scrollTop > 0
    ) {
      element.scrollTop += topSpacerPx - previousSpacer;
    }
  });

  // 用第一块进入视口的真实内容测一次“像素/字符”比例，让占位高度接近真实。
  // 后台标签挂载时是隐藏的（尺寸为 0），激活后需要再测一次。
  useLayoutEffect(() => {
    if (pxMeasuredRef.current || !active) return;
    const container = scrollRef.current;
    const root = contentRef.current;
    if (!container || !root) return;
    const containerTop = container.getBoundingClientRect().top;
    const elements = root.querySelectorAll<HTMLElement>("[data-chunk]");
    for (const element of elements) {
      const rect = element.getBoundingClientRect();
      if (rect.bottom <= containerTop) continue;
      const index = Number(element.dataset.chunk ?? "-1");
      const chars = chunkCharsRef.current[index] ?? 0;
      if (chars < 2000 || rect.height <= 0) continue;
      const perChar = rect.height / chars;
      if (perChar > 0.02 && perChar < 4) {
        pxMeasuredRef.current = true;
        setPxPerChar(perChar);
        return;
      }
    }
  }, [range, active]);

  useLayoutEffect(() => {
    if (previousContentRef.current === tab.content) return;
    const wasNearBottom = nearBottomRef.current;
    previousContentRef.current = tab.content;
    if (!wasNearBottom) return;

    const scrollToBottom = () => {
      const element = scrollRef.current;
      if (!element) return;
      element.scrollTop = element.scrollHeight;
    };
    setRange((range) => ({
      ...range,
      end: Math.min(chunksRef.current.length, range.end + 1),
    }));
    requestAnimationFrame(scrollToBottom);
    window.clearTimeout(followTimerRef.current);
    followTimerRef.current = window.setTimeout(scrollToBottom, 100);
  }, [tab.content]);

  const handleScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    const max = Math.max(0, element.scrollHeight - element.clientHeight);
    latestScrollRef.current = {
      top: element.scrollTop,
      ratio: max > 0 ? element.scrollTop / max : 0,
    };
    nearBottomRef.current = max - element.scrollTop < 120;
    // 向上滚动、接近已渲染内容的顶端时，补载更早的分块。
    const start = rangeRef.current.start;
    const distanceToWindowTop = element.scrollTop - spacerPxRef.current;
    if (
      start > 0 &&
      !expandPendingRef.current &&
      element.scrollTop < lastScrollTopRef.current - 2 &&
      distanceToWindowTop < EXPAND_UP_THRESHOLD
    ) {
      expandPendingRef.current = {
        scrollHeight: element.scrollHeight,
        scrollTop: element.scrollTop,
      };
      setRange((range) => ({
        ...range,
        start: Math.max(0, range.start - EXPAND_UP_CHUNKS),
      }));
    }
    lastScrollTopRef.current = element.scrollTop;
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveScroll(tab.path, latestScrollRef.current);
    }, 400);
  };

  const clearFindHighlights = useCallback(() => {
    if (typeof CSS !== "undefined" && CSS.highlights) {
      CSS.highlights.delete(FIND_ALL);
      CSS.highlights.delete(FIND_ACTIVE);
    }
  }, []);

  const collectMatches = useCallback((query: string): Range[] => {
    const root = contentRef.current;
    if (!root || !query) return [];
    const needle = query.toLowerCase();
    const ranges: Range[] = [];

    // 高亮会把文本拆成多个 span（Markdown 与代码文件都是），因此按分块把
    // 文本节点重新拼成一整段再查找，匹配可以跨节点建立 Range。
    const chunks = root.querySelectorAll<HTMLElement>("[data-chunk]");
    for (const chunk of chunks) {
      if (ranges.length >= MAX_MATCHES) break;
      const nodes: { node: Text; start: number }[] = [];
      let text = "";
      const walker = document.createTreeWalker(chunk, NodeFilter.SHOW_TEXT, {
        // 代码块头部的语言标签与复制按钮不属于内容，跳过以免被搜到。
        acceptNode(node) {
          const parent = node.parentElement;
          return parent && parent.closest(".md-code-head")
            ? NodeFilter.FILTER_SKIP
            : NodeFilter.FILTER_ACCEPT;
        },
      });
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const textNode = node as Text;
        nodes.push({ node: textNode, start: text.length });
        text += textNode.data;
      }
      if (!text) continue;

      const nodeAt = (offset: number) => {
        let low = 0;
        let high = nodes.length - 1;
        let found = nodes[0];
        while (low <= high) {
          const mid = (low + high) >> 1;
          if (nodes[mid].start <= offset) {
            found = nodes[mid];
            low = mid + 1;
          } else {
            high = mid - 1;
          }
        }
        return found;
      };

      const haystack = text.toLowerCase();
      let index = haystack.indexOf(needle);
      while (index !== -1 && ranges.length < MAX_MATCHES) {
        const startNode = nodeAt(index);
        const endNode = nodeAt(index + needle.length);
        if (!startNode || !endNode) break;
        const range = document.createRange();
        range.setStart(startNode.node, index - startNode.start);
        range.setEnd(
          endNode.node,
          Math.min(endNode.node.data.length, index + needle.length - endNode.start),
        );
        ranges.push(range);
        index = haystack.indexOf(needle, index + needle.length);
      }
    }
    return ranges;
  }, []);

  const applyHighlights = useCallback((ranges: Range[], activeIndex: number) => {
    if (typeof CSS === "undefined" || !CSS.highlights) return;
    if (ranges.length === 0) {
      CSS.highlights.delete(FIND_ALL);
      CSS.highlights.delete(FIND_ACTIVE);
      return;
    }
    CSS.highlights.set(FIND_ALL, new Highlight(...ranges));
    const active = ranges[activeIndex];
    if (active) {
      CSS.highlights.set(FIND_ACTIVE, new Highlight(active));
    } else {
      CSS.highlights.delete(FIND_ACTIVE);
    }
  }, []);

  const scrollToMatch = useCallback((range: Range) => {
    const container = scrollRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const rangeRect = range.getBoundingClientRect();
    const offset = rangeRect.top - containerRect.top;
    container.scrollTo({
      top: Math.max(0, container.scrollTop + offset - container.clientHeight * 0.35),
      behavior: "smooth",
    });
  }, []);

  const firstVisibleMatch = useCallback((ranges: Range[]): number => {
    const container = scrollRef.current;
    if (!container) return 0;
    const top = container.getBoundingClientRect().top;
    for (let index = 0; index < ranges.length; index += 1) {
      if (ranges[index].getBoundingClientRect().top >= top - 4) return index;
    }
    return 0;
  }, []);

  const moveWindowTo = useCallback((target: number) => {
    const element = scrollRef.current;
    setRange((range) => {
      const total = chunksRef.current.length;
      if (target >= range.end) {
        return { ...range, end: Math.min(total, target + 2) };
      }
      if (target < range.start) {
        if (element) {
          expandPendingRef.current = {
            scrollHeight: element.scrollHeight,
            scrollTop: element.scrollTop,
          };
        }
        return { start: Math.max(0, target - 1), end: range.end };
      }
      return range;
    });
  }, []);

  // 大文档全文小写化开销可观，仅在查找需要时计算一次并按内容缓存。
  const loweredContentRef = useRef<{ source: string; lowered: string } | null>(null);
  const getLoweredContent = useCallback(() => {
    const cached = loweredContentRef.current;
    if (cached && cached.source === tab.content) return cached.lowered;
    const lowered = tab.content.toLowerCase();
    loweredContentRef.current = { source: tab.content, lowered };
    return lowered;
  }, [tab.content]);

  const performSearch = useCallback(
    (query: string, direction: "first" | "next" | "prev") => {
      const trimmed = query.trim();
      if (!trimmed) return;
      const ranges = collectMatches(trimmed);

      if (ranges.length === 0) {
        const sourceIndex = getLoweredContent().indexOf(trimmed.toLowerCase());
        if (sourceIndex >= 0) {
          let accumulated = 0;
          let targetChunk = 0;
          for (let index = 0; index < chunks.length; index += 1) {
            accumulated += chunks[index].length;
            if (sourceIndex < accumulated) {
              targetChunk = index;
              break;
            }
          }
          const current = rangeRef.current;
          if (targetChunk >= current.end || targetChunk < current.start) {
            pendingSearchRef.current = trimmed;
            setFindHint("正在载入目标内容…");
            moveWindowTo(targetChunk);
            return;
          }
        }
        clearFindHighlights();
        searchStateRef.current = { query: trimmed, count: 0, active: -1 };
        setFindCount(0);
        setFindActive(-1);
        setFindHint("未找到匹配");
        return;
      }

      const previous = searchStateRef.current;
      let activeIndex: number;
      if (
        direction !== "first" &&
        previous.query === trimmed &&
        previous.count === ranges.length &&
        previous.active >= 0
      ) {
        activeIndex =
          direction === "next"
            ? (previous.active + 1) % ranges.length
            : (previous.active - 1 + ranges.length) % ranges.length;
      } else {
        activeIndex = firstVisibleMatch(ranges);
      }

      applyHighlights(ranges, activeIndex);
      scrollToMatch(ranges[activeIndex]);
      searchStateRef.current = {
        query: trimmed,
        count: ranges.length,
        active: activeIndex,
      };
      setFindCount(ranges.length);
      setFindActive(activeIndex);
      setFindHint(ranges.length >= MAX_MATCHES ? `仅显示前 ${MAX_MATCHES} 个匹配` : "");
    },
    [
      applyHighlights,
      chunks,
      clearFindHighlights,
      collectMatches,
      firstVisibleMatch,
      getLoweredContent,
      moveWindowTo,
      scrollToMatch,
    ],
  );

  useEffect(() => {
    if (!findOpen) {
      setFindHint("");
      return;
    }
    const timer = window.setTimeout(() => {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    }, 30);
    return () => window.clearTimeout(timer);
  }, [findOpen]);

  useEffect(() => {
    if (!findOpen) {
      pendingSearchRef.current = null;
      clearFindHighlights();
      searchStateRef.current = EMPTY_SEARCH;
      setFindCount(0);
      setFindActive(-1);
      setFindHint("");
      return;
    }
    const query = findQuery.trim();
    if (!query) {
      clearFindHighlights();
      searchStateRef.current = EMPTY_SEARCH;
      setFindCount(0);
      setFindActive(-1);
      setFindHint("");
      return;
    }
    const timer = window.setTimeout(() => performSearch(query, "first"), 220);
    return () => window.clearTimeout(timer);
  }, [findQuery, findOpen, performSearch, clearFindHighlights]);

  useEffect(() => {
    if (!pendingSearchRef.current) return;
    const timer = window.setTimeout(() => {
      const query = pendingSearchRef.current;
      pendingSearchRef.current = null;
      if (query) performSearch(query, "first");
    }, 260);
    return () => window.clearTimeout(timer);
  }, [range, performSearch]);

  useEffect(() => {
    return () => {
      pendingSearchRef.current = null;
      if (typeof CSS !== "undefined" && CSS.highlights) {
        CSS.highlights.delete(FIND_ALL);
        CSS.highlights.delete(FIND_ACTIVE);
      }
    };
  }, []);

  const jumpToAnchor = useCallback((anchorId: string) => {
    const scrollToTarget = () => {
      document
        .getElementById(anchorId)
        ?.scrollIntoView({ block: "start", behavior: "smooth" });
    };
    if (document.getElementById(anchorId)) {
      scrollToTarget();
      return;
    }
    const current = rangeRef.current;
    if (current.end < chunksRef.current.length) {
      setRange({ start: current.start, end: chunksRef.current.length });
      window.setTimeout(scrollToTarget, 120);
    }
  }, []);

  const handleContentClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as HTMLElement).closest("a");
    if (!anchor) return;
    const href = anchor.getAttribute("href");
    if (!href) return;
    event.preventDefault();
    if (href.startsWith("#")) {
      let anchorId = href.slice(1);
      try {
        anchorId = decodeURIComponent(anchorId);
      } catch {
        // 保留原始锚点
      }
      if (anchorId) jumpToAnchor(anchorId);
      return;
    }
    onOpenLink(href);
  };

  const findLabel = findHint
    ? findHint
    : findCount > 0
      ? `${findActive + 1}/${findCount}`
      : "Enter 下一个";

  return (
    <div className="viewer">
      <div className="viewer-scroll" ref={scrollRef} onScroll={handleScroll} tabIndex={-1}>
        <div
          className={
            isCode
              ? "doc reader code-doc width-full"
              : `doc reader font-${settings.font} width-${settings.width}`
          }
          style={documentStyle}
          onClick={handleContentClick}
          ref={contentRef}
        >
          {range.start > 0 ? (
            <div
              className="chunk-spacer-top"
              style={{ height: topSpacerPx }}
              aria-hidden="true"
            />
          ) : null}

          {tab.kind === "md"
            ? chunks.slice(range.start, range.end).map((chunk, offset) => (
                <div
                  className="md-chunk-wrap"
                  data-chunk={range.start + offset}
                  key={range.start + offset}
                >
                  <Suspense fallback={<div className="md-chunk-loading" />}>
                    <Markdown source={chunk} dir={tab.dir} />
                  </Suspense>
                </div>
              ))
            : isCode
              ? chunks.slice(range.start, range.end).map((chunk, offset) => (
                  <div
                    className="code-chunk-wrap"
                    data-chunk={range.start + offset}
                    key={range.start + offset}
                  >
                    <Suspense fallback={<div className="md-chunk-loading" />}>
                      <Code source={chunk} language={language} />
                    </Suspense>
                  </div>
                ))
              : chunks.slice(range.start, range.end).map((chunk, offset) => (
                  <pre
                    key={range.start + offset}
                    className="reader-text reader-chunk"
                    data-chunk={range.start + offset}
                  >
                    {chunk}
                  </pre>
                ))}

          {tab.content.length === 0 && !tab.loading ? (
            <p className="empty-doc">这个文件是空的。</p>
          ) : null}

          {range.end < chunks.length ? (
            <div className="chunk-sentinel" ref={sentinelRef}>
              <span className="tab-spinner" />
              继续加载…
            </div>
          ) : null}
        </div>
      </div>

      {tab.loading ? (
        <div className="viewer-loading">
          <span className="spinner" />
          正在读取文档…
        </div>
      ) : null}

      {findOpen ? (
        <div className="findbar" role="search">
          <SearchIcon size={14} className="find-icon" />
          <input
            ref={findInputRef}
            value={findQuery}
            placeholder="在当前文档中查找"
            spellCheck={false}
            aria-label="查找内容"
            onChange={(event) => {
              setFindQuery(event.target.value);
              setFindHint("");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                performSearch(findQuery, event.shiftKey ? "prev" : "next");
              } else if (event.key === "Escape") {
                event.preventDefault();
                onCloseFind();
              }
            }}
          />
          <span
            className={`find-hint ${
              findHint.includes("未找到") ? "warn" : findHint.includes("载入") ? "busy" : ""
            }`}
          >
            {findLabel}
          </span>
          <button
            type="button"
            className="find-btn"
            title="上一个 (Shift+Enter)"
            aria-label="上一个匹配"
            disabled={!findQuery.trim()}
            onClick={() => performSearch(findQuery, "prev")}
          >
            <ArrowUpIcon size={14} />
          </button>
          <button
            type="button"
            className="find-btn"
            title="下一个 (Enter)"
            aria-label="下一个匹配"
            disabled={!findQuery.trim()}
            onClick={() => performSearch(findQuery, "next")}
          >
            <ArrowDownIcon size={14} />
          </button>
          <button
            type="button"
            className="find-btn"
            title="关闭 (Esc)"
            aria-label="关闭查找"
            onClick={onCloseFind}
          >
            <CloseIcon size={14} />
          </button>
        </div>
      ) : null}
    </div>
  );
});
