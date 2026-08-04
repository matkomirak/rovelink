import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isLocalDevRuntime,
  isWeakRuntimeSecret,
  validateProductionRuntimeConfig,
} from "../server/services/runtime-config";

describe("runtime config hardening", () => {
  it("rejects default production secrets outside local/dev", () => {
    const errors = validateProductionRuntimeConfig({
      NODE_ENV: "production",
      ROVELINK_LOCAL_DEV: "false",
      JWT_SECRET: "local-jwt-secret-change-me",
      SESSION_SECRET: "local-session-secret-change-me",
      ENCRYPTION_KEY: "0".repeat(64),
    });

    assert.equal(errors.length, 4);
  });

  it("allows local Docker development to use explicit local defaults", () => {
    const errors = validateProductionRuntimeConfig({
      NODE_ENV: "production",
      ROVELINK_LOCAL_DEV: "true",
      JWT_SECRET: "local-jwt-secret-change-me",
      SESSION_SECRET: "local-session-secret-change-me",
      ENCRYPTION_KEY: "0".repeat(64),
    });

    assert.deepEqual(errors, []);
    assert.equal(isLocalDevRuntime({ NODE_ENV: "production", ROVELINK_LOCAL_DEV: "true" }), true);
  });

  it("accepts strong production-looking values", () => {
    const errors = validateProductionRuntimeConfig({
      NODE_ENV: "production",
      JWT_SECRET: "jwt_" + "a".repeat(48),
      SESSION_SECRET: "session_" + "b".repeat(48),
      ENCRYPTION_KEY: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      ROVELINK_GIT_ALLOWED_HOSTS: "github.com",
    });

    assert.deepEqual(errors, []);
    assert.equal(isWeakRuntimeSecret("short"), true);
    assert.equal(isWeakRuntimeSecret("strong_" + "c".repeat(48)), false);
  });
});
