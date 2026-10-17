import { useEffect, useRef, useState } from "react";

export interface ViewItem {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}

// "View ▾": show or hide the pipeline view's panels (same dropdown look as
// Path ▾ / Workspace ▾).
export function ViewMenu({ items }: { items: ViewItem[] }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onClickOutside);
    return () => window.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-xs px-2 py-1 rounded bg-surface border border-border text-gray-300 hover:border-accent hover:text-gray-100 transition-colors"
      >
        View ▾
      </button>
      {open && (
        <div className="absolute z-40 mt-1 w-56 rounded-md border border-border bg-panel shadow-xl py-1 text-xs">
          {items.map((it) => (
            <label key={it.label} title={it.hint}
                   className="flex items-center gap-2 px-3 py-1.5 text-gray-300 hover:bg-surface hover:text-gray-100 cursor-pointer select-none">
              <input type="checkbox" checked={it.checked} onChange={(e) => it.onChange(e.target.checked)}
                     className="accent-accent" />
              <span>{it.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
