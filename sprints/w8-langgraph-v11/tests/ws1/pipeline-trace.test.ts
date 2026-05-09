import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';

// Round 3 — 9 个 it 块（Round 2 的 7 + R1 SKIP fallback + R5 cascade_skip）
// R4: startMockBrain 用 port=0 (OS ephemeral) + 每个 it 块通过 try/finally 独立 server 实例
//     避免 vitest 并发场景下端口冲突

const SCRIPT = join(__dirname, '..', '..', 'scripts', 'verify-pipeline-trace.sh');

type FixtureOverrides = Partial<{
  generatorStdoutLen: number;
  plannerStdout: string;
  evaluatorCwd: string;
  absorptionStatus: string | null;
  taskStatus: string;
  contractVerdict: string;
  proposeBranchCount: number;
  generatorBranchInOrigin: boolean;
  subTaskAllFailed: boolean;
}>;

function buildBrainFixture(overrides: FixtureOverrides = {}) {
  return {
    generatorStdoutLen: overrides.generatorStdoutLen ?? 1024,
    plannerStdout: overrides.plannerStdout ?? 'planner started\nplanner done\n',
    evaluatorCwd: overrides.evaluatorCwd ?? '/srv/.worktrees/sub-12345',
    absorptionStatus: overrides.absorptionStatus === undefined ? 'not_applied' : overrides.absorptionStatus,
    taskStatus: overrides.taskStatus ?? 'in_progress',
    contractVerdict: overrides.contractVerdict ?? 'APPROVED',
    proposeBranchCount: overrides.proposeBranchCount ?? 1,
    generatorBranchInOrigin: overrides.generatorBranchInOrigin ?? true,
    subTaskAllFailed: overrides.subTaskAllFailed ?? false,
  };
}

function startMockBrain(fix: ReturnType<typeof buildBrainFixture>): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = req.url || '';
      res.setHeader('Content-Type', 'application/json');
      if (url.startsWith('/api/brain/tasks/sub-1') && !url.includes('?')) {
        return res.end(JSON.stringify({
          id: 'sub-1',
          status: fix.subTaskAllFailed ? 'failed' : 'completed',
          payload: { branch_name: 'cp-gen-sub-1' },
          result: { branch: 'cp-gen-sub-1' },
        }));
      }
      if (url.startsWith('/api/brain/tasks/') && !url.includes('?')) {
        return res.end(JSON.stringify({
          id: 'TID',
          status: fix.taskStatus,
          payload: { branch_name: 'cp-gen-x' },
          result: {},
        }));
      }
      if (url.startsWith('/api/brain/tasks?parent_task_id=') && url.includes('task_type=harness_generator')) {
        const subStatus = fix.subTaskAllFailed ? 'failed' : 'completed';
        return res.end(JSON.stringify({ tasks: [{ id: 'sub-1', status: subStatus }] }));
      }
      if (url.includes('stage=planner')) {
        return res.end(JSON.stringify({ records: [{ stdout: fix.plannerStdout }] }));
      }
      if (url.includes('stage=generator')) {
        return res.end(JSON.stringify({ records: [{ stdout: 'x'.repeat(fix.generatorStdoutLen) }] }));
      }
      if (url.includes('stage=evaluator')) {
        return res.end(JSON.stringify({
          records: [{ cwd: fix.evaluatorCwd, absorption_policy_status: fix.absorptionStatus }],
        }));
      }
      if (url.includes('stage=contract_review')) {
        return res.end(JSON.stringify({ records: [{ verdict: fix.contractVerdict }] }));
      }
      if (url.includes('/dev-records')) {
        return res.end(JSON.stringify({ records: [{ stdout: 'ok' }] }));
      }
      res.statusCode = 404;
      res.end('{}');
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

function runScript(brainPort: number, env: Record<string, string> = {}) {
  return spawnSync('bash', [SCRIPT], {
    env: { ...process.env, BRAIN: `127.0.0.1:${brainPort}`, TASK_ID: 'TID', ...env },
    encoding: 'utf8',
    timeout: 15000,
  });
}

describe('Workstream 1 — Pipeline-trace 验证脚本 [BEHAVIOR]', () => {
  it('脚本文件存在且可执行 (chmod +x)', () => {
    expect(existsSync(SCRIPT)).toBe(true);
    expect(statSync(SCRIPT).mode & 0o111).toBeGreaterThan(0);
  });

  it('全痕迹齐全场景: stdout 含 OK 标记且 exit 0', async () => {
    const { server, port } = await startMockBrain(buildBrainFixture());
    try {
      const r = runScript(port);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/OK|✅/);
    } finally {
      server.close();
    }
  });

  it('generator stdout < 200 bytes 时 exit 1 且 stderr 含 "stdout.*<.*200"（H7 失效）', async () => {
    const { server, port } = await startMockBrain(buildBrainFixture({ generatorStdoutLen: 50 }));
    try {
      const r = runScript(port);
      expect(r.status).toBe(1);
      expect(r.stderr + r.stdout).toMatch(/stdout.*<.*200/);
    } finally {
      server.close();
    }
  });

  it('planner stdout 含 "Cloning into" 时 exit 1 且消息含 "push 噪音"（H9 失效）', async () => {
    const { server, port } = await startMockBrain(buildBrainFixture({ plannerStdout: 'Cloning into bare repo...\n' }));
    try {
      const r = runScript(port);
      expect(r.status).toBe(1);
      expect(r.stderr + r.stdout).toMatch(/push.*噪音|push.*noise|Cloning/);
    } finally {
      server.close();
    }
  });

  it('evaluator cwd 不含 worktree 标志时 exit 1 且消息含 "worktree"（H8 失效）', async () => {
    const { server, port } = await startMockBrain(buildBrainFixture({ evaluatorCwd: '/srv/main-repo' }));
    try {
      const r = runScript(port);
      expect(r.status).toBe(1);
      expect(r.stderr + r.stdout).toMatch(/worktree/);
    } finally {
      server.close();
    }
  });

  it('absorption_policy 状态非法时 exit 1 且消息含 "absorption_policy"（H10 失效）', async () => {
    const { server, port } = await startMockBrain(buildBrainFixture({ absorptionStatus: 'fake_applied' }));
    try {
      const r = runScript(port);
      expect(r.status).toBe(1);
      expect(r.stderr + r.stdout).toMatch(/absorption_policy/);
    } finally {
      server.close();
    }
  });

  it('缺失 TASK_ID 环境变量时 exit 非 0 且消息含 "TASK_ID"', async () => {
    const { server, port } = await startMockBrain(buildBrainFixture());
    try {
      const r = spawnSync('bash', [SCRIPT], {
        env: { ...process.env, BRAIN: `127.0.0.1:${port}`, TASK_ID: '' },
        encoding: 'utf8',
        timeout: 15000,
      });
      expect(r.status).not.toBe(0);
      expect(r.stderr + r.stdout).toMatch(/TASK_ID/);
    } finally {
      server.close();
    }
  });

  // === Round 3 新增（R1 fresh-clone fallback）===
  it('GIT_UNAVAILABLE=1 注入时仍 exit 0 且 stdout 含 "SKIP"（R1：fresh-clone 不应误判 FAIL）', async () => {
    const { server, port } = await startMockBrain(buildBrainFixture());
    try {
      const r = runScript(port, { GIT_UNAVAILABLE: '1' });
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/SKIP/);
    } finally {
      server.close();
    }
  });

  // === Round 3 新增（R5 cascade_skip）===
  it('全部 generator sub_task status=failed 时 exit 0 且 stdout 含 "cascade_skip" + "inconclusive"（R5：避免假绿）', async () => {
    const { server, port } = await startMockBrain(buildBrainFixture({ subTaskAllFailed: true }));
    try {
      const r = runScript(port);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/cascade_skip/);
      expect(r.stdout).toMatch(/inconclusive/);
    } finally {
      server.close();
    }
  });
});
