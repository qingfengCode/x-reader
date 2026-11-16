// Markdown → HTML 渲染管线（unified 全家桶）。
// 与 react-markdown 相比省去了 React 元素树的构建，渲染分块时提交更快。
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeSlug from "rehype-slug";
import rehypeHighlight from "rehype-highlight";
import rehypeStringify from "rehype-stringify";
import type { Element, ElementContent, Root, RootContent } from "hast";

interface ParentNode {
  children: ElementContent[];
}

const ABSOLUTE_PATTERN = /^(https?:|data:|blob:|asset:|file:|mailto:|tel:|\/\/)/i;
const IMG_ALLOWED_PATTERN = /^(https?:|data:image\/|blob:|asset:)/i;
const DANGEROUS_LINK_PATTERN = /^(javascript:|vbscript:)/i;

/**
 * 媒体与链接处理：
 * - 相对路径图片只保留路径标记（data-local-src），由组件换成 asset 协议 URL；
 * - 可执行协议的链接直接去掉 href；
 * - 与 react-markdown 的默认过滤保持同等安全边界（原始 HTML 本就不会经过 remark-rehype）。
 */
function rehypeLocalMedia() {
  return (tree: Root) => {
    walkElements(tree, (node) => {
      if (node.tagName === "img") {
        const raw = String(node.properties.src ?? "");
        node.properties.loading = "lazy";
        node.properties.decoding = "async";
        if (IMG_ALLOWED_PATTERN.test(raw)) return;
        if (raw && !ABSOLUTE_PATTERN.test(raw)) {
          node.properties.src = undefined;
          node.properties.dataLocalSrc = safeDecode(raw.split("#")[0].split("?")[0]);
        } else {
          node.properties.src = undefined;
        }
        return;
      }
      if (node.tagName === "a") {
        const href = String(node.properties.href ?? "");
        if (DANGEROUS_LINK_PATTERN.test(href.trim())) {
          node.properties.href = undefined;
        }
      }
    });
  };
}

/** 代码块与表格加包装层（复制按钮、横向滚动容器），渲染结构与样式钩子对应。 */
function rehypeWrapBlocks() {
  return (tree: Root) => {
    transformChildren(tree as unknown as ParentNode);
  };
}

function transformChildren(parent: ParentNode) {
  const children = parent.children;
  for (let index = 0; index < children.length; index += 1) {
    const node = children[index];
    if (node.type !== "element") continue;
    if (node.tagName === "table") {
      children[index] = wrapElement(node, "md-table-wrap");
    } else if (node.tagName === "pre") {
      children[index] = wrapCodeBlock(node);
    }
    transformChildren(node);
  }
}

function wrapElement(node: Element, className: string): Element {
  return {
    type: "element",
    tagName: "div",
    properties: { className: [className] },
    children: [node],
  };
}

function wrapCodeBlock(pre: Element): Element {
  const code = pre.children.find(
    (child): child is Element => child.type === "element" && child.tagName === "code",
  );
  const classList = code?.properties?.className;
  const classes = Array.isArray(classList)
    ? classList.map(String).join(" ")
    : String(classList ?? "");
  const rawLanguage = /(?:^|\s)language-([^\s]+)/.exec(classes)?.[1] ?? "";
  const language = rawLanguage === "plaintext" ? "" : rawLanguage;
  const head: Element = {
    type: "element",
    tagName: "div",
    properties: { className: ["md-code-head"] },
    children: [
      {
        type: "element",
        tagName: "span",
        properties: { className: ["md-code-lang"] },
        children: [{ type: "text", value: language || "text" }],
      },
      {
        type: "element",
        tagName: "button",
        properties: { className: ["md-code-copy"], type: "button", title: "复制代码" },
        children: [
          {
            type: "element",
            tagName: "span",
            properties: {},
            children: [{ type: "text", value: "复制" }],
          },
        ],
      },
    ],
  };
  return {
    type: "element",
    tagName: "div",
    properties: { className: ["md-code"] },
    children: [head, pre],
  };
}

function walkElements(node: Root | RootContent, visit: (element: Element) => void) {
  if (node.type === "element") {
    visit(node);
    for (const child of node.children) walkElements(child, visit);
  } else if (node.type === "root") {
    for (const child of node.children) walkElements(child, visit);
  }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeLocalMedia)
  .use(rehypeSlug)
  .use(rehypeHighlight, { detect: false, ignoreMissing: true })
  .use(rehypeWrapBlocks)
  .use(rehypeStringify);

export function renderMarkdown(source: string): string {
  try {
    return String(processor.processSync(source));
  } catch {
    return "";
  }
}

// 代码文件没有 Markdown 语法，直接构造 hast 树交给高亮 / 序列化管线。
// 不套 Markdown 代码块外壳（语言头、复制按钮、卡片边框），让代码直接铺满展示区。
const codeProcessor = unified()
  .use(rehypeHighlight, { detect: false, ignoreMissing: true })
  .use(rehypeStringify);

export function renderCode(source: string, language: string): string {
  const lang = language.toLowerCase().replace(/[^a-z0-9+#.-]/g, "");
  const tree: Root = {
    type: "root",
    children: [
      {
        type: "element",
        tagName: "pre",
        properties: {},
        children: [
          {
            type: "element",
            tagName: "code",
            properties: lang ? { className: [`language-${lang}`] } : {},
            children: [{ type: "text", value: source }],
          },
        ],
      },
    ],
  };
  try {
    // 没有 Markdown 解析器，直接用 runSync 处理现成的 hast 树再序列化。
    // unified 的 Compatible 类型对 hast RootData 过于严格（要求索引签名），树本身是合法的。
    const input = tree as unknown as Parameters<typeof codeProcessor.runSync>[0];
    const output = codeProcessor.runSync(input) as unknown as Root;
    return String(codeProcessor.stringify(output));
  } catch {
    return "";
  }
}
