import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createHash, createPrivateKey } from "node:crypto";
import { tmpdir } from "node:os";
import type { Credential, JobTemplate, NetboxVm, Project } from "../../shared/schema";
import { decryptSecret, isEncrypted } from "./secrets";
import { assertSafeConnectionUser, isSafeInventoryAddress, runnerEnvironment, validateExtraVars } from "./execution-inputs";
import { resolveSafePlaybookPath } from "./safe-playbook-path";

export interface LocalPrerequisites { configured: boolean; playbookSha256?: string }

export function isPreflightLocalRunnerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ROVELINK_LOCAL_RUNNER_ENABLED === "true";
}

export function hasUsableSshCredential(credential: Credential): boolean {
  try {
    const metadata = credential.metadata as Record<string, unknown> | null;
    const config = credential.secretConfig as Record<string, unknown> | null;
    if (credential.kind !== "ssh_key" || typeof metadata?.username !== "string" || metadata.strictHostKeyChecking === false ||
        typeof config?.privateKey !== "string" || !isEncrypted(config.privateKey)) return false;
    assertSafeConnectionUser(metadata.username);
    if (metadata.sshPort !== undefined && (!Number.isInteger(metadata.sshPort) || Number(metadata.sshPort) < 1 || Number(metadata.sshPort) > 65535)) return false;
    createPrivateKey(decryptSecret(config.privateKey));
    return true;
  } catch { return false; }
}

/** Read-only checks: never materializes a key, contacts a target, or runs a playbook. */
export async function inspectLocalPrerequisites(project: Project, template: JobTemplate, credential: Credential, vm: NetboxVm): Promise<LocalPrerequisites> {
  try {
    if (!isPreflightLocalRunnerEnabled() || process.platform === "win32" || !project.checkoutPath || project.syncStatus !== "success") return { configured: false };
    if (!Array.isArray(project.playbooks) || !project.playbooks.includes(template.playbook)) return { configured: false };
    validateExtraVars(template.extraVars ?? {});
    const metadata = credential.metadata as Record<string, unknown> | null;
    if (!hasUsableSshCredential(credential)) return { configured: false };
    // Node verifies unencrypted PEM/PKCS8 material without writing or exposing it.
    // OpenSSH containers and passphrase-protected keys remain unknown in this first allow path.
    if (!vm.ip || !isSafeInventoryAddress(vm.ip.split("/")[0])) return { configured: false };
    const playbookPath = await resolveSafePlaybookPath(project.checkoutPath, template.playbook);
    const content = await readFile(playbookPath);
    if (content.length > 1024 * 1024) return { configured: false };
    const playbookSha256 = createHash("sha256").update(content).digest("hex");
    // Version inspection and known-host lookup are local only, with fixed argument arrays.
    if (!await localProbe("ansible-playbook", ["--version"])) return { configured: false, playbookSha256 };
    const address = vm.ip.split("/")[0];
    const knownHost = metadata?.sshPort && metadata.sshPort !== 22 ? `[${address}]:${metadata.sshPort}` : address;
    if (!await localProbe("ssh-keygen", ["-F", knownHost])) return { configured: false, playbookSha256 };
    return { configured: true, playbookSha256 };
  } catch { return { configured: false }; }
}

function localProbe(command: string, args: string[]): Promise<boolean> {
  return new Promise(resolve => {
    const child = spawn(command, args, { shell: false, cwd: tmpdir(), env: runnerEnvironment(process.env), stdio: "ignore" });
    const timer = setTimeout(() => { child.kill("SIGTERM"); resolve(false); }, 5000);
    child.on("error", () => { clearTimeout(timer); resolve(false); });
    child.on("close", code => { clearTimeout(timer); resolve(code === 0); });
  });
}
