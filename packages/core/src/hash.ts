import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
export const sha256Hex = (s: string): string => bytesToHex(sha256(utf8ToBytes(s)));
export const randomHex = (bytes: number): string => bytesToHex(crypto.getRandomValues(new Uint8Array(bytes)));
