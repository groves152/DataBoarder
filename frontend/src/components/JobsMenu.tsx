import { useEffect, useRef, useState } from "react";
import { usePipelineStore } from "@/stores/pipelineStore";
import { toast } from "@/stores/toastStore";

// "Jobs" in the pipeline top bar: the server's background jobs (sequence
// searches, optimizer runs; GET /api/jobs) plus the graph's own cook, with
// progress and Stop. A job finishing (or failing) while the page is open
// raises a notice.
interface JobSummary {
  kind: string;
  job_id: string;
  state: string;
  phase?: string | null;
  method?: string;
  strategy?: string;
  goal?: string;
  iteration?: number;
  iterations?: number;
  best_loss?: number | null;
  started_at?: number;
  ended_at?: number;
  error?: string;
  progress_label?: string; // what best_loss measures, e.g. "best loss, mm"
}

const TERMINAL = ["done", "stopped", "error"];
const KIND_LABEL: Record<string, string> = { search: "Sequence search", optimize: "Optimize", plan: "Plan" };

const label = (j: JobSummary) =>
  `${KIND_LABEL[j.kind] ?? j.kind}${j.method ? ` · ${j.method.replace(/_/g, " ")}` : j.strategy ? ` · ${j.strategy}` : ""}` +
  `${j.goal ? ` → ${j.goal}` : ""}`;

const best = (j: JobSummary) => `${j.progress_label ?? "best"} ${j.best_loss!.toFixed(2)}`;

function elapsed(j: JobSummary): string {
  if (!j.started_at) return "";
  const s = Math.max(0, (j.ended_at ?? Date.now() / 1000) - j.started_at);
  return s < 90 ? `${s.toFixed(0)} s` : `${(s / 60).toFixed(1)} min`;
}

export function JobsMenu() {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [open, setOpen] = useState(false);
  const cooking = usePipelineStore((s) => s.cooking);
  const seenRunning = useRef(new Set<string>());
  const menuRef = useRef<HTMLDivElement>(null);
  const running = jobs.filter((j) => !TERMINAL.includes(j.state));
  const openRef = useRef(open);
  openRef.current = open;

  // Poll: quickly while something runs or the list is open, slowly otherwise.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      let next: JobSummary[] = [];
      try {
        const res = await fetch("/api/jobs");
        if (res.ok) next = (await res.json()).jobs ?? [];
      } catch { /* server away: try again later */ }
      if (!alive) return;
      for (const j of next) {
        const key = `${j.kind}:${j.job_id}`;
        if (!TERMINAL.includes(j.state)) seenRunning.current.add(key);
        else if (seenRunning.current.delete(key)) {
          toast(j.state === "error"
            ? { text: `${label(j)} failed: ${j.error ?? "error"}`, tone: "error" }
            : { text: `${label(j)} ${j.state === "done" ? "finished" : "stopped"}` +
                      (typeof j.best_loss === "number" ? ` · ${best(j)}` : ""), tone: "success" });
        }
      }
      setJobs(next);
      const busy = next.some((j) => !TERMINAL.includes(j.state));
      timer = setTimeout(poll, busy || openRef.current ? 2000 : 8000);
    };
    void poll();
    return () => { alive = false; clearTimeout(timer); };
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const busy = running.length + (cooking ? 1 : 0);
  return (
    <div className="relative" ref={menuRef}>
      <button onClick={() => setOpen((o) => !o)}
              className="flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-surface border border-border text-gray-300 hover:border-accent hover:text-gray-100 transition-colors">
        {busy > 0 && <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />}
        Jobs{busy > 0 ? ` (${busy})` : ""} ▾
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-1 w-96 max-h-96 overflow-y-auto rounded-md border border-border bg-panel shadow-xl py-1 text-xs">
          {cooking && (
            <div className="px-3 py-2 border-b border-border text-gray-300 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-accent animate-pulse" /> Cooking the graph…
            </div>
          )}
          {jobs.length === 0 && !cooking && <div className="px-3 py-2 text-gray-500">No jobs yet.</div>}
          {jobs.map((j) => {
            const live = !TERMINAL.includes(j.state);
            const frac = j.iterations ? Math.min(1, (j.iteration ?? 0) / j.iterations) : null;
            return (
              <div key={`${j.kind}:${j.job_id}`} className="px-3 py-2 border-b border-border last:border-0">
                <div className="flex items-center gap-2">
                  <span className="text-gray-100 truncate flex-1" title={label(j)}>{label(j)}</span>
                  <span className={`shrink-0 ${j.state === "error" ? "text-red-400" : live ? "text-accent" : "text-gray-500"}`}>
                    {j.state}
                  </span>
                  {live && (
                    <button onClick={() => void fetch(`/api/${j.kind}/stop`, { method: "POST" })}
                            className="shrink-0 px-1.5 rounded bg-red-600 text-white">Stop</button>
                  )}
                </div>
                {live && frac !== null && (
                  <div className="mt-1 h-1 rounded bg-surface overflow-hidden">
                    <div className="h-full bg-accent" style={{ width: `${100 * frac}%` }} />
                  </div>
                )}
                <div className="mt-0.5 text-[10px] text-gray-500 truncate" title={j.error ?? j.phase ?? ""}>
                  {elapsed(j)}
                  {typeof j.best_loss === "number" ? ` · ${best(j)}` : ""}
                  {j.state === "error" && j.error ? ` · ${j.error}` : live && j.phase ? ` · ${j.phase}` : ""}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
