import { useState } from "react";
import { downloadJson } from "@/utils/pathJson";

// Shows an export (path or graph JSON, i.e. a hit sequence) as raw text the
// user can select/copy directly, instead of only ever triggering a silent
// file download -- PathMenu's export buttons used to call `downloadJson`
// straight away with no way to see or copy the JSON itself.
export function RawJsonDialog({
  data,
  filename,
  onClose,
}: {
  data: unknown;
  filename: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const text = JSON.stringify(data, null, 2);

  async function handleCopy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-[32rem] max-h-[80vh] flex flex-col rounded-md border border-border bg-panel shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3 py-2 border-b border-border flex items-center justify-between shrink-0">
          <span className="text-sm text-gray-200 font-medium">{filename}</span>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-200 text-xs">✕</button>
        </div>
        <div className="px-3 py-3 flex-1 min-h-0">
          <textarea
            readOnly
            value={text}
            onFocus={(e) => e.currentTarget.select()}
            spellCheck={false}
            className="w-full h-64 resize-none rounded border border-border bg-surface text-gray-200 text-xs font-mono p-2 outline-none focus:border-accent"
          />
        </div>
        <div className="px-3 py-2 border-t border-border flex justify-end gap-2 shrink-0">
          <button
            onClick={onClose}
            className="text-xs px-3 py-1 rounded bg-surface border border-border text-gray-300 hover:text-white transition-colors"
          >
            Close
          </button>
          <button
            onClick={() => downloadJson(data, filename)}
            className="text-xs px-3 py-1 rounded bg-surface border border-border text-gray-300 hover:text-white transition-colors"
          >
            Download file
          </button>
          <button
            onClick={handleCopy}
            className="text-xs px-3 py-1 rounded bg-accent text-white font-medium hover:opacity-90 transition-opacity"
          >
            {copied ? "Copied!" : "Copy to clipboard"}
          </button>
        </div>
      </div>
    </div>
  );
}
