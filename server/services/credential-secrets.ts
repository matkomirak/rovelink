import type { Credential } from "@shared/schema";
import { encryptSecret, isEncrypted } from "./secrets";

const SSH_PRIVATE_KEY_RE = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+-----END [A-Z ]*PRIVATE KEY-----/;

export interface CredentialRequestBody {
  name?: unknown;
  kind?: unknown;
  metadata?: unknown;
  secretRef?: unknown;
  privateKey?: unknown;
  passphrase?: unknown;
}

export interface SanitizedCredential {
  id: string;
  orgId: string | null;
  name: string;
  kind: string;
  metadata: Record<string, unknown>;
  secretRef: string | null;
  hasSecret: boolean;
  hasPrivateKey: boolean;
  createdAt: Date;
  updatedAt?: Date;
}

export function sanitizeCredentialForResponse(credential: Credential): SanitizedCredential {
  const secretConfig = normalizeSecretConfig(credential.secretConfig);
  return {
    id: credential.id,
    orgId: credential.orgId ?? null,
    name: credential.name,
    kind: credential.kind,
    metadata: normalizeMetadata(credential.metadata),
    secretRef: credential.secretRef ?? null,
    hasSecret: hasStoredSecret(secretConfig),
    hasPrivateKey: Boolean(secretConfig.privateKey),
    createdAt: credential.createdAt,
    updatedAt: credential.updatedAt,
  };
}

export function buildCredentialCreate(orgId: string, body: CredentialRequestBody): Record<string, unknown> {
  const name = requireString(body.name, "name");
  const kind = requireString(body.kind, "kind");
  if (body.passphrase) {
    throw new Error("SSH key passphrases are not supported yet");
  }

  const metadata = validateMetadata(kind, body.metadata);
  const privateKey = typeof body.privateKey === "string" ? body.privateKey.trim() : "";
  const secretConfig: Record<string, unknown> = {};

  if (kind === "ssh_key") {
    if (!privateKey) {
      throw new Error("privateKey is required for ssh_key credentials");
    }
    secretConfig.privateKey = encryptPrivateKey(privateKey);
  } else if (privateKey) {
    throw new Error("privateKey is only supported for ssh_key credentials");
  }

  return {
    orgId,
    name,
    kind,
    metadata,
    secretRef: optionalString(body.secretRef),
    secretConfig,
  };
}

export function buildCredentialUpdate(
  existing: Credential,
  body: CredentialRequestBody
): Record<string, unknown> {
  if (body.passphrase) {
    throw new Error("SSH key passphrases are not supported yet");
  }

  const kind = body.kind === undefined ? existing.kind : requireString(body.kind, "kind");
  const update: Record<string, unknown> = { kind };

  if (body.name !== undefined) {
    update.name = requireString(body.name, "name");
  }
  if (body.metadata !== undefined || kind === "ssh_key") {
    update.metadata = validateMetadata(kind, body.metadata ?? existing.metadata);
  }
  if (body.secretRef !== undefined) {
    update.secretRef = optionalString(body.secretRef);
  }

  const privateKey = typeof body.privateKey === "string" ? body.privateKey.trim() : "";
  if (privateKey) {
    if (kind !== "ssh_key") {
      throw new Error("privateKey is only supported for ssh_key credentials");
    }
    update.secretConfig = {
      ...normalizeSecretConfig(existing.secretConfig),
      privateKey: encryptPrivateKey(privateKey),
    };
  }

  return update;
}

export function hasStoredSecret(secretConfig: unknown): boolean {
  return Object.keys(normalizeSecretConfig(secretConfig)).length > 0;
}

function validateMetadata(kind: string, value: unknown): Record<string, unknown> {
  const metadata = normalizeMetadata(value);
  if (kind !== "ssh_key") {
    return metadata;
  }

  const username = metadata.username;
  if (typeof username !== "string" || username.trim().length === 0) {
    throw new Error("username is required for ssh_key credentials");
  }

  const sanitized: Record<string, unknown> = {
    username: username.trim(),
  };

  if (metadata.sshPort !== undefined && metadata.sshPort !== "") {
    const sshPort = Number(metadata.sshPort);
    if (!Number.isInteger(sshPort) || sshPort < 1 || sshPort > 65535) {
      throw new Error("sshPort must be a number between 1 and 65535");
    }
    sanitized.sshPort = sshPort;
  }

  if (metadata.become !== undefined) sanitized.become = Boolean(metadata.become);
  if (typeof metadata.becomeMethod === "string" && metadata.becomeMethod.trim()) {
    sanitized.becomeMethod = metadata.becomeMethod.trim();
  }
  if (typeof metadata.becomeUser === "string" && metadata.becomeUser.trim()) {
    sanitized.becomeUser = metadata.becomeUser.trim();
  }
  if (metadata.strictHostKeyChecking !== undefined) {
    sanitized.strictHostKeyChecking = Boolean(metadata.strictHostKeyChecking);
  }

  return sanitized;
}

function encryptPrivateKey(privateKey: string): string {
  if (!SSH_PRIVATE_KEY_RE.test(privateKey)) {
    throw new Error("privateKey must be a PEM encoded private key");
  }
  const encrypted = encryptSecret(privateKey);
  if (!isEncrypted(encrypted)) {
    throw new Error("ENCRYPTION_KEY is required to store SSH private keys");
  }
  return encrypted;
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function normalizeSecretConfig(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} is required`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
