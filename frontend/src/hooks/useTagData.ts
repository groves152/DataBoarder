import { useEffect } from "react";
import { useDataStore } from "@/stores/dataStore";
import type { TagEntry } from "@/types";
import { compactEntry } from "@/utils/meshData";

// How many mounted viewers show each (run, tag): a mesh tag's entries are
// kept while something shows them and let go after (a long program's replay
// is hundreds of meshes; `dataStore` doesn't keep meshes nothing asked for).
const viewers = new Map<string, number>();
// Fetched a page at a time: a long replay is hundreds of MB as one response,
// and a viewer redraws as each page lands rather than once per mesh.
const PAGE = { mesh: 32, other: 5000 };

export function useTagData(run: string, tag: string): TagEntry[] {
  const key = `${run}\u0000${tag}`;
  const entries = useDataStore((s) => s.entries[run]?.[tag] ?? []);
  const reload = useDataStore((s) => s.reloads[key] ?? 0); // bumped: fetch it again (e.g. a replay just built)

  useEffect(() => {
    viewers.set(key, (viewers.get(key) ?? 0) + 1);
    let live = true;
    const store = useDataStore.getState();
    // claim the tag now, so what's pushed while the fetch is out is kept
    if (!(tag in (store.entries[run] ?? {}))) store.setTagEntries(run, tag, []);
    (async () => {
      let got: TagEntry[] = [];
      // a mesh-sized first page whatever the tag (its type may not be known
      // yet: a replay just built); the rest sized by what came back
      let limit = PAGE.mesh;
      for (let start = 0; ;) {
        const r = await fetch(`/api/data?tag=${encodeURIComponent(tag)}&run=${encodeURIComponent(run)}`
          + `&start=${start}&limit=${limit}`);
        const d: { entries: TagEntry[]; total?: number } = await r.json();
        if (!live) return;
        got = got.concat(d.entries.map(compactEntry));
        useDataStore.getState().setTagEntries(run, tag, got);
        if (start === 0 && d.entries.length) {
          useDataStore.getState().setTagTypes(run, { [tag]: d.entries[0].type });
          if (d.entries[0].type !== "mesh") limit = PAGE.other;
        }
        start += d.entries.length;
        if (d.entries.length === 0 || start >= (d.total ?? start)) break;
      }
    })().catch(console.error);
    return () => {
      live = false;
      const n = (viewers.get(key) ?? 1) - 1;
      if (n > 0) viewers.set(key, n);
      else viewers.delete(key);
      // let a mesh tag go once nothing shows it -- after this render, so a
      // viewer that re-claims it at once (a remount, a reload) keeps it
      setTimeout(() => {
        if (viewers.has(key)) return;
        const s = useDataStore.getState();
        if (s.tagTypes[run]?.[tag] === "mesh" || s.entries[run]?.[tag]?.[0]?.type === "mesh") s.dropTag(run, tag);
      }, 0);
    };
  }, [run, tag, key, reload]);

  return entries;
}
