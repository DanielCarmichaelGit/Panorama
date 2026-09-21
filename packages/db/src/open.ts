import Database from "better-sqlite3-multiple-ciphers";
export type DB = import("better-sqlite3").Database;

export function openDatabase(file: string, keyHex: string | null): DB {
  const db = new Database(file) as DB;
  try {
    if (keyHex) {
      if (!/^[0-9a-f]{64}$/.test(keyHex)) throw new Error("bad_key");
      db.pragma("cipher='sqlcipher'");
      db.pragma("legacy=4");
      db.pragma(`key="x'${keyHex}'"`);
    }
    db.prepare("select count(*) from sqlite_master").get();
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    return db;
  } catch {
    db.close();
    throw new Error("bad_key");
  }
}
