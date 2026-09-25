import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_ACTIONS } from "@boomerang/core";
import { defaultAgentName, loadConfig, loadOrCreateKey, readKey, saveKey } from "./config";

const home = () => mkdtempSync(join(tmpdir(), "bm-mcp-home-"));

describe("config", () => {
  it("defaults to the local server, the hostname plus claude, and every action on every project", () => {
    const h = home();
    const c = loadConfig({}, h, "Daniels-MacBook-Pro.local");
    expect(c.url).toBe("http://127.0.0.1:4400");
    expect(c.name).toBe("Daniels-MacBook-Pro-claude");
    expect(c.keyFile).toBe(join(h, ".boomerang-mcp", "Daniels-MacBook-Pro-claude.json"));
    expect(c.scopes).toEqual({ projects: "*", actions: [...AGENT_ACTIONS] });
  });

  it("reads the url, name, key file and project list from the environment", () => {
    const c = loadConfig(
      { BOOMERANG_URL: "http://127.0.0.1:4499/", BOOMERANG_AGENT_NAME: "reviewer", BOOMERANG_MCP_KEY_FILE: "/tmp/x/key.json", BOOMERANG_PROJECTS: "p1, p2,,p3" },
      home(),
      "host"
    );
    expect(c.url).toBe("http://127.0.0.1:4499");
    expect(c.name).toBe("reviewer");
    expect(c.keyFile).toBe("/tmp/x/key.json");
    expect(c.scopes.projects).toEqual(["p1", "p2", "p3"]);
  });

  it("keeps a name the server accepts and a file name that is safe", () => {
    expect(defaultAgentName("")).toBe("agent-claude");
    expect(defaultAgentName("x".repeat(80))).toHaveLength(60);
    const c = loadConfig({ BOOMERANG_AGENT_NAME: "my agent/one" }, "/h", "host");
    expect(c.name).toBe("my agent/one");
    expect(c.keyFile).toBe(join("/h", ".boomerang-mcp", "my-agent-one.json"));
  });
});

describe("key file", () => {
  it("creates the key on first run with owner-only permissions and reads it back unchanged", () => {
    const path = join(home(), ".boomerang-mcp", "a.json");
    const first = loadOrCreateKey(path);
    expect(first.created).toBe(true);
    expect(first.key.id).toBeNull();
    expect(first.key.seed).toHaveLength(32);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(path, "..")).mode & 0o777).toBe(0o700);

    const stored = JSON.parse(readFileSync(path, "utf8"));
    expect(Object.keys(stored).sort()).toEqual(["id", "seed", "version"]);

    const second = loadOrCreateKey(path);
    expect(second.created).toBe(false);
    expect(Buffer.from(second.key.seed)).toEqual(Buffer.from(first.key.seed));
  });

  it("keeps the id once registration succeeds", () => {
    const path = join(home(), "k.json");
    const { key } = loadOrCreateKey(path);
    saveKey(path, { ...key, id: "agent-1" });
    expect(loadOrCreateKey(path).key.id).toBe("agent-1");
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("sets a drifted key file mode back to 600 and says so", () => {
    const path = join(home(), ".boomerang-mcp", "k.json");
    loadOrCreateKey(path);
    chmodSync(path, 0o644);
    const warnings: string[] = [];
    loadOrCreateKey(path, { warn: (line) => warnings.push(line) });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(warnings).toEqual([`The key file ${path} was mode 644; it should be 600 and has been set back. Check who else could read it.`]);
    // Once repaired, a second load has nothing to say.
    expect((() => { const w: string[] = []; loadOrCreateKey(path, { warn: (l) => w.push(l) }); return w; })()).toEqual([]);
  });

  it("sets a drifted key directory mode back to 700 and says so", () => {
    const dir = join(home(), ".boomerang-mcp");
    const path = join(dir, "k.json");
    loadOrCreateKey(path);
    chmodSync(dir, 0o755);
    const warnings: string[] = [];
    loadOrCreateKey(path, { warn: (line) => warnings.push(line) });
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(warnings).toEqual([`The key directory ${dir} was mode 755; it should be 700 and has been set back. Check who else could read it.`]);
  });

  it("reads a key without touching it", () => {
    const path = join(home(), "k.json");
    expect(readKey(path)).toBeNull();
    const { key } = loadOrCreateKey(path);
    expect(Buffer.from(readKey(path)!.seed)).toEqual(Buffer.from(key.seed));
  });

  it("refuses a file that is not an agent key rather than overwriting it", () => {
    const path = join(home(), "k.json");
    writeFileSync(path, "{\"password\":\"hunter2\"}");
    expect(() => loadOrCreateKey(path)).toThrow(/does not hold an agent key/);
    writeFileSync(path, "not json");
    expect(() => loadOrCreateKey(path)).toThrow(/not valid JSON/);
  });
});
