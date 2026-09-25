import type { ChainReason } from "../views/unlock";

const REASONS: Record<ChainReason, string> = {
  hash: "An entry was edited.",
  truncated: "Entries were removed from the end of the log.",
  checkpoint_mismatch: "The log no longer matches the last state you signed.",
  checkpoint_signature: "A checkpoint carries a signature that is not yours.",
  anchor_mismatch: "The log no longer matches what this browser last saw.",
  empty: "The log is empty.",
};

export const ChainBanner = ({ brokenAt, reason }: { brokenAt: number; reason: ChainReason }) => (
  <div className="banner" role="alert">
    The event log was changed outside Boomerang. {REASONS[reason]} First bad entry: {brokenAt}. Treat ticket history after that point as untrusted.
  </div>
);
