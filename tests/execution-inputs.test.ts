import assert from "node:assert/strict";
import { test } from "node:test";
import { assertSafeConnectionUser, assertSafeExecutionSegment, isSafeInventoryAddress, runnerEnvironment, validateExtraVars } from "../server/services/execution-inputs";
import { buildLocalRunnerArgs, createRunnerOutputHandler } from "../server/services/local-runner";
import { validatePlaybookPathSyntax } from "../server/services/safe-playbook-path";

test("execution inputs reject traversal, shell syntax, invalid addresses and injected usernames", () => {
  for (const value of ["../../etc/passwd", "; rm -rf /", "$(whoami)", "$(whoami).yml", "site.yml\n--foo"]) assert.throws(() => validatePlaybookPathSyntax(value));
  for (const value of ["vm\nansible_connection: local", "$(whoami)", "-oProxyCommand=bad", "192.0.2.999", 'a";bad']) assert.equal(isSafeInventoryAddress(value), false);
  for (const value of ["192.0.2.1", "2001:db8::1", "demo.example.org", "localhost"]) assert.equal(isSafeInventoryAddress(value), true);
  assert.throws(() => assertSafeExecutionSegment("../outside"));
  assert.throws(() => assertSafeConnectionUser('user"\nansible_connection: local'));
});
test("runner args are arrays and reject extra-vars connection overrides and unsafe limits", () => {
  assert.deepEqual(buildLocalRunnerArgs({ inventoryPath: "inventory.yml", playbookPath: "site.yml", extraVars: { application: "demo; literal data" } }),
    ["-i", "inventory.yml", "site.yml", "--extra-vars", '{"application":"demo; literal data"}']);
  for (const value of [{ ansible_connection: "local" }, { nested: { ansible_ssh_common_args: "ProxyCommand=bad" } }, JSON.parse('{"__proto__":{"x":1}}')]) assert.throws(() => validateExtraVars(value));
  assert.throws(() => buildLocalRunnerArgs({ inventoryPath: "inventory.yml", playbookPath: "site.yml", limitExpr: "$(whoami)" }));
  assert.throws(() => buildLocalRunnerArgs({ inventoryPath: "inventory.yml", playbookPath: "--version" }));
  assert.throws(() => validateExtraVars({ app: "{{ lookup('pipe', 'whoami') }}" }));
  const env = runnerEnvironment({ PATH: "safe-bin", JWT_SECRET: "hidden", DATABASE_URL: "hidden", ANSIBLE_CONFIG: "unexpected", ENCRYPTION_KEY: "hidden" });
  assert.equal(env.PATH, "safe-bin");
  assert.ok(!JSON.stringify(env).includes("hidden"));
  assert.equal(env.ANSIBLE_CONFIG, undefined);
});
test("runner stream redacts tokens across chunks, JSON passwords and multiline private keys", () => {
  const lines: string[] = [];
  const stream = createRunnerOutputHandler(line => lines.push(line));
  stream.write('Bearer synthetic-'); stream.write('token\n{"password":"synthetic-password"}\n-----BEGIN OPENSSH PRIVATE');
  stream.write(' KEY-----\nprivate-key-body\n-----END OPENSSH PRIVATE KEY-----\nnormal recap\n'); stream.flush();
  assert.ok(!lines.join("\n").match(/synthetic-token|synthetic-password|private-key-body/));
  assert.ok(lines.includes("normal recap"));
});
