import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app";
import { allowFastKdf, resolveDataDir } from "./dataDir";
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
// The scheduler and the outbox worker; `onEvents` is where the engine's runRules is handed in.
installWorkers(app, app.ctx);
await app.listen({ host: "127.0.0.1", port: Number(process.env.PORT ?? 4400) });
console.log(`Boomerang on http://127.0.0.1:${process.env.PORT ?? 4400} (data: ${dataDir})`);
