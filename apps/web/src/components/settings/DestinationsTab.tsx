import { useEffect, useRef, useState } from "react";
import { Archive, ArrowCounterClockwise, ArrowsClockwise, PaperPlaneTilt, PencilSimple } from "@phosphor-icons/react";
import { ApiError } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { useAllDestinations, useCreateDestination, useRotateDestination, useTestDestination, useUpdateDestination, type Destination, type DestinationWithSecret } from "../../lib/hooks";
import { Chip } from "../Chip";
import { EmptyRow, RowAction, RowConfirm, RowError, RowForm, SettingsList, SettingsRow, SettingsSection } from "./primitives";
import { tabState } from "./tabState";

const NEW = "new";

/** The url rule the server applies, in words, for the validation refusal its zod schema answers with. */
const URL_RULE = "The url must start with http or https and carry no username or password.";

function writeError(e: unknown, fallback: string): string {
  if (e instanceof ApiError && e.code === "validation") return URL_RULE;
  return errorMessage(e, fallback);
}

const looksLikeUrl = (u: string) => /^https?:\/\/\S+$/i.test(u.trim());

/** A secret shown once, with a Copy button and Done. Copy uses the clipboard when the browser allows it, else selects the text so a keyboard copy takes it. */
function SecretPanel({ name, secret, onDone }: { name: string; secret: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLElement>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  function select() {
    const el = codeRef.current;
    if (!el) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }
  async function copy() {
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(secret);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) {
      select();
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
    }
    if (ok) {
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <section className="secret-panel" aria-label={`Secret for ${name}`}>
      <div className="secret-line">
        <code ref={codeRef} className="mono secret-value" onClick={select}>{secret}</code>
        <button type="button" className="btn ghost small" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
      </div>
      <p className="muted">Shown once. Store it in the receiver now.</p>
      <div className="row-form-actions">
        <button type="button" className="btn small" onClick={onDone}>Done</button>
      </div>
    </section>
  );
}

function DestinationFields({ name, url, onName, onUrl, prefix }: { name: string; url: string; onName: (v: string) => void; onUrl: (v: string) => void; prefix: string }) {
  return (
    <div className="row-form-grid">
      <div className="field">
        <label htmlFor={`${prefix}-name`}>Name</label>
        <input id={`${prefix}-name`} className="input" value={name} maxLength={80} onChange={(e) => onName(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-url`}>Url</label>
        <input id={`${prefix}-url`} className="input mono-input" type="url" value={url} maxLength={2000} spellCheck={false} placeholder="https://" onChange={(e) => onUrl(e.target.value)} />
      </div>
    </div>
  );
}

function NewDestinationForm({ projectId, onCreated, onClose }: { projectId: string; onCreated: (d: DestinationWithSecret) => void; onClose: () => void }) {
  const create = useCreateDestination();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const canSave = name.trim() !== "" && looksLikeUrl(url);
  return (
    <RowForm
      label="New destination"
      onSubmit={() => create.mutate({ projectId, name: name.trim(), url: url.trim() }, { onSuccess: onCreated })}
      onCancel={onClose}
      canSave={canSave}
      busy={create.isPending}
      error={create.isError ? writeError(create.error, "Could not add the destination.") : null}
    >
      <DestinationFields prefix="nd" name={name} url={url} onName={setName} onUrl={setUrl} />
    </RowForm>
  );
}

function EditDestinationForm({ destination, onClose }: { destination: Destination; onClose: () => void }) {
  const update = useUpdateDestination();
  const [name, setName] = useState(destination.name);
  const [url, setUrl] = useState(destination.url);
  const patch: { name?: string; url?: string } = {};
  if (name.trim() !== destination.name) patch.name = name.trim();
  if (url.trim() !== destination.url) patch.url = url.trim();
  const canSave = name.trim() !== "" && looksLikeUrl(url) && Object.keys(patch).length > 0;
  return (
    <RowForm
      label={`Edit ${destination.name}`}
      onSubmit={() => update.mutate({ id: destination.id, patch }, { onSuccess: onClose })}
      onCancel={onClose}
      canSave={canSave}
      busy={update.isPending}
      error={update.isError ? writeError(update.error, "Could not save the destination.") : null}
    >
      <DestinationFields prefix={`ed-${destination.id}`} name={name} url={url} onName={setName} onUrl={setUrl} />
    </RowForm>
  );
}

type Pending = "rotate" | "archive" | null;

function DestinationRow({
  destination,
  expanded,
  onEdit,
  onClose,
  secret,
  onSecret,
  onSecretDone,
}: {
  destination: Destination;
  expanded: boolean;
  onEdit: () => void;
  onClose: () => void;
  secret: string | null;
  onSecret: (d: DestinationWithSecret) => void;
  onSecretDone: () => void;
}) {
  const update = useUpdateDestination();
  const rotate = useRotateDestination();
  const test = useTestDestination();
  const [pending, setPending] = useState<Pending>(null);
  const [tested, setTested] = useState(false);
  const d = destination;
  const idle = !expanded && pending === null && !secret;

  function start(next: Pending) {
    update.reset();
    rotate.reset();
    test.reset();
    setTested(false);
    setPending(next);
  }
  function sendTest() {
    update.reset();
    rotate.reset();
    setTested(false);
    test.mutate(d.id, { onSuccess: () => setTested(true) });
  }

  const error = update.isError ? writeError(update.error, "Could not change the destination.") : rotate.isError ? errorMessage(rotate.error, "Could not rotate the secret.") : test.isError ? errorMessage(test.error, "Could not queue the test.") : null;

  return (
    <SettingsRow
      expanded={expanded || pending !== null || !!secret}
      identity={<span className="row-name">{d.name}</span>}
      facts={
        <>
          <span className="mono row-truncate" title={d.url}>{d.url}</span>
          {d.archived && <Chip family="stone">Archived</Chip>}
        </>
      }
      actions={
        idle && (
          <>
            <RowAction icon={PencilSimple} label="Edit" onClick={onEdit} />
            <RowAction icon={ArrowsClockwise} label="Rotate secret" onClick={() => start("rotate")} />
            <RowAction icon={PaperPlaneTilt} label="Send test" onClick={sendTest} disabled={d.archived || test.isPending} reason={d.archived ? "Restore it first" : undefined} />
            {d.archived ? (
              <RowAction icon={ArrowCounterClockwise} label="Restore" onClick={() => { update.reset(); update.mutate({ id: d.id, patch: { archived: false } }); }} disabled={update.isPending} />
            ) : (
              <RowAction icon={Archive} label="Archive" onClick={() => start("archive")} />
            )}
          </>
        )
      }
    >
      {error && <RowError message={error} />}
      {tested && !error && <p className="muted row-note">Test delivery queued. The receiver should see it within a few seconds.</p>}
      {expanded && <EditDestinationForm destination={d} onClose={onClose} />}
      {pending === "rotate" && (
        <RowConfirm
          question={`Rotate the secret for ${d.name}?`}
          note="Deliveries queued from now on are signed with the new one."
          action="Rotate"
          busy={rotate.isPending}
          onConfirm={() => rotate.mutate(d.id, { onSuccess: (out) => onSecret(out), onSettled: () => setPending(null) })}
          onCancel={() => setPending(null)}
        />
      )}
      {pending === "archive" && (
        <RowConfirm
          question={`Archive ${d.name}?`}
          note="Pending deliveries to it stop. Rules that name it keep it until you pick another."
          action="Archive"
          busy={update.isPending}
          onConfirm={() => update.mutate({ id: d.id, patch: { archived: true } }, { onSettled: () => setPending(null) })}
          onCancel={() => setPending(null)}
        />
      )}
      {secret && <SecretPanel name={d.name} secret={secret} onDone={onSecretDone} />}
    </SettingsRow>
  );
}

/**
 * Settings tab for webhook destinations: where a rule's notify action posts. Add one (name and
 * url), edit it, rotate its secret, queue a test delivery, archive and restore it. The secret
 * comes back once, on create and on rotate, and is shown in a panel inside the row until Done;
 * nothing here can show it again. The list includes archived destinations so a name a rule
 * still carries can be found and restored.
 */
export function DestinationsTab({ projectId }: { projectId: string }) {
  const destinations = useAllDestinations(projectId);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  /** The destination whose secret is on show, with the row itself so a just-created one shows before the list refetches. */
  const [reveal, setReveal] = useState<DestinationWithSecret | null>(null);

  const state = tabState({ query: destinations, label: "destinations" });
  if (state) return state;

  const listed = destinations.data ?? [];
  const list = reveal && !listed.some((d) => d.id === reveal.id) ? [reveal, ...listed] : listed;
  const close = () => setExpandedId(null);
  const show = (d: DestinationWithSecret) => {
    setReveal(d);
    setExpandedId(null);
  };

  return (
    <SettingsSection
      description="Destinations are where automations can send a webhook when a rule says notify. Boomerang signs every delivery so the receiver can check it came from you."
      action={<button type="button" className="btn" onClick={() => setExpandedId(NEW)} disabled={expandedId === NEW}>Add destination</button>}
    >
      <SettingsList label="Destinations">
        {expandedId === NEW && (
          <li className="settings-row" data-expanded="true">
            <NewDestinationForm projectId={projectId} onCreated={show} onClose={close} />
          </li>
        )}
        {list.length === 0 && expandedId !== NEW && <EmptyRow mark>No destinations yet. Add one, then a rule can notify it.</EmptyRow>}
        {list.map((d) => (
          <DestinationRow
            key={d.id}
            destination={d}
            expanded={expandedId === d.id}
            onEdit={() => setExpandedId(d.id)}
            onClose={close}
            secret={reveal?.id === d.id ? reveal.secret : null}
            onSecret={show}
            onSecretDone={() => setReveal(null)}
          />
        ))}
      </SettingsList>
    </SettingsSection>
  );
}
