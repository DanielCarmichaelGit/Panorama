import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app";
import { allowFastKdf, resolveDataDir } from "./dataDir";
import { runRules } from "./engine/runRules";
import { installWorkers } from "./workers";

let dataDir: string;
try {
  dataDir = resolveDataDir({ env: process.env, home: homedir(), log: console.log });
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
const webDist = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../web/dist");
const app = await buildApp({ dataDir, webDist, allowFastKdf: allowFastKdf(process.env, console.log) });
// The scheduler and the outbox worker hand what they append (trigger.fired, ticket.due_passed,
// delivery events) to the engine, so a schedule rule runs like any other.
installWorkers(app, app.ctx, { onEvents: (_db, evs) => void runRules(app.ctx, evs) });
await app.listen({ host: "127.0.0.1", port: Number(process.env.PORT ?? 4400) });
console.log(`Boomerang on http://127.0.0.1:${process.env.PORT ?? 4400} (data: ${dataDir})`);
