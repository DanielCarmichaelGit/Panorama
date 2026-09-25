// Bundles src/main.ts into dist/main.js so `node apps/mcp/dist/main.js` (and the boomerang-mcp
// bin) runs without tsx: @boomerang/core ships TypeScript source, so it is bundled in along
// with its dependencies. The MCP SDK and zod stay external and resolve from this package's
// own node_modules.
import { chmodSync } from "node:fs";
import { build } from "esbuild";

await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/main.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  external: ["@modelcontextprotocol/sdk", "@modelcontextprotocol/sdk/*", "zod"],
  sourcemap: false,
  logLevel: "info",
});
chmodSync("dist/main.js", 0o755);
