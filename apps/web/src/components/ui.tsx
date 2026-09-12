import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { LoaderCircle } from "lucide-react";

export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function Button({
  variant = "primary",
  className,
  loading,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" | "outline"; loading?: boolean }) {
  const styles = {
    primary: "bg-accent text-ink-950 hover:bg-teal-300",
    ghost: "bg-transparent text-mist-100 hover:bg-ink-700",
    danger: "bg-rose-500/90 text-white hover:bg-rose-400",
    outline: "border border-ink-600 text-mist-100 hover:bg-ink-700",
  }[variant];
  return (
    <button
      disabled={disabled || loading}
      className={cn("inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:opacity-50", styles, className)}
      {...props}
    >
      {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
      {children}
    </button>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "min-h-11 w-full rounded-lg border border-ink-600 bg-ink-950 px-3 py-2 text-sm text-mist-100 outline-none ring-accent/40 placeholder:text-mist-400 focus:ring-2",
        props.className,
      )}
    />
  );
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        "w-full min-h-32 rounded-lg border border-ink-600 bg-ink-950 px-3 py-2 text-sm text-mist-100 outline-none ring-accent/40 placeholder:text-mist-400 focus:ring-2",
        props.className,
      )}
    />
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        "min-h-11 w-full rounded-lg border border-ink-600 bg-ink-950 px-3 py-2 text-sm text-mist-100 outline-none ring-accent/40 focus:ring-2",
        props.className,
      )}
    />
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-2xl border border-ink-600 bg-ink-800/80 shadow-xl shadow-black/20", className)}>{children}</div>;
}

export function Label({ children }: { children: ReactNode }) {
  return <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-mist-400">{children}</label>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-mist-400">{subtitle}</p> : null}
      </div>
      {actions}
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warn" | "bad" }) {
  const map = {
    neutral: "bg-ink-700 text-mist-100",
    good: "bg-emerald-500/15 text-emerald-300",
    warn: "bg-amber-500/15 text-amber-300",
    bad: "bg-rose-500/15 text-rose-300",
  }[tone];
  return <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", map)}>{children}</span>;
}

export function FieldError({ error }: { error?: string | null }) {
  if (!error) return null;
  return <p className="mt-2 text-sm text-rose-300">{error}</p>;
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-mist-400" role="status" aria-live="polite">
      <LoaderCircle className="h-5 w-5 animate-spin text-accent" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function EmptyState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return (
    <Card className="p-8 text-center">
      <h3 className="text-lg font-medium">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-mist-400">{detail}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </Card>
  );
}

export function QueryPanel({
  loading,
  error,
  empty,
  emptyTitle,
  emptyDetail,
  emptyAction,
  children,
}: {
  loading: boolean;
  error?: Error | null;
  empty?: boolean;
  emptyTitle?: string;
  emptyDetail?: string;
  emptyAction?: ReactNode;
  children: ReactNode;
}) {
  if (loading) return <Spinner label="Loading this workspace…" />;
  if (error) {
    return (
      <Card className="border-rose-500/40 p-5 text-sm text-rose-200">
        {error.message || "This view failed to load. Confirm the API is running, then refresh."}
      </Card>
    );
  }
  if (empty) return <EmptyState title={emptyTitle || "Nothing here yet"} detail={emptyDetail || "Create the first item to get started."} action={emptyAction} />;
  return <>{children}</>;
}

export function Modal({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <button className="absolute inset-0 bg-black/60" aria-label="Close dialog" onClick={onClose} />
      <Card className="relative z-10 w-full max-w-lg p-6">
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button className="text-mist-400 hover:text-white" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </Card>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Confirm",
  loading,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal open={open} title={title} onClose={onCancel}>
      <p className="text-sm text-mist-400">{body}</p>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={loading}>
          Cancel
        </Button>
        <Button variant="danger" loading={loading} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

export function Stepper({ steps, current, onSelect }: { steps: string[]; current: number; onSelect?: (index: number) => void }) {
  return (
    <ol className="mb-6 flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {steps.map((step, i) => (
        <li key={step} className="shrink-0">
          <button
            type="button"
            onClick={() => onSelect?.(i)}
            disabled={!onSelect || i > current}
            className={cn(
              "flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium",
              i === current ? "bg-accent text-ink-950" : i < current ? "bg-emerald-500/20 text-emerald-200" : "bg-ink-700 text-mist-400",
              onSelect && i <= current ? "cursor-pointer" : "cursor-default",
            )}
          >
            <span className="font-mono">{i + 1}</span>
            {step}
          </button>
        </li>
      ))}
    </ol>
  );
}

export function FetchBar({ active }: { active: boolean }) {
  if (!active) return null;
  return <div className="absolute inset-x-0 top-0 z-20 h-0.5 overflow-hidden bg-ink-700"><div className="h-full w-1/3 animate-[slide_1.1s_ease_infinite] bg-accent" /></div>;
}
