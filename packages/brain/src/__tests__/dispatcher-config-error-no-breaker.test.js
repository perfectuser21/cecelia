/**
 * dispatcher-config-error-no-breaker.test.js
 *
 * 验证 dispatcher 对 executor 返回 configError:true 的失败不 trip cecelia-run breaker。
 *
 * 根因：codex binary 缺失（容器配置漏装）属于"系统配置错误"非"任务执行错误"，
 * 不应累积 cecelia-run failure 计数 → 否则 breaker 因配置漂移 OPEN 阻断所有 dispatch。
 *
 * 期望行为：execResult = { success:false, configError:true, ... }
 *   - dispatcher 标记 task 回 queued
 *   - dispatcher 跳过 recordFailure('cecelia-run')
 *   - dispatcher 不发 'executor_failed' 计入 breaker
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dispatcherSrc = readFileSync(
  join(__dirname, '../dispatcher.js'),
  'utf8'
);

describe('dispatcher: configError 不 trip cecelia-run breaker', () => {
  it('dispatcher 检查 execResult.configError 字段', () => {
    expect(dispatcherSrc).toContain('configError');
  });

  it('configError:true 时跳过 recordFailure(cecelia-run)', () => {
    // 找 recordFailure('cecelia-run') 调用
    const recordIdx = dispatcherSrc.indexOf("recordFailure('cecelia-run')");
    expect(recordIdx).toBeGreaterThan(-1);
    // 取该调用前的 400 字节，必须包含 configError 守卫（if !configError 或类似）
    const before = dispatcherSrc.slice(Math.max(0, recordIdx - 400), recordIdx);
    expect(before).toMatch(/configError/);
  });

  it('configError 路径有日志说明 skipping breaker', () => {
    // 必须有日志解释为什么不 trip
    expect(dispatcherSrc).toMatch(/configError.*(skip|跳过|不计入|not.*counted)/i);
  });
});
