// 在首屏绘制前恢复主题，避免主题切换时闪白。
// 这里只读取与 lib/storage.ts 相同的设置键，不参与其余业务逻辑。
(function () {
  try {
    var raw = window.localStorage.getItem("xreader:settings:v1");
    var mode = raw ? JSON.parse(raw).theme : "dark";
    var dark =
      mode === "dark" ||
      (mode === "system" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  } catch {
    // 读取失败时交给 React 使用默认主题。
  }
})();
