/**
 * 合同测试 — 通道1 should-auto-merge.sh 判据由 PR 标题换成 Brain 归属求证 + fail-closed。
 *
 * 禁 mock 边（CONTRACT IS LAW）：should-auto-merge.sh ↔ Brain 归属端点是跨进程 HTTP 边，
 * 必须用真实 node:http stub server（真 socket、真 curl）驱动，禁止 mock curl / 桩掉 HTTP 传输层。
 * 本文件全部用例都以异步 execFile 真跑仓库里的 bash 脚本，BRAIN_URL 指向临时真 http server。
 *
 * 语义迁移：判据从「标题 feat(harness): → SKIP」换成「Brain owned=true → SKIP」。
 * 现脚本按标题判，故 owned=true / 5xx / 非法JSON / 不可达 / 超时 / 回归#4755 六例在 Red 阶段失败；
 * owned=false→MERGE、回归#4759(标题恰为 feat(harness):)、非cp-* 三例在 Red 阶段巧合通过（非伪绿）。
 */
import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const pExecFile = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
// sprints/08112000-merge-authority-single-gate/tests/ → 仓库根 = 上溯 3 级
const REPO_ROOT = resolve(HERE, '../../..');
const SCRIPT = resolve(REPO_ROOT, '.github/workflows/scripts/should-auto-merge.sh');

// 用异步 execFile（非 execFileSync）：脚本内 curl 请求由本进程的 http stub server 应答，
// 同步阻塞会占死 node 事件循环导致 stub 永不响应（curl 必超时）。异步等待让事件循环空闲应答。
async function runScript(branch: string, title: string, env: Record<string, string> = {}) {
  try {
    const { stdout } = await pExecFile('bash', [SCRIPT, branch, title], {
      cwd: REPO_ROOT,
      env: { ...process.env, ...env },
      encoding: 'utf8',
      timeout: 30000,
    });
    return { stdout: String(stdout).trim() };
  } catch (e: any) {
    return { stdout: String(e.stdout || '').trim() };
  }
}

/** 起一个临时真 http server，回调里跑脚本，结束后关闭。 */
async function withStub(
  handler: (req: any, res: any) => void,
  fn: (url: string) => void | Promise<void>,
) {
  const server = createServer(handler);
  await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()));
  const port = (server.address() as any).port;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((res) => server.close(() => res()));
  }
}

function ownedHandler(owned: boolean) {
  return (_req: any, res: any) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        owned,
        run_id: owned ? '11111111-1111-1111-1111-111111111111' : null,
        pr_url: owned ? 'https://github.com/o/r/pull/1' : null,
        matched_by: owned ? 'branch' : null,
      }),
    );
  };
}

describe('should-auto-merge.sh × Brain 归属求证（通道1）', () => {
  it('owned=true → 输出 SKIP（harness-owned，交裁判 gate）', async () => {
    await withStub(ownedHandler(true), async (url) => {
      const { stdout } = await runScript('cp-x-abc', 'fix(brain): x', { BRAIN_URL: url });
      expect(stdout.startsWith('SKIP')).toBe(true);
      expect(stdout).not.toMatch(/MERGE/);
    });
  });

  it('owned=false + cp-* → 输出 MERGE（/dev 不回归，红线）', async () => {
    await withStub(ownedHandler(false), async (url) => {
      const { stdout } = await runScript('cp-x-devpr', 'fix(brain): 手动 dev', { BRAIN_URL: url });
      expect(stdout).toMatch(/^MERGE/);
    });
  });

  it('Brain 5xx → SKIP（fail-closed，绝不 MERGE）', async () => {
    await withStub(
      (_req, res) => {
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end('boom');
      },
      async (url) => {
        const { stdout } = await runScript('cp-x-abc', 'fix(brain): x', { BRAIN_URL: url });
        expect(stdout.startsWith('SKIP')).toBe(true);
        expect(stdout).not.toMatch(/MERGE/);
      },
    );
  });

  it('非法 JSON → SKIP（fail-closed，2xx 但 body 不可解析）', async () => {
    await withStub(
      (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{ not-json');
      },
      async (url) => {
        const { stdout } = await runScript('cp-x-abc', 'fix(brain): x', { BRAIN_URL: url });
        expect(stdout.startsWith('SKIP')).toBe(true);
        expect(stdout).not.toMatch(/MERGE/);
      },
    );
  });

  it('Brain 不可达（连接被拒 exit7）→ SKIP（fail-closed 快速失败）', async () => {
    const { stdout } = await runScript('cp-x-abc', 'fix(brain): x', { BRAIN_URL: 'http://127.0.0.1:1' });
    expect(stdout.startsWith('SKIP')).toBe(true);
    expect(stdout).not.toMatch(/MERGE/);
  });

  it('Brain 超时（接受连接后挂起 → curl --max-time exit28）→ SKIP（fail-closed，R1-1）', async () => {
    await withStub(
      () => {
        /* 永不响应，逼出 curl --max-time 超时路径 */
      },
      async (url) => {
        const { stdout } = await runScript('cp-x-abc', 'fix(brain): x', {
          BRAIN_URL: url,
          BRAIN_TIMEOUT: '2',
        });
        expect(stdout.startsWith('SKIP')).toBe(true);
        expect(stdout).not.toMatch(/MERGE/);
      },
    );
  });

  it('回归 #4755 分支 cp-08101107-04e4690d → harness-owned/SKIP（当天绕过标题判据事故不重演）', async () => {
    await withStub(ownedHandler(true), async (url) => {
      const { stdout } = await runScript(
        'cp-08101107-04e4690d',
        'fix(orchestrator): 基础设施触发的 fix 轮 SHA 不变不误判 no-progress',
        { BRAIN_URL: url },
      );
      expect(stdout.startsWith('SKIP')).toBe(true);
      expect(stdout).not.toMatch(/MERGE/);
    });
  });

  it('回归 #4759 分支 cp-08101246-643b5302 → harness-owned/SKIP（当天无视 judge FAIL 强合事故不重演）', async () => {
    await withStub(ownedHandler(true), async (url) => {
      const { stdout } = await runScript(
        'cp-08101246-643b5302',
        'feat(harness): preview-reaper 停止按端口持有者 kill，根治 OrbStack vmgr 误杀',
        { BRAIN_URL: url },
      );
      expect(stdout.startsWith('SKIP')).toBe(true);
    });
  });

  it('非cp-* 分支 → SKIP（保留原有行为，不归通用 auto-merge）', async () => {
    await withStub(ownedHandler(false), async (url) => {
      const { stdout } = await runScript('feature/manual-branch', 'fix(brain): 随便改', { BRAIN_URL: url });
      expect(stdout.startsWith('SKIP')).toBe(true);
    });
  });
});
