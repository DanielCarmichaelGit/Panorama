import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { filePath, readFile, storeFile } from "./files";
const id = "0f0f0f0f-0000-4000-8000-000000000001";
describe("files", () => {
  it("round trips plain and encrypted bytes and refuses a tampered ciphertext", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pan-files-")); const key = Buffer.alloc(32, 7); const bytes = Buffer.from("hello attachments");
    await storeFile(dir, null, id, bytes); expect(await readFile(dir, null, id)).toEqual(bytes);
    await storeFile(dir, key, id, bytes);
    expect(readFileSync(filePath(dir, id)).includes("hello")).toBe(false);
    expect(await readFile(dir, key, id)).toEqual(bytes);
    await expect(readFile(dir, Buffer.alloc(32, 8), id)).rejects.toThrow("file_auth");
    expect(() => filePath(dir, "../etc/passwd")).toThrow();
  });
});
