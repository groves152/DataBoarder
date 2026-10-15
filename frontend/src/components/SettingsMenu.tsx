import { useEffect, useRef, useState } from "react";
import { useThemeStore, type ThemeMode } from "@/theme";

// App-wide settings (gear, top bar). Per-browser preferences only; machine /
// material / process profiles get their own page.
export function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const options: { value: ThemeMode; label: string }[] = [
    { value: "dark", label: "Dark" },
    { value: "light", label: "Light" },
    { value: "system", label: "Follow system" },
  ];

  return (
    <div ref={ref} className="relative">
      <button
        title="Settings"
        onClick={() => setOpen((o) => !o)}
        className="w-7 h-6 flex items-center justify-center rounded text-gray-400 hover:text-gray-100 hover:bg-border transition-colors"
      >
        ⚙
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-52 z-50 rounded-md border border-border bg-panel shadow-xl py-2 text-xs">
          <div className="px-3 pb-1 text-[10px] uppercase tracking-wide text-gray-500">Theme</div>
          {options.map((o) => (
            <label key={o.value} className="flex items-center gap-2 px-3 py-1 cursor-pointer text-gray-200 hover:bg-surface">
              <input
                type="radio"
                name="theme"
                checked={mode === o.value}
                onChange={() => setMode(o.value)}
                className="accent-accent"
              />
              {o.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
