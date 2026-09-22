// Modal/screen menu list -- navigation (D-pad, left stick, or arrow keys;
// A/Enter to select; Back/Esc to cancel where applicable) is handled by
// useControllerModeInput itself; this just renders whatever index it
// reports as current. `onSelectIndex`, when given, also makes each row
// mouse-clickable (used by the model-select screen, which still wants a
// plain click to work for anyone not using a controller/keyboard) --
// omitted for the real Start Menu overlay, which has nothing behind it
// worth click-through for.
export function StartMenu({
  items, selectedIndex, hint, onSelectIndex,
}: {
  items: readonly string[];
  selectedIndex: number;
  hint?: string;
  onSelectIndex?: (index: number) => void;
}) {
  return (
    <div
      className={`absolute inset-0 z-20 flex items-center justify-center bg-black/60 ${onSelectIndex ? "" : "pointer-events-none"}`}
    >
      <div className="bg-panel border border-border rounded-lg py-2 min-w-[16rem] shadow-xl">
        {items.map((item, i) => (
          <div
            key={item}
            onClick={onSelectIndex ? () => onSelectIndex(i) : undefined}
            className={`px-4 py-2 text-sm ${onSelectIndex ? "cursor-pointer" : ""} ${
              i === selectedIndex ? "bg-accent text-white" : "text-gray-300"
            }`}
          >
            {item}
          </div>
        ))}
        <div className="px-4 pt-2 mt-1 border-t border-border text-[10px] text-gray-500">
          {hint ?? "D-pad/stick ↑↓ navigate · A/Enter select · Back/Esc cancel"}
        </div>
      </div>
    </div>
  );
}
