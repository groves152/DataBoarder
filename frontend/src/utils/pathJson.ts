// Shared JSON-shape detection + file-download helper for the pipeline
// editor's import/export/paste flows (`PathMenu.tsx`, `PasteJsonDialog.tsx`,
// `RawJsonDialog.tsx`). Split out once a second consumer (paste) needed the
// exact same detection logic the file importer already had.
import type { PathJson, GraphJson, WorkspaceJson } from "@/types/pipeline";

export function isPathJson(data: unknown): data is PathJson {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.root === "object" && d.root !== null &&
    typeof (d.root as Record<string, unknown>).kind === "string" &&
    Array.isArray(d.steps)
  );
}

export function isGraphJson(data: unknown): data is GraphJson {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return Array.isArray(d.nodes) && Array.isArray(d.edges);
}

export function isWorkspaceJson(data: unknown): data is WorkspaceJson {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return d.format === "databoarder_workspace/v1";
}

export function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
