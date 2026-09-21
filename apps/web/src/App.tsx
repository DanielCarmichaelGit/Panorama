import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { api } from "./lib/api";
import { session } from "./lib/session";

export interface Status {
  state: "uninitialized" | "locked" | "unlocked";
  kdfSalt?: string;
  argon?: { iterations: number; memorySize: number; parallelism: number };
  humanPublicKey?: string;
  encryption?: boolean;
}

export function App() {
  const seed = useSyncExternalStore(session.subscribe, session.getSeed);
  const status = useQuery({ queryKey: ["status"], queryFn: () => api<Status>("GET", "/api/v1/status") });
  if (status.isPending) return null;
  if (status.isError) {
    return (
      <main style={{ padding: "var(--gutter)" }}>
        <p className="error">Cannot reach the Panorama server. Is it running?</p>
        <button className="btn" onClick={() => status.refetch()}>Try again</button>
      </main>
    );
  }
  if (status.data.state !== "unlocked" || !seed) return <p>Lock</p>;
  return <p>Unlocked</p>;
}
