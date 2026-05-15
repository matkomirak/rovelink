/**
 * Safe playbook path validation tests.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validatePlaybookPathSyntax } from "../server/services/safe-playbook-path";

describe("validatePlaybookPathSyntax — allowed paths", () => {
  const allowed = [
    "site.yml",
    "site.yaml",
    "playbooks/deploy.yml",
    "playbooks/rollback.yaml",
    "roles/example/tasks/main.yaml",
    "nested/deep/playbook.yml",
  ];

  for (const p of allowed) {
    it(`allows: ${p}`, () => {
      assert.doesNotThrow(() => validatePlaybookPathSyntax(p));
    });
  }
});

describe("validatePlaybookPathSyntax — rejected paths", () => {
  it("rejects empty string", () => {
    assert.throws(() => validatePlaybookPathSyntax(""), /required/i);
  });

  it("rejects absolute path /etc/passwd", () => {
    assert.throws(() => validatePlaybookPathSyntax("/etc/passwd"), /absolute/i);
  });

  it("rejects absolute path /etc/shadow", () => {
    assert.throws(() => validatePlaybookPathSyntax("/etc/shadow"), /absolute/i);
  });

  it("rejects ../ traversal", () => {
    assert.throws(() => validatePlaybookPathSyntax("../outside.yml"), /escape/i);
  });

  it("rejects nested traversal playbooks/../../outside.yml", () => {
    assert.throws(() => validatePlaybookPathSyntax("playbooks/../../outside.yml"), /escape/i);
  });

  it("rejects shell script .sh file", () => {
    assert.throws(() => validatePlaybookPathSyntax("script.sh"), /yaml/i);
  });

  it("rejects .py file", () => {
    assert.throws(() => validatePlaybookPathSyntax("playbook.py"), /yaml/i);
  });

  it("rejects .txt file", () => {
    assert.throws(() => validatePlaybookPathSyntax("playbook.txt"), /yaml/i);
  });

  it("rejects path with no extension", () => {
    assert.throws(() => validatePlaybookPathSyntax("site"), /yaml/i);
  });

  it("rejects null-ish value", () => {
    assert.throws(() => validatePlaybookPathSyntax(null as any), /required/i);
  });
});
