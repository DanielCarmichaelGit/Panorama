import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ID_RE = /^[0-9a-f-]{36}$/;
const IV_LEN = 12;
const TAG_LEN = 16;

/** The on-disk path for an attachment. Throws on anything that is not a UUID, so a bad id
 *  can never be used to read or write outside the files directory. */
export function filePath(dataDir: string, id: string): string {
  if (!ID_RE.test(id)) throw new Error("bad_attachment_id");
  return join(dataDir, "files", id);
}

function encrypt(key: Buffer, bytes: Buffer): Buffer {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([iv, ciphertext, cipher.getAuthTag()]);
}

function decrypt(key: Buffer, blob: Buffer): Buffer {
  const iv = blob.subarray(0, IV_LEN);
  const tag = blob.subarray(blob.length - TAG_LEN);
  const ciphertext = blob.subarray(IV_LEN, blob.length - TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error("file_auth");
  }
}

/** Writes an attachment's bytes to disk, encrypted with AES-256-GCM when `key` is given.
 *  The files directory and the file itself are created with owner-only permissions. */
export async function storeFile(dataDir: string, key: Buffer | null, id: string, bytes: Buffer): Promise<void> {
  const dir = join(dataDir, "files");
  mkdirSync(dir, { recursive: true });
  chmodSync(dir, 0o700);
  const path = filePath(dataDir, id);
  writeFileSync(path, key ? encrypt(key, bytes) : bytes);
  chmodSync(path, 0o600);
}

/** Reads an attachment's plaintext bytes back. Throws `Error("file_auth")` when `key` does
 *  not match the tag stored with the file (wrong key, or tampered ciphertext). */
export async function readFile(dataDir: string, key: Buffer | null, id: string): Promise<Buffer> {
  const raw = readFileSync(filePath(dataDir, id));
  return key ? decrypt(key, raw) : raw;
}
