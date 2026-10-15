import { useState } from "react";
import { usePipelineStore } from "@/stores/pipelineStore";
import { isPathJson, isGraphJson } from "@/utils/pathJson";

// Paste-in counterpart to PathMenu's file-picker import. Same two JSON
// shapes accepted (path or raw graph), same detection/loader calls -- just
// sourced from a textarea instead of `<input type="file">`, for pasting a
// hit sequence copied from elsewhere (chat, a script's stdout, another
// export) without round-tripping through a saved file.
export function PasteJsonDialog({ onClose }: { onClose: () => void }) {
  const { loadPath, importGraph } = usePipelineStore();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleLoad() {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (err) {
      setError(`Invalid JSON: ${String(err)}`);
      return;
    }
    if (isPathJson(data)) {
      loadPath(data);
      onClose();
    } else if (isGraphJson(data)) {
      importGraph(data);
      onClose();
    } else {
      setError("Not a recognized JSON shape — expected either a path ({root, steps}) or a graph ({nodes, edges}).");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-[32rem] max-h-[80vh] flex flex-col rounded-md border border-border bg-panel shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3 py-2 border-b border-border flex items-center justify-between shrink-0">
          <span className="text-sm text-gray-200 font-medium">Paste JSON (path or graph)</span>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-200 text-xs">✕</button>
        </div>
        <div className="px-3 py-3 flex-1 min-h-0">
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder='{"root": {"kind": "slab_stock", "params": {...}}, "steps": [...]}'
            spellCheck={false}
            className="w-full h-64 resize-none rounded border border-border bg-surface text-gray-200 text-xs font-mono p-2 outline-none focus:border-accent"
          />
        </div>
        {error && <div className="px-3 pb-2 text-[11px] text-red-400 break-words">{error}</div>}
        <div className="px-3 py-2 border-t border-border flex justify-end gap-2 shrink-0">
          <button
            onClick={onClose}
            className="text-xs px-3 py-1 rounded bg-surface border border-border text-gray-300 hover:text-gray-100 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleLoad}
            disabled={text.trim().length === 0}
            className="text-xs px-3 py-1 rounded bg-accent text-white font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            Load
          </button>
        </div>
      </div>
    </div>
  );
}
