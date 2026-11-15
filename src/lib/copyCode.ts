import type { MouseEvent } from "react";

/** 代码块「复制」按钮的事件委托，Markdown 与代码文件视图共用。 */
export function handleCopyClick(event: MouseEvent<HTMLElement>) {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".md-code-copy");
  if (!button || button.disabled) return;
  const code = button.closest(".md-code")?.querySelector("code")?.textContent ?? "";
  if (!code) return;
  void copyText(code).then(() => {
    const label = button.querySelector("span");
    const original = label?.textContent ?? "复制";
    if (label) label.textContent = "已复制";
    button.disabled = true;
    window.setTimeout(() => {
      if (label) label.textContent = original;
      button.disabled = false;
    }, 1600);
  });
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand("copy");
    } catch {
      // 剪贴板不可用时忽略
    }
    area.remove();
  }
}
