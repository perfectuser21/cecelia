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

  it('意识状态检查同时考虑 env var（CONSCIOUSNESS_ENABLED / BRAIN_QUIET_MODE），而不仅读 DB', () => {
    expect(ruminationFn).toContain('process.env.CONSCIOUSNESS_ENABLED');
    expect(ruminationFn).toContain('process.env.BRAIN_QUIET_MODE');
    expect(ruminationFn).toContain('envOff');
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
