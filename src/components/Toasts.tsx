import type { ToastItem } from "../types";
import { AlertTriangleIcon, BookOpenIcon, CheckIcon, CloseIcon } from "./icons";

interface ToastsProps {
  items: ToastItem[];
  onDismiss: (id: number) => void;
}

export function Toasts({ items, onDismiss }: ToastsProps) {
  if (items.length === 0) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((item) => (
        <div key={item.id} className={`toast ${item.kind}`}>
          <span className="toast-icon">
            {item.kind === "error" ? (
              <AlertTriangleIcon size={15} />
            ) : item.kind === "success" ? (
              <CheckIcon size={15} />
            ) : (
              <BookOpenIcon size={15} />
            )}
          </span>
          <span className="toast-text">
            <span className="toast-title">{item.title}</span>
            {item.detail ? <span className="toast-detail">{item.detail}</span> : null}
          </span>
          <button
            type="button"
            className="toast-close"
            aria-label="关闭提示"
            onClick={() => onDismiss(item.id)}
          >
            <CloseIcon size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
