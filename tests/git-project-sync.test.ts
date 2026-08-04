import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  discoverAnsiblePlaybooks,
  getAllowedGitHosts,
  getProjectCheckoutPath,
  sanitizeGitSyncError,
  validateGitRef,
  validateGitHostAllowed,
  validateGitRepoUrl,
} from "../server/services/git-project-sync";

describe("validateGitRepoUrl", () => {
  it("allows public https Git URLs", () => {
    assert.equal(
      validateGitRepoUrl("https://github.com/example/repo.git"),
      "https://github.com/example/repo.git"
    );
  });

  it("rejects non-https URLs", () => {
    assert.throws(() => validateGitRepoUrl("ssh://git@example.com/repo.git"), /https/i);
    assert.throws(() => validateGitRepoUrl("git@example.com:org/repo.git"), /https/i);
    assert.throws(() => validateGitRepoUrl("file:///tmp/repo.git"), /https/i);
  });

  it("rejects embedded credentials", () => {
    assert.throws(
      () => validateGitRepoUrl("https://user:secret@example.com/repo.git"),
      /credentials/i
    );
  });

  it("allows github.com by default in local/dev runtime", () => {
    assert.deepEqual(getAllowedGitHosts({ NODE_ENV: "test" }), ["github.com"]);
    assert.equal(
      validateGitRepoUrl("https://github.com/example/repo.git"),
      "https://github.com/example/repo.git"
    );
  });

  it("requires an explicit allowlist in production", () => {
    assert.throws(
      () => validateGitHostAllowed("github.com", { NODE_ENV: "production" }),
      /ROVELINK_GIT_ALLOWED_HOSTS/i
    );

    assert.equal(
      validateGitHostAllowed("git.example.com", {
        NODE_ENV: "production",
        ROVELINK_GIT_ALLOWED_HOSTS: "git.example.com",
      }),
      "git.example.com"
    );
  });

  it("rejects localhost, private, link-local, and disallowed hosts", () => {
    const env = {
      NODE_ENV: "production",
      ROVELINK_GIT_ALLOWED_HOSTS: "github.com,git.example.com",
    };

    for (const host of ["localhost", "127.0.0.1", "10.0.0.5", "172.16.0.10", "192.168.1.10", "169.254.1.1", "::1", "fe80::1"]) {
      assert.throws(() => validateGitHostAllowed(host, env), /private|localhost/i);
    }

    assert.throws(() => validateGitHostAllowed("gitlab.com", env), /not allowed/i);
  });
});

describe("validateGitRef", () => {
  it("allows common branch, tag, and sha-like refs", () => {
    assert.equal(validateGitRef("main"), "main");
    assert.equal(validateGitRef("release/v1.2.3"), "release/v1.2.3");
    assert.equal(validateGitRef("0123456789abcdef"), "0123456789abcdef");
  });

  it("rejects unsafe refs", () => {
    const unsafe = ["-main", "feature branch", "../main", "main..next", "main@{1}", "main:evil", "main\\evil"];
    for (const ref of unsafe) {
      assert.throws(() => validateGitRef(ref), /ref|branch/i);
    }
  });
});

describe("getProjectCheckoutPath", () => {
  it("derives checkout path only from org and project IDs under the configured root", async () => {
    const previousRoot = process.env.ROVELINK_PROJECTS_ROOT;
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "rovelink-git-root-"));
    process.env.ROVELINK_PROJECTS_ROOT = root;

    try {
      const checkoutPath = getProjectCheckoutPath({
        id: "project-123",
        orgId: "org-456",
      });

      assert.equal(checkoutPath, path.resolve(root, "org-456", "project-123", "repo"));
    } finally {
      if (previousRoot === undefined) delete process.env.ROVELINK_PROJECTS_ROOT;
      else process.env.ROVELINK_PROJECTS_ROOT = previousRoot;
    }
  });

  it("rejects unsafe IDs", () => {
    assert.throws(
      () => getProjectCheckoutPath({ id: "../project", orgId: "org-456" }),
      /identity/i
    );
  });
});

describe("discoverAnsiblePlaybooks", () => {
  it("finds playbooks and skips non-playbook YAML and ignored directories", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "rovelink-playbooks-"));
    await fs.mkdir(path.join(root, ".github", "workflows"), { recursive: true });
    await fs.mkdir(path.join(root, "roles", "web", "tasks"), { recursive: true });
    await fs.mkdir(path.join(root, "playbooks"), { recursive: true });
    await fs.mkdir(path.join(root, "group_vars"), { recursive: true });

    await fs.writeFile(path.join(root, "site.yml"), "- hosts: all\n  tasks: []\n");
    await fs.writeFile(path.join(root, "playbooks", "deploy.yaml"), "---\n- hosts: web\n  tasks: []\n");
    await fs.writeFile(path.join(root, ".github", "workflows", "ci.yml"), "name: ci\n");
    await fs.writeFile(path.join(root, "roles", "web", "tasks", "main.yml"), "- name: install\n");
    await fs.writeFile(path.join(root, "group_vars", "all.yml"), "foo: bar\n");
    await fs.writeFile(path.join(root, "README.yaml"), "not: a playbook\n");

    const playbooks = await discoverAnsiblePlaybooks(root);

    assert.deepEqual(playbooks, ["playbooks/deploy.yaml", "site.yml"]);
  });

  it("skips symlinked files", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "rovelink-symlinks-"));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "rovelink-outside-"));
    await fs.writeFile(path.join(outside, "outside.yml"), "- hosts: all\n");

    try {
      await fs.symlink(path.join(outside, "outside.yml"), path.join(root, "outside.yml"));
    } catch {
      return;
    }

    const playbooks = await discoverAnsiblePlaybooks(root);
    assert.deepEqual(playbooks, []);
  });
});

describe("sanitizeGitSyncError", () => {
  it("redacts credentials embedded in error messages", () => {
    const safe = sanitizeGitSyncError(
      new Error("fatal: https://user:secret@example.com/repo.git failed")
    );

    assert.ok(!safe.includes("secret"));
    assert.ok(safe.includes("[REDACTED]"));
  });
});
