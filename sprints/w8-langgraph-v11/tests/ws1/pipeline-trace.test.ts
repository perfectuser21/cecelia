import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '..', '..', 'scripts', 'verify-pipeline-trace.sh');

type FixtureOverrides = Partial<{
  generatorStdoutLen: number;
  plannerStdout: string;
  evaluatorCwd: string;
  absorptionStatus: string | null;
  taskStatus: string;
  devRecordsExtra: Array<Record<string, unknown>>;
}>;

function buildBrainFixture(overrides: FixtureOverrides = {}) {
  const generatorStdoutLen = overrides.generatorStdoutLen ?? 1024;
  const plannerStdout = overrides.plannerStdout ?? 'planner started\nplanner done\n';
  const evaluatorCwd = overrides.evaluatorCwd ?? '/srv/.worktrees/sub-12345';
  const absorptionStatus = overrides.absorptionStatus === undefined ? 'not_applied' : overrides.absorptionStatus;
  const taskStatus = overrides.taskStatus ?? 'in_progress';
  return { generatorStdoutLen, plannerStdout, evaluatorCwd, absorptionStatus, taskStatus, devRecordsExtra: overrides.devRecordsExtra ?? [] };
}

function startMockBrain(fix: ReturnType<typeof buildBrainFixture>): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = req.url || '';
      res.setHeader('Content-Type', 'application/json');
      if (url.startsWith('/api/brain/tasks/') && !url.includes('?')) {
        return res.end(JSON.stringify({ id: 'TID', status: fix.taskStatus, payload: { branch_name: 'cp-gen-x' }, result: {} }));
      }
      if (url.startsWith('/api/brain/tasks?parent_task_id=') && url.includes('task_type=harness_generator')) {
        return res.end(JSON.stringify({ tasks: [{ id: 'sub-1' }] }));
      }
      if (url.startsWith('/api/brain/tasks/sub-1')) {
        return res.end(JSON.stringify({ id: 'sub-1', payload: { branch_name: 'cp-gen-sub-1' }, result: { branch: 'cp-gen-sub-1' } }));
      }
      if (url.includes('stage=planner')) {
        return res.end(JSON.stringify({ records: [{ stdout: fix.plannerStdout }] }));
      }
      if (url.includes('stage=generator')) {
        return res.end(JSON.stringify({ records: [{ stdout: 'x'.repeat(fix.generatorStdoutLen) }] }));
      }
      if (url.includes('stage=evaluator')) {
        return res.end(JSON.stringify({ records: [{ cwd: fix.evaluatorCwd, absorption_policy_status: fix.absorptionStatus }] }));
      }
      if (url.includes('stage=contract_review')) {
        return res.end(JSON.stringify({ records: [{ verdict: 'APPROVED' }] }));
      }
      if (url.includes('/dev-records')) {
        return res.end(JSON.stringify({ records: [{ stdout: 'ok' }, ...fix.devRecordsExtra] }));
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
  it('脚本文件存在且可执行', () => {
    expect(existsSync(SCRIPT)).toBe(true);
    expect(statSync(SCRIPT).mode & 0o111).toBeGreaterThan(0);
  });

  it('全痕迹齐全场景返回 exit 0', async () => {
    const { server, port } = await startMockBrain(buildBrainFixture());
    try {
      const r = runScript(port);
      expect(r.status).toBe(0);
    } finally {
      server.close();
    }
  });

  it('generator stdout < 200 bytes 时返回非 0（H7 痕迹缺失）', async () => {
    const { server, port } = await startMockBrain(buildBrainFixture({ generatorStdoutLen: 50 }));
    try {
      const r = runScript(port);
      expect(r.status).not.toBe(0);
    } finally {
      server.close();
    }
  });

  it('planner stdout 含 "Cloning into" 时返回非 0（H9 失效）', async () => {
    const { server, port } = await startMockBrain(buildBrainFixture({ plannerStdout: 'Cloning into bare repo...\n' }));
    try {
      const r = runScript(port);
      expect(r.status).not.toBe(0);
    } finally {
      server.close();
    }
  });

  it('evaluator cwd 不含 worktree 标志时返回非 0（H8 失效）', async () => {
    const { server, port } = await startMockBrain(buildBrainFixture({ evaluatorCwd: '/srv/main-repo' }));
    try {
      const r = runScript(port);
      expect(r.status).not.toBe(0);
    } finally {
      server.close();
    }
  });

  it('absorption_policy 状态非法时返回非 0（H10 失效）', async () => {
    const { server, port } = await startMockBrain(buildBrainFixture({ absorptionStatus: 'fake_applied' }));
    try {
      const r = runScript(port);
      expect(r.status).not.toBe(0);
    } finally {
      server.close();
    }
  });

  it('缺失 TASK_ID 环境变量时直接 exit 非 0', async () => {
    const { server, port } = await startMockBrain(buildBrainFixture());
    try {
      const r = spawnSync('bash', [SCRIPT], {
        env: { ...process.env, BRAIN: `127.0.0.1:${port}`, TASK_ID: '' },
        encoding: 'utf8',
        timeout: 15000,
      });
      expect(r.status).not.toBe(0);
    } finally {
      server.close();
    }
  });
});
