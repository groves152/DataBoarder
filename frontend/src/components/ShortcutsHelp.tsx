// "?" in the pipeline top bar: the mouse and keyboard shortcuts, on hover.
const SHORTCUTS: [string, string][] = [
  ["Click a node", "show its cooked part in the viewport"],
  ["Tab / right-click", "add a node at the pointer"],
  ["Cmd/Ctrl + A", "select every node (pointer over the graph)"],
  ["Shift-drag, Cmd/Ctrl-click", "box / multi-select"],
  ["Cmd/Ctrl + C, V", "copy, paste node params (or nodes, onto empty canvas)"],
  ["Delete / Backspace", "delete the selected nodes"],
  ["Two-finger scroll", "pan the graph"],
  ["Pinch, Ctrl + wheel", "zoom the graph"],
];

export function ShortcutsHelp() {
  return (
    <div className="relative group">
      <button aria-label="Shortcuts"
              className="w-6 h-6 rounded-full border border-border text-gray-400 hover:border-accent hover:text-gray-100 transition-colors">
        ?
      </button>
      <div className="pointer-events-none absolute right-0 top-full mt-1 z-40 w-max rounded-md border border-border bg-panel
                      shadow-xl px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <table className="text-[11px]">
          <tbody>
            {SHORTCUTS.map(([keys, what]) => (
              <tr key={keys}>
                <td className="pr-3 py-0.5 text-gray-200 whitespace-nowrap">{keys}</td>
                <td className="py-0.5 text-gray-400">{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
