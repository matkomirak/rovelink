import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";
import {
  isLocalDevBootstrapAllowed,
  shouldCreateBootstrapAdmin,
  validateBootstrapAdminPassword,
  displayBootstrapCredentials,
} from "../server/seed";

describe("bootstrap admin password policy", () => {
  it("displays a generated password once and never prints an explicit password", () => {
    const output: string[] = [];
    displayBootstrapCredentials("admin", "synthetic-generated-secret", undefined, line => output.push(line));
    assert.equal(output.filter(line => line.includes("synthetic-generated-secret")).length, 1);
    assert.match(output.join("\n"), /displayed once.*Store them securely/);
    output.length = 0;
    displayBootstrapCredentials("admin", "synthetic-explicit-secret", "synthetic-explicit-secret", line => output.push(line));
    assert.ok(!output.join("\n").includes("synthetic-explicit-secret"));
  });

  it("keeps bootstrap setup free of credential file writes and docs free of legacy file instructions", () => {
    const root = new URL("../", import.meta.url);
    const legacyFile = "admin" + ".txt";
    for (const file of ["ubuntu-setup.sh", "server/seed.ts"]) {
      const source = readFileSync(new URL(file, root), "utf8");
      assert.ok(!source.includes(legacyFile), file);
      assert.doesNotMatch(source, /writeFile|appendFile|createWriteStream/, file);
    }
    const inspectDocs = (directory: URL): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
        if (entry.isDirectory()) inspectDocs(url);
        else if (/\.(md|html)$/.test(entry.name)) {
          assert.ok(!readFileSync(url, "utf8").includes(legacyFile), url.pathname);
        }
      }
    };
    for (const entry of readdirSync(root)) {
      if (entry.endsWith(".md")) assert.ok(!readFileSync(new URL(entry, root), "utf8").includes(legacyFile), entry);
    }
    inspectDocs(new URL("docs/", root));
    // The website is optional in source-only checkouts.
    if (readdirSync(root).includes("website")) inspectDocs(new URL("website/", root));
  });

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
