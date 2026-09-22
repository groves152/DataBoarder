import { useEffect, useMemo, useRef, useState } from "react";
import { usePipelineStore, TARGETS_RUN, TARGETS_TAG_PREFIX } from "@/stores/pipelineStore";
import { MeshPanel, type CameraState } from "./MeshPanel";
import { PressPreview, type ToolDims } from "./PressPreview";
import { GoalOverlay } from "./GoalOverlay";
import { ControllerHud } from "./ControllerHud";
import { StartMenu } from "./StartMenu";
import { useGamepadConnection } from "@/hooks/useGamepadConnection";
import { useControllerModeInput } from "@/hooks/useControllerModeInput";

// Focused, controller/keyboard-driven alternate to the mouse-based
// PipelineView graph editor -- same underlying store/graph, but exactly
// ONE linear chain at a time (no branching UI, no separate "add stock"
// action) and no auto-cook-on-every-change (continuous stick/key input
// updates params locally; Commit/Recook are the only things that POST).
// `controllerModelKind` lives in the store (not local state) specifically
// so switching to the "pipeline" tab and back doesn't wipe the
// in-progress chain -- see pipelineStore.ts's own docstring on that field.
// See useControllerModeInput's own docstring for the input-handling
// details; this component wires it to the live 3-D preview + HUD + menu.
export function ControllerModeView() {
  const {
    run, tag, nodes, nodeKinds, selectedNodeId, diagnostics, viewSequence,
    goalName, goalVisible, goalOpacity, billetOpacity, showPressPreview, controllerModelKind, startControllerSession,
    fetchAvailableGoals, fetchNodeKinds, sessionEpoch,
  } = usePipelineStore();
  const cameraStateRef = useRef<CameraState | null>(null);
  const gamepad = useGamepadConnection();

  const {
    fineModeActive, flashMessage, playbackActive, menuOpen, menuItems, menuIndex,
    modelSelectItems, modelSelectIndex, cameraOrbitRef, rawGamepadDebug,
  } = useControllerModeInput(gamepad.index);

  useEffect(() => {
    fetchNodeKinds();
    fetchAvailableGoals();
  }, [fetchNodeKinds, fetchAvailableGoals]);

  // "Mesh briefly disappears after adding a strike" fix -- a freshly
  // added node has no cooked mesh yet, so switching MeshPanel's tag to it
  // immediately would show a blank/empty state until Commit. Keep
  // rendering whichever node was LAST actually cooked instead; only
  // follow selectedNodeId once that node's own `cooked` flag flips true
  // (which also makes cycling BACK to an already-committed node switch
  // immediately, since its cooked flag is already true).
  const [displayedNodeId, setDisplayedNodeId] = useState<string | null>(null);
  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  useEffect(() => {
    if (selectedNode?.data.cooked) setDisplayedNodeId(selectedNodeId);
  }, [selectedNodeId, selectedNode?.data.cooked]);
  // Without this, a New/Restart Session left displayedNodeId pointing at
  // the PREVIOUS session's last node -- that mesh tag was just purged
  // server-side (see startControllerSession's cache DELETE), but nothing
  // above ever told this state to let go of it, so the viewport kept
  // requesting/showing an already-deleted tag until the new session's
  // first strike finished cooking (reported as "the cache doesn't get
  // properly cleared"). sessionEpoch bumps unconditionally on every
  // session (re)start, independent of whether displayedNodeId itself
  // would ever naturally change.
  useEffect(() => {
    setDisplayedNodeId(null);
  }, [sessionEpoch]);

  const selectedSchema = nodeKinds.find((k) => k.kind === selectedNode?.data.kind);
  const selectedDiag = selectedNodeId ? diagnostics[selectedNodeId] : undefined;

  // Same computation as PipelineView's own previewOverlay/goalOverlay --
  // see that component for the full rationale (capped-closure snapping,
  // goal staying visible across both single-node and sequence view).
  const previewOverlay = useMemo(() => {
    if (viewSequence || !showPressPreview || !selectedNode || !selectedSchema) return undefined;
    const p = selectedSchema.params;
    if (!p.z || !p.phi || !p.rho || !p.tool) return undefined;
    const toolName = String(selectedNode.data.params.tool ?? p.tool.default);
    const toolDims = p.tool.options_meta?.[toolName] as unknown as ToolDims | undefined;
    if (!toolDims) return undefined;
    // See PipelineView's own previewOverlay for why this also gates on
    // "slider still matches what was actually cooked" -- without that,
    // a capped result from an earlier rho value stays stuck forever,
    // ignoring every rho change made via RT/LT since (reported: the die
    // stops tracking the depth control until the next commit).
    const capped = Boolean(selectedDiag?.capped);
    const achievedRho = typeof selectedDiag?.achieved_rho === "number" ? selectedDiag.achieved_rho : undefined;
    const commandedRho = typeof selectedDiag?.commanded_rho === "number" ? selectedDiag.commanded_rho : undefined;
    const liveRho = Number(selectedNode.data.params.rho ?? p.rho.default);
    const stillAtCommandedRho = commandedRho === undefined || Math.abs(liveRho - commandedRho) < 1e-3;
    const rho = capped && achievedRho !== undefined && stillAtCommandedRho ? achievedRho : liveRho;
    return (
      <PressPreview
        z={Number(selectedNode.data.params.z ?? p.z.default)}
        phi={Number(selectedNode.data.params.phi ?? p.phi.default)}
        rho={rho}
        toolDims={toolDims}
        toolName={toolName}
        capped={capped}
      />
    );
  }, [viewSequence, showPressPreview, selectedNode, selectedSchema, selectedDiag]);

  const goalOverlay = useMemo(() => {
    if (!goalVisible || !goalName) return undefined;
    return <GoalOverlay run={TARGETS_RUN} tag={`${TARGETS_TAG_PREFIX}${goalName}`} opacity={goalOpacity} />;
  }, [goalVisible, goalName, goalOpacity]);

  const combinedOverlay = useMemo(() => {
    if (!previewOverlay && !goalOverlay) return undefined;
    return <>{previewOverlay}{goalOverlay}</>;
  }, [previewOverlay, goalOverlay]);

  if (!controllerModelKind) {
    return (
      <div className="h-full w-full relative bg-surface">
        <div className="absolute top-6 left-1/2 -translate-x-1/2 text-sm text-gray-400 uppercase tracking-wide">
          Choose a model to begin
        </div>
        {/* Reuses StartMenu for controller/keyboard nav (D-pad, left
            stick, or arrow keys; A/Enter confirms) -- this screen used to
            be mouse-only (plain buttons), which meant it had NO
            controller/keyboard path at all. onSelectIndex ALSO keeps
            plain mouse clicks working, matching modelSelectItems'
            ["Slab", "Forge-Net"] order 1:1. */}
        <StartMenu
          items={modelSelectItems}
          selectedIndex={modelSelectIndex}
          onSelectIndex={(i) => startControllerSession(i === 0 ? "slab" : "forge_net")}
          hint="D-pad/stick ↑↓ navigate · A/Enter select"
        />
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-[10px] text-gray-600 max-w-xs text-center">
          One chain per session. Press Start/U afterward to open the menu (new/restart session, switch model,
          export).
        </div>
      </div>
    );
  }

  const meshTag = viewSequence ? `${tag}/__sequence__` : displayedNodeId ? `${tag}/${displayedNodeId}` : null;

  return (
    <div className="relative h-full w-full">
      {meshTag ? (
        <MeshPanel
          key={`${run}::${meshTag}`}
          run={run}
          tag={meshTag}
          overlay={combinedOverlay}
          meshOpacity={billetOpacity}
          cameraState={cameraStateRef}
          externalOrbitRef={cameraOrbitRef}
        />
      ) : (
        <div className="h-full w-full flex items-center justify-center text-xs text-gray-500 bg-surface">
          Press A / Space to add the first strike
        </div>
      )}
      <ControllerHud
        gamepadConnected={gamepad.connected}
        fineModeActive={fineModeActive}
        flashMessage={flashMessage}
        playbackActive={playbackActive}
        rawGamepadDebug={rawGamepadDebug}
      />
      {menuOpen && <StartMenu items={menuItems} selectedIndex={menuIndex} />}
    </div>
  );
}
