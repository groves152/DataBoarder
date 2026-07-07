import { create } from "zustand";
import type { TagEntry, WsMessage } from "@/types";

interface DataStore {
  runs: string[];
  activeRun: string;
  entries: Record<string, Record<string, TagEntry[]>>; // run → tag → entries
  enabledTags: Record<string, string[]>;

  setRuns: (runs: string[]) => void;
  setActiveRun: (run: string) => void;
  appendEntry: (msg: WsMessage) => void;
  setTagEntries: (run: string, tag: string, entries: TagEntry[]) => void;
  toggleTag: (run: string, tag: string) => void;
  refreshRun: (run: string) => void;
}

export const useDataStore = create<DataStore>((set, get) => ({
  runs: [],
  activeRun: "default",
  entries: {},
  enabledTags: {},

  setRuns: (runs) =>
    set((s) => ({
      runs,
      activeRun: runs.includes(s.activeRun) ? s.activeRun : (runs[0] ?? "default"),
    })),

  setActiveRun: (run) => set({ activeRun: run }),

  appendEntry: (msg) =>
    set((s) => {
      const isNewRun = !s.runs.includes(msg.run);
      const newRuns = isNewRun ? [...s.runs, msg.run] : s.runs;

      // Auto-switch from the placeholder "default" to the first real run that arrives
      const newActiveRun =
        s.activeRun === "default" && !s.runs.includes("default") && isNewRun
          ? msg.run
          : s.activeRun;

      const runEntries = s.entries[msg.run] ?? {};
      const tagEntries = runEntries[msg.tag] ?? [];
      return {
        runs: newRuns,
        activeRun: newActiveRun,
        entries: {
          ...s.entries,
          [msg.run]: {
            ...runEntries,
            [msg.tag]: [...tagEntries, { type: msg.type, data: msg.data } as TagEntry],
          },
        },
      };
    }),

  setTagEntries: (run, tag, entries) =>
    set((s) => ({
      entries: {
        ...s.entries,
        [run]: { ...(s.entries[run] ?? {}), [tag]: entries },
      },
    })),

  toggleTag: (run, tag) =>
    set((s) => {
      const current = s.enabledTags[run] ?? [];
      const next = current.includes(tag)
        ? current.filter((t) => t !== tag)
        : [...current, tag];
      return { enabledTags: { ...s.enabledTags, [run]: next } };
    }),

  refreshRun: (run) => {
    const { setTagEntries, setRuns } = get();
    // Re-fetch run list first, then discover all tags (includes new ones not yet in store)
    fetch("/api/runs")
      .then((r) => r.json())
      .then((d: { runs: string[] }) => { if (d.runs.length) setRuns(d.runs); })
      .catch(console.error);
    fetch(`/api/tags?run=${encodeURIComponent(run)}`)
      .then((r) => r.json())
      .then((d: { tags: string[] }) => {
        for (const tag of d.tags) {
          fetch(`/api/data?tag=${encodeURIComponent(tag)}&run=${encodeURIComponent(run)}`)
            .then((r) => r.json())
            .then((data: { entries: TagEntry[] }) => setTagEntries(run, tag, data.entries))
            .catch(console.error);
        }
      })
      .catch(console.error);
  },
}));
