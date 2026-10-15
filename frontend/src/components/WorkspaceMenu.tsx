import { useEffect, useRef, useState } from "react";
import type { GroupImperativeHandle } from "react-resizable-panels";
import { usePipelineStore } from "@/stores/pipelineStore";
import { isWorkspaceJson } from "@/utils/pathJson";
import { RawJsonDialog } from "./RawJsonDialog";
import type { WorkspaceJson } from "@/types/pipeline";

// "Similar to how VSCode works" -- exports/imports UI/session state (render
// toggles, panel drag-resize positions), deliberately separate from
// PathMenu's node/edge JSON. Panel drag positions ALSO auto-persist to
// localStorage on their own (see PipelineView's useDefaultLayout calls), so
// this menu is only for the explicit "save this exact setup to a portable
// file" / "load a setup someone else sent me" use case.
export function WorkspaceMenu({
  outerGroupRef,
  meshRowGroupRef,
  graphRowGroupRef,
}: {
  outerGroupRef: React.RefObject<GroupImperativeHandle | null>;
  meshRowGroupRef: React.RefObject<GroupImperativeHandle | null>;
  graphRowGroupRef: React.RefObject<GroupImperativeHandle | null>;
}) {
  const snapshotAppSettings = usePipelineStore((s) => s.snapshotAppSettings);
  const applyAppSettings = usePipelineStore((s) => s.applyAppSettings);
  const [open, setOpen] = useState(false);
  const [jsonPreview, setJsonPreview] = useState<{ data: unknown; filename: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onClickOutside);
    return () => window.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  function handleExportClick() {
    const workspace: WorkspaceJson = {
      format: "databoarder_workspace/v1",
      app_settings: snapshotAppSettings(),
      layouts: {
        outer: outerGroupRef.current?.getLayout(),
        meshRow: meshRowGroupRef.current?.getLayout(),
        graphRow: graphRowGroupRef.current?.getLayout(),
      },
    };
    setJsonPreview({ data: workspace, filename: "workspace.json" });
    setOpen(false);
  }

  function handleImportClick() {
    fileInputRef.current?.click();
    setOpen(false);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    let data: unknown;
    try {
      data = JSON.parse(await file.text());
    } catch (err) {
      window.alert(`Failed to import workspace: ${String(err)}`);
      return;
    }
    if (!isWorkspaceJson(data)) {
      window.alert('Not a recognized workspace JSON (expected "format": "databoarder_workspace/v1").');
      return;
    }
    if (data.app_settings) applyAppSettings(data.app_settings);
    if (data.layouts?.outer) outerGroupRef.current?.setLayout(data.layouts.outer);
    if (data.layouts?.meshRow) meshRowGroupRef.current?.setLayout(data.layouts.meshRow);
    if (data.layouts?.graphRow) graphRowGroupRef.current?.setLayout(data.layouts.graphRow);
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-xs px-2 py-1 rounded bg-surface border border-border text-gray-300 hover:border-accent hover:text-gray-100 transition-colors"
      >
        Workspace ▾
      </button>
      <input ref={fileInputRef} type="file" accept="application/json,.json" className="hidden" onChange={handleFileChange} />

      {open && (
        <div className="absolute z-40 mt-1 w-64 rounded-md border border-border bg-panel shadow-xl py-1 text-xs">
          <button
            onClick={handleExportClick}
            className="w-full text-left px-3 py-1.5 text-gray-300 hover:bg-surface hover:text-gray-100"
          >
            Export workspace (JSON)
          </button>
          <button
            onClick={handleImportClick}
            className="w-full text-left px-3 py-1.5 text-gray-300 hover:bg-surface hover:text-gray-100"
          >
            Import workspace…
          </button>
        </div>
      )}

      {jsonPreview && (
        <RawJsonDialog
          data={jsonPreview.data}
          filename={jsonPreview.filename}
          onClose={() => setJsonPreview(null)}
        />
      )}
    </div>
  );
}
