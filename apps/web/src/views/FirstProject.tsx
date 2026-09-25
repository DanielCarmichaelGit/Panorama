import { useState } from "react";
import { LaneScene } from "../lib/iso";
import { useCreateProject } from "../lib/hooks";

// The key prefixes every ticket (FIRETOWER-1). It is the name in capitals with spaces as
// underscores, up to 32 characters, and it is not edited by hand.
export function keyFor(name: string): string {
  return name.trim().toUpperCase().replace(/\s+/g, "_").replace(/[^A-Z0-9_]/g, "").replace(/^[^A-Z]+/, "").slice(0, 32);
}

export function FirstProject() {
  const [name, setName] = useState("");
  const key = keyFor(name);
  const create = useCreateProject();

  function onNameChange(v: string) { setName(v); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !key.trim() || create.isPending) return;
    await create.mutateAsync({ name: name.trim(), key: key.trim().toUpperCase() }).catch(() => {});
  }

  return (
    <main id="main" className="lock">
      <a className="skip" href="#main">Skip to content</a>
      <form onSubmit={submit}>
        <div className="mark">Boomerang</div>
        <h1>Name your first project</h1>
        <p className="muted">Everything in Boomerang belongs to a project. You can add more later.</p>
        <div className="field">
          <label htmlFor="proj-name">Project name</label>
          <input id="proj-name" className="input" autoFocus value={name} onChange={(e) => onNameChange(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="proj-key">Key</label>
          <input id="proj-key" className="input mono" value={key} readOnly aria-readonly="true" tabIndex={-1} />
        </div>
        {create.isError && <p className="error" role="alert">{create.error instanceof Error ? create.error.message : "Could not create the project."}</p>}
        <button className="btn" disabled={!name.trim() || !key.trim() || create.isPending}>{create.isPending ? "Creating" : "Create project"}</button>
      </form>
      <div className="art"><LaneScene /></div>
    </main>
  );
}
