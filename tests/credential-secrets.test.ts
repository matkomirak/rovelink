import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Credential } from "../shared/schema";
import {
  buildCredentialCreate,
  buildCredentialUpdate,
  sanitizeCredentialForResponse,
} from "../server/services/credential-secrets";
import { isEncrypted } from "../server/services/secrets";

const TEST_KEY = "b".repeat(64);
const PRIVATE_KEY = [
  "-----BEGIN OPENSSH PRIVATE KEY-----",
  "local-test-private-key-material",
  "-----END OPENSSH PRIVATE KEY-----",
].join("\n");

function withEncryptionKey<T>(fn: () => T): T {
  const previous = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = TEST_KEY;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = previous;
  }
}

function makeCredential(overrides: Partial<Credential> = {}): Credential {
  return {
    id: "cred-1",
    orgId: "org-1",
    name: "SSH",
    kind: "ssh_key",
    metadata: { username: "ansible", sshPort: 22 },
    secretConfig: {},
    secretRef: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  } as Credential;
}

describe("credential secret storage", () => {
  it("encrypts SSH private keys before persistence", () => {
    const created = withEncryptionKey(() =>
      buildCredentialCreate("org-1", {
        name: "Production SSH",
        kind: "ssh_key",
        metadata: { username: "ansible", sshPort: "22" },
        privateKey: PRIVATE_KEY,
      })
    );

    const secretConfig = created.secretConfig as Record<string, string>;
    assert.ok(isEncrypted(secretConfig.privateKey));
    assert.ok(!secretConfig.privateKey.includes(PRIVATE_KEY));
    assert.deepEqual(created.metadata, {
      username: "ansible",
      sshPort: 22,
    });
  });

  it("sanitized responses hide plaintext and encrypted ciphertext", () => {
    const encryptedPrivateKey = withEncryptionKey(() =>
      (buildCredentialCreate("org-1", {
        name: "Production SSH",
        kind: "ssh_key",
        metadata: { username: "ansible" },
        privateKey: PRIVATE_KEY,
      }).secretConfig as Record<string, string>).privateKey
    );

    const credential = makeCredential({
      secretConfig: { privateKey: encryptedPrivateKey },
    });
    const safe = sanitizeCredentialForResponse(credential);
    const json = JSON.stringify(safe);

    assert.equal(safe.hasSecret, true);
    assert.equal(safe.hasPrivateKey, true);
    assert.ok(!json.includes(PRIVATE_KEY));
    assert.ok(!json.includes("enc:v1:"));
    assert.ok(!("secretConfig" in safe));
  });

  it("preserves an existing private key when update omits privateKey", () => {
    const existingPrivateKey = withEncryptionKey(() =>
      (buildCredentialCreate("org-1", {
        name: "Production SSH",
        kind: "ssh_key",
        metadata: { username: "ansible" },
        privateKey: PRIVATE_KEY,
      }).secretConfig as Record<string, string>).privateKey
    );

    const existing = makeCredential({
      secretConfig: { privateKey: existingPrivateKey },
    });
    const update = buildCredentialUpdate(existing, {
      name: "Renamed SSH",
      metadata: { username: "deploy", sshPort: 2222 },
    });

    assert.equal(update.name, "Renamed SSH");
    assert.deepEqual(update.metadata, { username: "deploy", sshPort: 2222 });
    assert.equal(update.secretConfig, undefined);
  });

  it("replaces the private key only when a new privateKey is sent", () => {
    const existing = makeCredential({
      secretConfig: { privateKey: "enc:v1:old" },
    });
    const update = withEncryptionKey(() =>
      buildCredentialUpdate(existing, {
        privateKey: PRIVATE_KEY,
      })
    );

    const secretConfig = update.secretConfig as Record<string, string>;
    assert.ok(isEncrypted(secretConfig.privateKey));
    assert.notEqual(secretConfig.privateKey, "enc:v1:old");
  });

  it("rejects invalid ssh_key payloads with useful validation errors", () => {
    assert.throws(
      () => buildCredentialCreate("org-1", { name: "SSH", kind: "ssh_key", privateKey: PRIVATE_KEY }),
      /username/i
    );
    assert.throws(
      () => buildCredentialCreate("org-1", { name: "SSH", kind: "ssh_key", metadata: { username: "ansible" } }),
      /privateKey/i
    );
    assert.throws(
      () =>
        buildCredentialCreate("org-1", {
          name: "SSH",
          kind: "ssh_key",
          metadata: { username: "ansible" },
          privateKey: PRIVATE_KEY,
          passphrase: "not-supported",
        }),
      /passphrases are not supported/i
    );
  });
});
