import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { LocalRunner } from "../server/services/local-runner";
import {
  isLocalhostOnlyPlaybook,
  resolveProjectPlaybook,
} from "../server/services/runner-dispatcher";

describe("resolveProjectPlaybook", () => {
  it("accepts a valid playbook under checkoutPath", async () => {
    const checkoutPath = await fs.mkdtemp(path.join(os.tmpdir(), "rovelink-checkout-"));
    await fs.mkdir(path.join(checkoutPath, "playbooks"));
    await fs.writeFile(path.join(checkoutPath, "playbooks", "localhost.yml"), "- hosts: localhost\n");

    const resolved = await resolveProjectPlaybook({ checkoutPath }, "playbooks/localhost.yml");

    assert.equal(resolved, path.join(checkoutPath, "playbooks", "localhost.yml"));
  });

  it("rejects traversal outside checkoutPath", async () => {
    const checkoutPath = await fs.mkdtemp(path.join(os.tmpdir(), "rovelink-checkout-"));
    const outsidePath = path.join(path.dirname(checkoutPath), "outside.yml");
    await fs.writeFile(outsidePath, "- hosts: localhost\n");

    await assert.rejects(
      () => resolveProjectPlaybook({ checkoutPath }, "../outside.yml"),
      /escape/i
    );
  });

  it("rejects missing checkoutPath", async () => {
    await assert.rejects(
      () => resolveProjectPlaybook({ checkoutPath: null }, "site.yml"),
      /checkoutPath/i
    );
  });
});

describe("isLocalhostOnlyPlaybook", () => {
  it("detects localhost-only playbooks", async () => {
    const checkoutPath = await fs.mkdtemp(path.join(os.tmpdir(), "rovelink-localhost-"));
    const playbookPath = path.join(checkoutPath, "localhost.yml");
    await fs.writeFile(playbookPath, "- hosts: localhost\n  tasks: []\n");

    assert.equal(await isLocalhostOnlyPlaybook(playbookPath), true);
  });

  it("does not mark remote-host playbooks as localhost-only", async () => {
    const checkoutPath = await fs.mkdtemp(path.join(os.tmpdir(), "rovelink-remote-"));
    const playbookPath = path.join(checkoutPath, "site.yml");
    await fs.writeFile(playbookPath, "- hosts: all\n  tasks: []\n");

    assert.equal(await isLocalhostOnlyPlaybook(playbookPath), false);
  });
});

describe("LocalRunner", () => {
  it("uses the localhost execution argument path", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rovelink-runner-"));
    const fakeRunnerPath = path.join(tempDir, "fake-runner.mjs");
    const outputPath = path.join(tempDir, "args.json");
    const inventoryPath = path.join(tempDir, "localhost.yml");
    const playbookPath = path.join(tempDir, "localhost-playbook.yml");

    await fs.writeFile(inventoryPath, "all:\n  hosts:\n    localhost:\n      ansible_connection: local\n");
    await fs.writeFile(playbookPath, "- hosts: localhost\n");
    await fs.writeFile(
      fakeRunnerPath,
      [
        "import fs from 'node:fs';",
        `fs.writeFileSync(${JSON.stringify(outputPath)}, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }));`,
        "console.log('localhost : ok=1 changed=0 unreachable=0 failed=0');",
      ].join("\n")
    );

    const runner = new LocalRunner({
      command: process.execPath,
      commandArgsPrefix: [fakeRunnerPath],
    });
    const logs: string[] = [];

    const result = await runner.execute(
      {
        playbookPath,
        inventoryPath,
        workingDirectory: tempDir,
      },
      (line) => logs.push(line)
    );

    const observed = JSON.parse(await fs.readFile(outputPath, "utf8"));

    assert.equal(result.status, "ok");
    assert.equal(result.summary.hosts, 1);
    assert.equal(observed.cwd, tempDir);
    assert.deepEqual(observed.args, ["-i", inventoryPath, playbookPath]);
    assert.match(logs.join(""), /localhost : ok=1/);
  });
});
