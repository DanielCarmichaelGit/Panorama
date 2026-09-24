import { useQuery } from "@tanstack/react-query";
import { useState, useSyncExternalStore } from "react";
import { Route, Routes } from "react-router-dom";
import { ChainBanner } from "./components/ChainBanner";
import { api } from "./lib/api";
import { session } from "./lib/session";
import { Agents } from "./views/Agents";
import { Board } from "./views/Board";
import { LockScreen } from "./views/LockScreen";
import { Queue } from "./views/Queue";
import { Shell } from "./views/Shell";
import type { ChainState } from "./views/unlock";

export interface Status {
  state: "uninitialized" | "locked" | "unlocked";
  kdfSalt?: string;
  argon?: { iterations: number; memorySize: number; parallelism: number };
  humanPublicKey?: string;
  encryption?: boolean;
}

export function App() {
  const seed = useSyncExternalStore(session.subscribe, session.getSeed);
  const [chain, setChain] = useState<ChainState>({ ok: true });
  const status = useQuery({ queryKey: ["status"], queryFn: () => api<Status>("GET", "/api/v1/status") });
  if (status.isPending) {
    return (
      <main className="view" aria-busy="true">
        {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" />)}
      </main>
    );
  }
  if (status.isError) {
    return (
      <main style={{ padding: "var(--gutter)" }}>
        <p className="error">Cannot reach the Panorama server. Is it running?</p>
        <button className="btn" onClick={() => status.refetch()}>Try again</button>
      </main>
    );
  }
  if (status.data.state !== "unlocked" || !seed) {
    return <LockScreen status={status.data} onDone={(s, c) => { setChain(c); session.setSeed(s); status.refetch(); }} />;
  }
  return (
    <>
      {!chain.ok && <ChainBanner brokenAt={chain.brokenAt} reason={chain.reason} />}
      <Routes>
        <Route element={<Shell status={status.data} chainOk={chain.ok} />}>
          <Route path="/" element={<Queue />} />
          <Route path="/board" element={<Board />} />
          <Route path="/agents" element={<Agents />} />
          <Route path="/t/:id" element={<Queue />} />
          <Route path="/board/t/:id" element={<Board />} />
        </Route>
      </Routes>
    </>
  );
}
