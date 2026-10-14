import { isIP } from "node:net";

export function isSafeInventoryAddress(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 253 || value !== value.trim()) return false;
  if (isIP(value)) return true;
  // Numeric dotted strings must be valid IPs rather than falling back to DNS.
  if (/^[\d.]+$/.test(value)) return false;
  return value.split(".").every(label => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label));
}

export function assertSafeExecutionSegment(value: string): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error("Invalid execution identity");
}

export function assertSafeConnectionUser(value: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_.@-]{0,127}$/.test(value)) throw new Error("Invalid connection username");
}

export function validateExtraVars(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Extra vars must be an object");
  const inspect = (current: unknown, depth: number): void => {
    if (depth > 8) throw new Error("Extra vars exceed nesting limit");
    if (typeof current === "string") {
      if (/\{[{%#]/.test(current)) throw new Error("Template expressions are not allowed in extra vars");
      return;
    }
    if (current === null || typeof current === "boolean") return;
    if (typeof current === "number" && Number.isFinite(current)) return;
    if (Array.isArray(current)) { current.forEach(child => inspect(child, depth + 1)); return; }
    if (typeof current !== "object" || !current) throw new Error("Invalid extra vars value");
    for (const [key, child] of Object.entries(current)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || /^(ansible_|rovelink_)/i.test(key) ||
          ["__proto__", "constructor", "prototype"].includes(key)) throw new Error("Unsafe extra vars key");
      inspect(child, depth + 1);
    }
  };
  inspect(value, 0);
  if (Buffer.byteLength(JSON.stringify(value)) > 65536) throw new Error("Extra vars exceed size limit");
}

export function runnerEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const selected: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE", "LANG", "LC_ALL"]) {
    if (env[key] !== undefined) selected[key] = env[key];
  }
  return { ...selected, ANSIBLE_FORCE_COLOR: "0", ANSIBLE_NOCOLOR: "1" };
}
