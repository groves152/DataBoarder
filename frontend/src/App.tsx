import { useState } from "react";
import { useWebSocket } from "@/hooks/useWebSocket";
import { Dashboard } from "@/components/Dashboard";
import { PipelineView } from "@/components/PipelineView";

type View = "dashboard" | "pipeline";

export default function App() {
  useWebSocket();
  const [view, setView] = useState<View>("dashboard");

  return (
    <div className="flex flex-col h-screen">
      <div className="flex items-center gap-1 px-3 h-8 border-b border-border bg-panel shrink-0 text-xs">
        {(["dashboard", "pipeline"] as View[]).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-2.5 py-1 rounded capitalize transition-colors ${
              view === v ? "bg-accent text-white" : "text-gray-400 hover:text-gray-200"
            }`}
          >
            {v}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0">
        {view === "dashboard" ? <Dashboard /> : <PipelineView />}
      </div>
    </div>
  );
}
