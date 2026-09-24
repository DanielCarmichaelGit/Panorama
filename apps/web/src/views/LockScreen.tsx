import { Info } from "@phosphor-icons/react";
import { useState } from "react";
import type { Status } from "../App";
import { LaneScene } from "../lib/iso";
import { generatePassword } from "../lib/password";
import { setupFlow, unlockFlow, type ChainState } from "./unlock";

export function LockScreen({ status, onDone }: { status: Status; onDone: (seed: Uint8Array, chain: ChainState) => void }) {
  const first = status.state === "uninitialized";
  const [pw, setPw] = useState(""), [pw2, setPw2] = useState(""), [enc, setEnc] = useState(true), [busy, setBusy] = useState(false), [err, setErr] = useState(""), [shown, setShown] = useState(false);
  function suggest() { const p = generatePassword(); setPw(p); setPw2(p); setShown(true); setErr(""); }
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
        <div className="field"><label htmlFor="pw">Password</label><input id="pw" className={"input" + (shown ? " mono-input" : "")} type={shown ? "text" : "password"} autoFocus autoComplete={first ? "new-password" : "current-password"} spellCheck={false} value={pw} onChange={(e) => setPw(e.target.value)} /></div>
        {first && <div className="field"><label htmlFor="pw2">Repeat password</label><input id="pw2" className={"input" + (shown ? " mono-input" : "")} type={shown ? "text" : "password"} autoComplete="new-password" spellCheck={false} value={pw2} onChange={(e) => setPw2(e.target.value)} /></div>}
        {first && <div className="row-actions"><button type="button" className="btn ghost" onClick={suggest}>Suggest a password</button><button type="button" className="btn ghost" onClick={() => setShown((v) => !v)} aria-pressed={shown}>{shown ? "Hide" : "Show"}</button></div>}
        {first && <div className="notice">
          <p>Write it down somewhere that is not this computer. Do not save it in a file, a note, a browser, or a password manager on this machine: an agent that can read the file can unlock the database and sign as you.</p>
          <span className="tip"><button type="button" className="tip-btn" aria-label="About suggested passwords" aria-describedby="pw-tip"><Info size={16} weight="regular" aria-hidden="true" /></button><span role="tooltip" id="pw-tip" className="tip-text">A suggested password has about 129 bits of randomness, so knowing how it was made does not help anyone guess it.</span></span>
        </div>}
        {first && <label className="check"><input type="checkbox" checked={enc} onChange={(e) => setEnc(e.target.checked)} /><span>Encrypt the database. Panorama then stays locked after a restart until you enter this password.</span></label>}
        {err && <p className="error" role="alert">{err}</p>}
        <button className="btn" disabled={busy || !pw}>{busy ? "Working" : first ? "Create" : "Unlock"}</button>
      </form>
      <div className="art"><LaneScene settle /></div>
    </main>
  );
}
