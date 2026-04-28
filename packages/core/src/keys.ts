import { promisify } from "node:util";
import { randomBytes, scrypt as scryptCb, createCipheriv, createDecipheriv } from "node:crypto";
import { readFile, writeFile, chmod, mkdir, access, constants } from "node:fs/promises";
import { dirname } from "node:path";

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number, options?: object) => Promise<Buffer>;

/**
 * Backup file format for an encrypted Mnemoscope private key.
 *
 * The escrow path is intentionally minimal: encrypt the existing PEM
 * private key with AES-256-GCM, derive the symmetric key from a
 * passphrase via scrypt, write a single self-describing JSON file.
 * No network, no external services, no extra dependencies. Restore
 * decrypts and writes the PEM back into the vault. Lose the
 * passphrase and the backup is unrecoverable — that is the trade.
 *
 * The format is versioned so that v2 can swap algorithms cleanly
 * (e.g. argon2id) without breaking existing backups.
 */
export type EncryptedKeyEnvelope = {
  version: 1;
  kdf: "scrypt";
  kdfParams: { N: number; r: number; p: number };
  salt: string;
  cipher: "aes-256-gcm";
  iv: string;
  ciphertext: string;
  tag: string;
  keyType: "ed25519-pkcs8-pem";
  comment?: string;
};

const KDF_PARAMS = { N: 1 << 15, r: 8, p: 1 };
const SALT_LEN = 16;
const IV_LEN = 12;
const KEY_LEN = 32;
// Node's default scrypt maxmem is exactly 32 MiB; raise it so the params above fit.
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

export async function encryptPrivateKeyPem(pem: string, passphrase: string, comment?: string): Promise<EncryptedKeyEnvelope> {
  if (passphrase.length < 8) throw new Error("passphrase must be at least 8 characters");
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = await scrypt(passphrase, salt, KEY_LEN, { ...KDF_PARAMS, maxmem: SCRYPT_MAXMEM });
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(pem, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    version: 1,
    kdf: "scrypt",
    kdfParams: { ...KDF_PARAMS },
    salt: salt.toString("base64"),
    cipher: "aes-256-gcm",
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: tag.toString("base64"),
    keyType: "ed25519-pkcs8-pem",
    ...(comment ? { comment } : {}),
  };
}

export async function decryptPrivateKeyPem(envelope: EncryptedKeyEnvelope, passphrase: string): Promise<string> {
  if (envelope.version !== 1) throw new Error(`unsupported envelope version ${String(envelope.version)}`);
  if (envelope.kdf !== "scrypt") throw new Error(`unsupported KDF ${String(envelope.kdf)}`);
  if (envelope.cipher !== "aes-256-gcm") throw new Error(`unsupported cipher ${String(envelope.cipher)}`);
  const salt = Buffer.from(envelope.salt, "base64");
  const iv = Buffer.from(envelope.iv, "base64");
  const ciphertext = Buffer.from(envelope.ciphertext, "base64");
  const tag = Buffer.from(envelope.tag, "base64");
  const key = await scrypt(passphrase, salt, KEY_LEN, { ...envelope.kdfParams, maxmem: SCRYPT_MAXMEM });
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const pem = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  return pem;
}

export async function backupPrivateKey(privateKeyPath: string, outputPath: string, passphrase: string, comment?: string): Promise<void> {
  const pem = await readFile(privateKeyPath, "utf8");
  const envelope = await encryptPrivateKeyPem(pem, passphrase, comment);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(envelope, null, 2), "utf8");
  await chmod(outputPath, 0o600);
}

export async function restorePrivateKey(backupPath: string, privateKeyPath: string, passphrase: string, opts: { overwrite?: boolean } = {}): Promise<void> {
  if (!opts.overwrite) {
    try {
      await access(privateKeyPath, constants.F_OK);
      throw new Error(`refusing to overwrite existing key at ${privateKeyPath}; pass overwrite: true to force`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
  const envelope = JSON.parse(await readFile(backupPath, "utf8")) as EncryptedKeyEnvelope;
  const pem = await decryptPrivateKeyPem(envelope, passphrase);
  await mkdir(dirname(privateKeyPath), { recursive: true });
  await writeFile(privateKeyPath, pem, "utf8");
  await chmod(privateKeyPath, 0o600);
}
