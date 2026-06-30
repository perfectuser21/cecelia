/**
 * BEHAVIOR test: capability-probe.js probeRumination 心跳检查逻辑
 * 验证 probeRumination 阶段 4：心跳事件区分 loop_dead vs degraded_llm_failure vs invoke_no_digest
 *
 * 背景：PROBE_FAIL_RUMINATION 存在三种故障模式：
 * 1. loop_dead        — runRumination 完全未被调用（consciousness 禁用 / tick 停止）
 * 2. invoke_no_digest — runRumination 被调用但未进入 digestLearnings（无 items / 提前返回）
 * 3. degraded_llm_failure — digestLearnings 跑了但 LLM 全失败，无 insight 产出
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const PROBE_PATH = path.resolve('src/capability-probe.js');
const content = fs.readFileSync(PROBE_PATH, 'utf8');

// 提取 probeRumination 函数体（从 async function probeRumination 到下一个同级函数）
const fnMatch = content.match(/async function probeRumination\(\)[^]*?(?=\nasync function |\nexport )/);
const ruminationFn = fnMatch ? fnMatch[0] : '';

describe('probeRumination — 心跳事件区分 dead vs degraded', () => {
  it('失败路径查询 rumination_run 心跳事件（24h 窗口）', () => {
    expect(ruminationFn).toContain("event_type = 'rumination_run'");
    expect(ruminationFn).toContain('recentHeartbeats');
  });

  it('失败 detail 包含 heartbeats_24h 字段供运维诊断', () => {
    expect(ruminationFn).toContain('heartbeats_24h=');
  });

  it('心跳 > 0 时 livenessTag 标为 degraded_llm_failure', () => {
    expect(ruminationFn).toContain('degraded_llm_failure');
  });

  it('invoke > 0 且 heartbeat == 0 时 livenessTag 标为 invoke_no_digest', () => {
    expect(ruminationFn).toContain('invoke_no_digest');
  });

  it('invoke == 0 且 heartbeat == 0 时 livenessTag 标为 loop_dead', () => {
    expect(ruminationFn).toContain('loop_dead');
  });
});

describe('probeRumination — invoke 心跳（区分"未调用"与"无 items"）', () => {
  it('查询 rumination_invoke 事件（24h 窗口）', () => {
    expect(ruminationFn).toContain("event_type = 'rumination_invoke'");
    expect(ruminationFn).toContain('recentInvocations');
  });

  it('失败 detail 包含 invocations_24h 字段', () => {
    expect(ruminationFn).toContain('invocations_24h=');
  });
});

describe('probeRumination — loop_dead 时透出 consciousness + tick 状态', () => {
  it('loop_dead 分支查询 consciousness_enabled working_memory 键', () => {
    expect(ruminationFn).toContain("key = 'consciousness_enabled'");
    expect(ruminationFn).toContain('consciousness=');
  });

  it('loop_dead 分支查询 tick_last 以获取上次 tick 时间', () => {
    expect(ruminationFn).toContain("key = 'tick_last'");
    expect(ruminationFn).toContain('last_tick=');
  });

  it('consciousness DISABLED 时 detail 包含 consciousness=DISABLED', () => {
    expect(ruminationFn).toContain('consciousness=DISABLED');
    expect(ruminationFn).toContain('consciousnessEnabled');
  });

  it('意识状态检查通过 isConsciousnessEnabled() 获取（SSOT，不裸读 env var）', () => {
    expect(ruminationFn).toContain('isConsciousnessEnabled');
    expect(ruminationFn).not.toContain('process.env.CONSCIOUSNESS_ENABLED');
    expect(ruminationFn).not.toContain('process.env.BRAIN_QUIET_MODE');
  });

  it('env override 导致的 DISABLED 包含 (env_override) 后缀，便于区分 DB 设置 vs env 变量', () => {
    expect(ruminationFn).toContain('env_override');
  });
});

describe('probeRumination — loop_dead 时检测 BRAIN_MINIMAL_MODE（section 10.x 外层守卫）', () => {
  it('loop_dead 分支检查 BRAIN_MINIMAL_MODE 环境变量', () => {
    expect(ruminationFn).toContain('process.env.BRAIN_MINIMAL_MODE');
    expect(ruminationFn).toContain('minimalMode');
  });

  it('MINIMAL_MODE 启用时 detail 包含 minimal_mode=ENABLED(blocks_rumination)', () => {
    expect(ruminationFn).toContain('minimal_mode=ENABLED(blocks_rumination)');
  });

  it('MINIMAL_MODE 检查在 consciousness 检查之前（外层守卫先输出）', () => {
    const minimalIdx = ruminationFn.indexOf('BRAIN_MINIMAL_MODE');
    const consciousnessIdx = ruminationFn.indexOf("key = 'consciousness_enabled'");
    expect(minimalIdx).toBeGreaterThanOrEqual(0);
    expect(consciousnessIdx).toBeGreaterThanOrEqual(0);
    expect(minimalIdx).toBeLessThan(consciousnessIdx);
  });
});

describe('probeRumination — last_run 真实化 + LLM forensic 透出', () => {
  it('last_run 查询使用全局 max（不含 48h 过滤）— "last_run=never" 仅在表全空时出现', () => {
    // 关键断言：probe 内必须有一次"无 INTERVAL 过滤的 max(created_at)" 查询
    expect(ruminationFn).toMatch(/SELECT\s+max\(created_at\)\s+AS\s+last_run\s+FROM\s+synthesis_archive(?!\s*\n?\s*WHERE)/);
  });

  it('degraded_llm_failure 时查询最近一次 rumination_llm_failure 事件', () => {
    expect(ruminationFn).toContain("event_type = 'rumination_llm_failure'");
    expect(ruminationFn).toContain('ORDER BY created_at DESC');
  });

  it('detail 末尾透出 last_llm_failure 摘要（notebook + llm 错误）', () => {
    expect(ruminationFn).toContain('last_llm_failure');
    expect(ruminationFn).toContain('notebook=');
    expect(ruminationFn).toContain('llm=');
  });
});

describe('probeRumination — loop_dead 自愈机制（PROBE_FAIL_RUMINATION cp-05020002）', () => {
  it('probe 文件顶部导入 setConsciousnessEnabled 和 getConsciousnessStatus', () => {
    expect(content).toContain('setConsciousnessEnabled');
    expect(content).toContain('getConsciousnessStatus');
  });

  it('loop_dead 分支包含 self_heal 自愈标记字段（可观测性）', () => {
    expect(ruminationFn).toContain('self_heal=consciousness_reenabled');
    expect(ruminationFn).toContain('self_heal=direct_run');
    expect(ruminationFn).toContain('self_heal_fail=');
  });

  it('env_override 时不触发自愈（getConsciousnessStatus().env_override 检查）', () => {
    expect(ruminationFn).toContain('envOverride');
    expect(ruminationFn).toContain('getConsciousnessStatus');
    expect(ruminationFn).not.toContain('process.env.CONSCIOUSNESS_ENABLED');
    expect(ruminationFn).not.toContain('process.env.BRAIN_QUIET_MODE');
  });

  it('consciousness 被 DB 禁用时调用 setConsciousnessEnabled(pool, true) 重新启用', () => {
    expect(ruminationFn).toContain('setConsciousnessEnabled');
    expect(ruminationFn).toContain('setConsciousnessEnabled(pool, true)');
    expect(ruminationFn).toContain('consciousness_reenabled');
  });

  it('loop_dead 时动态导入 rumination.js 并调用 runRuminationForce（绕过 tick 且绕过冷却期）', () => {
    expect(ruminationFn).toContain("import('./rumination.js')");
    // 使用 Force 版本绕过 _lastRunAt 冷却检查，确保 rumination_invoke 事件始终被写入
    expect(ruminationFn).toContain('runRuminationForce(pool)');
    expect(ruminationFn).not.toContain('runRumination(pool)');
    expect(ruminationFn).toContain('direct_run');
  });

  it('Wave 2: Case A 和 Case B 自愈后都重启 consciousness loop（rumination 现由 consciousness-loop 调度）', () => {
    expect(ruminationFn).toContain("import('./consciousness-loop.js')");
    expect(ruminationFn).toContain('startConsciousnessLoop()');
    expect(ruminationFn).toContain('consciousness_loop_restarted');
    expect(ruminationFn).toContain('self_heal_loop_fail=');
  });

  it('minimal_mode 启用时不触发自愈（人工开关优先）', () => {
    expect(ruminationFn).toContain('!minimalMode');
  });
});

describe('probeRumination — 自愈 runRuminationForce 必须异步（防探针超时）', () => {
  it('self-heal direct_run 不阻塞探针 — runRuminationForce(pool) 不使用 await（fire-and-forget）', () => {
    // BUG: await runRuminationForce(pool) 触发 LLM/NotebookLM 调用，耗时 >30s → probe timeout
    // 修复: runRuminationForce(pool).then().catch() 异步执行，探针立即返回
    expect(ruminationFn).not.toContain('await runRuminationForce(pool)');
  });

  it('self-heal 启动后 loopDeadContext 包含 direct_run 标记（可观测性保持）', () => {
    // 即使 fire-and-forget，仍须在 detail 中记录自愈已触发
    expect(ruminationFn).toContain('self_heal=direct_run');
  });

  it('self-heal 使用 runRuminationForce 而非 runRumination — 冷却期不阻断 invocations_24h 写入', () => {
    // runRumination 有 _lastRunAt 冷却检查（10 分钟），若同进程内已有近期调用则跳过 rumination_invoke 事件写入
    // 导致下次 probe 仍看到 invocations_24h=0 → 误报 loop_dead。Force 版本绕过所有限制。
    expect(ruminationFn).toContain('runRuminationForce(pool)');
    expect(ruminationFn).not.toContain('runRumination(pool)');
  });
});

describe('probeRumination — Case A 自愈立即 direct_run（cp-05200001）', () => {
  it('Case A 和 Case B 都包含 import rumination.js + runRuminationForce（两处 direct_run 确保两种 loop_dead 场景都立即反刍）', () => {
    // 修复前：只有 Case B 有 import('./rumination.js')，count=1
    // 修复后：Case A（consciousness 重新启用后）也立即运行，count≥2
    const importCount = (ruminationFn.match(/import\('\.\/rumination\.js'\)/g) || []).length;
    expect(importCount).toBeGreaterThanOrEqual(2);
    // 所有 direct_run 使用 Force 版本，而非标准 runRumination（标准版有冷却期可能阻断）
    const forceCount = (ruminationFn.match(/runRuminationForce\(pool\)/g) || []).length;
    expect(forceCount).toBeGreaterThanOrEqual(2);
  });

  it('consciousness_reenabled 标记与 direct_run 标记都出现在函数体中（Case A 完整自愈链）', () => {
    expect(ruminationFn).toContain('consciousness_reenabled');
    expect(ruminationFn).toContain('direct_run');
    // consciousness_reenabled 在 if(!consEnabled) 分支，direct_run 也应在其后同一分支出现
    const reenabledIdx = ruminationFn.indexOf('consciousness_reenabled');
    const loopRestartedIdx = ruminationFn.indexOf('consciousness_loop_restarted');
    const firstDirectRunIdx = ruminationFn.indexOf('direct_run');
    // loop_restarted 在 Wave 2，direct_run 在 Wave 3，Wave 2 先于 Wave 3
    expect(loopRestartedIdx).toBeLessThan(firstDirectRunIdx);
    // consciousness_reenabled（Case A Wave 1）先于第一个 direct_run（Case A Wave 3）
    expect(reenabledIdx).toBeLessThan(firstDirectRunIdx);
  });
});

describe('probeRumination — loop_dead 自愈 grace period（防重复 auto-fix 派发）', () => {
  it('probe 函数体内查询 rumination_self_heal_initiated 事件（grace period 检测）', () => {
    expect(ruminationFn).toContain("event_type = 'rumination_self_heal_initiated'");
    expect(ruminationFn).toContain('selfHealGrace');
  });

  it('grace period 同时要求 rumination_invoke 在 30min 内（防止仅凭旧 heal 事件误判）', () => {
    expect(ruminationFn).toContain("event_type = 'rumination_invoke'");
    expect(ruminationFn).toContain('hasRecentInvoke');
    expect(ruminationFn).toContain('30 minutes');
  });

  it('grace period 检查窗口为 2 小时', () => {
    expect(ruminationFn).toContain('2 hours');
    expect(ruminationFn).toContain('hasRecentHeal');
  });

  it('grace period 生效时 detail 包含 self_heal_grace_period 标记（可观测性）', () => {
    expect(ruminationFn).toContain('self_heal_grace_period');
    expect(ruminationFn).toContain('heal_active');
    expect(ruminationFn).toContain('invoke_confirmed');
  });

  it('grace period 生效时返回 ok: true（避免重复派发 auto-fix）', () => {
    // grace period return 必须在自愈动作之前（先检查是否已在愈合中，再决定是否重新自愈）
    const graceIdx = ruminationFn.indexOf('self_heal_grace_period');
    const directRunIdx = ruminationFn.indexOf('self_heal=direct_run(bg)');
    expect(graceIdx).toBeGreaterThanOrEqual(0);
    expect(directRunIdx).toBeGreaterThanOrEqual(0);
    expect(graceIdx).toBeLessThan(directRunIdx);
  });

  it('自愈触发后写入 rumination_self_heal_initiated 事件（供下次 probe grace period 检查）', () => {
    expect(ruminationFn).toContain("'rumination_self_heal_initiated'");
    expect(ruminationFn).toContain("'capability-probe'");
    // 必须是 fire-and-forget（.catch）不阻塞 probe
    expect(ruminationFn).toContain('self_heal_initiated event write failed');
  });

  it('grace period 检查先于自愈动作（grace check → self-heal actions 顺序正确）', () => {
    const gracePeriodQueryIdx = ruminationFn.indexOf('selfHealGrace');
    const consEnabledSetIdx = ruminationFn.indexOf('setConsciousnessEnabled(pool, true)');
    expect(gracePeriodQueryIdx).toBeGreaterThanOrEqual(0);
    expect(consEnabledSetIdx).toBeGreaterThanOrEqual(0);
    expect(gracePeriodQueryIdx).toBeLessThan(consEnabledSetIdx);
  });
});
