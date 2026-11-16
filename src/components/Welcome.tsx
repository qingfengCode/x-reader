import type { RecentFile } from "../types";
import { kindOf, relativeTime } from "../lib/format";
import {
  BookOpenIcon,
  ChevronRightIcon,
  FileKindIcon,
  FileTextIcon,
  FolderOpenIcon,
  ImageIcon,
  LockIcon,
  RefreshIcon,
} from "./icons";

interface WelcomeProps {
  recents: RecentFile[];
  onOpen: () => void;
  onOpenPath: (path: string) => void;
  onClearRecents: () => void;
}

export function Welcome({ recents, onOpen, onOpenPath, onClearRecents }: WelcomeProps) {
  return (
    <div className="welcome">
      <div className="welcome-inner">
        <section className="welcome-hero">
          <span className="welcome-mark">
            <BookOpenIcon size={22} />
          </span>
          <span className="welcome-kicker">X-READER</span>
          <h1>
            安静地读<span className="welcome-dot">。</span>
          </h1>
          <p className="welcome-lead">
            一个只读的本地阅读空间，支持 txt、Markdown、常见代码文件、PDF、图片、视频与音频。
            <br />
            文件永远保持原样。
          </p>

          <div className="welcome-actions">
            <button type="button" className="btn-primary" onClick={onOpen}>
              <FolderOpenIcon size={15} />
              打开文件
              <kbd>Ctrl O</kbd>
            </button>
          </div>

          <div className="welcome-chips">
            <span>
              <LockIcon size={11} />
              严格只读
            </span>
            <span>
              <RefreshIcon size={11} />
              自动刷新
            </span>
            <span>
              <FileTextIcon size={11} />
              多标签
            </span>
            <span>
              <ImageIcon size={11} />
              图片 · 视频 · 音频
            </span>
          </div>
        </section>

        <section className="recent-card" aria-label="最近打开">
          <div className="recent-card-head">
            <span>最近打开</span>
            {recents.length > 0 ? (
              <button type="button" className="recent-clear" onClick={onClearRecents}>
                清空
              </button>
            ) : null}
          </div>

          {recents.length === 0 ? (
            <div className="recent-empty">
              <span className="recent-empty-icon">
                <FileTextIcon size={18} />
              </span>
              <strong>还没有打开过文件</strong>
              <span>从左侧书库选择文件，或点击「打开文件」。</span>
            </div>
          ) : (
            <ul className="recent-list">
              {recents.slice(0, 5).map((item) => (
                <li key={item.path}>
                  <button
                    type="button"
                    className="recent-item"
                    onClick={() => onOpenPath(item.path)}
                    title={item.path}
                  >
                    <span className={`recent-icon ${kindOf(item.path)}`}>
                      <FileKindIcon kind={kindOf(item.path)} size={14} />
                    </span>
                    <span className="recent-text">
                      <span className="recent-name">{item.fileName}</span>
                      <span className="recent-dir">{item.dir}</span>
                    </span>
                    <span className="recent-time">{relativeTime(item.openedAt)}</span>
                    <ChevronRightIcon size={13} className="recent-arrow" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="welcome-footnote">
          把文件或文件夹拖进窗口，也可以直接开始阅读
        </p>
      </div>
    </div>
  );
}
