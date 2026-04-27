export { computeRotScore, type RotScore, type VaultSignature } from "./rot-score.js";
export { extractSignature } from "./signatures.js";
export { tierVault, type TieredVault, type TierLayer } from "./tiering.js";
export {
  Journal,
  type JournalEntry,
  type JournalOp,
  type VerifiedJournalEntry,
  GENESIS_PREV_HASH,
} from "./journal.js";
export {
  encryptPrivateKeyPem,
  decryptPrivateKeyPem,
  backupPrivateKey,
  restorePrivateKey,
  type EncryptedKeyEnvelope,
} from "./keys.js";
export {
  digestSha256,
  digestForEntrySig,
  requestCalendarTimestamp,
  composeOtsFile,
  parseOtsFile,
  verifyOtsHeaderForDigest,
  type CalendarRequest,
  type ParsedOtsFile,
} from "./timestamp.js";
