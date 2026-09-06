// F1「工厂 · 开发闭环」步骤 1「接单进车间即分档」—— 边：codex-bridge 派活时解析 workDir
//
// Regression: resolveLegacyWorkDir 只认短 slug，收到完整 GitHub URL 直接抛
// legacy_workspace_repo_not_supported，导致整类 contract 任务在派发阶段全灭。
//
// 生产现场（2026-09-06 实测）：Brain blocked 队列里大量任务 blocked_detail.last_error =
//   "legacy_workspace_repo_not_supported:https://github.com/perfectuser21/cecelia.git"
// 根因：resolveLegacyWorkDir 用 === 严格比较 baseRepo 与 'perfectuser21/cecelia'，
// 但上游 payload.base_repo 存的是完整 URL（harness_initiative 任务实测均为
// "https://github.com/perfectuser21/cecelia"），两者永不相等 → 落到兜底 throw。
// codex-bridge 是派活给 Codex 账号的唯一通路，它塞死＝Codex 侧算力全闲置。
//
// 锁死：无论 baseRepo 是短 slug、https URL、带不带 .git 后缀、带不带尾部斜杠，
// 只要指向同一个仓库就必须解析到同一个 workDir，不得抛错。
import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let resolveLegacyWorkDir;

beforeAll(() => {
  ({ resolveLegacyWorkDir } = require('../../../packages/brain/scripts/codex-bridge/codex-bridge.cjs'));
});

describe('F1 step1 · codex-bridge resolveLegacyWorkDir 仓库标识归一化', () => {
  const WORK = '/tmp/work-cecelia';
  const ZJ = '/tmp/work-zenithjoy';

  // cecelia 主仓：四种等价写法都必须解析到同一个 workDir
  const ceceliaForms = [
    'perfectuser21/cecelia',
    'https://github.com/perfectuser21/cecelia',
    'https://github.com/perfectuser21/cecelia.git',
    'https://github.com/perfectuser21/cecelia/',
  ];

  it.each(ceceliaForms)('cecelia 写法 %s 解析到默认 workDir，不抛错', (baseRepo) => {
    expect(() => resolveLegacyWorkDir({ baseRepo, defaultWorkDir: WORK }))
      .not.toThrow();
    expect(resolveLegacyWorkDir({ baseRepo, defaultWorkDir: WORK })).toBe(WORK);
  });

  it('生产实测的完整 URL 不再抛 legacy_workspace_repo_not_supported', () => {
    // 这一条就是 Brain blocked 队列里的原始字符串
    const baseRepo = 'https://github.com/perfectuser21/cecelia.git';
    let err = null;
    try { resolveLegacyWorkDir({ baseRepo, defaultWorkDir: WORK }); } catch (e) { err = e; }
    expect(err).toBeNull();
  });

  const zjForms = [
    'perfectuser21/zenithjoy-workspace',
    'https://github.com/perfectuser21/zenithjoy-workspace',
    'https://github.com/perfectuser21/zenithjoy-workspace.git',
  ];

  it.each(zjForms)('zenithjoy-workspace 写法 %s 解析到 ZENITHJOY_WORK_DIR', (baseRepo) => {
    const prev = process.env.ZENITHJOY_WORK_DIR;
    process.env.ZENITHJOY_WORK_DIR = ZJ;
    try {
      expect(resolveLegacyWorkDir({ baseRepo, defaultWorkDir: WORK })).toBe(ZJ);
    } finally {
      if (prev === undefined) delete process.env.ZENITHJOY_WORK_DIR;
      else process.env.ZENITHJOY_WORK_DIR = prev;
    }
  });

  // 守住原有语义：真正不认识的仓库仍须抛错，不能为了修 bug 把兜底闸拆了
  it('真正不支持的仓库仍然抛 legacy_workspace_repo_not_supported', () => {
    expect(() => resolveLegacyWorkDir({
      baseRepo: 'https://github.com/someone-else/unknown-repo.git',
      defaultWorkDir: WORK,
    })).toThrow(/legacy_workspace_repo_not_supported/);
  });

  // 守住原有语义：无 baseRepo 无 workDir → 默认；无 baseRepo 有 workDir → 用 workDir
  it('无 baseRepo 时保持原有回落语义', () => {
    expect(resolveLegacyWorkDir({ defaultWorkDir: WORK })).toBe(WORK);
    expect(resolveLegacyWorkDir({ workDir: '/tmp/explicit', defaultWorkDir: WORK })).toBe('/tmp/explicit');
  });
});
