/**
 * island-gate proven-to-fire 回归锁
 * B8: 覆盖 B1/B2/B3/B4 四个核心场景
 *
 * 注意：island-gate.mjs 是 CI 脚本（process.exit），
 * 本测试通过 child_process.spawn 调用脚本并捕获 exit code，
 * 同时对纯函数逻辑（actionHint）做直接单测。
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 测试文件在 src/__tests__/，脚本在 scripts/ci/ → 相对两层上
const SCRIPT = path.resolve(__dirname, '../../scripts/ci/island-gate.mjs');

function runGate(fixtureFiles, extraEnv = {}) {
  const result = spawnSync(
    process.execPath,
    [SCRIPT, `--fixture-files=${fixtureFiles}`],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        // 测试模式：不连真实 DB（无 DB_HOST），脚本应能处理空图
        DB_HOST: '',
        DB_PORT: '5432',
        DB_NAME: 'cecelia_test',
        DB_USER: 'cecelia',
        ISLAND_GATE_NO_DB: '1',  // 告知脚本跳过 DB，用空图
        ...extraEnv,
      },
      timeout: 10000,
    }
  );
  return {
    exitCode: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

// ─── B3: 无新增文件 → exit 0 跳过 ────────────────────────────────────────────
describe('B3 — 无新增文件 → exit 0 跳过', () => {
  it('fixture-files 为空串时 exit 0 并打 [ISLAND-GATE] SKIP', () => {
    const { exitCode, stdout, stderr } = runGate('');
    const combined = stdout + stderr;
    expect(exitCode).toBe(0);
    expect(combined).toMatch(/\[ISLAND-GATE\] SKIP/);
  });
});

// ─── B1: 孤岛新文件 → exit 1（proven-to-fire）────────────────────────────────
describe('B1 — 孤岛新文件 → exit 1（proven-to-fire）', () => {
  it('无 import 的新增文件 → exit 1 + [ISLAND-GATE] FAIL', () => {
    const orphanFile = 'packages/brain/src/_orphan_ci_fixture.js';
    const { exitCode, stdout, stderr } = runGate(orphanFile, {
      // 传入文件内容（无 import）供脚本扫描
      FIXTURE_CONTENT_0: '// intentionally orphan\nexport function noop() {}',
      FIXTURE_PATH_0: orphanFile,
    });
    const combined = stdout + stderr;
    expect(exitCode).toBe(1);
    expect(combined).toMatch(/\[ISLAND-GATE\] FAIL/);
    expect(combined).toMatch(/isolated|orphan/i);
  });
});

// ─── B2: 带 import 新文件 → exit 0（连通放行）────────────────────────────────
describe('B2 — 带 import 新文件 → exit 0（连通放行）', () => {
  it('含 import 的新增文件 → exit 0（connected_unclaimed）', () => {
    const legitFile = 'packages/brain/src/_legit_ci_fixture.js';
    const { exitCode, stdout, stderr } = runGate(legitFile, {
      FIXTURE_CONTENT_0: "import pool from '../db.js';\nexport async function query(sql) { return pool.query(sql); }",
      FIXTURE_PATH_0: legitFile,
    });
    const combined = stdout + stderr;
    expect(exitCode).toBe(0);
    // 应不出现 FAIL
    expect(combined).not.toMatch(/\[ISLAND-GATE\] FAIL/);
  });
});

// ─── B4: action-hint 标签分类（纯函数单测）────────────────────────────────────
describe('B4 — action-hint 三分类逻辑', () => {
  // 直接 import 纯函数（同步测试，无需跑脚本）
  it('__tests__/ 路径 → [ACTION:挂起]', async () => {
    const { actionHint } = await import('../../scripts/ci/island-gate.mjs');
    expect(actionHint('packages/brain/src/__tests__/new-feature.test.mjs')).toBe('[ACTION:挂起]');
  });

  it('.test. 路径 → [ACTION:挂起]', async () => {
    const { actionHint } = await import('../../scripts/ci/island-gate.mjs');
    expect(actionHint('packages/brain/src/lib/__tests__/foo.test.js')).toBe('[ACTION:挂起]');
  });

  it('/src/ 核心路径（非测试）→ [ACTION:收编]', async () => {
    const { actionHint } = await import('../../scripts/ci/island-gate.mjs');
    expect(actionHint('packages/brain/src/utils/helper-new.js')).toBe('[ACTION:收编]');
  });

  it('其他路径 → [ACTION:挂起]', async () => {
    const { actionHint } = await import('../../scripts/ci/island-gate.mjs');
    expect(actionHint('packages/brain/scripts/ci/some-script.mjs')).toBe('[ACTION:挂起]');
  });
});

// ─── B9(2026-07-18 盲区回归锁): 零出边叶子模块被仓内生产文件引用 → 入边判连通 ──
// 事故: PR#4090 的 radius-client.js(只用全局 fetch,零 import)被闸误杀,
// 而它被 cascade-list.js(生产代码)引用。修法: 出边为零时补仓内入边静态扫描;
// 测试文件不算入边源(只被自己单测引用的仍是孤岛,闸保牙)。
describe('B9 — 入边盲区回归锁', () => {
  it('radius-client.js(真实仓内叶子,被 cascade-list 引用)→ exit 0 且日志含 in-edge', () => {
    const { exitCode, stdout, stderr } = runGate('packages/brain/src/lib/radius-client.js');
    const combined = stdout + stderr;
    expect(exitCode).toBe(0);
    expect(combined).toMatch(/in-edge/);
  });

  it('真孤岛(仓内无人引用的 fixture)→ 仍 exit 1', () => {
    const { exitCode } = runGate('packages/brain/src/lib/true-island-b9-xyz.js', {
      FIXTURE_PATH_0: 'packages/brain/src/lib/true-island-b9-xyz.js',
      FIXTURE_CONTENT_0: 'const x = 1; export default x;',
    });
    expect(exitCode).toBe(1);
  });
});
