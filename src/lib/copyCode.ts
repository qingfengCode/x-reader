import type { MouseEvent } from "react";
import { copyText } from "./clipboard";

/** 代码块「复制」按钮的事件委托，Markdown 与代码文件视图共用。 */
export function handleCopyClick(event: MouseEvent<HTMLElement>) {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".md-code-copy");
  if (!button || button.disabled) return;
  const code = button.closest(".md-code")?.querySelector("code")?.textContent ?? "";
  if (!code) return;
  void copyText(code).then((copied) => {
    if (!copied) return;
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
