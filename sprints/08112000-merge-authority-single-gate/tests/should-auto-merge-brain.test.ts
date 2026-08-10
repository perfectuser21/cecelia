// TDD Red — should-auto-merge.sh 归属判据换 Brain 求证 + fail-closed。
// 禁 mock 边：脚本 ↔ Brain 归属端点 是本单被改的接缝，测试用【真实 HTTP stub server】
// （真 socket、真 curl）驱动，不 mock curl / 不 mock HTTP 传输层。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SCRIPT = `${REPO_ROOT}.github/workflows/scripts/should-auto-merge.sh`;

// 真实 stub Brain：按 branch query 决定 owned；支持 mode=5xx / mode=badjson 复现 fail-closed。
let server: any;
let baseUrl = '';
// 由每个用例设置的应答策略
let responder: (branch: string) => { code: number; body: string } = () => ({ code: 200, body: '{}' });

beforeAll(async () => {
  server = createServer((req, res) => {
    const u = new URL(req.url || '/', 'http://x');
    const branch = u.searchParams.get('branch') || '';
    const { code, body } = responder(branch);
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(body);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(() => { server?.close(); });

function run(branch: string, title: string, brainUrl = baseUrl): string {
  try {
    return execFileSync('bash', [SCRIPT, branch, title], {
      env: { ...process.env, BRAIN_URL: brainUrl },
      encoding: 'utf8',
    }).trim();
  } catch (e: any) {
    // 脚本 exit!=0 时仍取 stdout 做断言
    return String(e.stdout || '').trim();
  }
}

describe('should-auto-merge.sh — Brain 归属求证 [BEHAVIOR]', () => {
  it('Brain 返回 owned=true（harness run）→ 输出 SKIP（不抢跑 auto-merge）', () => {
    responder = () => ({ code: 200, body: JSON.stringify({ owned: true, run_id: 'r1', pr_url: 'https://x/pull/1', matched_by: 'branch' }) });
    expect(run('cp-0704084753-abc', 'fix(brain): 任意标题')).toContain('SKIP');
  });

  it('Brain 返回 owned=false（非 harness run）+ cp-* → 输出 MERGE（/dev 不回归）', () => {
    responder = () => ({ code: 200, body: JSON.stringify({ owned: false, run_id: null, pr_url: null, matched_by: null }) });
    expect(run('cp-0704084753-abc', 'fix(brain): 手动 /dev')).toContain('MERGE');
  });

  it('fail-closed：Brain 5xx → SKIP', () => {
    responder = () => ({ code: 503, body: 'upstream down' });
    expect(run('cp-0704084753-abc', 'fix(brain): x')).toContain('SKIP');
  });

  it('fail-closed：Brain 返回非法 JSON → SKIP', () => {
    responder = () => ({ code: 200, body: 'not-json{' });
    expect(run('cp-0704084753-abc', 'fix(brain): x')).toContain('SKIP');
  });

  it('fail-closed：Brain 不可达（连接被拒）→ SKIP', () => {
    // 指向一个未监听端口 → curl 立即 exit7 快速失败
    expect(run('cp-0704084753-abc', 'fix(brain): x', 'http://127.0.0.1:1')).toContain('SKIP');
  });

  it('fail-closed：Brain 超时（接受连接后挂起无响应）→ SKIP', () => {
    // R1-1：与「连接被拒」是不同代码路径——真 stub server 接受连接后永不响应，逼脚本走
    // curl --max-time 超时（exit28）而非快速失败（exit7）。BRAIN_TIMEOUT=2 让用例秒级返回；
    // 若脚本漏配 --max-time，此用例会挂满 vitest 超时预算 → FAIL（即缺 -m 的逼出信号）。
    const hang = createServer(() => { /* 收到请求后永不 res.end，挂起连接 */ });
    return new Promise<void>((resolve, reject) => {
      hang.listen(0, '127.0.0.1', () => {
        const port = (hang.address() as any).port;
        let out = '';
        try {
          out = execFileSync('bash', [SCRIPT, 'cp-0704084753-abc', 'fix(brain): x'], {
            env: { ...process.env, BRAIN_URL: `http://127.0.0.1:${port}`, BRAIN_TIMEOUT: '2' },
            encoding: 'utf8',
          }).trim();
        } catch (e: any) {
          out = String(e.stdout || '').trim();
        }
        hang.close();
        try {
          expect(out).toContain('SKIP');
          expect(out).not.toContain('MERGE');
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });
  });

  it('回归 #4755 分支 cp-08101107-04e4690d（Brain 判 owned）→ SKIP', () => {
    responder = (b) => b === 'cp-08101107-04e4690d'
      ? ({ code: 200, body: JSON.stringify({ owned: true, run_id: 'r4755', pr_url: 'https://x/pull/4755', matched_by: 'branch' }) })
      : ({ code: 200, body: JSON.stringify({ owned: false }) });
    expect(run('cp-08101107-04e4690d', 'fix(orchestrator): 基础设施触发的 fix 轮 SHA 不变不误判 no-progress')).toContain('SKIP');
  });

  it('回归 #4759 分支 cp-08101246-643b5302（Brain 判 owned）→ SKIP', () => {
    responder = (b) => b === 'cp-08101246-643b5302'
      ? ({ code: 200, body: JSON.stringify({ owned: true, run_id: 'r4759', pr_url: 'https://x/pull/4759', matched_by: 'branch' }) })
      : ({ code: 200, body: JSON.stringify({ owned: false }) });
    expect(run('cp-08101246-643b5302', 'feat(harness): preview-reaper 停止按端口持有者 kill')).toContain('SKIP');
  });

  it('非 cp-* 分支 → SKIP（保留原有行为）', () => {
    responder = () => ({ code: 200, body: JSON.stringify({ owned: false }) });
    expect(run('feature/manual-branch', 'fix(brain): x')).toContain('SKIP');
  });
});
