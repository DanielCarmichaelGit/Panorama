import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app";

const dataDir = process.env.PANORAMA_DATA_DIR ?? join(homedir(), ".panorama");
const webDist = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../web/dist");
const app = await buildApp({ dataDir, webDist, allowFastKdf: process.env.PANORAMA_ALLOW_FAST_KDF === "1" });
await app.listen({ host: "127.0.0.1", port: Number(process.env.PORT ?? 4400) });
console.log(`Panorama on http://127.0.0.1:${process.env.PORT ?? 4400} (data: ${dataDir})`);
