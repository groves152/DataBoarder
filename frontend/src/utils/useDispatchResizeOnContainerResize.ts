import { useEffect, type RefObject } from "react";

// react-plotly.js's `useResizeHandler` prop only listens for WINDOW
// 'resize' events (see node_modules/react-plotly.js/factory.js:208-213,
// `Plotly.Plots.resize(this.el)` fired from a `window.addEventListener
// ('resize', ...)`). Now that Plotly-bearing panels live inside
// react-resizable-panels' drag-resizable `<Panel>`s, their container can
// change size without the WINDOW ever resizing, so Plotly never
// re-measures. Rather than reaching into react-plotly.js's internals (no
// public API exposes its Plotly module instance to call
// `Plotly.Plots.resize` directly), this dispatches a real synthetic
// `resize` event whenever the container's own size changes -- which
// react-plotly.js's own already-enabled handler then picks up exactly as
// if the window itself had resized. rAF-throttled since a drag can fire
// many ResizeObserver callbacks per second.
export function useDispatchResizeOnContainerResize(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let rafId: number | null = null;
    const observer = new ResizeObserver(() => {
      if (rafId != null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        window.dispatchEvent(new Event("resize"));
      });
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, [ref]);
}
