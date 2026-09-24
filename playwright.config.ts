import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

const firstRunDataDir = mkdtempSync(join(tmpdir(), "pan-e2e-first-run-"));
const gateDataDir = mkdtempSync(join(tmpdir(), "pan-e2e-gate-"));

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  webServer: [
    {
      command: "pnpm start",
      url: "http://127.0.0.1:4410/api/v1/health",
      env: { PORT: "4410", PANORAMA_DATA_DIR: firstRunDataDir, VITE_FAST_KDF: "1", PANORAMA_ALLOW_FAST_KDF: "1" },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "pnpm start",
      url: "http://127.0.0.1:4411/api/v1/health",
      env: { PORT: "4411", PANORAMA_DATA_DIR: gateDataDir, VITE_FAST_KDF: "1", PANORAMA_ALLOW_FAST_KDF: "1" },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  projects: [
    { name: "first-run", testMatch: "first-run.spec.ts", use: { baseURL: "http://127.0.0.1:4410" } },
    { name: "gate", testMatch: "gate.spec.ts", use: { baseURL: "http://127.0.0.1:4411" } },
  ],
});
