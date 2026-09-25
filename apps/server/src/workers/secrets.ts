import { decrypt, encrypt } from "../files";

// A webhook destination's secret at rest. With encryption on, the server holds the database key
// in memory between unlock and lock (ctx.fileKey), and the secret is sealed under it with the
// same AES-256-GCM helper attachments use, marked by a prefix so a plain value is still readable.
// This is the same key SQLCipher already protects the file with, so it adds nothing against
// someone who holds that key; what it buys is that the secret never sits in clear in the
// server's own view of the row (a table dump, a debug query, a future export) and can only be
// opened by the worker while the server is unlocked. With encryption off there is no key, and
// the secret is stored as it is, like everything else in that database.

const PREFIX = "gcm:";

export function sealSecret(key: Buffer | null, secret: string): string {
  return key ? PREFIX + encrypt(key, Buffer.from(secret, "utf8")).toString("base64") : secret;
}

/** Throws `Error("secret_sealed")` when a sealed value meets a server that holds no key. */
export function openSecret(key: Buffer | null, stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored;
  if (!key) throw new Error("secret_sealed");
  return decrypt(key, Buffer.from(stored.slice(PREFIX.length), "base64")).toString("utf8");
}
