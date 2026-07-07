import { useEffect } from "react";
import { useDataStore } from "@/stores/dataStore";
import type { TagEntry } from "@/types";

export function useTagData(run: string, tag: string): TagEntry[] {
  const setTagEntries = useDataStore((s) => s.setTagEntries);
  const entries = useDataStore((s) => s.entries[run]?.[tag] ?? []);

  useEffect(() => {
    fetch(`/api/data?tag=${encodeURIComponent(tag)}&run=${encodeURIComponent(run)}`)
      .then((r) => r.json())
      .then((d: { entries: TagEntry[] }) => setTagEntries(run, tag, d.entries))
      .catch(console.error);
  }, [run, tag, setTagEntries]);

  return entries;
}
