import type { Config, DB } from "@panorama/db";
import type { EventBus } from "./bus";

export interface Ctx {
  dataDir: string;
  db: DB | null;
  config: Config | null;
  now: () => Date;
  /** Nonces seen since this process started, with the time they may be forgotten. */
  nonces: Map<string, number>;
  /** When this process started. Requests older than that cannot be fresh. */
  startedAt: number;
  /** Set only for tests and the end to end run, where a real Argon2 pass is too slow. */
  allowFastKdf: boolean;
  /** The database key, ready to encrypt attachment files. Set at setup/unlock when encryption
   *  is on, cleared at lock, and always null when encryption is off. */
  fileKey: Buffer | null;
  /** Fans out committed events to open server-sent-event streams. */
  bus: EventBus;
  /** Last time (ms) each agent's presence was published, so the auth hook can throttle
   *  `agent.seen` to once per agent per 30s instead of once per request. */
  agentSeenAt: Map<string, number>;
}
