import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const code = readFileSync(join(__dirname, '..', 'executor.js'), 'utf8');

// executor.js 巨型模块依赖面太宽，行为级测试成本高（会拉起 langgraph/docker 链）；
// 本任务用源码结构断言锁接线点存在性 + dedupe.test.js 已覆盖 claim 行为本身。
describe('executor spawn dedupe 接线（结构断言）', () => {
  // 原 5 条用例（DEDUP CHECK 后 claimDedupeKey(spawn) / RESOURCE CHECK 顺序 / server_overloaded 先于 claim /
  // spawn_deduplicated 返回 / spawn 失败 releaseDedupeKey）测的是 _triggerCeceliaRunInner 第 3 步 Claude 桥接/容器 spawn 段，
  // 已随 Claude 通道退役删除（任务 76a160b3）。
  it('Claude spawn 段已删：executor 不再 claim/release spawn dedupe key', () => {
    expect(code).not.toMatch(/claimDedupeKey\('spawn'/);
    expect(code).not.toMatch(/releaseDedupeKey\('spawn'/);
  });

  it('不碰 harness-callback claim（该文件零改动）', () => {
    const cb = readFileSync(join(__dirname, '..', 'routes', 'harness-callback.js'), 'utf8');
    expect(cb).not.toMatch(/claimDedupeKey/);
  });
});

describe('dispatcher spawn_deduplicated carve-out（结构断言）', () => {
  it('spawn_deduplicated 在 recordFailure 排除逻辑里，不计入 cecelia-run 熔断', () => {
    const dispatcherCode = readFileSync(join(__dirname, '..', 'dispatcher.js'), 'utf8');
    const configErrorIdx = dispatcherCode.indexOf("if (execResult.configError)");
    const spawnDedupIdx = dispatcherCode.indexOf("execResult.reason === 'spawn_deduplicated'");
    // 0923 秋米熔断豁免刀：这行从字面量 recordFailure('cecelia-run') 改成按注册表
    // surface 分键的三元，定位改用正则（失败路径只有这一处 recordFailure 调用）。
    const recordFailureIdx = dispatcherCode.search(/await recordFailure\(/);
    expect(configErrorIdx).toBeGreaterThan(-1);
    expect(spawnDedupIdx).toBeGreaterThan(configErrorIdx);
    expect(recordFailureIdx).toBeGreaterThan(spawnDedupIdx);
  });
});
