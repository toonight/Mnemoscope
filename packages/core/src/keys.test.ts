import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import {
  encryptPrivateKeyPem,
  decryptPrivateKeyPem,
  backupPrivateKey,
  restorePrivateKey,
} from "./keys.js";

function freshKeyPem(): string {
  const { privateKey } = generateKeyPairSync("ed25519");
  return privateKey.export({ format: "pem", type: "pkcs8" }).toString();
}

test("encryptPrivateKeyPem -> decryptPrivateKeyPem round-trips the PEM", async () => {
  const pem = freshKeyPem();
  const env = await encryptPrivateKeyPem(pem, "correct horse battery staple");
  assert.equal(env.version, 1);
  assert.equal(env.cipher, "aes-256-gcm");
  assert.equal(env.kdf, "scrypt");
  const back = await decryptPrivateKeyPem(env, "correct horse battery staple");
  assert.equal(back, pem);
});

test("decrypt with wrong passphrase fails (auth tag mismatch)", async () => {
  const pem = freshKeyPem();
  const env = await encryptPrivateKeyPem(pem, "passphrase-one");
  await assert.rejects(() => decryptPrivateKeyPem(env, "passphrase-two"));
});

test("encryption produces different ciphertext on each call (IV randomness)", async () => {
  const pem = freshKeyPem();
  const env1 = await encryptPrivateKeyPem(pem, "same-passphrase");
  const env2 = await encryptPrivateKeyPem(pem, "same-passphrase");
  assert.notEqual(env1.ciphertext, env2.ciphertext);
  assert.notEqual(env1.iv, env2.iv);
  assert.notEqual(env1.salt, env2.salt);
});

test("rejects passphrases shorter than 8 characters", async () => {
  await assert.rejects(() => encryptPrivateKeyPem("dummy", "short"), /at least 8/);
});

test("backupPrivateKey + restorePrivateKey round-trip on disk; restore writes mode 0600", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mnemoscope-keys-"));
  const keyPath = join(dir, "ed25519.key");
  const backupPath = join(dir, "backup", "vault.key.enc");
  const restoredPath = join(dir, "restored", "ed25519.key");
  writeFileSync(keyPath, freshKeyPem(), { mode: 0o600 });

  await backupPrivateKey(keyPath, backupPath, "passphrase-correct");
  const backupStat = statSync(backupPath);
  assert.equal(backupStat.mode & 0o777, 0o600, "backup file must be 0600");

  await restorePrivateKey(backupPath, restoredPath, "passphrase-correct");
  const restored = readFileSync(restoredPath, "utf8");
  const original = readFileSync(keyPath, "utf8");
  assert.equal(restored, original);
  const restoredStat = statSync(restoredPath);
  assert.equal(restoredStat.mode & 0o777, 0o600, "restored key must be 0600");
  rmSync(dir, { recursive: true, force: true });
});

test("restorePrivateKey refuses to overwrite an existing key without overwrite:true", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mnemoscope-keys-"));
  const keyPath = join(dir, "ed25519.key");
  const backupPath = join(dir, "backup.enc");
  writeFileSync(keyPath, freshKeyPem(), { mode: 0o600 });
  await backupPrivateKey(keyPath, backupPath, "passphrase-correct");
  await assert.rejects(() => restorePrivateKey(backupPath, keyPath, "passphrase-correct"), /refusing to overwrite/);
  await restorePrivateKey(backupPath, keyPath, "passphrase-correct", { overwrite: true });
  rmSync(dir, { recursive: true, force: true });
});

test("rejects an envelope with a bumped version", async () => {
  const pem = freshKeyPem();
  const env = await encryptPrivateKeyPem(pem, "correct passphrase");
  // @ts-expect-error testing forward incompatibility
  env.version = 99;
  await assert.rejects(() => decryptPrivateKeyPem(env, "correct passphrase"), /version 99/);
});
