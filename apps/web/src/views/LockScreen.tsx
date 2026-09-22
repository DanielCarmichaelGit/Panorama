import { useState } from "react";
import type { Status } from "../App";
import { LaneScene } from "../lib/iso";
import { setupFlow, unlockFlow, type ChainState } from "./unlock";

export function LockScreen({ status, onDone }: { status: Status; onDone: (seed: Uint8Array, chain: ChainState) => void }) {
  const first = status.state === "uninitialized";
  const [pw, setPw] = useState(""), [pw2, setPw2] = useState(""), [enc, setEnc] = useState(true), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    if (first && pw.length < 12) return setErr("Use at least 12 characters.");
    if (first && pw !== pw2) return setErr("The two passwords do not match.");
    setBusy(true);
    try {
      if (first) onDone(await setupFlow(pw, enc), { ok: true });
      else { const out = await unlockFlow(pw, status); onDone(out.seed, out.chain); }
    } catch (x: any) {
      setErr(x.message === "wrong_password" ? "That password does not match this installation's key. If you are sure it is right, config.json may have been altered." : x.message);
    } finally { setBusy(false); }
  }
  return (
    <main className="lock">
      <form onSubmit={submit}>
        <div className="mark">Panorama</div>
        <h1>{first ? "Set your password" : "Unlock"}</h1>
        <p className="muted">{first ? "It signs everything you approve and it is never stored. If you lose it, it cannot be recovered in this version." : status.encryption ? "Your database is encrypted. Schedules and agents wait until you unlock." : "Your password signs the actions only you can take."}</p>
        <div className="field"><label htmlFor="pw">Password</label><input id="pw" className="input" type="password" autoFocus autoComplete={first ? "new-password" : "current-password"} value={pw} onChange={(e) => setPw(e.target.value)} /></div>
        {first && <div className="field"><label htmlFor="pw2">Repeat password</label><input id="pw2" className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></div>}
        {first && <label className="check"><input type="checkbox" checked={enc} onChange={(e) => setEnc(e.target.checked)} /><span>Encrypt the database. Panorama then stays locked after a restart until you enter this password.</span></label>}
        {err && <p className="error" role="alert">{err}</p>}
        <button className="btn" disabled={busy || !pw}>{busy ? "Working" : first ? "Create" : "Unlock"}</button>
      </form>
      <div className="art"><LaneScene settle /></div>
    </main>
  );
}
