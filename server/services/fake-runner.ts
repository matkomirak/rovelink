// FakeRunner service - simulates Ansible playbook execution with canned logs
import type { JobRun } from "@shared/schema";

const ANSIBLE_LOG_TEMPLATES = [
  "PLAY [all] *********************************************************************",
  "",
  "TASK [Gathering Facts] *********************************************************",
  "ok: [web-01]",
  "ok: [web-02]",
  "ok: [web-03]",
  "",
  "TASK [Install packages] ********************************************************",
  "changed: [web-01]",
  "changed: [web-02]",
  "changed: [web-03]",
  "",
  "TASK [Configure services] ******************************************************",
  "changed: [web-01]",
  "ok: [web-02]",
  "changed: [web-03]",
  "",
  "TASK [Restart application] *****************************************************",
  "changed: [web-01]",
  "changed: [web-02]",
  "changed: [web-03]",
  "",
  "PLAY RECAP *********************************************************************",
  "web-01 : ok=4    changed=3    unreachable=0    failed=0    skipped=0    rescued=0    ignored=0",
  "web-02 : ok=4    changed=2    unreachable=0    failed=0    skipped=0    rescued=0    ignored=0",
  "web-03 : ok=4    changed=3    unreachable=0    failed=0    skipped=0    rescued=0    ignored=0",
];

const FAILED_LOG_TEMPLATES = [
  "PLAY [all] *********************************************************************",
  "",
  "TASK [Gathering Facts] *********************************************************",
  "ok: [web-01]",
  "ok: [web-02]",
  "",
  "TASK [Deploy application] ******************************************************",
  "fatal: [web-01]: FAILED! => {\"msg\": \"Connection timeout\"}",
  "ok: [web-02]",
  "",
  "PLAY RECAP *********************************************************************",
  "web-01 : ok=1    changed=0    unreachable=0    failed=1    skipped=0    rescued=0    ignored=0",
  "web-02 : ok=2    changed=1    unreachable=0    failed=0    skipped=0    rescued=0    ignored=0",
];

export interface RunResult {
  status: "ok" | "failed";
  summary: {
    hosts: number;
    ok: number;
    changed: number;
    failed: number;
  };
  logs: string;
}

export class FakeRunner {
  async executeRun(
    run: JobRun,
    onLog: (log: string) => void
  ): Promise<RunResult> {
    // Simulate execution time (10-20 seconds)
    const duration = 10000 + Math.random() * 10000;
    const shouldFail = Math.random() < 0.2; // 20% failure rate
    
    const logLines = shouldFail ? FAILED_LOG_TEMPLATES : ANSIBLE_LOG_TEMPLATES;
    const delayPerLine = duration / logLines.length;

    // Stream logs line by line
    for (const line of logLines) {
      await new Promise(resolve => setTimeout(resolve, delayPerLine));
      onLog(line + "\n");
    }

    // Generate summary
    const summary = shouldFail
      ? { hosts: 2, ok: 3, changed: 1, failed: 1 }
      : { hosts: 3, ok: 12, changed: 8, failed: 0 };

    return {
      status: shouldFail ? "failed" : "ok",
      summary,
      logs: logLines.join("\n"),
    };
  }

  async scheduleRun(runId: string, scheduledAt: Date): Promise<void> {
    const delay = scheduledAt.getTime() - Date.now();
    if (delay > 0) {
      // In a real app, this would use a job queue like GoodJob
      console.log(`Scheduled run ${runId} to execute in ${delay}ms`);
      // For MVP, we'll just log it - actual scheduling would happen in routes
    }
  }
}

export const fakeRunner = new FakeRunner();
