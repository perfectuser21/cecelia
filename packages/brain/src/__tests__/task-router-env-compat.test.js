/**
 * task-router-env-compat.test.js
 *
 * 验证 task-router 跨环境一致性验证：
 *   - LOCATION_CAPABILITIES 定义每个 location 提供的 capability tags
 *   - extractEnvRequirements 合并 type 基线 + DoD 层标注（payload.env_requires + 内联 [env: tag]）
 *   - verifyEnvCompatibility 在 location 缺少 required tag 时返回 incompatible
 *   - pre-flight 接入 verifyEnvCompatibility，dispatch 前拦截不兼容任务
 *
 * 根因：learning_id da78df62 — 跨环境一致性验证应在任务定义阶段完成（非执行阶段）：
 *   DoD 命令必须标注环境依赖，dispatch 层必须验证目标环境兼容性。
 *   原 selectBestMachine 在无匹配机器时静默降级到 us-m4，掩盖了类型↔机器配错的真正错误。
 *
 * 采用 import + 单元断言模式，同时静态读取 pre-flight-check.js 验证 wire-up。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  LOCATION_CAPABILITIES,
  extractEnvRequirements,
  verifyEnvCompatibility,
  getTaskLocation,
  TASK_REQUIREMENTS,
} from '../task-router.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('LOCATION_CAPABILITIES: 每个 location 显式声明 capability tags', () => {
  it('us / xian / xian_m1 三个 location 全部有定义', () => {
    expect(LOCATION_CAPABILITIES).toBeDefined();
    expect(Array.isArray(LOCATION_CAPABILITIES.us)).toBe(true);
    expect(Array.isArray(LOCATION_CAPABILITIES.xian)).toBe(true);
    expect(Array.isArray(LOCATION_CAPABILITIES.xian_m1)).toBe(true);
  });

  it('us 至少提供 has_git / has_browser / general（US M4 是全能机）', () => {
    expect(LOCATION_CAPABILITIES.us).toEqual(expect.arrayContaining(['has_git', 'has_browser', 'general']));
  });

  it('xian 至少提供 has_git（codex_dev 实际依赖 worktree） + has_browser（crystallize CDP）+ general', () => {
    expect(LOCATION_CAPABILITIES.xian).toEqual(expect.arrayContaining(['has_git', 'has_browser', 'general']));
  });

  it('xian_m1 是 general-only Codex（无 git / browser）', () => {
    expect(LOCATION_CAPABILITIES.xian_m1).toContain('general');
    expect(LOCATION_CAPABILITIES.xian_m1).not.toContain('has_git');
    expect(LOCATION_CAPABILITIES.xian_m1).not.toContain('has_browser');
  });
});

describe('extractEnvRequirements: 合并 type 基线 + DoD 层标注', () => {
  it('仅从 task_type 推导 baseline（无 payload 标注时）', () => {
    const task = { task_type: 'dev' };
    const reqs = extractEnvRequirements(task);
    expect(reqs).toEqual(expect.arrayContaining(TASK_REQUIREMENTS['dev']));
  });

  it('合并 payload.env_requires 数组（DoD 层显式标注）', () => {
    const task = {
      task_type: 'dev',
      payload: { env_requires: ['has_browser'] },
    };
    const reqs = extractEnvRequirements(task);
    expect(reqs).toContain('has_git');      // type baseline
    expect(reqs).toContain('has_browser');  // DoD 加签
  });

  it('合并 description 里的内联 [env: tag] 标注', () => {
    const task = {
      task_type: 'talk',
      description: '需要 [env: has_browser] 跑端到端测试',
    };
    const reqs = extractEnvRequirements(task);
    expect(reqs).toContain('general');      // type baseline (talk)
    expect(reqs).toContain('has_browser');  // 内联标注
  });

  it('去重：同一 tag 在多处出现只保留一次', () => {
    const task = {
      task_type: 'dev',
      description: '[env: has_git]',
      payload: { env_requires: ['has_git'] },
    };
    const reqs = extractEnvRequirements(task);
    const gitCount = reqs.filter((t) => t === 'has_git').length;
    expect(gitCount).toBe(1);
  });

  it('无 task_type 时返回保守 baseline（至少含 has_git）', () => {
    const task = {};
    const reqs = extractEnvRequirements(task);
    expect(reqs).toContain('has_git');
  });
});

describe('verifyEnvCompatibility: dispatch 前 fail-fast', () => {
  it('compat=true 当 location 提供所有 required tags', () => {
    const task = { task_type: 'dev' };
    const result = verifyEnvCompatibility(task, 'us');
    expect(result.compatible).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('compat=false 当 location 缺少 required tag（不再静默降级）', () => {
    const task = { task_type: 'dev' }; // requires has_git
    const result = verifyEnvCompatibility(task, 'xian_m1'); // 无 has_git
    expect(result.compatible).toBe(false);
    expect(result.missing).toContain('has_git');
  });

  it('DoD 加签的 env 未被目标 location 提供时 fail（核心场景）', () => {
    const task = {
      task_type: 'talk',
      payload: { env_requires: ['has_git'] }, // DoD 层加签
    };
    // talk 默认路由 xian，xian 有 has_git，应 compatible
    const xianResult = verifyEnvCompatibility(task, 'xian');
    expect(xianResult.compatible).toBe(true);
    // 但路由到 xian_m1（无 has_git）应 fail
    const m1Result = verifyEnvCompatibility(task, 'xian_m1');
    expect(m1Result.compatible).toBe(false);
    expect(m1Result.missing).toContain('has_git');
  });

  it('未知 location 视为 incompatible（防漏配）', () => {
    const task = { task_type: 'dev' };
    const result = verifyEnvCompatibility(task, 'mars');
    expect(result.compatible).toBe(false);
    expect(result.reason).toMatch(/unknown_location/);
  });

  it('返回结构含 required / available / missing 三段（便于排障）', () => {
    const task = { task_type: 'dev' };
    const result = verifyEnvCompatibility(task, 'xian_m1');
    expect(Array.isArray(result.required)).toBe(true);
    expect(Array.isArray(result.available)).toBe(true);
    expect(Array.isArray(result.missing)).toBe(true);
  });
});

describe('既有 LOCATION_MAP 路由全部通过 env-compat 验证（回归红线）', () => {
  // 任何现有 task_type → location 配对若不兼容，说明本次 fix 引入了回归
  const taskTypes = Object.keys(TASK_REQUIREMENTS);
  for (const taskType of taskTypes) {
    it(`${taskType} → ${getTaskLocation(taskType)} 兼容`, () => {
      const location = getTaskLocation(taskType);
      const result = verifyEnvCompatibility({ task_type: taskType }, location);
      expect(result.compatible, `${taskType} 路由 ${location} 缺失 tags=${JSON.stringify(result.missing)}`).toBe(true);
    });
  }
});

describe('pre-flight-check: 接入 env-compat 验证（dispatch 前拦截）', () => {
  const preFlightSrc = readFileSync(join(__dirname, '../pre-flight-check.js'), 'utf8');

  it('pre-flight-check.js import verifyEnvCompatibility', () => {
    expect(preFlightSrc).toMatch(/verifyEnvCompatibility|getTaskLocation/);
  });

  it('pre-flight 失败原因含 env_incompatible 字样（用于 dispatch 日志 grep）', () => {
    expect(preFlightSrc).toMatch(/env[_-]?incompat/i);
  });
});
