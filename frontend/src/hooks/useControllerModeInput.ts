import { useEffect, useMemo, useRef, useState } from "react";
import { usePipelineStore, PHI_SYMMETRY_PRESETS, type PhiSymmetry } from "@/stores/pipelineStore";
import { topologicalOrder } from "@/utils/graphOrder";
import { downloadJson } from "@/utils/pathJson";

// --- DualSense (DS5) controller profile ---
// Confirmed directly from a user's real DS5 via ControllerHud's own
// rawGamepadDebug readout -- Chrome (Linux) does NOT remap a DualSense's
// face buttons to the Standard Gamepad Layout's A/B/X/Y positions the way
// it does for an Xbox controller:
//   b0=X, b1=A, b2=B, b3=Y   (Standard layout would be b0=A, b1=B, b2=X, b3=Y)
//   b4=LB, b5=RB, b6=LT, b7=RT, b8=Back/Select, b9=Start, b10=L3, b11=R3
//     -- all of THESE match Standard; only the 4 face buttons are permuted.
//   The D-pad is NOT exposed as buttons[12..15] at all on this
//   controller/browser -- it's a single "hat switch" axis (axes[4])
//   encoding direction as one of several evenly-spaced values in [-1, 1]:
//   up=-1, right=-3/7≈-0.43, down=1/7≈0.14, left=5/7≈0.71 (confirmed by
//   the same readout; the 4 diagonal values are inferred from the same
//   8-way spacing, unconfirmed since nothing here uses them).
// A real Xbox controller may report differently (untested on real
// hardware) -- if/when that's confirmed, add a second profile object and
// pick between them (e.g. via gamepad.id) rather than overwriting this one.
const BTN_A = 1;
const BTN_X = 0;
const BTN_Y = 3;
const BTN_LB = 4;
const BTN_RB = 5;
const BTN_LT = 6;
const BTN_RT = 7;
const BTN_BACK = 8;
const BTN_START = 9;
const BTN_L3 = 10;
const BTN_R3 = 11;

const DPAD_HAT_AXIS = 4;
const DPAD_HAT_VALUES: Record<"up" | "right" | "down" | "left", number> = {
  up: -1, right: -3 / 7, down: 1 / 7, left: 5 / 7,
};
const DPAD_HAT_TOLERANCE = 0.08;

function readDpadHat(gp: Gamepad | null): "up" | "right" | "down" | "left" | null {
  const v = gp?.axes[DPAD_HAT_AXIS];
  if (v === undefined) return null;
  for (const dir of ["up", "right", "down", "left"] as const) {
    if (Math.abs(v - DPAD_HAT_VALUES[dir]) < DPAD_HAT_TOLERANCE) return dir;
  }
  return null;
}

// Left-stick-driven list navigation (axes 0/1 -- "a0/a1", explicitly
// asked for as an alternative to the D-pad for scrolling any menu).
// Digital/edge-triggered like a button, not continuous -- a stick held
// deflected must advance exactly one item per push, not free-scroll every
// frame it's held.
const MENU_STICK_THRESHOLD = 0.5;

function readMenuStickDir(gp: Gamepad | null): -1 | 0 | 1 {
  const y = gp?.axes[1] ?? 0;
  if (Math.abs(y) > MENU_STICK_THRESHOLD) return y < 0 ? -1 : 1;
  const x = gp?.axes[0] ?? 0;
  if (Math.abs(x) > MENU_STICK_THRESHOLD) return x < 0 ? -1 : 1;
  return 0;
}

const AXIS_DEAD_ZONE = 0.15;
const TRIGGER_THRESHOLD = 0.1;
// At full deflection (or a held key), a param sweeps this fraction of its
// whole [min,max] span per second -- fixed-rate, not proportional to how
// far a stick is pushed. Round-tripped once already (0.25 -> 0.08, "too
// sensitive" -> "too insensitive") -- 0.15 is a middle-ground guess, still
// expect to tune live. z/rho additionally get their OWN multiplier on top
// of this (explicitly asked to move faster than phi).
const BASE_RATE_FRACTION_PER_SEC = 0.15;
const Z_RHO_RATE_MULTIPLIER = 2.0;
const FINE_MODE_MULTIPLIER = 0.5;
const CAMERA_ORBIT_RATE_RAD_PER_SEC = 1.0;
// How often (in frames) the raw-input diagnostic readout updates -- every
// frame would be needlessly expensive (60 re-renders/sec) for a panel
// that's purely for figuring out a specific controller's real button/axis
// layout when it doesn't match the Standard Gamepad assumptions below.
const DEBUG_UPDATE_EVERY_N_FRAMES = 6;

// Index 3 ("Strike symmetry") and index 4 ("Stock opacity") are both live
// CYCLE-IN-PLACE items, not execute-and-close actions -- selecting either
// advances its value and the menu stays open so the updated label is
// visible immediately (see executeMenuSelection). Cycle order for symmetry
// is arbitrary (most- to least-constrained); "square" is the launch
// default (see startControllerSession in pipelineStore.ts). Opacity steps
// in fixed 25% increments and wraps; billetOpacity's own store default is
// 0.5, matching the "starting stock" default asked for directly (shared
// with the graph editor's own billet-opacity slider in ViewportSidebar --
// no separate controller-mode-only field).
const PHI_SYMMETRY_CYCLE: PhiSymmetry[] = ["square", "hex", "octagon", "free"];
const OPACITY_CYCLE = [0.25, 0.5, 0.75, 1.0];
const STRIKE_SYMMETRY_MENU_INDEX = 3;
const STOCK_OPACITY_MENU_INDEX = 4;
const MENU_ITEM_COUNT = 6; // New session, Restart session, Select model, Strike symmetry, Stock opacity, Export

const MODEL_SELECT_ITEMS = ["Slab", "Forge-Net"] as const;
const MODEL_SELECT_KINDS = ["slab", "forge_net"] as const; // matches ControllerModelKind's non-null variants

// Reads one continuous control axis, gamepad OR keyboard, as a direction
// in [-1, 1] -- `negateGamepad` flips the raw axis reading (the left
// stick's Y axis reports -1 for "up" per the Standard Gamepad spec; this
// hook's own convention is "up / posKey = increase", so the Y-axis call
// site negates it to match rather than leaving a keyboard key and
// stick-up disagreeing).
function readAxisDirection(
  gp: Gamepad | null, axisIndex: number, negateGamepad: boolean, negKey: string, posKey: string, heldKeys: Set<string>,
): number {
  const raw = gp?.axes[axisIndex] ?? 0;
  if (Math.abs(raw) > AXIS_DEAD_ZONE) return negateGamepad ? -raw : raw;
  let v = 0;
  if (heldKeys.has(negKey)) v -= 1;
  if (heldKeys.has(posKey)) v += 1;
  return v;
}

function justPressed(gp: Gamepad | null, buttonIndex: number, prevPressed: Map<number, boolean>): boolean {
  if (!gp) return false;
  const isPressed = gp.buttons[buttonIndex]?.pressed ?? false;
  const was = prevPressed.get(buttonIndex) ?? false;
  prevPressed.set(buttonIndex, isPressed);
  return isPressed && !was;
}

export interface ControllerModeStatus {
  fineModeActive: boolean;
  // Transient confirmation text ("Node committed" / "Chain recooked") --
  // both fire the literal same cook() server-side (there's no partial-cook
  // endpoint); this is purely which HUD message flashes, not a real
  // difference in what happens. Auto-clears after ~1.5s.
  flashMessage: string | null;
  playbackActive: boolean;
  menuOpen: boolean;
  menuItems: readonly string[];
  menuIndex: number;
  // Model-select-screen navigation state -- active whenever
  // controllerModelKind is null, i.e. before/between sessions. Exposed so
  // ControllerModeView can render it (reusing StartMenu) instead of a
  // mouse-only button pair, which had no controller/keyboard path at all.
  modelSelectItems: readonly string[];
  modelSelectIndex: number;
  // Right-stick camera orbit deltas for THIS frame -- pass straight into
  // MeshPanel's `externalOrbitRef` prop. The hook overwrites it every
  // frame; MeshPanel applies whatever's currently there once per R3F
  // frame. Not React state -- would re-render on every stick tick for no
  // reason, and nothing needs to react to it directly.
  cameraOrbitRef: React.MutableRefObject<{ dAzimuth: number; dPolar: number }>;
  // Raw button/axis values straight from the Gamepad object, refreshed a
  // few times a second -- NOT used by any control logic, purely a
  // diagnostic readout so a controller that doesn't match this hook's
  // Standard Gamepad index assumptions (gamepad.mapping !== "standard",
  // a real risk on some Linux/browser/controller combos -- flagged as
  // unverifiable without physical hardware when this was first built) can
  // be identified by watching which index lights up as each physical
  // button/stick is pressed.
  rawGamepadDebug: { mapping: string; buttons: number[]; axes: number[] } | null;
}

// Owns the whole controller-mode input loop: a requestAnimationFrame poll
// (Gamepad API has no per-button press/release events, only
// gamepadconnected/disconnected for the device as a whole -- reading
// current state every frame and diffing against last frame is the only
// way to detect "just pressed" for one-shot actions) plus keyboard
// held-key tracking for the continuous axes. Every action reads/writes
// usePipelineStore.getState() directly (imperative, not a hook
// subscription -- this loop runs outside React's render cycle); nothing
// about WHICH model is active needs to be passed in as a prop anymore --
// controllerModelKind lives in the store itself (see pipelineStore.ts),
// so a chain built via the controller survives switching to the
// "pipeline" tab and back, and this hook can always read it fresh.
//
// Always runs while the caller keeps it mounted -- no separate `enabled`
// flag anymore. It used to be gated on controllerModelKind !== null,
// which meant the WHOLE input loop (including the model-select screen's
// own navigation) was dead until a model had already been picked with the
// mouse -- exactly why that screen had no controller/keyboard support at
// all. Model-select is now just another branch of the same tick loop,
// active whenever controllerModelKind is null.
export function useControllerModeInput(gamepadIndex: number | null): ControllerModeStatus {
  const [fineModeActive, setFineModeActiveState] = useState(false);
  const [flashMessage, setFlashMessage] = useState<string | null>(null);
  const [playbackActive, setPlaybackActiveState] = useState(false);
  const [menuOpen, setMenuOpenState] = useState(false);
  const [menuIndex, setMenuIndexState] = useState(0);
  const [modelSelectIndex, setModelSelectIndexState] = useState(0);
  const [rawGamepadDebug, setRawGamepadDebug] = useState<ControllerModeStatus["rawGamepadDebug"]>(null);
  // Reactive (not getState()) on purpose -- this hook already returns
  // React state elsewhere for the HUD to render, and the menu's own
  // "Strike symmetry" label needs to re-render when it changes, whether
  // that change came from IN the menu (cycleSymmetry below) or from the
  // graph editor's own ViewportSidebar toggle.
  const phiSymmetry = usePipelineStore((s) => s.phiSymmetry);
  const billetOpacity = usePipelineStore((s) => s.billetOpacity);
  const menuItems = useMemo(
    () => [
      "New session", "Restart session", "Select model",
      `Strike symmetry: ${PHI_SYMMETRY_PRESETS[phiSymmetry].label}`,
      `Stock opacity: ${Math.round(billetOpacity * 100)}%`,
      "Export session to JSON",
    ],
    [phiSymmetry, billetOpacity],
  );

  const heldKeysRef = useRef<Set<string>>(new Set());
  const prevPressedRef = useRef<Map<number, boolean>>(new Map());
  const lastFrameTimeRef = useRef<number | null>(null);
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fineModeToggleRef = useRef(false); // L3-toggled persistent state
  const menuOpenRef = useRef(false);
  const menuIndexRef = useRef(0);
  const modelSelectIndexRef = useRef(0);
  const cameraOrbitRef = useRef({ dAzimuth: 0, dPolar: 0 });
  const prevDpadDirRef = useRef<"up" | "right" | "down" | "left" | null>(null);
  const prevMenuStickDirRef = useRef<-1 | 0 | 1>(0); // edge-detection for stick-driven menu nav
  const debugFrameCounterRef = useRef(0);

  function flash(message: string) {
    setFlashMessage(message);
    if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
    flashTimeoutRef.current = setTimeout(() => setFlashMessage(null), 1500);
  }

  function moveModelSelect(direction: 1 | -1) {
    const next = (modelSelectIndexRef.current + direction + MODEL_SELECT_ITEMS.length) % MODEL_SELECT_ITEMS.length;
    modelSelectIndexRef.current = next;
    setModelSelectIndexState(next);
  }

  function confirmModelSelect() {
    usePipelineStore.getState().startControllerSession(MODEL_SELECT_KINDS[modelSelectIndexRef.current]);
  }

  function setMenuOpen(open: boolean) {
    menuOpenRef.current = open;
    setMenuOpenState(open);
    if (open) {
      menuIndexRef.current = 0;
      setMenuIndexState(0);
    }
  }

  function moveMenuSelection(direction: 1 | -1) {
    const next = (menuIndexRef.current + direction + MENU_ITEM_COUNT) % MENU_ITEM_COUNT;
    menuIndexRef.current = next;
    setMenuIndexState(next);
  }

  function cycleSymmetry() {
    const { phiSymmetry: current, setPhiSymmetry } = usePipelineStore.getState();
    const idx = PHI_SYMMETRY_CYCLE.indexOf(current);
    setPhiSymmetry(PHI_SYMMETRY_CYCLE[(idx + 1) % PHI_SYMMETRY_CYCLE.length]);
  }

  function cycleOpacity() {
    const { billetOpacity: current, setBilletOpacity } = usePipelineStore.getState();
    // Nearest cycle entry, not indexOf -- billetOpacity can be a value the
    // cycle itself never lands on (e.g. left over from the graph editor's
    // own free-form opacity slider), so this always advances sanely
    // instead of silently no-op'ing on an exact-match miss.
    let closestIdx = 0;
    let closestDiff = Infinity;
    OPACITY_CYCLE.forEach((v, i) => {
      const diff = Math.abs(v - current);
      if (diff < closestDiff) { closestDiff = diff; closestIdx = i; }
    });
    setBilletOpacity(OPACITY_CYCLE[(closestIdx + 1) % OPACITY_CYCLE.length]);
  }

  function executeMenuSelection() {
    const s = usePipelineStore.getState();
    switch (menuIndexRef.current) {
      case 0: // New session
      case 2: // Select model -- same action, "restarts session for now that's okay"
        s.returnToControllerModelSelect();
        setMenuOpen(false);
        break;
      case 1: // Restart session -- same model, purge cache, fresh chain
        if (s.controllerModelKind) s.startControllerSession(s.controllerModelKind);
        setMenuOpen(false);
        break;
      case STRIKE_SYMMETRY_MENU_INDEX:
      case STOCK_OPACITY_MENU_INDEX:
        // Cycle-in-place -- stays open so the updated label is visible
        // immediately, unlike every other item here which executes once
        // and closes.
        if (menuIndexRef.current === STRIKE_SYMMETRY_MENU_INDEX) cycleSymmetry();
        else cycleOpacity();
        break;
      case 5: { // Export session to JSON
        const path = s.exportPath();
        if (path) downloadJson(path, `${s.tag || "controller_session"}.json`);
        setMenuOpen(false);
        break;
      }
    }
  }

  function cycleSelection(direction: 1 | -1) {
    const { nodes, edges, selectedNodeId, selectNode } = usePipelineStore.getState();
    const order = topologicalOrder(nodes, edges);
    if (!order || order.length === 0) return;
    const currentIdx = selectedNodeId ? order.indexOf(selectedNodeId) : -1;
    const nextIdx = currentIdx < 0 ? 0 : (currentIdx + direction + order.length) % order.length;
    selectNode(order[nextIdx]);
  }

  function cycleGoal(direction: 1 | -1) {
    const { availableGoals, goalName, setGoalName, setGoalVisible } = usePipelineStore.getState();
    if (availableGoals.length === 0) return;
    const currentIdx = goalName ? availableGoals.indexOf(goalName) : -1;
    const nextIdx = (currentIdx + direction + availableGoals.length) % availableGoals.length;
    setGoalName(availableGoals[nextIdx]);
    setGoalVisible(true);
  }

  // Phi is a discrete "step to next angle" control (LB=prev/RB=next),
  // not a continuous slider -- moved off the left stick entirely (was
  // colliding with wanting that axis free, and a stick sweep didn't make
  // sense once symmetry presets were already discrete-stepping it).
  // Inherits the SAME angle set as the graph editor's global phi-symmetry
  // toggle (ViewportSidebar/NodeInspector, see PHI_SYMMETRY_PRESETS in
  // pipelineStore.ts) whenever it's not "free" -- e.g. square symmetry
  // means just 2 real choices, so a press JUMPS between them. In "free"
  // mode there's no preset list to jump between, so it steps by a fixed
  // increment instead, wrapping around a full turn.
  const PHI_FREE_STEP_RAD = (15 * Math.PI) / 180;
  function stepPhi(direction: 1 | -1) {
    const { nodes, nodeKinds, selectedNodeId, phiSymmetry, updateNodeParam } = usePipelineStore.getState();
    const node = nodes.find((n) => n.id === selectedNodeId);
    // The selected node might be a stock node (or any kind without a phi
    // param at all) -- e.g. right after starting a session, before any
    // strike is added yet, the stock node is what's selected. Without
    // this check, updateNodeParam would inject a "phi" key into a node
    // whose kind doesn't have one, and the next cook() would crash server
    // -side (slab_stock_handler() got an unexpected keyword argument
    // 'phi') -- confirmed this exact traceback directly.
    const schema = node && nodeKinds.find((k) => k.kind === node.data.kind)?.params;
    if (!node || !schema?.phi) return;
    const current = Number(node.data.params.phi ?? 0);
    const anglesDeg = PHI_SYMMETRY_PRESETS[phiSymmetry].anglesDeg;
    if (anglesDeg && anglesDeg.length > 1) {
      const anglesRad = anglesDeg.map((d) => (d * Math.PI) / 180);
      let closestIdx = 0;
      let closestDiff = Infinity;
      anglesRad.forEach((a, i) => {
        const diff = Math.abs(a - current);
        if (diff < closestDiff) { closestDiff = diff; closestIdx = i; }
      });
      const nextIdx = (closestIdx + direction + anglesRad.length) % anglesRad.length;
      updateNodeParam(node.id, "phi", anglesRad[nextIdx]);
    } else {
      const min = schema.phi.min ?? 0;
      const max = schema.phi.max ?? 2 * Math.PI;
      const span = max - min;
      const next = min + (((current - min + direction * PHI_FREE_STEP_RAD) % span) + span) % span;
      updateNodeParam(node.id, "phi", next);
    }
  }

  function addStrike() {
    const { controllerModelKind, addNode } = usePipelineStore.getState();
    if (controllerModelKind) addNode(`${controllerModelKind}_strike`);
  }

  // The combined "A" action: commit the strike currently being worked on
  // (an immediate, non-debounced cook -- unlike the continuous z/rho/phi
  // updates above, which only ever schedule the debounced auto-cook), then
  // -- once that succeeds -- append a fresh strike right after it and
  // select that one, so the user is immediately working on the next hit.
  // Skips the auto-add on a failed cook (checked via cookError straight
  // after awaiting, since cook() itself never rejects/throws on a server-
  // side failure) so a bad commit doesn't silently pile a new node on top
  // of it.
  async function commitAndAdvance() {
    const { controllerModelKind, cook } = usePipelineStore.getState();
    await cook();
    if (usePipelineStore.getState().cookError) return;
    flash("Node committed");
    if (controllerModelKind) addStrike();
  }

  // Back/Backspace: "undo" the strike currently being worked on -- deletes
  // it and re-selects whatever it was chained onto, so pairing this with
  // A's commitAndAdvance gives a natural add/commit-or-undo loop. No-op on
  // the root stock node (nothing upstream of it to fall back to).
  function undoNode() {
    const { edges, selectedNodeId, deleteNode, selectNode } = usePipelineStore.getState();
    if (!selectedNodeId) return;
    const parentEdge = edges.find((e) => e.target === selectedNodeId);
    if (!parentEdge) return;
    deleteNode(selectedNodeId);
    selectNode(parentEdge.source);
  }

  function commit() {
    usePipelineStore.getState().cook();
    flash("Node committed");
  }

  function recook() {
    usePipelineStore.getState().cook();
    flash("Chain recooked");
  }

  function togglePlayback() {
    const { viewSequence, setViewSequence } = usePipelineStore.getState();
    setViewSequence(!viewSequence);
    setPlaybackActiveState(!viewSequence);
  }

  function togglePressPreview() {
    const { showPressPreview, setShowPressPreview } = usePipelineStore.getState();
    setShowPressPreview(!showPressPreview);
  }

  // Keyboard: continuous axes go into heldKeysRef for the rAF loop to
  // read; one-shot actions dispatch directly here on keydown (guarded
  // against OS auto-repeat via e.repeat), matching GraphPanel.tsx's own
  // typing-guard pattern defensively even though this view has no text
  // inputs of its own.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;

      const key = e.key.toLowerCase();
      if (["a", "d", "w", "s"].includes(key)) {
        heldKeysRef.current.add(key);
      }
      if (e.key === "Shift") heldKeysRef.current.add("shift");

      if (e.repeat) return;

      if (usePipelineStore.getState().controllerModelKind === null) {
        if (e.key === "ArrowUp") { e.preventDefault(); moveModelSelect(-1); }
        else if (e.key === "ArrowDown") { e.preventDefault(); moveModelSelect(1); }
        else if (e.key === "Enter") { confirmModelSelect(); }
        return;
      }

      if (menuOpenRef.current) {
        if (e.key === "ArrowUp") { e.preventDefault(); moveMenuSelection(-1); }
        else if (e.key === "ArrowDown") { e.preventDefault(); moveMenuSelection(1); }
        else if (e.key === "Enter") { executeMenuSelection(); }
        else if (e.key === "Escape") { setMenuOpen(false); }
        return;
      }

      if (key === "u") {
        setMenuOpen(true);
      } else if (e.key === " ") {
        e.preventDefault();
        commitAndAdvance();
      } else if (key === "p") {
        togglePressPreview();
      } else if (key === "q") {
        stepPhi(-1);
      } else if (key === "e") {
        stepPhi(1);
      } else if (e.key === "Tab") {
        e.preventDefault();
        cycleSelection(e.shiftKey ? -1 : 1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        cycleGoal(-1);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        cycleGoal(1);
      } else if (e.key === "Backspace" || e.key === "Delete") {
        undoNode();
      } else if (e.key === "Enter") {
        if (e.shiftKey) recook(); else commit();
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      const key = e.key.toLowerCase();
      heldKeysRef.current.delete(key);
      if (e.key === "Shift") heldKeysRef.current.delete("shift");
    }
    function onBlur() {
      // A held key's keyup can be missed entirely (e.g. alt-tabbing away
      // while holding it) -- clear on window blur so it doesn't get stuck
      // "held" forever.
      heldKeysRef.current.clear();
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      heldKeysRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Gamepad + continuous-param/camera application: the actual per-frame loop.
  useEffect(() => {
    let rafId: number;

    function tick(timestamp: number) {
      rafId = requestAnimationFrame(tick);

      const gp = gamepadIndex != null ? navigator.getGamepads()[gamepadIndex] ?? null : null;
      const dtSec = lastFrameTimeRef.current == null ? 0 : (timestamp - lastFrameTimeRef.current) / 1000;
      lastFrameTimeRef.current = timestamp;

      // Edge-detect EVERY tracked button unconditionally, every frame,
      // regardless of menu state -- if this were skipped while the menu
      // is open, a button held DURING that time would read as "stale
      // not-pressed" in prevPressed, so releasing it only after the menu
      // closes (or just having it still held right as the menu closes)
      // would misfire as a fresh press on the very next tick. Computing
      // all the edges first, then branching on what to DISPATCH, keeps
      // press-tracking accurate no matter what the menu is doing.
      const pressedStart = justPressed(gp, BTN_START, prevPressedRef.current);
      const pressedX = justPressed(gp, BTN_X, prevPressedRef.current);
      const pressedY = justPressed(gp, BTN_Y, prevPressedRef.current);
      const pressedBack = justPressed(gp, BTN_BACK, prevPressedRef.current);
      const pressedA = justPressed(gp, BTN_A, prevPressedRef.current);
      const pressedL3 = justPressed(gp, BTN_L3, prevPressedRef.current);
      const pressedR3 = justPressed(gp, BTN_R3, prevPressedRef.current);
      const pressedLB = justPressed(gp, BTN_LB, prevPressedRef.current);
      const pressedRB = justPressed(gp, BTN_RB, prevPressedRef.current);

      // D-pad is a single hat-switch axis on this profile, not 4 separate
      // buttons -- same "compute the edge unconditionally every frame"
      // reasoning as justPressed above, just against a direction string
      // instead of a button index (only one direction can be active at a
      // time, so tracking just the previous direction is enough).
      const dpadDir = readDpadHat(gp);
      const pressedDpadUp = dpadDir === "up" && prevDpadDirRef.current !== "up";
      const pressedDpadDown = dpadDir === "down" && prevDpadDirRef.current !== "down";
      const pressedDpadLeft = dpadDir === "left" && prevDpadDirRef.current !== "left";
      const pressedDpadRight = dpadDir === "right" && prevDpadDirRef.current !== "right";
      prevDpadDirRef.current = dpadDir;

      // Left-stick list navigation (a0/a1) -- explicitly asked for
      // alongside the D-pad for scrolling any menu. Same edge-detection
      // idea as the D-pad hat above.
      const menuStickDir = readMenuStickDir(gp);
      const navUp = pressedDpadUp || (menuStickDir === -1 && prevMenuStickDirRef.current !== -1);
      const navDown = pressedDpadDown || (menuStickDir === 1 && prevMenuStickDirRef.current !== 1);
      prevMenuStickDirRef.current = menuStickDir;

      // Raw diagnostic readout -- throttled, purely informational (see
      // ControllerModeStatus.rawGamepadDebug's docstring). Runs
      // unconditionally (before any branch/return below) so it's already
      // working on the model-select screen, not just once a session has
      // started.
      debugFrameCounterRef.current++;
      if (gp && debugFrameCounterRef.current % DEBUG_UPDATE_EVERY_N_FRAMES === 0) {
        setRawGamepadDebug({
          mapping: gp.mapping || "(non-standard)",
          buttons: gp.buttons.map((b) => Math.round(b.value * 100) / 100),
          axes: gp.axes.map((a) => Math.round(a * 100) / 100),
        });
      } else if (!gp) {
        setRawGamepadDebug((prev) => (prev === null ? prev : null));
      }

      // Model-select screen navigation -- active until a session has
      // actually started (controllerModelKind still null). Nothing below
      // this (menu, gameplay) applies yet.
      if (usePipelineStore.getState().controllerModelKind === null) {
        if (navUp) moveModelSelect(-1);
        if (navDown) moveModelSelect(1);
        if (pressedA) confirmModelSelect();
        return;
      }

      // Menu navigation/dispatch takes over entirely while open -- normal
      // gameplay bindings below are skipped so an accidental stick nudge
      // or button press doesn't leak through to whatever's behind the menu.
      if (menuOpenRef.current) {
        if (navUp) moveMenuSelection(-1);
        if (navDown) moveMenuSelection(1);
        if (pressedA) executeMenuSelection();
        if (pressedBack || pressedStart) setMenuOpen(false);
        return;
      }

      const fineMode = fineModeToggleRef.current || heldKeysRef.current.has("shift");
      setFineModeActiveState((prev) => (prev === fineMode ? prev : fineMode));

      if (pressedStart) setMenuOpen(true);
      // A = commit the strike being worked on AND append/select the next
      // one in a single press (see commitAndAdvance); X is still a plain
      // commit with no auto-add, for "recook without spawning another
      // strike". Back = undo (delete the in-progress strike, fall back to
      // the previous one).
      if (pressedA) commitAndAdvance();
      if (pressedX) commit();
      if (pressedY) togglePressPreview();
      if (pressedDpadLeft) cycleSelection(-1);
      if (pressedDpadRight) cycleSelection(1);
      if (pressedDpadUp) cycleGoal(-1);
      if (pressedDpadDown) cycleGoal(1);
      if (pressedBack) undoNode();
      if (pressedL3) fineModeToggleRef.current = !fineModeToggleRef.current;
      if (pressedR3) togglePlayback();
      if (pressedLB) stepPhi(-1);
      if (pressedRB) stepPhi(1);

      if (dtSec > 0) {
        // Camera orbit -- right stick, always active regardless of
        // selection (nothing to clamp against, no param involved).
        const camX = gp?.axes[2] ?? 0;
        const camY = gp?.axes[3] ?? 0;
        const dAzimuth = Math.abs(camX) > AXIS_DEAD_ZONE ? camX * CAMERA_ORBIT_RATE_RAD_PER_SEC * dtSec : 0;
        const dPolar = Math.abs(camY) > AXIS_DEAD_ZONE ? camY * CAMERA_ORBIT_RATE_RAD_PER_SEC * dtSec : 0;
        cameraOrbitRef.current = { dAzimuth, dPolar };

        // Continuous translation/depth/angle -- only meaningful once a
        // node is selected, since there's nothing to apply a delta to
        // otherwise. Depth reads RT (increase) / LT (decrease) as
        // digital thresholds -- both are analog buttons but this control
        // is fixed-rate like everything else, not proportional to how
        // far they're pressed.
        const { nodes, nodeKinds, selectedNodeId, updateNodeParam } = usePipelineStore.getState();
        const node = nodes.find((n) => n.id === selectedNodeId);
        const schema = node && nodeKinds.find((k) => k.kind === node.data.kind)?.params;
        if (node && schema) {
          const rateFrac = BASE_RATE_FRACTION_PER_SEC * (fineMode ? FINE_MODE_MULTIPLIER : 1) * dtSec;
          const rtVal = gp?.buttons[BTN_RT]?.value ?? 0;
          const ltVal = gp?.buttons[BTN_LT]?.value ?? 0;
          const rhoDir = (rtVal > TRIGGER_THRESHOLD ? 1 : 0) - (ltVal > TRIGGER_THRESHOLD ? 1 : 0);
          const zDir = readAxisDirection(gp, 0, false, "a", "d", heldKeysRef.current);

          for (const [paramName, dir] of [["z", zDir], ["rho", rhoDir]] as const) {
            if (dir === 0) continue;
            const spec = schema[paramName];
            if (!spec || spec.min === undefined || spec.max === undefined) continue;
            const span = spec.max - spec.min;
            const current = Number(node.data.params[paramName] ?? spec.default);
            const next = Math.min(spec.max, Math.max(spec.min, current + dir * rateFrac * Z_RHO_RATE_MULTIPLIER * span));
            // autoCook defaults to true -- schedules the SAME debounced
            // cook the mouse-driven graph editor uses on every slider
            // drag (a fresh call just keeps deferring it while input is
            // still moving, see scheduleAutoCook), rather than requiring
            // an explicit Commit before anything ever re-cooks.
            updateNodeParam(node.id, paramName, next);
          }
        }
      }
    }

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
      lastFrameTimeRef.current = null;
      prevPressedRef.current.clear();
      cameraOrbitRef.current = { dAzimuth: 0, dPolar: 0 };
      prevDpadDirRef.current = null;
      prevMenuStickDirRef.current = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gamepadIndex]);

  return {
    fineModeActive, flashMessage, playbackActive, menuOpen, menuItems, menuIndex,
    modelSelectItems: MODEL_SELECT_ITEMS, modelSelectIndex, cameraOrbitRef, rawGamepadDebug,
  };
}
