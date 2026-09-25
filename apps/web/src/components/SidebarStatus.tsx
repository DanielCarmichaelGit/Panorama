import { ShieldCheck, ShieldWarning } from "@phosphor-icons/react";

export const CHAIN_OK = "Every change is hash-chained to the one before it and was verified against the point you last signed.";
export const CHAIN_BROKEN = "The history no longer matches the point you last signed: a recorded change was altered or removed. See the banner above.";
export const STREAM_ON = "Live updates from the server are connected.";
export const STREAM_OFF = "Live updates from the server dropped. Reconnecting, and the lists refresh in full once they are back.";

/**
 * The sidebar's two status rows: whether the event history verified, and whether live updates
 * are connected. Each row carries its one-sentence explanation as its title and accessible
 * name; the collapsed sidebar hides the short labels (through the shell's `.label` rule) and
 * keeps the icon, the dot, and the titles. The broken-chain banner above the shell is separate
 * and unchanged.
 */
export function SidebarStatus({ chainOk, connected }: { chainOk: boolean; connected: boolean }) {
  const chainText = chainOk ? CHAIN_OK : CHAIN_BROKEN;
  const streamText = connected ? STREAM_ON : STREAM_OFF;
  return (
    <div className="side-status">
      <div className="side-status-row" role="group" title={chainText} aria-label={chainText}>
        {chainOk ? (
          <ShieldCheck size={16} weight="regular" className="side-status-ok" aria-hidden="true" />
        ) : (
          <ShieldWarning size={16} weight="regular" className="side-status-bad" aria-hidden="true" />
        )}
        <span className="label">{chainOk ? "History intact" : "History altered"}</span>
      </div>
      <div className="side-status-row" role="group" title={streamText} aria-label={streamText}>
        <span className={"side-status-dot" + (connected ? " on" : "")} aria-hidden="true" />
        <span className="label">{connected ? "Connected" : "Reconnecting"}</span>
      </div>
    </div>
  );
}
