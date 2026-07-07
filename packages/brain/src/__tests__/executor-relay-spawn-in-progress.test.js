/**
 * Regression test: skill-relay spawn 成功后 executor 不得标 completed
 *
 * Bug 根因：spawnSkillRelaySession 返回 {ok:true, mode:'skill-relay'}，
 * executor.js 沿用 LangGraph 语义 ok=true → updateTaskStatus('completed')，
 * 导致容器刚启动就被标完成，watchdog housekeep 踢掉还在跑的 run，
 * relay 保护网失效。
 *
 * 修法（2026-07-07）：result.ok=true + result.mode==='skill-relay'
 * 时留 in_progress，完成态归 harness-report callback 回写。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

describe('executor.js skill-relay spawn 完成态保护', () => {
  const SRC = fs.readFileSync(new URL('../executor.js', import.meta.url), 'utf8');

  // 定位 runHarnessInitiativeRouter 调用后的状态处理块
  const routerCallIdx = SRC.indexOf("const result = await runHarnessInitiativeRouter(task)");
  const handlerBlock = routerCallIdx >= 0 ? SRC.slice(routerCallIdx, routerCallIdx + 1500) : '';

  it('handlerBlock 能被正确提取（测试前置条件）', () => {
    expect(routerCallIdx).toBeGreaterThanOrEqual(0);
    expect(handlerBlock.length).toBeGreaterThan(100);
  });

  it('存在 skill-relay 模式检测（mode guard）', () => {
    expect(handlerBlock).toMatch(/mode\s*===\s*['"]skill-relay['"]/);
  });

  it('skill-relay 分支有 leaving in_progress 日志', () => {
    // 确保 relay spawn 成功路径有可观测的 log
    expect(handlerBlock).toMatch(/skill-relay[\s\S]{0,200}in_progress|in_progress[\s\S]{0,200}skill-relay/);
  });

  it('mode guard 出现在 updateTaskStatus(completed) 之前，确保 relay 不走 completed 分支', () => {
    const modeGuardIdx = handlerBlock.search(/mode\s*===\s*['"]skill-relay['"]/);
    const completedIdx = handlerBlock.indexOf("updateTaskStatus(task.id, 'completed')");
    // mode guard 必须存在
    expect(modeGuardIdx).toBeGreaterThanOrEqual(0);
    // 若 completed 调用仍存在，它必须在 guard 的 else 分支（即 guard 先于 completed）
    if (completedIdx >= 0) {
      expect(modeGuardIdx).toBeLessThan(completedIdx);
    }
  });
});
