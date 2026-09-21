import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

const dataDir = mkdtempSync(join(tmpdir(), "pan-e2e-"));

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: { baseURL: "http://127.0.0.1:4410" },
  webServer: {
    command: "pnpm start",
    url: "http://127.0.0.1:4410/api/v1/health",
    env: { PORT: "4410", PANORAMA_DATA_DIR: dataDir, VITE_FAST_KDF: "1" },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
