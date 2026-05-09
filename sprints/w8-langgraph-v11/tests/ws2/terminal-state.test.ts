import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '..', '..', 'scripts', 'verify-terminal-state.sh');

type FixtureOverrides = Partial<{
  status: string;
  completedAt: string | null;
  resultBranch: string | null;
  resultVerdict: string | null;
  orphanCount: number;
  has404: boolean;
}>;

function buildFixture(o: FixtureOverrides = {}) {
  return {
    status: o.status ?? 'completed',
    completedAt: o.completedAt === undefined ? '2026-05-09T10:00:00Z' : o.completedAt,
    resultBranch: o.resultBranch === undefined ? 'cp-final-abc' : o.resultBranch,
    resultVerdict: o.resultVerdict === undefined ? 'PASS' : o.resultVerdict,
    orphanCount: o.orphanCount ?? 0,
    has404: o.has404 ?? false,
  };
}

function startMockBrain(fix: ReturnType<typeof buildFixture>): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = req.url || '';
      res.setHeader('Content-Type', 'application/json');
      if (url.startsWith('/api/brain/tasks/') && !url.includes('?')) {
        const result: Record<string, unknown> = {};
        if (fix.resultBranch) result.branch = fix.resultBranch;
        if (fix.resultVerdict) result.final_verdict = fix.resultVerdict;
        return res.end(JSON.stringify({
          id: 'TID',
          status: fix.status,
          completed_at: fix.completedAt,
          result,
        }));
      }
      if (url.startsWith('/api/brain/tasks?parent_task_id=') && url.includes('status=in_progress')) {
        return res.end(JSON.stringify({ tasks: Array(fix.orphanCount).fill({ id: 'orphan' }) }));
      }
      if (url.includes('/dev-records')) {
        const records = fix.has404
          ? [{ stdout: 'received callback 404 not found' }]
          : [{ stdout: 'ok' }];
        return res.end(JSON.stringify({ records }));
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

describe('Workstream 2 — 终态写回验证脚本 [BEHAVIOR]', () => {
  it('脚本文件存在且可执行 (chmod +x)', () => {
    expect(existsSync(SCRIPT)).toBe(true);
    expect(statSync(SCRIPT).mode & 0o111).toBeGreaterThan(0);
  });

  it('status=completed + 字段完整 + 无孤儿 + 无 404 → exit 0 且 stdout 含 OK 标记', async () => {
    const { server, port } = await startMockBrain(buildFixture());
    try {
      const r = runScript(port);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/OK|✅|completed/);
    } finally {
      server.close();
    }
  });

  it('status=in_progress（非终态）时 exit 1 且消息含 "非终态" 或 "not.*terminal"', async () => {
    const { server, port } = await startMockBrain(buildFixture({ status: 'in_progress' }));
    try {
      const r = runScript(port);
      expect(r.status).toBe(1);
      expect(r.stderr + r.stdout).toMatch(/非终态|not.*terminal|in_progress/);
    } finally {
      server.close();
    }
  });

  it('completed_at 缺失时 exit 1 且消息含 "completed_at"', async () => {
    const { server, port } = await startMockBrain(buildFixture({ completedAt: null }));
    try {
      const r = runScript(port);
      expect(r.status).toBe(1);
      expect(r.stderr + r.stdout).toMatch(/completed_at/);
    } finally {
      server.close();
    }
  });

  it('result.branch 缺失时 exit 1 且消息含 "branch"', async () => {
    const { server, port } = await startMockBrain(buildFixture({ resultBranch: null }));
    try {
      const r = runScript(port);
      expect(r.status).toBe(1);
      expect(r.stderr + r.stdout).toMatch(/branch/);
    } finally {
      server.close();
    }
  });

  it('存在孤儿 in_progress sub_task 时 exit 1 且消息含 "孤儿" 或 "orphan"', async () => {
    const { server, port } = await startMockBrain(buildFixture({ orphanCount: 2 }));
    try {
      const r = runScript(port);
      expect(r.status).toBe(1);
      expect(r.stderr + r.stdout).toMatch(/孤儿|orphan/);
    } finally {
      server.close();
    }
  });

  it('dev_record 含 callback 404 时 exit 1 且消息含 "404"', async () => {
    const { server, port } = await startMockBrain(buildFixture({ has404: true }));
    try {
      const r = runScript(port);
      expect(r.status).toBe(1);
      expect(r.stderr + r.stdout).toMatch(/404/);
    } finally {
      server.close();
    }
  });
});
