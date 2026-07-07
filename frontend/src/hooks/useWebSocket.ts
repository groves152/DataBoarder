import { useEffect, useRef } from "react";
import type { TagEntry, WsMessage } from "@/types";
import { useDataStore } from "@/stores/dataStore";

const WS_URL = `ws://${window.location.host}/ws`;

/** Fetch all tags + entries for a run and populate the store. */
async function bootstrapRun(
  run: string,
  setTagEntries: (run: string, tag: string, entries: TagEntry[]) => void,
): Promise<void> {
  const tagsRes = await fetch(`/api/tags?run=${encodeURIComponent(run)}`);
  const { tags }: { tags: string[] } = await tagsRes.json();
  await Promise.all(
    tags.map(async (tag) => {
      const dataRes = await fetch(
        `/api/data?tag=${encodeURIComponent(tag)}&run=${encodeURIComponent(run)}`,
      );
      const { entries }: { entries: TagEntry[] } = await dataRes.json();
      setTagEntries(run, tag, entries);
    }),
  );
}

export function useWebSocket(): void {
  const appendEntry   = useDataStore((s) => s.appendEntry);
  const setRuns       = useDataStore((s) => s.setRuns);
  const setTagEntries = useDataStore((s) => s.setTagEntries);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const msg: WsMessage = JSON.parse(event.data as string);
      appendEntry(msg);
    };

    ws.onopen = () => {
      fetch("/api/runs")
        .then((r) => r.json())
        .then((d: { runs: string[] }) => {
          const runs = d.runs.length ? d.runs : [];
          if (runs.length) {
            setRuns(runs);
            // Load all historical data from the server buffer / SQLite DB
            for (const run of runs) {
              bootstrapRun(run, setTagEntries).catch(console.error);
            }
          }
        })
        .catch(console.error);
    };

    const ping = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send("ping");
    }, 20_000);

    return () => { clearInterval(ping); ws.close(); };
  }, [appendEntry, setRuns, setTagEntries]);
}
