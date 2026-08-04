/**
 * Security tests — verify that secrets never leak into:
 *   1. API responses (provider config, CMDB config, NetBox tokens)
 *   2. Log lines produced by redactForLog
 *   3. Encryption round-trip correctness
 *
 * Run with:
 *   npx tsx --test tests/security.test.ts
 * Or if vitest is configured:
 *   npx vitest run tests/security.test.ts
 */

import assert from "assert";
import { describe, it } from "node:test";

// ─── Import the functions under test ─────────────────────────────────────────
// We import directly so no server needs to be running.
import {
  encryptSecret,
  decryptSecret,
  isEncrypted,
  encryptIfNeeded,
  encryptProviderConfig,
  decryptProviderConfig,
  redactProviderConfig,
  encryptCmdbConfig,
  decryptCmdbConfig,
  redactCmdbConfig,
  sanitizeProviderForResponse,
  sanitizeCmdbForResponse,
  sanitizeNetboxSourceForResponse,
  redactForLog,
  encryptNetboxToken,
  decryptNetboxToken,
  PROVIDER_SECRET_FIELDS,
  CMDB_SECRET_FIELDS,
} from "../server/services/secrets";
import { sanitizeErrorForLog } from "../server/services/api-errors";
import {
  buildAuthUserResponse,
  buildRunFailureLog,
  shouldFallbackToJwtClaimsOnDbLookupError,
} from "../server/routes";

// Provide a test encryption key (64-char hex = 32 bytes)
const TEST_KEY = "a".repeat(64);

function withKey<T>(fn: () => T): T {
  const prev = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = TEST_KEY;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = prev;
  }
}

// ─── Encryption / decryption round-trip ──────────────────────────────────────

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a plaintext value", () => {
    const original = "super-secret-token-abc123";
    const encrypted = withKey(() => encryptSecret(original));
    assert.ok(isEncrypted(encrypted), "should start with enc:v1:");
    assert.notStrictEqual(encrypted, original, "encrypted should differ from plaintext");

    const decrypted = withKey(() => decryptSecret(encrypted));
    assert.strictEqual(decrypted, original, "decrypted should equal original");
  });

  it("returns plaintext unchanged when no key in dev", () => {
    const original = "no-key-secret";
    const result = encryptSecret(original); // no ENCRYPTION_KEY set
    assert.strictEqual(result, original);
  });

  it("returns plaintext from decryptSecret for legacy values without prefix", () => {
    const legacy = "plaintext-legacy-token";
    const result = withKey(() => decryptSecret(legacy));
    assert.strictEqual(result, legacy);
  });

  it("encryptIfNeeded skips already-encrypted values", () => {
    const encrypted = withKey(() => encryptSecret("my-secret"));
    const again = withKey(() => encryptIfNeeded(encrypted));
    assert.strictEqual(again, encrypted, "should not double-encrypt");
  });
});

// ─── Provider config encrypt / decrypt / redact ───────────────────────────────

describe("Provider config helpers", () => {
  const rawConfig = {
    base_url: "https://proxmox.example.com",
    username: "root",
    password: "hunter2",
    token_secret: "tok-abc-secret",
    client_secret: "azure-client-secret",
    realm: "pam",
  };

  it("encryptProviderConfig encrypts all secret fields", () => {
    const encrypted = withKey(() => encryptProviderConfig(rawConfig));
    for (const field of PROVIDER_SECRET_FIELDS) {
      if ((rawConfig as any)[field]) {
        assert.ok(
          isEncrypted((encrypted as any)[field]),
          `field '${field}' should be encrypted`
        );
      }
    }
    // Non-secret fields preserved as-is
    assert.strictEqual(encrypted.base_url, rawConfig.base_url);
    assert.strictEqual(encrypted.username, rawConfig.username);
    assert.strictEqual(encrypted.realm, rawConfig.realm);
  });

  it("decryptProviderConfig recovers original values", () => {
    const encrypted = withKey(() => encryptProviderConfig(rawConfig));
    const decrypted = withKey(() => decryptProviderConfig(encrypted));
    assert.strictEqual(decrypted.password, rawConfig.password);
    assert.strictEqual(decrypted.token_secret, rawConfig.token_secret);
    assert.strictEqual(decrypted.client_secret, rawConfig.client_secret);
  });

  it("redactProviderConfig removes all secret fields from response", () => {
    const { config: redacted, secretsMeta } = withKey(() => redactProviderConfig(rawConfig));
    for (const field of PROVIDER_SECRET_FIELDS) {
      assert.ok(!(field in redacted), `field '${field}' should be removed from response`);
    }
    assert.strictEqual(redacted.base_url, rawConfig.base_url);
    assert.strictEqual(secretsMeta.has_password, true);
    assert.strictEqual(secretsMeta.has_token_secret, true);
    assert.strictEqual(secretsMeta.has_client_secret, true);
  });

  it("sanitizeProviderForResponse never returns secret values", () => {
    const provider = { id: "p1", name: "MyProvider", kind: "proxmox", config: rawConfig };
    const safe = sanitizeProviderForResponse(provider);
    const json = JSON.stringify(safe);
    assert.ok(!json.includes("hunter2"), "password must not appear in response");
    assert.ok(!json.includes("tok-abc-secret"), "token_secret must not appear in response");
    assert.ok(!json.includes("azure-client-secret"), "client_secret must not appear in response");
  });
});

// ─── CMDB config encrypt / decrypt / redact ───────────────────────────────────

describe("CMDB config helpers", () => {
  const rawCmdb = {
    url: "https://netbox.example.com",
    token: "netbox-api-token-xyz",
    password: "admin-password",
  };

  it("encryptCmdbConfig encrypts all secret fields", () => {
    const encrypted = withKey(() => encryptCmdbConfig(rawCmdb));
    for (const field of CMDB_SECRET_FIELDS) {
      if ((rawCmdb as any)[field]) {
        assert.ok(
          isEncrypted((encrypted as any)[field]),
          `field '${field}' should be encrypted`
        );
      }
    }
    assert.strictEqual(encrypted.url, rawCmdb.url);
  });

  it("decryptCmdbConfig recovers original values", () => {
    const encrypted = withKey(() => encryptCmdbConfig(rawCmdb));
    const decrypted = withKey(() => decryptCmdbConfig(encrypted));
    assert.strictEqual(decrypted.token, rawCmdb.token);
    assert.strictEqual(decrypted.password, rawCmdb.password);
  });

  it("redactCmdbConfig removes all secret fields from response", () => {
    const { config: redacted } = withKey(() => redactCmdbConfig(rawCmdb));
    assert.ok(!("token" in redacted), "token must not appear in response");
    assert.ok(!("password" in redacted), "password must not appear in response");
    assert.strictEqual(redacted.url, rawCmdb.url);
  });

  it("sanitizeCmdbForResponse never returns secret values", () => {
    const cmdb = { id: "c1", name: "NetBox", kind: "netbox", config: rawCmdb };
    const safe = sanitizeCmdbForResponse(cmdb);
    const json = JSON.stringify(safe);
    assert.ok(!json.includes("netbox-api-token-xyz"), "token must not appear in response");
    assert.ok(!json.includes("admin-password"), "password must not appear in response");
  });
});

// ─── NetBox inventory source ──────────────────────────────────────────────────

describe("NetBox inventory source sanitization", () => {
  it("sanitizeNetboxSourceForResponse removes token and sets has_token", () => {
    const source = { id: "s1", name: "Primary", url: "https://nb.example.com", token: "secret-token", enabled: true };
    const safe = sanitizeNetboxSourceForResponse(source);
    const json = JSON.stringify(safe);
    assert.ok(!json.includes("secret-token"), "token must not appear in response");
    assert.strictEqual(safe.has_token, true);
    assert.strictEqual(safe.url, source.url);
  });

  it("encryptNetboxToken / decryptNetboxToken round-trip", () => {
    const token = "my-netbox-api-token";
    const encrypted = withKey(() => encryptNetboxToken(token));
    assert.ok(isEncrypted(encrypted));
    const recovered = withKey(() => decryptNetboxToken(encrypted));
    assert.strictEqual(recovered, token);
  });
});

// ─── redactForLog ─────────────────────────────────────────────────────────────

describe("redactForLog", () => {
  it("redacts known secret keys in flat objects", () => {
    const obj = { username: "admin", password: "hunter2", token: "abc-secret" };
    const redacted = redactForLog(obj) as any;
    assert.strictEqual(redacted.username, "admin");
    assert.strictEqual(redacted.password, "[REDACTED]");
    assert.strictEqual(redacted.token, "[REDACTED]");
  });

  it("redacts nested secret keys", () => {
    const obj = { config: { url: "https://nb.example.com", token: "leaked-token" } };
    const redacted = redactForLog(obj) as any;
    assert.strictEqual(redacted.config.url, "https://nb.example.com");
    assert.strictEqual(redacted.config.token, "[REDACTED]");
  });

  it("redacts keys in arrays of objects", () => {
    const arr = [{ token: "leak1" }, { token: "leak2" }];
    const redacted = redactForLog(arr) as any[];
    assert.strictEqual(redacted[0].token, "[REDACTED]");
    assert.strictEqual(redacted[1].token, "[REDACTED]");
  });

  it("does not redact non-secret keys", () => {
    const obj = { name: "MyProvider", kind: "proxmox", url: "https://example.com" };
    const redacted = redactForLog(obj) as any;
    assert.strictEqual(redacted.name, "MyProvider");
    assert.strictEqual(redacted.url, "https://example.com");
  });

  it("does not leak Authorization header value", () => {
    const headers = { authorization: "Bearer super-secret-jwt-token", "content-type": "application/json" };
    const redacted = redactForLog(headers) as any;
    assert.strictEqual(redacted.authorization, "[REDACTED]");
    assert.strictEqual(redacted["content-type"], "application/json");
  });
});

// ─── API response contract: encrypted ciphertext must never appear raw ────────

describe("Encrypted values do not appear in API response shape", () => {
  it("provider response omits enc:v1: ciphertext", () => {
    const encryptedPassword = withKey(() => encryptSecret("hunter2"));
    const provider = {
      id: "p1", name: "Test", kind: "proxmox",
      config: { base_url: "https://px.example.com", password: encryptedPassword },
    };
    const safe = sanitizeProviderForResponse(provider);
    const json = JSON.stringify(safe);
    assert.ok(!json.includes("enc:v1:"), "encrypted ciphertext must not appear in response");
    assert.ok(!json.includes("hunter2"), "plaintext password must not appear in response");
  });

  it("cmdb response omits enc:v1: ciphertext", () => {
    const encryptedToken = withKey(() => encryptSecret("netbox-token-xyz"));
    const cmdb = {
      id: "c1", name: "NetBox", kind: "netbox",
      config: { url: "https://nb.example.com", token: encryptedToken },
    };
    const safe = sanitizeCmdbForResponse(cmdb);
    const json = JSON.stringify(safe);
    assert.ok(!json.includes("enc:v1:"), "encrypted ciphertext must not appear in response");
    assert.ok(!json.includes("netbox-token-xyz"), "plaintext token must not appear in response");
  });
});

describe("sanitizeErrorForLog", () => {
  it("redacts token-like and credential-like text from error logs", () => {
    const safe = sanitizeErrorForLog(
      new Error("request failed with Bearer jwt.secret.value at https://user:password@example.com/repo.git")
    );
    const json = JSON.stringify(safe);

    assert.ok(!json.includes("jwt.secret.value"));
    assert.ok(!json.includes("password@example.com"));
    assert.ok(json.includes("[REDACTED]"));
  });
});

describe("auth response and production fallback hardening", () => {
  it("auth response omits JWT token and returns only safe user fields", () => {
    const response = buildAuthUserResponse({
      id: "u1",
      username: "admin",
      role: "admin",
      orgId: "org-1",
    });

    assert.deepStrictEqual(response, {
      user: { id: "u1", username: "admin", role: "admin", orgId: "org-1" },
    });
    assert.ok(!("token" in response));
  });

  it("JWT claim fallback on DB lookup errors is test-only", () => {
    assert.strictEqual(shouldFallbackToJwtClaimsOnDbLookupError({ NODE_ENV: "test" }), true);
    assert.strictEqual(shouldFallbackToJwtClaimsOnDbLookupError({ NODE_ENV: "production" }), false);
    assert.strictEqual(shouldFallbackToJwtClaimsOnDbLookupError({ NODE_ENV: "development" }), false);
  });
});

describe("run failure observability", () => {
  it("sanitizes dispatcher failure messages before storing them in run logs", () => {
    const log = buildRunFailureLog(
      new Error("credential load failed with token=abc123 at https://user:password@example.com/repo.git")
    );

    assert.match(log, /^\[rovelink\] Run failed:/);
    assert.ok(!log.includes("abc123"));
    assert.ok(!log.includes("password@example.com"));
    assert.ok(log.includes("[REDACTED]"));
  });
});
