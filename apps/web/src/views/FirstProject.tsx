import { useState } from "react";
import { LaneScene } from "../lib/iso";
import { useCreateProject } from "../lib/hooks";

function suggestKey(name: string): string {
  return name.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase();
}

export function FirstProject() {
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const create = useCreateProject();

  function onNameChange(v: string) {
    setName(v);
    if (!keyTouched) setKey(suggestKey(v));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !key.trim() || create.isPending) return;
    await create.mutateAsync({ name: name.trim(), key: key.trim().toUpperCase() }).catch(() => {});
  }

  return (
    <main id="main" className="lock">
      <a className="skip" href="#main">Skip to content</a>
      <form onSubmit={submit}>
        <div className="mark">Panorama</div>
        <h1>Name your first project</h1>
        <p className="muted">Everything in Panorama belongs to a project. You can add more later.</p>
        <div className="field">
          <label htmlFor="proj-name">Project name</label>
          <input id="proj-name" className="input" autoFocus value={name} onChange={(e) => onNameChange(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="proj-key">Key</label>
          <input id="proj-key" className="input mono" value={key} maxLength={8} onChange={(e) => { setKeyTouched(true); setKey(e.target.value.toUpperCase()); }} />
        </div>
        {create.isError && <p className="error" role="alert">{create.error instanceof Error ? create.error.message : "Could not create the project."}</p>}
        <button className="btn" disabled={!name.trim() || !key.trim() || create.isPending}>{create.isPending ? "Creating" : "Create project"}</button>
      </form>
      <div className="art"><LaneScene /></div>
    </main>
  );
}
