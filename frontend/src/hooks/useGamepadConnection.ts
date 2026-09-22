import { useEffect, useState } from "react";

// Just connect/disconnect status -- changes rarely, fine to live in real
// React state (unlike per-frame axis/button values, which useControllerModeInput
// polls directly via navigator.getGamepads() every animation frame instead
// of routing through React state, since that would mean a 60Hz re-render
// of the whole tree for values nothing needs to react to directly).
export interface GamepadConnection {
  connected: boolean;
  index: number | null;
}

export function useGamepadConnection(): GamepadConnection {
  const [state, setState] = useState<GamepadConnection>(() => {
    // A gamepad already connected before this hook mounts (e.g. switching
    // back to this view) doesn't fire "gamepadconnected" again -- check
    // navigator.getGamepads() directly on init instead of only listening.
    const pads = navigator.getGamepads?.() ?? [];
    for (const pad of pads) {
      if (pad) return { connected: true, index: pad.index };
    }
    return { connected: false, index: null };
  });

  useEffect(() => {
    function onConnect(e: GamepadEvent) {
      setState({ connected: true, index: e.gamepad.index });
    }
    function onDisconnect(e: GamepadEvent) {
      setState((s) => (s.index === e.gamepad.index ? { connected: false, index: null } : s));
    }
    window.addEventListener("gamepadconnected", onConnect);
    window.addEventListener("gamepaddisconnected", onDisconnect);
    return () => {
      window.removeEventListener("gamepadconnected", onConnect);
      window.removeEventListener("gamepaddisconnected", onDisconnect);
    };
  }, []);

  return state;
}
