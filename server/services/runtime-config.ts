const DEFAULT_SECRET_VALUES = new Set([
  "dev-secret-change-in-production",
  "local-session-secret-change-me",
  "local-jwt-secret-change-me",
  "change_me_32_hex_chars",
  "change_me_jwt_secret",
  "changeme",
]);

const ZERO_ENCRYPTION_KEY = "0".repeat(64);

export function isLocalDevRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ROVELINK_LOCAL_DEV === "true" || env.NODE_ENV === "development" || env.NODE_ENV === "test";
}

export function isWeakRuntimeSecret(value: string | undefined): boolean {
  if (!value) return true;
  const trimmed = value.trim();
  return trimmed.length < 24 || DEFAULT_SECRET_VALUES.has(trimmed) || trimmed === ZERO_ENCRYPTION_KEY;
}

export function validateProductionRuntimeConfig(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.NODE_ENV !== "production" || isLocalDevRuntime(env)) {
    return [];
  }

  const errors: string[] = [];
  if (isWeakRuntimeSecret(env.JWT_SECRET)) {
    errors.push("JWT_SECRET must be set to a strong non-default value in production.");
  }
  if (isWeakRuntimeSecret(env.SESSION_SECRET)) {
    errors.push("SESSION_SECRET must be set to a strong non-default value in production.");
  }
  if (isWeakRuntimeSecret(env.ENCRYPTION_KEY)) {
    errors.push("ENCRYPTION_KEY must be a strong non-default 64-character hex value in production.");
  }
  if (!env.ROVELINK_GIT_ALLOWED_HOSTS?.trim()) {
    errors.push("ROVELINK_GIT_ALLOWED_HOSTS must list approved Git hosts in production.");
  }
  return errors;
}
