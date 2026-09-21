import type { Config, DB } from "@panorama/db";

export interface Ctx {
  dataDir: string;
  db: DB | null;
  config: Config | null;
  now: () => Date;
  nonces: Map<string, number>;
}
