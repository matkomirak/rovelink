import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isLocalDevBootstrapAllowed,
  shouldCreateBootstrapAdmin,
  validateBootstrapAdminPassword,
} from "../server/seed";

describe("bootstrap admin password policy", () => {
  it("rejects weak default passwords outside local/dev", () => {
    assert.throws(
      () => validateBootstrapAdminPassword("changeme", {
        NODE_ENV: "production",
        ROVELINK_LOCAL_DEV: "false",
      }),
      /weak or default/i,
    );
  });

  it("allows local/dev bootstrap to use the Docker default password", () => {
    assert.doesNotThrow(() =>
      validateBootstrapAdminPassword("changeme", {
        NODE_ENV: "production",
        ROVELINK_LOCAL_DEV: "true",
      }),
    );
    assert.equal(isLocalDevBootstrapAllowed({ NODE_ENV: "production", ROVELINK_LOCAL_DEV: "true" }), true);
  });

  it("does not create or overwrite bootstrap admin when one already exists", () => {
    const existingAdmin = {
      id: "admin-1",
      username: "admin",
      password: "existing-hash",
    };

    assert.equal(shouldCreateBootstrapAdmin(existingAdmin), false);
  });
});
