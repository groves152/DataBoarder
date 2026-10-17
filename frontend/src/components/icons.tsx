// Small stroke icons (24 x 24, currentColor) and the square icon button the
// graph's side toolbars use: the tooltip opens beside the button, toward the
// canvas.

type IconName =
  | "trash" | "mesh" | "reset" | "purge" | "layout" | "fit" | "zoomIn" | "zoomOut" | "selectAll"
  | "expand" | "flame" | "programs" | "plus" | "up";

const PATHS: Record<IconName, string> = {
  trash: "M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3",
  mesh: "M4 6l8-3 8 3v12l-8 3-8-3zM4 6l8 3 8-3M12 9v12",
  reset: "M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4",
  purge: "M3 6h18M8 6V4h8v2M6 6l1.5 14h9L18 6M9.5 10l5 6M14.5 10l-5 6",
  layout: "M3 4h7v6H3zM14 4h7v6h-7zM3 14h7v6H3zM14 14h7v6h-7zM10 7h4M10 17h4M6.5 10v4",
  fit: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5M9 9h6v6H9z",
  zoomIn: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4M11 8v6M8 11h6",
  zoomOut: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4M8 11h6",
  selectAll: "M4 4h4M4 4v4M20 4h-4M20 4v4M4 20h4M4 20v-4M20 20h-4M20 20v-4M9 9h6v6H9z",
  expand: "M4 6h16M4 12h10M4 18h13M17 9l3 3-3 3",
  flame: "M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-4 2.5-5 0 2 1 3 2 3-1-3 0-6 .5-8z",
  programs: "M3 5h8v6H3zM13 13h8v6h-8zM7 11v4h6M17 13V9h-6",
  plus: "M12 5v14M5 12h14",
  up: "M12 19V5M5 12l7-7 7 7",
};

export function Icon({ name, className = "w-4 h-4" }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"
         strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

export function IconButton({ icon, label, onClick, side = "right", active = false, danger = false, disabled = false }: {
  icon: IconName;
  label: string; // the tooltip (and the accessible name)
  onClick: () => void;
  side?: "left" | "right"; // where the tooltip opens
  active?: boolean; // a toggle that is on
  danger?: boolean;
  disabled?: boolean;
}) {
  const tone = active
    ? "bg-accent border-accent text-white"
    : danger
      ? "bg-panel border-border text-red-400 hover:border-red-400"
      : "bg-panel border-border text-gray-300 hover:border-accent hover:text-gray-100";
  return (
    <div className="relative group">
      <button onClick={onClick} disabled={disabled} aria-label={label} aria-pressed={active}
              className={`w-7 h-7 rounded border flex items-center justify-center shadow-sm transition-colors disabled:opacity-40 ${tone}`}>
        <Icon name={icon} />
      </button>
      <div className={`pointer-events-none absolute top-1/2 -translate-y-1/2 ${side === "right" ? "left-full ml-1.5" : "right-full mr-1.5"}
                       whitespace-nowrap rounded bg-panel border border-border px-1.5 py-0.5 text-[10px] text-gray-200 shadow
                       opacity-0 group-hover:opacity-100 transition-opacity z-20`}>
        {label}
      </div>
    </div>
  );
}
