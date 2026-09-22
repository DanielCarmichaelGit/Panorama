import Database from "better-sqlite3-multiple-ciphers";
export type DB = import("better-sqlite3").Database;

/**
 * Opens the database, applying the SQLCipher key when there is one. Only a key that
 * cannot be right is reported as `bad_key`: everything else (a missing directory, a
 * read-only file, a disk error) is rethrown as it came, so callers do not tell the
 * owner their password is wrong when the real fault is something else.
 */
export function openDatabase(file: string, keyHex: string | null): DB {
  if (keyHex !== null && !/^[0-9a-f]{64}$/.test(keyHex)) throw new Error("bad_key");
  const db = new Database(file) as DB;
  try {
    if (keyHex) {
      db.pragma("cipher='sqlcipher'");
      db.pragma("legacy=4");
      db.pragma(`key="x'${keyHex}'"`);
    }
    db.prepare("select count(*) from sqlite_master").get();
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    return db;
  } catch (e) {
    db.close();
    if ((e as { code?: string }).code === "SQLITE_NOTADB") throw new Error("bad_key");
    throw e;
  }
}
