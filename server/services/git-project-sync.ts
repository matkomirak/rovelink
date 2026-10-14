import { spawn } from "child_process";
import { runnerEnvironment } from "./execution-inputs";
import fs from "fs/promises";
import dns from "dns/promises";
import path from "path";
import type { Project } from "@shared/schema";
import { isLocalDevRuntime } from "./runtime-config";

const DEFAULT_PROJECTS_ROOT = path.resolve(process.cwd(), ".local", "git-projects");
const SAFE_ID_RE = /^[A-Za-z0-9_-]+$/;
const MAX_GIT_OUTPUT = 8000;
const GIT_TIMEOUT_MS = 120000;
const MAX_DISCOVERY_DEPTH = 12;
const MAX_DISCOVERY_FILES = 1000;
const MAX_PLAYBOOK_BYTES = 1024 * 1024;
const LOCAL_DEV_DEFAULT_ALLOWED_HOSTS = ["github.com"];

const SKIPPED_DIRS = new Set([
  ".git",
  ".github",
  "node_modules",
  "vendor",
  "group_vars",
  "host_vars",
]);

export interface GitProjectSyncResult {
  checkoutPath: string;
  playbooks: string[];
}

export function validateGitRepoUrl(repoUrl: string): string {
  if (!repoUrl || typeof repoUrl !== "string") {
    throw new Error("Git URL is required");
  }

  let url: URL;
  try {
    url = new URL(repoUrl);
  } catch {
    throw new Error("Git URL must be a valid https:// URL");
  }

  if (url.protocol !== "https:") {
    throw new Error("Only public https:// Git URLs are supported");
  }

  if (url.username || url.password) {
    throw new Error("Git URL must not include embedded credentials");
  }

  if (!url.hostname || url.hostname.includes("..")) {
    throw new Error("Git URL host is invalid");
  }

  validateGitHostAllowed(url.hostname);

  return url.toString();
}

export function getAllowedGitHosts(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = env.ROVELINK_GIT_ALLOWED_HOSTS?.trim();
  if (configured) {
    return configured
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean);
  }

  return isLocalDevRuntime(env) ? LOCAL_DEV_DEFAULT_ALLOWED_HOSTS : [];
}

export function validateGitHostAllowed(hostname: string, env: NodeJS.ProcessEnv = process.env): string {
  const host = hostname.toLowerCase();
  if (isLocalOrPrivateHost(host)) {
    throw new Error("Git URL host must not be localhost or a private network address");
  }

  const allowedHosts = getAllowedGitHosts(env);
  if (allowedHosts.length === 0) {
    throw new Error("ROVELINK_GIT_ALLOWED_HOSTS must be set before Git sync is allowed");
  }

  if (!allowedHosts.includes(host)) {
    throw new Error("Git URL host is not allowed");
  }

  return host;
}

export function validateGitRef(gitRef: string): string {
  if (!gitRef || typeof gitRef !== "string") {
    throw new Error("Git branch or ref is required");
  }

  const ref = gitRef.trim();
  if (ref.length === 0 || ref.length > 200) {
    throw new Error("Git branch or ref length is invalid");
  }

  if (/[\s\x00-\x1F\x7F]/.test(ref)) {
    throw new Error("Git branch or ref must not contain whitespace or control characters");
  }

  if (
    ref.startsWith("-") ||
    ref.startsWith("/") ||
    ref.endsWith("/") ||
    ref.endsWith(".") ||
    ref.includes("..") ||
    ref.includes("@{") ||
    /[\\~^:?*[]/.test(ref)
  ) {
    throw new Error("Git branch or ref contains unsupported characters");
  }

  return ref;
}

export function getProjectsRoot(): string {
  const configuredRoot = process.env.ROVELINK_PROJECTS_ROOT?.trim();
  return path.resolve(configuredRoot || DEFAULT_PROJECTS_ROOT);
}

export function getProjectCheckoutPath(project: Pick<Project, "id" | "orgId">): string {
  const orgId = project.orgId;
  if (!orgId || !SAFE_ID_RE.test(orgId) || !SAFE_ID_RE.test(project.id)) {
    throw new Error("Project identity is invalid for checkout path");
  }

  const root = getProjectsRoot();
  const checkoutPath = path.resolve(root, orgId, project.id, "repo");
  const relative = path.relative(root, checkoutPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Resolved checkout path escapes the projects root");
  }

  return checkoutPath;
}

export function sanitizeGitSyncError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/https:\/\/[^/\s:@]+:[^@\s]+@/gi, "https://[REDACTED]@")
    .replace(/https:\/\/[^/\s:@]+@/gi, "https://[REDACTED]@")
    .slice(0, 1000);
}

export async function discoverAnsiblePlaybooks(repoRoot: string): Promise<string[]> {
  const root = path.resolve(repoRoot);
  const playbooks: string[] = [];
  let visitedFiles = 0;

  async function walk(currentDir: string, segments: string[]): Promise<void> {
    if (segments.length > MAX_DISCOVERY_DEPTH || visitedFiles > MAX_DISCOVERY_FILES) {
      return;
    }

    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue;
      }

      const nextSegments = [...segments, entry.name];
      if (entry.isDirectory()) {
        if (shouldSkipDirectory(nextSegments)) {
          continue;
        }
        await walk(path.join(currentDir, entry.name), nextSegments);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      visitedFiles += 1;
      if (visitedFiles > MAX_DISCOVERY_FILES || !isYamlFile(entry.name)) {
        continue;
      }

      const filePath = path.join(currentDir, entry.name);
      if (await looksLikePlaybook(filePath)) {
        playbooks.push(nextSegments.join("/"));
      }
    }
  }

  await walk(root, []);
  return playbooks.sort((a, b) => a.localeCompare(b));
}

export async function syncGitProject(project: Project): Promise<GitProjectSyncResult> {
  const repoUrl = validateGitRepoUrl(project.gitUrl);
  const gitRef = validateGitRef(project.gitRef);
  const checkoutPath = getProjectCheckoutPath(project);
  await validateGitHostResolution(new URL(repoUrl).hostname);

  await fs.mkdir(checkoutPath, { recursive: true });

  if (!(await pathExists(path.join(checkoutPath, ".git")))) {
    await runGit(["init", checkoutPath]);
    await runGit(["-C", checkoutPath, "remote", "add", "origin", repoUrl]);
  } else {
    await runGit(["-C", checkoutPath, "remote", "set-url", "origin", repoUrl]);
  }

  await runGit(["-C", checkoutPath, "fetch", "--prune", "--depth=1", "origin", gitRef]);
  await runGit(["-C", checkoutPath, "checkout", "--force", "--detach", "FETCH_HEAD"]);
  await runGit(["-C", checkoutPath, "clean", "-fdx"]);

  const playbooks = await discoverAnsiblePlaybooks(checkoutPath);
  return { checkoutPath, playbooks };
}

export async function validateGitHostResolution(hostname: string): Promise<void> {
  if (isLocalOrPrivateHost(hostname)) {
    throw new Error("Git URL host must not resolve to localhost or a private network address");
  }

  let records: string[] = [];
  try {
    const resolved = await dns.lookup(hostname, { all: true, verbatim: true });
    records = resolved.map((record) => record.address);
  } catch {
    throw new Error("Git URL host could not be resolved");
  }

  if (records.length === 0 || records.some(isLocalOrPrivateHost)) {
    throw new Error("Git URL host must not resolve to localhost or a private network address");
  }
}

function shouldSkipDirectory(segments: string[]): boolean {
  const name = segments[segments.length - 1];
  if (SKIPPED_DIRS.has(name)) {
    return true;
  }

  const rolesIndex = segments.indexOf("roles");
  if (rolesIndex >= 0) {
    const roleSubdir = segments[rolesIndex + 2];
    return roleSubdir === "tasks" || roleSubdir === "handlers";
  }

  return false;
}

function isYamlFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.endsWith(".yml") || lower.endsWith(".yaml");
}

async function looksLikePlaybook(filePath: string): Promise<boolean> {
  const stat = await fs.stat(filePath);
  if (stat.size > MAX_PLAYBOOK_BYTES) {
    return false;
  }

  const content = await fs.readFile(filePath, "utf8");
  const head = content.slice(0, 65536);
  return /^\s*-\s+hosts\s*:/m.test(head);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function runGit(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("git", args, { shell: false, env: {
      ...runnerEnvironment(process.env), GIT_TERMINAL_PROMPT: "0", GIT_ALLOW_PROTOCOL: "https",
      GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    } });
    let output = "";

    const append = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-MAX_GIT_OUTPUT);
    };

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Git command timed out"));
    }, GIT_TIMEOUT_MS);

    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Git command failed with exit code ${code}: ${output.trim()}`));
      }
    });
  });
}

function isLocalOrPrivateHost(hostnameOrIp: string): boolean {
  const host = hostnameOrIp.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) {
    return true;
  }

  if (isPrivateIpv4(host)) {
    return true;
  }

  if (isPrivateIpv6(host)) {
    return true;
  }

  return false;
}

function isPrivateIpv4(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4) {
    return false;
  }

  const octets = parts.map((part) => Number(part));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }

  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIpv6(value: string): boolean {
  if (!value.includes(":")) {
    return false;
  }

  return (
    value === "::1" ||
    value === "::" ||
    value.startsWith("fc") ||
    value.startsWith("fd") ||
    value.startsWith("fe80:") ||
    value.startsWith("ff")
  );
}
