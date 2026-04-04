/**
 * Secret handling service — AES-256-GCM encryption/decryption for sensitive fields.
 *
 * Secrets stored in the database are prefixed with `enc:v1:` so the format is:
 *   enc:v1:<nonce_hex>:<tag_hex>:<ciphertext_hex>
 *
 * The master key is read from the ENCRYPTION_KEY environment variable.
 * It must be a 64-character hex string (32 bytes = 256 bits).
 *
 * If ENCRYPTION_KEY is not set:
 *   - In production: startup will fail (enforced in server/index.ts)
 *   - In development: secrets are stored plaintext with a warning
 *
 * Backward compatibility:
 *   Values that do NOT start with `enc:v1:` are treated as plaintext (legacy).
 *   They will be re-encrypted on the next write.
 */

import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const ENC_PREFIX = "enc:v1:";

function getKey(): Buffer | null {
  const keyHex = process.env.ENCRYPTION_KEY;
  if (!keyHex) return null;
  if (keyHex.length !== 64) {
    throw new Error("ENCRYPTION_KEY must be a 64-character hex string (32 bytes)");
  }
  return Buffer.from(keyHex, "hex");
}

/**
 * Encrypt a plaintext secret. Returns the `enc:v1:...` encoded string.
 * If no ENCRYPTION_KEY is configured, returns the plaintext unchanged (dev mode).
 */
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  if (!key) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("ENCRYPTION_KEY must be set in production");
    }
    return plaintext;
  }

  const nonce = crypto.randomBytes(NONCE_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, nonce);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${ENC_PREFIX}${nonce.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypt a secret. Handles both `enc:v1:...` encrypted values and
 * legacy plaintext values (returned as-is for backward compat).
 */
export function decryptSecret(stored: string): string {
  if (!stored.startsWith(ENC_PREFIX)) {
    return stored;
  }

  const key = getKey();
  if (!key) {
    throw new Error("ENCRYPTION_KEY is required to decrypt secrets");
  }

  const parts = stored.slice(ENC_PREFIX.length).split(":");
  if (parts.length !== 3) {
    throw new Error("Malformed encrypted secret");
  }

  const nonce = Buffer.from(parts[0], "hex");
  const tag = Buffer.from(parts[1], "hex");
  const ciphertext = Buffer.from(parts[2], "hex");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, nonce);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/**
 * Returns true if a stored value is encrypted (has the enc:v1: prefix).
 */
export function isEncrypted(value: string): boolean {
  return value.startsWith(ENC_PREFIX);
}

/**
 * Encrypt only if the value is not already encrypted.
 * Use this on writes where the value may have been read and re-submitted.
 */
export function encryptIfNeeded(value: string): string {
  if (isEncrypted(value)) return value;
  return encryptSecret(value);
}

// ─── Secret field definitions ────────────────────────────────────────────────

/** Provider config keys that are secrets */
export const PROVIDER_SECRET_FIELDS = [
  "client_secret",
  "password",
  "token_secret",
  "api_key",
  "secret",
] as const;

/** CMDB config keys that are secrets */
export const CMDB_SECRET_FIELDS = ["token", "password", "api_key"] as const;

// ─── Provider config helpers ─────────────────────────────────────────────────

/**
 * Encrypt all secret fields in a provider config object before storing.
 */
export function encryptProviderConfig(config: Record<string, any>): Record<string, any> {
  const result = { ...config };
  for (const field of PROVIDER_SECRET_FIELDS) {
    if (typeof result[field] === "string" && result[field]) {
      result[field] = encryptIfNeeded(result[field]);
    }
  }
  return result;
}

/**
 * Decrypt all secret fields in a provider config object for internal use.
 */
export function decryptProviderConfig(config: Record<string, any>): Record<string, any> {
  const result = { ...config };
  for (const field of PROVIDER_SECRET_FIELDS) {
    if (typeof result[field] === "string" && result[field]) {
      try {
        result[field] = decryptSecret(result[field]);
      } catch {
        // Leave as-is if decryption fails (e.g. plaintext legacy value)
      }
    }
  }
  return result;
}

/**
 * Redact all secret fields from a provider config object for API responses.
 * Returns the sanitized config plus has_<field>: true metadata.
 */
export function redactProviderConfig(config: Record<string, any>): {
  config: Record<string, any>;
  secretsMeta: Record<string, boolean>;
} {
  const sanitized = { ...config };
  const secretsMeta: Record<string, boolean> = {};

  for (const field of PROVIDER_SECRET_FIELDS) {
    if (sanitized[field]) {
      secretsMeta[`has_${field}`] = true;
      delete sanitized[field];
    }
  }

  return { config: sanitized, secretsMeta };
}

// ─── CMDB config helpers ─────────────────────────────────────────────────────

export function encryptCmdbConfig(config: Record<string, any>): Record<string, any> {
  const result = { ...config };
  for (const field of CMDB_SECRET_FIELDS) {
    if (typeof result[field] === "string" && result[field]) {
      result[field] = encryptIfNeeded(result[field]);
    }
  }
  return result;
}

export function decryptCmdbConfig(config: Record<string, any>): Record<string, any> {
  const result = { ...config };
  for (const field of CMDB_SECRET_FIELDS) {
    if (typeof result[field] === "string" && result[field]) {
      try {
        result[field] = decryptSecret(result[field]);
      } catch {
        // Leave as-is
      }
    }
  }
  return result;
}

export function redactCmdbConfig(config: Record<string, any>): {
  config: Record<string, any>;
  secretsMeta: Record<string, boolean>;
} {
  const sanitized = { ...config };
  const secretsMeta: Record<string, boolean> = {};

  for (const field of CMDB_SECRET_FIELDS) {
    if (sanitized[field]) {
      secretsMeta[`has_${field}`] = true;
      delete sanitized[field];
    }
  }

  return { config: sanitized, secretsMeta };
}

// ─── Response sanitizers ─────────────────────────────────────────────────────

/** Strip secrets from a provider account for API responses */
export function sanitizeProviderForResponse(provider: any): any {
  if (!provider) return provider;
  const config = (provider.config as Record<string, any>) || {};
  const { config: safeConfig, secretsMeta } = redactProviderConfig(config);
  return { ...provider, config: safeConfig, ...secretsMeta };
}

/** Strip secrets from a CMDB account for API responses */
export function sanitizeCmdbForResponse(cmdb: any): any {
  if (!cmdb) return cmdb;
  const config = (cmdb.config as Record<string, any>) || {};
  const { config: safeConfig, secretsMeta } = redactCmdbConfig(config);
  return { ...cmdb, config: safeConfig, ...secretsMeta };
}

/** Strip token from a NetBox inventory source for API responses */
export function sanitizeNetboxSourceForResponse(source: any): any {
  if (!source) return source;
  const has_token = Boolean(source.token);
  const { token: _token, ...rest } = source;
  return { ...rest, has_token };
}

// ─── Log redaction ───────────────────────────────────────────────────────────

const REDACT_KEYS = new Set([
  "secret",
  "client_secret",
  "password",
  "token",
  "api_key",
  "authorization",
  "x-api-key",
  "netbox_token",
]);

/**
 * Recursively redact sensitive keys from an object (for safe logging).
 */
export function redactForLog(obj: unknown, depth = 0): unknown {
  if (depth > 5 || obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map((item) => redactForLog(item, depth + 1));

  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (REDACT_KEYS.has(k.toLowerCase())) {
      result[k] = v ? "[REDACTED]" : v;
    } else {
      result[k] = redactForLog(v, depth + 1);
    }
  }
  return result;
}

// ─── NetBox source helpers ────────────────────────────────────────────────────

export function encryptNetboxToken(token: string): string {
  return encryptIfNeeded(token);
}

export function decryptNetboxToken(stored: string): string {
  return decryptSecret(stored);
}
