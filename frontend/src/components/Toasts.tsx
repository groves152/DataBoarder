import { useToastStore } from "@/stores/toastStore";

const TONE = {
  info: "border-border",
  success: "border-green-600/70",
  error: "border-red-500/80",
};

export function Toasts() {
  const { toasts, dismiss } = useToastStore();
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-1.5 items-center pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id} role="status"
             className={`pointer-events-auto flex items-center gap-3 rounded-md border bg-panel shadow-xl px-3 py-2 text-xs text-gray-200 max-w-[560px] ${TONE[t.tone]}`}>
          <span className="break-words">{t.text}</span>
          {t.action && (
            <button onClick={() => { t.action!.run(); dismiss(t.id); }}
                    className="shrink-0 text-accent hover:underline">
              {t.action.label}
            </button>
          )}
          <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="shrink-0 text-gray-500 hover:text-gray-200">✕</button>
        </div>
      ))}
    </div>
  );
}
