/**
 * GP F1 step3 —— installer 复制清单必须覆盖 fleet-worker.cjs 的全部本地 require。
 *
 * 回归背景（2026-09-13，PR #5300 部署缺件）：fleet-worker.cjs 新增
 * require('./orchestrator-runner.cjs')，但 install-fleet-worker.sh 的固定复制
 * 清单没跟上——照旧安装 worker 启动即 MODULE_NOT_FOUND，崩掉 primary 的整个
 * 执行面（attempt + orchestrator 一起）。本守卫机械枚举 require 清单与 installer
 * 覆盖面比对，任何新 require 漏进 installer 都在 CI 变红，不再靠人记。
 *
 * 守卫在真实的边上：读真 fleet-worker.cjs / 真 install-fleet-worker.sh 文件内容
 * （不 mock），installer（install-fleet-worker）的 SOURCE/cp/MOVE 三段都必须
 * 覆盖每个被 require 的 .cjs 模块。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const WORKER_DIR = join(ROOT, 'packages/brain/scripts/fleet-worker');
const workerSource = readFileSync(join(WORKER_DIR, 'fleet-worker.cjs'), 'utf8');
const installerSource = readFileSync(
  join(WORKER_DIR, 'install-fleet-worker.sh'),
  'utf8',
);

/** fleet-worker.cjs 顶层本地依赖：require('./x.cjs') 的全部 basename */
function localRequires() {
  const out = new Set();
  for (const m of workerSource.matchAll(/require\('\.\/([a-z0-9-]+)\.cjs'\)/g)) {
    out.add(m[1]);
  }
  return [...out];
}

describe('GP F1 step3 — installer 覆盖 worker 运行时依赖', () => {
  const modules = localRequires();

  it('fleet-worker.cjs 的本地 require 清单非空（解析器自证）', () => {
    expect(modules.length).toBeGreaterThanOrEqual(5);
    expect(modules).toContain('orchestrator-runner');
    expect(modules).toContain('attempt-runner');
  });

  it.each(localRequires())(
    'installer 完整搬运 %s.cjs（SOURCE 声明 + cp staging + MOVE 落位）',
    (mod) => {
      // SOURCE 声明：installer 把它列为必需源文件
      expect(installerSource).toMatch(
        new RegExp(`_SOURCE="\\$SCRIPT_DIR/${mod}\\.cjs"`),
      );
      // cp staging：真的复制进 staging 区
      expect(installerSource).toMatch(
        new RegExp(`cp "\\$[A-Z_]+_SOURCE" "\\$STAGED_[A-Z_]+"[\\s\\S]{0,400}`),
      );
      expect(installerSource).toContain(`${mod}.cjs.XXXXXX`);
      // MOVE 落位：staging → runtime 目录
      expect(installerSource).toContain(`${mod}.cjs"`);
    },
  );

  it('installer 行为契约自测存在且断言 orchestrator-runner 安装', () => {
    const testSh = readFileSync(
      join(WORKER_DIR, 'install-fleet-worker.test.sh'),
      'utf8',
    );
    expect(testSh).toContain('installed_orchestrator_runner');
  });
});
