import { useQuery } from "@tanstack/react-query";
import { useState, useSyncExternalStore } from "react";
import { Route, Routes } from "react-router-dom";
import { ChainBanner } from "./components/ChainBanner";
import { api } from "./lib/api";
import { session } from "./lib/session";
import { Agents } from "./views/Agents";
import { LockScreen } from "./views/LockScreen";
import { Queue } from "./views/Queue";
import { Shell } from "./views/Shell";

export interface Status {
  state: "uninitialized" | "locked" | "unlocked";
  kdfSalt?: string;
  argon?: { iterations: number; memorySize: number; parallelism: number };
  humanPublicKey?: string;
  encryption?: boolean;
}

export function App() {
  const seed = useSyncExternalStore(session.subscribe, session.getSeed);
  const [brokenAt, setBrokenAt] = useState<number | null>(null);
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
  if (status.data.state !== "unlocked" || !seed) {
    return <LockScreen status={status.data} onDone={(s, b) => { setBrokenAt(b); session.setSeed(s); status.refetch(); }} />;
  }
  return (
    <>
      {brokenAt !== null && <ChainBanner brokenAt={brokenAt} />}
      <Routes>
        <Route element={<Shell status={status.data} brokenAt={brokenAt} />}>
          <Route path="/" element={<Queue />} />
          <Route path="/agents" element={<Agents />} />
          <Route path="/t/:id" element={<Queue />} />
        </Route>
      </Routes>
    </>
  );
}
