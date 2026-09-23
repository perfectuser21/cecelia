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
    // 找失败路径上的 recordFailure 调用。
    // 0923 秋米熔断豁免刀之后这里不再是字面量 recordFailure('cecelia-run')，
    // 而是按注册表 surface 分键的三元（openclaw-agent / cecelia-run），
    // 所以定位改用正则；键的默认仍必须是 cecelia-run（下面一条断言钉住）。
    const recordIdx = dispatcherSrc.search(/await recordFailure\(/);
    expect(recordIdx).toBeGreaterThan(-1);
    const recordLine = dispatcherSrc.slice(recordIdx, dispatcherSrc.indexOf('\n', recordIdx));
    expect(recordLine, '失败路径的 breaker 默认键必须还是 cecelia-run').toContain("'cecelia-run'");
    // 取该调用前的窗口，必须包含 configError 守卫。
    // 窗口放宽到 800 字节：if-else 链后续追加了其他豁免分支（如
    // spawn_deduplicated / local_execution_disabled_on_scheduler），
    // 400 字节量不出前几个分支就先把 configError 挤出窗口。
    // 0923 变异实测：只断言窗口里出现「configError」这个词是假绿——把整个
    // if (execResult.configError) 分支删掉，窗口里剩下的注释仍带这个词，测试照样绿。
    // 所以钉的是真实代码分支（读 execResult.configError 的那个 if），不是词。
    const before = dispatcherSrc.slice(Math.max(0, recordIdx - 800), recordIdx);
    expect(before, 'recordFailure 之前必须先有 execResult.configError 分支把它挡掉').toMatch(
      /if \(\s*execResult\.configError\s*\)/
    );
  });

  it('configError 路径有日志说明 skipping breaker', () => {
    // 必须有日志解释为什么不 trip。同上，窗口限定在 recordFailure 之前的豁免链里，
    // 否则文件别处任意一句带 configError 的话都能让这条假绿。
    const recordIdx = dispatcherSrc.search(/await recordFailure\(/);
    const before = dispatcherSrc.slice(Math.max(0, recordIdx - 800), recordIdx);
    expect(before).toMatch(/configError[^\n]*(skip|跳过|不计入|not.*counted)[^\n]*breaker/i);
  });
});
