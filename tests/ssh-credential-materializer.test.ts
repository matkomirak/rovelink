import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { Credential } from "../shared/schema";
import { encryptSecret } from "../server/services/secrets";
import {
  cleanupRuntimeCredentialDir,
  loadAndMaterializeSshCredential,
  materializeSshCredentialForRun,
} from "../server/services/ssh-credential-materializer";

const PRIVATE_KEY = [
  "-----BEGIN OPENSSH PRIVATE KEY-----",
  "local-test-private-key-material",
  "-----END OPENSSH PRIVATE KEY-----",
  "",
].join("\n");

async function withEncryptionKey<T>(fn: () => Promise<T> | T): Promise<T> {
  const previous = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = "c".repeat(64);
  try {
    return await fn();
  } finally {
    if (previous === undefined) {
      delete process.env.ENCRYPTION_KEY;
    } else {
      process.env.ENCRYPTION_KEY = previous;
    }
  }
}

function makeCredential(overrides: Partial<Credential> = {}): Credential {
  return {
    id: "cred-1",
    orgId: "org-1",
    name: "Remote SSH",
    kind: "ssh_key",
    metadata: { username: "ubuntu", sshPort: 2222, strictHostKeyChecking: false },
    secretConfig: { privateKey: encryptSecret(PRIVATE_KEY) },
    secretRef: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("SSH credential materialization", () => {
  it("fetches credentials with the same orgId", async () => withEncryptionKey(async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "rovelink-creds-"));
    const observed: Array<{ id: string; orgId: string }> = [];

    const materialized = await loadAndMaterializeSshCredential({
      credentialId: "cred-1",
      orgId: "org-1",
      runId: "run-1",
      root,
      getCredential: async (id, orgId) => {
        observed.push({ id, orgId });
        return makeCredential();
      },
    });

    assert.deepEqual(observed, [{ id: "cred-1", orgId: "org-1" }]);
    assert.equal(materialized.username, "ubuntu");
    assert.equal(materialized.sshPort, 2222);
    assert.equal(materialized.strictHostKeyChecking, false);
  }));

  it("fails safely for missing credential", async () => {
    await assert.rejects(
      () => loadAndMaterializeSshCredential({
        credentialId: "missing",
        orgId: "org-1",
        runId: "run-1",
        getCredential: async () => undefined,
      }),
      /credential not found/i
    );
  });

  it("fails safely for wrong org, wrong kind, and missing private key", async () => withEncryptionKey(async () => {
    await assert.rejects(
      () => materializeSshCredentialForRun({
        credential: makeCredential({ orgId: "org-2" }),
        orgId: "org-1",
        runId: "run-1",
      }),
      /credential not found/i
    );

    await assert.rejects(
      () => materializeSshCredentialForRun({
        credential: makeCredential({ kind: "winrm" }),
        orgId: "org-1",
        runId: "run-1",
      }),
      /ssh_key/i
    );

    await assert.rejects(
      () => materializeSshCredentialForRun({
        credential: makeCredential({ secretConfig: {} }),
        orgId: "org-1",
        runId: "run-1",
      }),
      /missing private key/i
    );
  }));

  it("writes private key with safe permissions where supported and cleans up", async () => withEncryptionKey(async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "rovelink-creds-"));
    const materialized = await materializeSshCredentialForRun({
      credential: makeCredential(),
      orgId: "org-1",
      runId: "run-1",
      root,
    });

    const stored = await fs.readFile(materialized.privateKeyPath, "utf8");
    assert.equal(stored, PRIVATE_KEY);

    if (process.platform !== "win32") {
      const stat = await fs.stat(materialized.privateKeyPath);
      assert.equal(stat.mode & 0o777, 0o600);
    }

    await cleanupRuntimeCredentialDir("org-1", "run-1", root);
    await assert.rejects(() => fs.stat(materialized.privateKeyPath), /ENOENT/);
  }));
});
