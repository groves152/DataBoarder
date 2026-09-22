import { usePipelineStore, PHI_SYMMETRY_PRESETS } from "@/stores/pipelineStore";
import { formatRadiansAsPi } from "@/utils/angleFormat";

const LEGEND: [string, string, string][] = [
  ["Start", "U", "Menu"],
  ["A", "Space", "Commit + next strike"],
  ["X", "Enter", "Commit (no advance)"],
  ["Back", "Backspace/Delete", "Undo (delete + back)"],
  ["Y", "P", "Toggle press preview"],
  ["L-stick X", "A / D", "Translation z"],
  ["LB / RB", "Q / E", "Angle phi (step)"],
  ["RT / LT", "W / S", "Depth rho (+/-)"],
  ["R-stick", "—", "Camera orbit"],
  ["D-pad ←/→", "Tab / Shift+Tab", "Prev / next node"],
  ["D-pad ↑/↓", "↑ / ↓", "Prev / next target"],
  ["L3", "Shift (hold)", "Fine mode toggle"],
  ["R3", "—", "Toggle playback"],
];

// Plain HTML, layered as an absolutely-positioned sibling OVER MeshPanel's
// <Canvas> (NOT passed through MeshPanel's own `overlay` prop -- that
// renders INSIDE the Three.js scene, for 3-D content like PressPreview/
// GoalOverlay, not status text). Reads everything reactively straight off
// the store; only fineModeActive/flashMessage/playbackActive/
// gamepadConnected come from the controller-input hook itself (the rest
// -- selected node, its params, cook status -- already lives in
// usePipelineStore).
export function ControllerHud({
  gamepadConnected, fineModeActive, flashMessage, playbackActive, rawGamepadDebug,
}: {
  gamepadConnected: boolean;
  fineModeActive: boolean;
  flashMessage: string | null;
  playbackActive: boolean;
  // Raw button/axis readout -- see useControllerModeInput's own
  // ControllerModeStatus.rawGamepadDebug docstring. Shown so a controller
  // that doesn't match this app's Standard Gamepad index assumptions can
  // be identified by watching which index lights up per physical press,
  // instead of guessing blind.
  rawGamepadDebug: { mapping: string; buttons: number[]; axes: number[] } | null;
}) {
  const { nodes, nodeKinds, selectedNodeId, cooking, cookError, phiSymmetry } = usePipelineStore();
  const node = nodes.find((n) => n.id === selectedNodeId);
  const schema = node && nodeKinds.find((k) => k.kind === node.data.kind);

  return (
    <div className="absolute inset-0 pointer-events-none z-10 flex flex-col justify-between p-3 text-xs">
      <div className="flex items-start justify-between">
        <div className="bg-panel/80 backdrop-blur border border-border rounded-md px-3 py-2 text-gray-300 min-w-[12rem]">
          <div className="flex items-center gap-1.5 mb-1">
            <span className={`w-2 h-2 rounded-full ${gamepadConnected ? "bg-green-400" : "bg-gray-600"}`} />
            <span className="text-[10px] uppercase tracking-wide text-gray-500">
              {gamepadConnected ? "Controller connected" : "Keyboard only"}
            </span>
            {fineModeActive && (
              <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-accent/30 text-accent">fine</span>
            )}
            {playbackActive && (
              <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-accent/30 text-accent">playback</span>
            )}
          </div>
          <div className="flex justify-between tabular-nums text-[10px] mb-1">
            <span className="text-gray-500">symmetry</span>
            <span>{PHI_SYMMETRY_PRESETS[phiSymmetry].label}</span>
          </div>
          {node ? (
            <>
              <div className="text-gray-500">{node.data.kind}</div>
              <div className="text-sm text-gray-200 font-medium mb-1">{node.id}</div>
              {schema?.params.z && (
                <div className="flex justify-between tabular-nums">
                  <span className="text-gray-500">z</span>
                  <span>{Number(node.data.params.z ?? 0).toFixed(2)}mm</span>
                </div>
              )}
              {schema?.params.rho && (
                <div className="flex justify-between tabular-nums">
                  <span className="text-gray-500">rho</span>
                  <span>{Number(node.data.params.rho ?? 0).toFixed(2)}mm</span>
                </div>
              )}
              {schema?.params.phi && (
                <div className="flex justify-between tabular-nums">
                  <span className="text-gray-500">phi</span>
                  <span>{formatRadiansAsPi(Number(node.data.params.phi ?? 0))}</span>
                </div>
              )}
            </>
          ) : (
            <div className="text-gray-500">No node selected</div>
          )}
          <div className="mt-1 text-[10px]">
            {cooking && <span className="text-accent">cooking…</span>}
            {!cooking && cookError && <span className="text-red-400 break-words">{cookError}</span>}
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          {flashMessage && (
            <div className="bg-accent/90 text-white rounded-md px-3 py-1.5 text-xs font-medium">
              {flashMessage}
            </div>
          )}
          <div className="bg-panel/80 backdrop-blur border border-border rounded-md px-3 py-2">
            <div className="grid grid-cols-[auto_auto_1fr] gap-x-3 gap-y-0.5 text-[10px] text-gray-500">
              {LEGEND.map(([gp, kb, label]) => (
                <div key={label} className="contents">
                  <span className="text-gray-400">{gp}</span>
                  <span className="text-gray-600">{kb}</span>
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {rawGamepadDebug && (
        <div className="bg-panel/80 backdrop-blur border border-border rounded-md px-3 py-2 self-start font-mono text-[10px] text-gray-500 max-w-md">
          <div className="text-gray-400 mb-1">
            raw gamepad debug — mapping: <span className={rawGamepadDebug.mapping === "standard" ? "text-green-400" : "text-amber-400"}>{rawGamepadDebug.mapping}</span>
          </div>
          <div className="flex flex-wrap gap-x-2 gap-y-0.5">
            {rawGamepadDebug.buttons.map((v, i) => (
              <span key={i} className={v > 0.05 ? "text-accent" : undefined}>b{i}:{v.toFixed(2)}</span>
            ))}
          </div>
          <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-0.5">
            {rawGamepadDebug.axes.map((v, i) => (
              <span key={i} className={Math.abs(v) > 0.2 ? "text-accent" : undefined}>a{i}:{v.toFixed(2)}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
