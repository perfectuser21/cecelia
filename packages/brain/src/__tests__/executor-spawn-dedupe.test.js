import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const code = readFileSync(join(__dirname, '..', 'executor.js'), 'utf8');

// executor.js 巨型模块依赖面太宽，行为级测试成本高（会拉起 langgraph/docker 链）；
// 本任务用源码结构断言锁接线点存在性 + dedupe.test.js 已覆盖 claim 行为本身。
describe('executor spawn dedupe 接线（结构断言）', () => {
  it('DEDUP CHECK 之后接了 DB 级 claimDedupeKey(spawn)', () => {
    const dedupCheckIdx = code.indexOf('=== DEDUP CHECK ===');
    const claimIdx = code.indexOf("claimDedupeKey('spawn'");
    expect(dedupCheckIdx).toBeGreaterThan(-1);
    expect(claimIdx).toBeGreaterThan(dedupCheckIdx);
  });

  it('claim 在 RESOURCE CHECK 之后、docker/bridge spawn 之前（终审修复：避免 server_overloaded 路径泄漏 key）', () => {
    const resourceCheckIdx = code.indexOf('=== RESOURCE CHECK ===');
    const claimIdx = code.indexOf("claimDedupeKey('spawn'");
    const dockerSpawnIdx = code.indexOf('HARNESS_DOCKER_ENABLED');
    expect(resourceCheckIdx).toBeGreaterThan(-1);
    expect(claimIdx).toBeGreaterThan(resourceCheckIdx);
    expect(dockerSpawnIdx).toBeGreaterThan(claimIdx);
  });

  it('server_overloaded return 出现在 claim 之前（资源过载路径不可能泄漏 dedupe key）', () => {
    const overloadedIdx = code.indexOf("reason: 'server_overloaded'");
    const claimIdx = code.indexOf("claimDedupeKey('spawn'");
    expect(overloadedIdx).toBeGreaterThan(-1);
    expect(overloadedIdx).toBeLessThan(claimIdx);
  });

  it('被去重返回 spawn_deduplicated 语义', () => {
    expect(code).toMatch(/reason:\s*'spawn_deduplicated'/);
  });

  it('spawn 失败路径释放 key', () => {
    expect(code).toMatch(/releaseDedupeKey\('spawn'/);
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
    const recordFailureIdx = dispatcherCode.indexOf("await recordFailure('cecelia-run');");
    expect(configErrorIdx).toBeGreaterThan(-1);
    expect(spawnDedupIdx).toBeGreaterThan(configErrorIdx);
    expect(recordFailureIdx).toBeGreaterThan(spawnDedupIdx);
  });
});
