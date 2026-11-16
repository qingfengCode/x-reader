/** 写入剪贴板；返回是否成功。navigator.clipboard 不可用时回退到 textarea + execCommand。 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {
      // 剪贴板不可用时按失败处理
    }
    area.remove();
    return copied;
  }
}
