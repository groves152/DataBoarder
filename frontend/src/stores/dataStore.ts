import { create } from "zustand";
import type { DataType, TagEntry, WsMessage } from "@/types";
import { compactEntry } from "@/utils/meshData";

interface DataStore {
  runs: string[];
  activeRun: string;
  entries: Record<string, Record<string, TagEntry[]>>; // run → tag → entries
  // Every tag the server has, with its type (run → tag → type), loaded or
  // not: a mesh tag's entries are fetched only by what shows them
  // (`useTagData`) -- a long program's replay is hundreds of meshes.
  tagTypes: Record<string, Record<string, DataType>>;
  // Per "run\0tag": bumped to make its viewers fetch it again (`useTagData`).
  reloads: Record<string, number>;
  enabledTags: Record<string, string[]>;

  setRuns: (runs: string[]) => void;
  setActiveRun: (run: string) => void;
  appendEntry: (msg: WsMessage) => void;
  setTagEntries: (run: string, tag: string, entries: TagEntry[]) => void;
  setTagTypes: (run: string, types: Record<string, DataType>) => void;
  dropTag: (run: string, tag: string) => void; // forget a tag's entries (still listed by its type)
  reloadTag: (run: string, tag: string) => void;
  toggleTag: (run: string, tag: string) => void;
  refreshRun: (run: string) => void;
}

export const useDataStore = create<DataStore>((set, get) => ({
  runs: [],
  activeRun: "default",
  entries: {},
  tagTypes: {},
  reloads: {},
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
      const types = s.tagTypes[msg.run] ?? {};
      const tagTypes = types[msg.tag] === msg.type ? s.tagTypes : { ...s.tagTypes, [msg.run]: { ...types, [msg.tag]: msg.type } };
      // a mesh nothing has asked for yet isn't kept: whatever shows it fetches it
      if (msg.type === "mesh" && !(msg.tag in runEntries)) return { runs: newRuns, activeRun: newActiveRun, tagTypes };
      const tagEntries = msg.replace ? [] : runEntries[msg.tag] ?? [];
      return {
        runs: newRuns,
        activeRun: newActiveRun,
        tagTypes,
        entries: {
          ...s.entries,
          [msg.run]: {
            ...runEntries,
            [msg.tag]: [...tagEntries, compactEntry({ type: msg.type, data: msg.data } as TagEntry)],
          },
        },
      };
    }),

  setTagEntries: (run, tag, entries) =>
    set((s) => ({
      entries: {
        ...s.entries,
        [run]: { ...(s.entries[run] ?? {}), [tag]: entries.map(compactEntry) },
      },
    })),

  reloadTag: (run, tag) => set((s) => {
    const key = `${run}\u0000${tag}`;
    return { reloads: { ...s.reloads, [key]: (s.reloads[key] ?? 0) + 1 } };
  }),

  dropTag: (run, tag) => set((s) => {
    if (!(tag in (s.entries[run] ?? {}))) return {};
    const { [tag]: _gone, ...rest } = s.entries[run];
    return { entries: { ...s.entries, [run]: rest } };
  }),

  setTagTypes: (run, types) => set((s) => ({ tagTypes: { ...s.tagTypes, [run]: { ...(s.tagTypes[run] ?? {}), ...types } } })),

  toggleTag: (run, tag) =>
    set((s) => {
      const current = s.enabledTags[run] ?? [];
      const next = current.includes(tag)
        ? current.filter((t) => t !== tag)
        : [...current, tag];
      return { enabledTags: { ...s.enabledTags, [run]: next } };
    }),

  refreshRun: (run) => {
    const { setTagEntries, setTagTypes, setRuns } = get();
    // Re-fetch run list first, then discover all tags (includes new ones not yet in store)
    fetch("/api/runs")
      .then((r) => r.json())
      .then((d: { runs: string[] }) => { if (d.runs.length) setRuns(d.runs); })
      .catch(console.error);
    fetch(`/api/tags?run=${encodeURIComponent(run)}`)
      .then((r) => r.json())
      .then((d: { tags: string[]; types?: Record<string, DataType> }) => {
        if (d.types) setTagTypes(run, d.types);
        for (const tag of d.tags) {
          if (d.types?.[tag] === "mesh") continue; // fetched by whatever shows it
          fetch(`/api/data?tag=${encodeURIComponent(tag)}&run=${encodeURIComponent(run)}`)
            .then((r) => r.json())
            .then((data: { entries: TagEntry[] }) => setTagEntries(run, tag, data.entries))
            .catch(console.error);
        }
      })
      .catch(console.error);
  },
}));
