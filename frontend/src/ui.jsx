// Shared UI primitives for the liquid-glass design system.
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Loader2, X } from "lucide-react";

export const cx = (...classes) => classes.filter(Boolean).join(" ");

// Chart colors mirror the CSS tokens (SVG attributes cannot read CSS vars).
export const TONE_HEX = {
  ok: "#6ee7a8",
  warn: "#fbbf62",
  bad: "#fb7185",
  info: "#7cc4fa",
  idle: "#94a3b8",
  accent: "#7cf0c5",
};

const TONE_CLASS = {
  ok: "text-ok bg-ok/10 ring-ok/25",
  warn: "text-warn bg-warn/10 ring-warn/25",
  bad: "text-bad bg-bad/10 ring-bad/25",
  info: "text-info bg-info/10 ring-info/25",
  idle: "text-fg-2 bg-white/5 ring-white/10",
  accent: "text-accent bg-accent/10 ring-accent/25",
};

// Status words used across the API, mapped to one visual tone.
export const STATUS_TONE = {
  present: "ok", on_time: "ok", active: "ok", check_in: "ok", reviewed: "ok", sent: "ok",
  late: "warn", early_leave: "warn", incomplete: "warn", new: "warn", queued: "warn",
  absent: "bad", inactive: "idle", failed: "bad",
  inside: "info", check_out: "info",
  outside: "idle", normal: "idle", weekend: "idle", holiday: "idle", dismissed: "idle",
};

export const label = (value) =>
  String(value ?? "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

// The SmartGate mark (frontend/public/SmartGate-logo.png, served as a
// square 256px copy). Decorative by default; pass alt when it stands alone.
export function Logo({ className, alt = "" }) {
  return (
    <img
      src="/logo-256.png"
      alt={alt}
      aria-hidden={alt ? undefined : true}
      width={256}
      height={256}
      draggable={false}
      className={cx("shrink-0 rounded-[28%] ring-1 ring-inset ring-white/10 shadow-[0_6px_20px_-8px_rgb(124_240_197/0.45)]", className)}
    />
  );
}

export function Panel({ as: Tag = "section", className, children, ...props }) {
  return (
    <Tag className={cx("glass rounded-[28px]", className)} {...props}>
      {children}
    </Tag>
  );
}

export function PageHeader({ title, description, actions }) {
  return (
    <header className="reveal mb-8 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
      <div className="max-w-5xl">
        <h1 className="text-[clamp(1.75rem,2.6vw,2.5rem)] font-semibold leading-[1.1] tracking-[-0.03em] text-fg">
          {title}
        </h1>
        {description && <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-fg-3">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

const BUTTON = {
  primary:
    "bg-accent text-accent-ink hover:bg-[#99f5d4] shadow-[0_8px_24px_-10px_rgb(124_240_197/0.6),inset_0_1px_0_rgb(255_255_255/0.5)]",
  glass: "glass text-fg hover:bg-white/10",
  ghost: "text-fg-2 hover:text-fg hover:bg-white/6",
  danger: "bg-bad/12 text-bad ring-1 ring-bad/30 hover:bg-bad/20",
};

export function Button({ variant = "glass", size = "md", icon: Icon, loading, className, children, ...props }) {
  return (
    <button
      type="button"
      className={cx(
        "inline-flex cursor-pointer select-none items-center justify-center gap-2 rounded-full font-medium",
        "transition-[background-color,transform,box-shadow,color] duration-200 ease-out active:scale-[0.97]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-9 px-3.5 text-[13px]" : "h-11 px-5 text-sm",
        BUTTON[variant],
        className
      )}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : Icon && <Icon className="size-4" aria-hidden />}
      {children}
    </button>
  );
}

export function IconButton({ label: text, icon: Icon, className, ...props }) {
  return (
    <button
      type="button"
      aria-label={text}
      title={text}
      className={cx(
        "inline-flex size-10 cursor-pointer items-center justify-center rounded-full text-fg-2",
        "transition-colors duration-200 hover:bg-white/8 hover:text-fg active:scale-95",
        className
      )}
      {...props}
    >
      <Icon className="size-[18px]" aria-hidden />
    </button>
  );
}

export function Badge({ tone, children, dot = true, className }) {
  const resolved = tone ?? STATUS_TONE[children] ?? "idle";
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset",
        TONE_CLASS[resolved],
        className
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {typeof children === "string" ? label(children) : children}
    </span>
  );
}

const FIELD = cx(
  "h-11 w-full rounded-2xl bg-white/[0.04] px-4 text-sm text-fg placeholder:text-fg-3",
  "ring-1 ring-inset ring-line transition-[box-shadow,background-color] duration-200",
  "hover:ring-line-strong focus:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-accent/70",
  "aria-[invalid=true]:ring-bad/70"
);

export function Field({ label: text, hint, error, children, className }) {
  const id = useId();
  const control = typeof children === "function" ? children(id) : children;
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-fg-2">
        {text}
      </label>
      {control}
      {error ? (
        <p className="text-xs text-bad" role="alert">{error}</p>
      ) : (
        hint && <p className="text-xs text-fg-3">{hint}</p>
      )}
    </div>
  );
}

export function Input({ className, ...props }) {
  return <input className={cx(FIELD, className)} {...props} />;
}

export function Select({ className, children, ...props }) {
  return (
    <select className={cx(FIELD, "cursor-pointer appearance-none pr-9 [&>option]:bg-ink-2", className)} {...props}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...props }) {
  return <textarea className={cx(FIELD, "h-auto min-h-24 py-3", className)} {...props} />;
}

// Pill tabs. `options` = [{ value, label }].
export function Segmented({ value, onChange, options, label: text }) {
  return (
    <div role="tablist" aria-label={text} className="glass inline-flex rounded-full p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
          className={cx(
            "h-9 cursor-pointer rounded-full px-4 text-[13px] font-medium transition-[background-color,color] duration-200",
            value === option.value ? "bg-white/12 text-fg shadow-[inset_0_1px_0_rgb(255_255_255/0.12)]" : "text-fg-3 hover:text-fg"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Spinner({ className }) {
  return <Loader2 className={cx("size-5 animate-spin text-fg-3", className)} aria-label="Loading" />;
}

export function Skeleton({ className }) {
  return <div className={cx("animate-pulse rounded-2xl bg-white/[0.05]", className)} aria-hidden />;
}

export function Empty({ icon: Icon, title, children, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {Icon && (
        <div className="glass mb-4 flex size-12 items-center justify-center rounded-2xl">
          <Icon className="size-5 text-fg-2" aria-hidden />
        </div>
      )}
      <p className="text-[15px] font-medium text-fg">{title}</p>
      {children && <p className="mt-1 max-w-sm text-sm text-fg-3">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorNote({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl bg-bad/10 px-4 py-3 text-sm text-bad ring-1 ring-inset ring-bad/25" role="alert">
      <span className="flex items-center gap-2">
        <AlertTriangle className="size-4 shrink-0" aria-hidden />
        {error.message}
      </span>
      {onRetry && (
        <button type="button" onClick={() => onRetry()} className="cursor-pointer font-medium underline-offset-4 hover:underline">
          Retry
        </button>
      )}
    </div>
  );
}

export function Modal({ open, onClose, title, description, children, footer, wide }) {
  const panel = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const previous = document.activeElement;
    panel.current?.querySelector("input, select, textarea, button")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx(
          "glass glass-strong reveal relative flex max-h-[92vh] w-full flex-col rounded-t-[28px] sm:rounded-[28px]",
          wide ? "sm:max-w-2xl" : "sm:max-w-lg"
        )}
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-6">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
            {description && <p className="mt-1 text-sm text-fg-3">{description}</p>}
          </div>
          <IconButton label="Close" icon={X} onClick={onClose} className="-mr-2 -mt-1" />
        </div>
        <div className="overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-6 py-4">{footer}</div>}
      </div>
    </div>
  );
}

export function Pagination({ page, limit, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (total <= limit) return null;
  return (
    <div className="flex items-center justify-between gap-4 px-2 pt-4 text-[13px] text-fg-3">
      <span className="tabular">
        {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}
      </span>
      <div className="flex gap-1">
        <IconButton label="Previous page" icon={ChevronLeft} disabled={page <= 1} onClick={() => onPage(page - 1)} className="disabled:opacity-30" />
        <IconButton label="Next page" icon={ChevronRight} disabled={page >= pages} onClick={() => onPage(page + 1)} className="disabled:opacity-30" />
      </div>
    </div>
  );
}

// Plain table on glass. `columns` = [{ key, header, render?, className? }].
export function Table({ columns, rows, rowKey = "id", empty }) {
  if (!rows.length) return empty;
  return (
    <div className="-mx-2 overflow-x-auto">
      <table className="w-full min-w-[640px] border-separate border-spacing-0 text-left text-sm">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={cx("px-4 pb-3 text-xs font-medium text-fg-3", column.className)}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row[rowKey]} className="group">
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cx(
                    "border-t border-line px-4 py-3.5 text-fg-2 transition-colors duration-150 group-hover:bg-white/[0.025]",
                    column.className
                  )}
                >
                  {column.render ? column.render(row) : row[column.key] ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Avatar({ name, className }) {
  const initials = String(name || "?")
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return (
    <span
      className={cx(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-white/8 text-xs font-semibold text-fg ring-1 ring-inset ring-line",
        className
      )}
      aria-hidden
    >
      {initials}
    </span>
  );
}

/* Toasts */
const ToastContext = createContext(() => {});

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const notify = useCallback((message, tone = "ok") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((list) => [...list, { id, message, tone }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 4200);
  }, []);

  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div className="pointer-events-none fixed bottom-5 left-1/2 z-[60] flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className="glass glass-strong reveal pointer-events-auto flex items-center gap-3 rounded-2xl px-4 py-3 text-sm">
            {toast.tone === "bad" ? (
              <AlertTriangle className="size-4 shrink-0 text-bad" aria-hidden />
            ) : (
              <CheckCircle2 className="size-4 shrink-0 text-ok" aria-hidden />
            )}
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

/* Formatting */
export const fmtTime = (value) =>
  value ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";

export const fmtDateTime = (value) =>
  value
    ? new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "—";

export const fmtMinutes = (minutes) => {
  if (!minutes) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
};

export const timeAgo = (value) => {
  const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return fmtDateTime(value);
};
