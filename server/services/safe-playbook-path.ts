/**
 * Safe playbook path resolution.
 * Prevents directory traversal, absolute paths, and non-YAML files.
 */

import path from "node:path";
import fs from "node:fs/promises";

/**
 * Resolves a playbook path relative to a project root, enforcing safety rules.
 * Throws if the path is unsafe or the file does not exist.
 */
export async function resolveSafePlaybookPath(
  projectRoot: string,
  playbookPath: string
): Promise<string> {
  if (!playbookPath || typeof playbookPath !== "string") {
    throw new Error("Playbook path is required");
  }
  if (/[\0\r\n;$`|&<>]/.test(playbookPath)) throw new Error("Unsupported playbook path characters");

  if (path.isAbsolute(playbookPath)) {
    throw new Error("Absolute playbook paths are not allowed");
  }

  const normalizedRelative = path.normalize(playbookPath);

  if (
    normalizedRelative.startsWith("..") ||
    normalizedRelative.includes(`..${path.sep}`)
  ) {
    throw new Error("Playbook path cannot escape project directory");
  }

  if (!/\.(ya?ml)$/i.test(normalizedRelative)) {
    throw new Error("Playbook must be a YAML file (.yml or .yaml)");
  }

  const projectRealPath = await fs.realpath(projectRoot).catch(() => {
    throw new Error(`Project root does not exist: ${projectRoot}`);
  });

  const candidatePath = path.resolve(projectRealPath, normalizedRelative);

  const candidateRealPath = await fs.realpath(candidatePath).catch(() => {
    throw new Error(`Playbook not found: ${normalizedRelative}`);
  });

  const relativeToProject = path.relative(projectRealPath, candidateRealPath);

  if (
    relativeToProject.startsWith("..") ||
    path.isAbsolute(relativeToProject)
  ) {
    throw new Error("Playbook path escapes project directory");
  }

  return candidateRealPath;
}

/**
 * Lightweight validation that does NOT require the file to exist on disk.
 * Use this when the project has not been checked out yet (e.g. mocked runner).
 * Still rejects absolute paths, traversal, and non-YAML files.
 */
export function validatePlaybookPathSyntax(playbookPath: string): void {
  if (!playbookPath || typeof playbookPath !== "string") {
    throw new Error("Playbook path is required");
  }
  if (/[\0\r\n;$`|&<>]/.test(playbookPath)) throw new Error("Unsupported playbook path characters");

  if (path.isAbsolute(playbookPath)) {
    throw new Error("Absolute playbook paths are not allowed");
  }

  const normalizedRelative = path.normalize(playbookPath);

  if (
    normalizedRelative.startsWith("..") ||
    normalizedRelative.includes(`..${path.sep}`)
  ) {
    throw new Error("Playbook path cannot escape project directory");
  }

  if (!/\.(ya?ml)$/i.test(normalizedRelative)) {
    throw new Error("Playbook must be a YAML file (.yml or .yaml)");
  }
}
