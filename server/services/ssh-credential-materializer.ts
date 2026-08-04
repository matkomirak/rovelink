import { chmod, mkdir, rm, writeFile } from "fs/promises";
import path from "path";
import type { Credential } from "@shared/schema";
import { storage } from "../storage";
import { decryptSecret } from "./secrets";

export interface MaterializedSshCredential {
  privateKeyPath: string;
  username: string;
  sshPort?: number;
  strictHostKeyChecking: boolean;
}

export interface MaterializeCredentialOptions {
  credentialId: string | null | undefined;
  orgId: string;
  runId: string;
  root?: string;
  getCredential?: (id: string, orgId: string) => Promise<Credential | undefined>;
}

export function runtimeCredentialsRoot(root = path.resolve(process.cwd(), "runtime", "credentials")): string {
  return path.resolve(root);
}

export async function loadAndMaterializeSshCredential(
  options: MaterializeCredentialOptions
): Promise<MaterializedSshCredential> {
  if (!options.credentialId) {
    throw new Error("Remote local execution requires an ssh_key credential.");
  }

  const getCredential = options.getCredential ?? storage.getCredential.bind(storage);
  const credential = await getCredential(options.credentialId, options.orgId);
  if (!credential) {
    throw new Error("SSH credential not found.");
  }

  return materializeSshCredentialForRun({
    credential,
    orgId: options.orgId,
    runId: options.runId,
    root: options.root,
  });
}

export async function materializeSshCredentialForRun(options: {
  credential: Credential;
  orgId: string;
  runId: string;
  root?: string;
}): Promise<MaterializedSshCredential> {
  const { credential, orgId, runId } = options;

  if (credential.orgId !== orgId) {
    throw new Error("SSH credential not found.");
  }
  if (credential.kind !== "ssh_key") {
    throw new Error("Only ssh_key credentials are supported for remote local execution.");
  }

  const metadata = normalizeRecord(credential.metadata);
  const username = typeof metadata.username === "string" ? metadata.username.trim() : "";
  if (!username) {
    throw new Error("SSH credential is missing username metadata.");
  }

  const secretConfig = normalizeRecord(credential.secretConfig);
  const encryptedPrivateKey = typeof secretConfig.privateKey === "string" ? secretConfig.privateKey : "";
  if (!encryptedPrivateKey) {
    throw new Error("SSH credential is missing private key material.");
  }

  const privateKey = decryptSecret(encryptedPrivateKey);
  const dir = runtimeCredentialDir(orgId, runId, options.root);
  await mkdir(dir, { recursive: true });

  const privateKeyPath = path.join(dir, "id_ansible");
  await writeFile(privateKeyPath, privateKey.endsWith("\n") ? privateKey : `${privateKey}\n`, { mode: 0o600 });
  await chmodPrivateKey(privateKeyPath);

  const sshPortValue = metadata.sshPort === undefined ? undefined : Number(metadata.sshPort);
  const sshPort = Number.isInteger(sshPortValue) && sshPortValue! > 0 && sshPortValue! <= 65535
    ? sshPortValue
    : undefined;

  return {
    privateKeyPath,
    username,
    sshPort,
    strictHostKeyChecking: metadata.strictHostKeyChecking !== false,
  };
}

export async function cleanupRuntimeCredentialDir(orgId: string, runId: string, root?: string): Promise<void> {
  await rm(runtimeCredentialDir(orgId, runId, root), { recursive: true, force: true });
}

export async function cleanupStaleRuntimeCredentials(root?: string): Promise<void> {
  await rm(runtimeCredentialsRoot(root), { recursive: true, force: true });
}

function runtimeCredentialDir(orgId: string, runId: string, root?: string): string {
  assertSafePathSegment(orgId, "orgId");
  assertSafePathSegment(runId, "runId");

  const base = runtimeCredentialsRoot(root);
  const dir = path.resolve(base, orgId, runId);
  if (dir !== base && !dir.startsWith(base + path.sep)) {
    throw new Error("Refusing to write credential material outside the runtime credential directory.");
  }
  return dir;
}

function assertSafePathSegment(value: string, field: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`${field} contains unsupported characters.`);
  }
}

async function chmodPrivateKey(privateKeyPath: string): Promise<void> {
  try {
    await chmod(privateKeyPath, 0o600);
  } catch {
    // Windows and some mounted filesystems may not support POSIX modes.
  }
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
