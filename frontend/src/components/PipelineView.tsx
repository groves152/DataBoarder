import { useEffect, useMemo, useRef, useState } from "react";
import { Group, Panel, Separator, useDefaultLayout, useGroupRef } from "react-resizable-panels";
import { usePipelineStore, TARGETS_RUN, TARGETS_TAG_PREFIX } from "@/stores/pipelineStore";
import { GraphPanel } from "./GraphPanel";
import { NodeInspector } from "./NodeInspector";
import { MeshPanel, type CameraState } from "./MeshPanel";
import { PressPreview, type ToolDims } from "./PressPreview";
import { PathMenu } from "./PathMenu";
import { WorkspaceMenu } from "./WorkspaceMenu";
import { SequenceViewToggle } from "./SequenceViewToggle";
import { GoalOverlay } from "./GoalOverlay";
import { SequenceTrendPanel } from "./SequenceTrendPanel";
import { ViewportSidebar } from "./ViewportSidebar";

// Drag handle between two Panels in a Group -- headless library, no default
// styling (see react-resizable-panels' own docs: "Use the `data-separator`
// attribute for custom hover/active styles"). `data-[orientation=...]`
// selects horizontal (left/right split, drag left-right, resizes width) vs
// vertical (top/bottom split, drag up-down, resizes height) automatically
// from the attribute the library itself sets.
const SEPARATOR_CLASS =
  "shrink-0 bg-border hover:bg-accent/60 data-[state=dragging]:bg-accent transition-colors " +
  "data-[orientation=horizontal]:w-1 data-[orientation=horizontal]:cursor-col-resize " +
  "data-[orientation=vertical]:h-1 data-[orientation=vertical]:cursor-row-resize";

export function PipelineView() {
  const {
    run, tag, nodes, nodeKinds, setRun, setTag, selectedNodeId, cook, cooking, diagnostics, viewSequence,
    goalName, goalVisible, goalOpacity, billetOpacity, showPressPreview,
  } = usePipelineStore();
  // Whichever step MeshPanel is currently showing during sequence
  // playback -- reported one-way via its onFrameChange callback, drawn as
  // a playhead line in SequenceTrendPanel. Reset whenever sequence view
  // is (re-)entered so a stale line from a previous session doesn't show
  // before the first frame reports in.
  const [playbackStep, setPlaybackStep] = useState<number | null>(null);
  useEffect(() => {
    if (!viewSequence) setPlaybackStep(null);
  }, [viewSequence]);
  // Independent of viewSequence -- the trend panel is useful in BOTH
  // sequence playback AND single-node editing (it shows the selected
  // node's own position on the trend even with no playback happening),
  // so it's its own on/off toggle. Width is now drag-resizable (its own
  // Panel below) instead of a two-step "normal/expanded" toggle.
  const [showTrendPanel, setShowTrendPanel] = useState(true);
  // Lives here, NOT inside MeshPanel -- MeshPanel itself fully remounts
  // (fresh <Canvas>/camera/controls) every time `meshTag` changes below
  // (switching nodes, or toggling sequence view), but THIS component
  // doesn't remount just because the user clicked a different node, so a
  // ref here survives across those switches. Auto-fits once from the
  // first mesh it ever sees, then camera drag/pan/zoom state persists
  // across every subsequent node switch instead of resetting.
  const cameraStateRef = useRef<CameraState | null>(null);

  // Imperative handles for each drag-resizable Group, needed for
  // WorkspaceMenu's explicit JSON export/import (getLayout/setLayout) --
  // separate from the automatic localStorage persistence below, which
  // needs no ref at all.
  const outerGroupRef = useGroupRef();
  const meshRowGroupRef = useGroupRef();
  const graphRowGroupRef = useGroupRef();

  // "Panels have drag handles to resize on the fly" -- each Group also
  // auto-persists its own layout to localStorage (survives a page reload)
  // independent of WorkspaceMenu's explicit export/import file. `panelIds`
  // covers meshRow's conditionally-rendered "pv-trend" panel so a saved
  // layout from a session with the trend panel open still applies
  // correctly to one with it closed, and vice versa.
  const outerLayout = useDefaultLayout({ id: "pipeline-outer" });
  const meshRowLayout = useDefaultLayout({ id: "pipeline-mesh-row", panelIds: ["pv-sidebar", "pv-mesh", "pv-trend"] });
  const graphRowLayout = useDefaultLayout({ id: "pipeline-graph-row" });

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const selectedSchema = nodeKinds.find((k) => k.kind === selectedNode?.data.kind);
  const selectedDiag = selectedNodeId ? diagnostics[selectedNodeId] : undefined;

  // Only meaningful for node kinds that look like a strike (have z/phi/rho
  // + a tool select param) -- generic detection off the schema rather than
  // hardcoding "slab_strike" by name, so a future pullback_strike node
  // gets this for free too as long as it uses the same param names.
  const previewOverlay = useMemo(() => {
    // Tied to the SELECTED node's live slider values, not whichever frame
    // is currently playing -- showing it during sequence playback would be
    // visually misleading (a static press die pinned to one node while the
    // billet scrubs through many), so it's suppressed there.
    if (viewSequence || !showPressPreview || !selectedNode || !selectedSchema) return undefined;
    const p = selectedSchema.params;
    if (!p.z || !p.phi || !p.rho || !p.tool) return undefined;
    const toolName = String(selectedNode.data.params.tool ?? p.tool.default);
    const toolDims = p.tool.options_meta?.[toolName] as unknown as ToolDims | undefined;
    if (!toolDims) return undefined;

    // If the last cook reported this strike's gap was capped by the real
    // press's physical limit, snap the preview to the ACHIEVED gap instead
    // of the (impossible) requested one -- "far more clear where we will
    // actually do the strike" applies doubly once the request can't be met.
    // Only while the slider STILL sits at the rho that produced this
    // diagnostic, though -- otherwise a capped result from an earlier rho
    // value stays stuck forever, ignoring every rho change since (the die
    // preview silently stops tracking the slider until the next cook).
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

  // Kept visible in BOTH sequence-playback and single-node view (unlike
  // previewOverlay, which is selection-specific) -- a goal is a fixed
  // reference shape, meaningful to see regardless of which step/node is
  // currently shown.
  const goalOverlay = useMemo(() => {
    if (!goalVisible || !goalName) return undefined;
    return <GoalOverlay run={TARGETS_RUN} tag={`${TARGETS_TAG_PREFIX}${goalName}`} opacity={goalOpacity} />;
  }, [goalVisible, goalName, goalOpacity]);

  const combinedOverlay = useMemo(() => {
    if (!previewOverlay && !goalOverlay) return undefined;
    return <>{previewOverlay}{goalOverlay}</>;
  }, [previewOverlay, goalOverlay]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 h-10 border-b border-border bg-panel shrink-0 text-xs">
        <span className="font-semibold text-gray-400 uppercase tracking-wide mr-1">Pipeline</span>
        <span className="text-gray-500">run</span>
        <input
          value={run}
          onChange={(e) => setRun(e.target.value)}
          className="bg-surface border border-border rounded px-2 py-1 w-32 text-gray-200"
        />
        <span className="text-gray-500">tag</span>
        <input
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          className="bg-surface border border-border rounded px-2 py-1 w-32 text-gray-200"
        />
        <button
          onClick={() => cook()}
          disabled={cooking}
          className="ml-2 px-3 py-1 rounded bg-accent text-white text-xs font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {cooking ? "Cooking…" : "Cook"}
        </button>
        <PathMenu />
        <WorkspaceMenu
          outerGroupRef={outerGroupRef}
          meshRowGroupRef={meshRowGroupRef}
          graphRowGroupRef={graphRowGroupRef}
        />
        <SequenceViewToggle />
        <label className="flex items-center gap-1.5 ml-2 cursor-pointer select-none text-gray-400">
          <input
            type="checkbox"
            checked={showTrendPanel}
            onChange={(e) => setShowTrendPanel(e.target.checked)}
            className="accent-accent"
          />
          <span>Trend panel</span>
        </label>
        <span className="text-gray-500 ml-auto">
          Viewport shows whichever node is selected — click through a chain, or check "Sequence view" to scrub the
          whole cooked chain. Shift-drag or ctrl/cmd-click nodes to multi-select for export.
        </span>
      </div>

      <div className="flex-1 min-h-0">
        <Group
          orientation="vertical"
          id="pipeline-outer"
          groupRef={outerGroupRef}
          className="h-full w-full"
          defaultLayout={outerLayout.defaultLayout}
          onLayoutChanged={outerLayout.onLayoutChanged}
        >
          <Panel id="pv-mesh-row" defaultSize="50" minSize="20">
            <Group
              orientation="horizontal"
              id="pipeline-mesh-row"
              groupRef={meshRowGroupRef}
              className="h-full w-full"
              defaultLayout={meshRowLayout.defaultLayout}
              onLayoutChanged={meshRowLayout.onLayoutChanged}
            >
              <Panel id="pv-sidebar" defaultSize={224} minSize={160} maxSize={420} groupResizeBehavior="preserve-pixel-size">
                <ViewportSidebar />
              </Panel>
              <Separator className={SEPARATOR_CLASS} />
              <Panel id="pv-mesh" defaultSize="60" minSize="20">
                {(() => {
                  const meshTag = viewSequence ? `${tag}/__sequence__` : selectedNodeId ? `${tag}/${selectedNodeId}` : null;
                  if (!meshTag) {
                    return (
                      <div className="h-full w-full flex items-center justify-center text-xs text-gray-500">
                        Select a node to preview its cooked geometry (its own state, including every upstream hit applied so far).
                      </div>
                    );
                  }
                  // meshTag stays constant (`${tag}/__sequence__`) for the
                  // WHOLE duration of sequence playback, so this key does
                  // NOT change on every playback tick -- MeshPanel's own
                  // internal scrubber/play loop steps through the frames it
                  // already fetched, no remount/re-fetch per hit. Outside
                  // sequence view, meshTag still embeds selectedNodeId, so
                  // clicking a different node still remounts as before
                  // (each node has only ONE current mesh, no history, so a
                  // fresh mount per click is correct there, not the thing
                  // that was flashing).
                  return (
                    <MeshPanel
                      key={`${run}::${meshTag}`}
                      run={run}
                      tag={meshTag}
                      overlay={combinedOverlay}
                      onFrameChange={viewSequence ? setPlaybackStep : undefined}
                      meshOpacity={billetOpacity}
                      cameraState={cameraStateRef}
                    />
                  );
                })()}
              </Panel>
              {/* Independent of whether a node/sequence is currently shown
                  in the mesh viewport -- still useful as an overview with
                  nothing selected, and shows the selected node's own point
                  even when no playback is happening. */}
              {showTrendPanel && (
                <>
                  <Separator className={SEPARATOR_CLASS} />
                  <Panel id="pv-trend" defaultSize={416} minSize={240} maxSize={800} groupResizeBehavior="preserve-pixel-size">
                    <SequenceTrendPanel
                      playbackStep={playbackStep}
                      selectedNodeId={selectedNodeId}
                      onClose={() => setShowTrendPanel(false)}
                    />
                  </Panel>
                </>
              )}
            </Group>
          </Panel>

          <Separator className={SEPARATOR_CLASS} />

          <Panel id="pv-bottom" defaultSize="50" minSize="20">
            <Group
              orientation="horizontal"
              id="pipeline-graph-row"
              groupRef={graphRowGroupRef}
              className="h-full w-full"
              defaultLayout={graphRowLayout.defaultLayout}
              onLayoutChanged={graphRowLayout.onLayoutChanged}
            >
              <Panel id="pv-graph" defaultSize="75" minSize="30">
                <GraphPanel />
              </Panel>
              <Separator className={SEPARATOR_CLASS} />
              <Panel id="pv-inspector" defaultSize={288} minSize={220} maxSize={480} groupResizeBehavior="preserve-pixel-size">
                <NodeInspector />
              </Panel>
            </Group>
          </Panel>
        </Group>
      </div>
    </div>
  );
}
