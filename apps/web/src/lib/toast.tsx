import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { cn } from "../components/ui";

export type ToastTone = "success" | "error" | "info";
export type Toast = { id: number; tone: ToastTone; title: string; detail?: string };

type ToastApi = {
  push: (tone: ToastTone, title: string, detail?: string) => void;
  success: (title: string, detail?: string) => void;
  error: (title: string, detail?: string) => void;
  info: (title: string, detail?: string) => void;
};

const Ctx = createContext<ToastApi | null>(null);
let seq = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((tone: ToastTone, title: string, detail?: string) => {
    const id = seq++;
    setItems((cur) => [...cur, { id, tone, title, detail }]);
    window.setTimeout(() => setItems((cur) => cur.filter((t) => t.id !== id)), tone === "error" ? 8000 : 5200);
  }, []);
  const api = useMemo<ToastApi>(
    () => ({
      push,
      success: (title, detail) => push("success", title, detail),
      error: (title, detail) => push("error", title, detail),
      info: (title, detail) => push("info", title, detail),
    }),
    [push],
  );
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[80] flex w-[min(100%-2rem,24rem)] flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto rounded-xl border px-4 py-3 shadow-xl",
              t.tone === "success" && "border-emerald-500/40 bg-ink-800 text-emerald-100",
              t.tone === "error" && "border-rose-500/40 bg-ink-800 text-rose-100",
              t.tone === "info" && "border-sky-500/40 bg-ink-800 text-sky-100",
            )}
            role={t.tone === "error" ? "alert" : "status"}
          >
            <div className="text-sm font-medium">{t.title}</div>
            {t.detail ? <div className="mt-1 text-xs text-mist-400">{t.detail}</div> : null}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}

export function errorMessage(err: unknown, fallback: string) {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
