import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

const firstRunDataDir = mkdtempSync(join(tmpdir(), "bm-e2e-first-run-"));
const gateDataDir = mkdtempSync(join(tmpdir(), "bm-e2e-gate-"));
const ticketModelDataDir = mkdtempSync(join(tmpdir(), "bm-e2e-ticket-model-"));
const settingsDataDir = mkdtempSync(join(tmpdir(), "bm-e2e-settings-"));

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  webServer: [
    {
      command: "pnpm start",
      url: "http://127.0.0.1:4410/api/v1/health",
      env: { PORT: "4410", BOOMERANG_DATA_DIR: firstRunDataDir, VITE_FAST_KDF: "1", BOOMERANG_ALLOW_FAST_KDF: "1" },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "pnpm start",
      url: "http://127.0.0.1:4411/api/v1/health",
      env: { PORT: "4411", BOOMERANG_DATA_DIR: gateDataDir, VITE_FAST_KDF: "1", BOOMERANG_ALLOW_FAST_KDF: "1" },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "pnpm start",
      url: "http://127.0.0.1:4412/api/v1/health",
      env: { PORT: "4412", BOOMERANG_DATA_DIR: ticketModelDataDir, VITE_FAST_KDF: "1", BOOMERANG_ALLOW_FAST_KDF: "1" },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "pnpm start",
      url: "http://127.0.0.1:4413/api/v1/health",
      env: { PORT: "4413", BOOMERANG_DATA_DIR: settingsDataDir, VITE_FAST_KDF: "1", BOOMERANG_ALLOW_FAST_KDF: "1" },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  projects: [
    { name: "first-run", testMatch: "first-run.spec.ts", use: { baseURL: "http://127.0.0.1:4410" } },
    { name: "gate", testMatch: "gate.spec.ts", use: { baseURL: "http://127.0.0.1:4411" } },
    { name: "ticket-model", testMatch: "ticket-model.spec.ts", use: { baseURL: "http://127.0.0.1:4412" } },
    { name: "settings", testMatch: "settings.spec.ts", use: { baseURL: "http://127.0.0.1:4413" } },
  ],
});
